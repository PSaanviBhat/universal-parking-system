<#
.SYNOPSIS
  End-to-end check of a deployed backend (P5.3): register -> login -> vehicle ->
  top-up -> balance -> facilities -> entry -> active session -> exit -> wallet
  debit -> operator sees the completed session -> repeated exit is not charged.

.EXAMPLE
  .\scripts\e2e-live.ps1 -BaseUrl https://parking-backend.onrender.com

  Prompts for the operator and admin passwords. In production, simulated payments
  are off, so the script pauses at the top-up step: log in to the mobile app with
  the printed test account and add money through Razorpay test checkout
  (UPI: success@razorpay), then press Enter. Use -SkipTopUp to test the debt path.
#>
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$FacilityName = 'Phoenix Mall',
  [string]$OperatorUser = 'operator1',
  [string]$AdminUser = 'superadmin',
  # Optional: pass these to run without prompts (e.g. against a dev backend).
  [string]$OperatorPassword,
  [string]$AdminPassword,
  [switch]$SkipTopUp
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$script:failures = 0

function Step([int]$n, [string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host ("PASS  {0,2}. {1} {2}" -f $n, $name, $detail) -ForegroundColor Green }
  else { Write-Host ("FAIL  {0,2}. {1} {2}" -f $n, $name, $detail) -ForegroundColor Red; $script:failures++ }
}

function Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = $null) {
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $headers; ContentType = 'application/json' }
  if ($null -ne $Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 6) }
  try {
    $data = Invoke-RestMethod @params
    return [pscustomobject]@{ Status = 200; Data = $data }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $msg = $_.ErrorDetails.Message
    return [pscustomobject]@{ Status = $status; Data = $(if ($msg) { $msg | ConvertFrom-Json } else { $null }) }
  }
}

function PlainText([System.Security.SecureString]$s) {
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

Write-Host "`nEnd-to-end check against $BaseUrl`n"
$opPass = if ($OperatorPassword) { $OperatorPassword } else { PlainText (Read-Host "Password for operator '$OperatorUser'" -AsSecureString) }
$adminPass = if ($AdminPassword) { $AdminPassword } else { PlainText (Read-Host "Password for admin '$AdminUser'" -AsSecureString) }

# 0. Health (first call may take ~1 min while a sleeping Render instance wakes up)
$health = Api GET '/health'
Step 0 'Backend health' ($health.Status -eq 200 -and $health.Data.status -eq 'healthy') "($($health.Data.services.database.status))"

# 1-2. Register + login a unique test driver
$n = (Get-Date).ToString('MMddHHmmss')
$email = "e2e_$n@example.test"
$phone = '7' + $n.Substring(1)
$password = "E2e-$n!"
$reg = Api POST '/api/auth/register' @{ name = "E2E Driver $n"; email = $email; phone = $phone; password = $password; tcAccepted = $true }
Step 1 'Register driver' ($reg.Status -eq 200 -and $reg.Data.success) $email
$login = Api POST '/api/auth/login' @{ email = $email; password = $password }
$token = $login.Data.data.token
Step 2 'Login' ([bool]$token)

# 3. Vehicle
$plate = "E2E$($n.Substring(4))"
$veh = Api POST '/api/vehicles' @{ licensePlate = $plate; nickname = 'E2E car' } $token
$vehicleId = $veh.Data.data.id
Step 3 'Add vehicle' ([bool]$vehicleId) $plate

# 4. Top-up
if ($SkipTopUp) {
  Step 4 'Top-up' $true '(skipped: testing the debt path)'
} else {
  $order = Api POST '/api/wallet/create-order' @{ amount = 100 } $token
  if ($order.Status -eq 200 -and $order.Data.data.isMock) {
    $top = Api POST '/api/wallet/topup' @{ razorpayOrderId = $order.Data.data.orderId } $token
    Step 4 'Top-up (simulated order)' ($top.Status -eq 200) "balance $($top.Data.data.newBalance)"
  } else {
    Step 4 'Create Razorpay order' ($order.Status -eq 200) $order.Data.data.orderId
    Write-Host "`n  Production payments are real (test mode). In the mobile app, log in as:" -ForegroundColor Yellow
    Write-Host "    email: $email    password: $password" -ForegroundColor Yellow
    Write-Host "  then Wallet -> Top Up -> pay with Razorpay test UPI 'success@razorpay'." -ForegroundColor Yellow
    Read-Host '  Press Enter once the top-up succeeded'
  }
}

# 5. Balance
$wallet = Api GET '/api/wallet' $null $token
$balanceBefore = [double]$wallet.Data.data.balance
Step 5 'Check balance' ($wallet.Status -eq 200) "Rs $balanceBefore"

# 6. Facilities + gate QR strings (admin)
$fac = Api GET '/api/facilities'
$facility = $fac.Data.data | Where-Object { $_.name -eq $FacilityName } | Select-Object -First 1
$adminLogin = Api POST '/api/admin-auth/login' @{ username = $AdminUser; password = $adminPass }
$adminFacilities = Api GET '/api/admin/facilities' $null $adminLogin.Data.token
$gates = ($adminFacilities.Data.data | Where-Object { $_.id -eq $facility.id }).gates
$entryQr = ($gates | Where-Object { $_.gateType -eq 'ENTRY' -and $_.isActive } | Select-Object -First 1).qrCodeData
$exitQr = ($gates | Where-Object { $_.gateType -eq 'EXIT' -and $_.isActive } | Select-Object -First 1).qrCodeData
Step 6 'View facilities + gate QRs' ([bool]$facility -and [bool]$entryQr -and [bool]$exitQr) $FacilityName

# 7. Entry
$entry = Api POST '/api/sessions/entry' @{ qrCodeData = $entryQr; vehicleId = $vehicleId } $token
$sessionId = $entry.Data.data.session.id
Step 7 'Enter gate' ($entry.Status -eq 200 -and [bool]$sessionId) "slot $($entry.Data.data.assignedSlot.slotNumber)"

# 8. Active session
$active = Api GET '/api/sessions/active' $null $token
Step 8 'View active session' (@($active.Data.data | Where-Object { $_.sessionId -eq $sessionId }).Count -eq 1)

# 9. Exit
$exit = Api POST '/api/sessions/exit' @{ qrCodeData = $exitQr; vehicleId = $vehicleId } $token
$fee = [double]$exit.Data.data.session.totalFee
Step 9 'Exit gate' ($exit.Status -eq 200) "fee Rs $fee, $($exit.Data.data.session.paymentStatus)"

# 10. Wallet debited exactly once, with a PARKING_CHARGE transaction
$walletAfter = Api GET '/api/wallet' $null $token
$balanceAfter = [double]$walletAfter.Data.data.balance
$txns = Api GET '/api/wallet/transactions' $null $token
$charge = $txns.Data.data.transactions | Where-Object { $_.sessionId -eq $sessionId -and $_.type -eq 'PARKING_CHARGE' }
Step 10 'Wallet debited' ([math]::Round($balanceBefore - $fee, 2) -eq [math]::Round($balanceAfter, 2) -and @($charge).Count -eq 1) "Rs $balanceBefore -> Rs $balanceAfter"

# 11. Operator sees the completed session
$opLogin = Api POST '/api/operator-auth/login' @{ username = $OperatorUser; password = $opPass }
$completed = Api GET "/api/operator/sessions/$($facility.id)?status=COMPLETED&limit=50" $null $opLogin.Data.token
Step 11 'Completed session on operator dashboard' (@($completed.Data.data | Where-Object { $_.sessionId -eq $sessionId }).Count -eq 1)

# 12. Repeated exit is refused and not charged again
$again = Api POST '/api/sessions/exit' @{ qrCodeData = $exitQr; vehicleId = $vehicleId } $token
$walletFinal = Api GET '/api/wallet' $null $token
Step 12 'Repeated exit not charged' ($again.Status -ge 400 -and [double]$walletFinal.Data.data.balance -eq $balanceAfter) "HTTP $($again.Status)"

Write-Host ''
if ($script:failures -eq 0) { Write-Host 'All end-to-end checks passed.' -ForegroundColor Green; exit 0 }
Write-Host "$($script:failures) check(s) failed." -ForegroundColor Red
exit 1

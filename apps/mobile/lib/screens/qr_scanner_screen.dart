import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../services/session_service.dart';
import '../services/vehicle_service.dart';
import '../services/wallet_service.dart';
import '../services/facility_service.dart';
import 'slot_assigned_screen.dart';
import 'exit_summary_screen.dart';

class QRScannerScreen extends StatefulWidget {
  const QRScannerScreen({super.key});

  @override
  State<QRScannerScreen> createState() => _QRScannerScreenState();
}

class _QRScannerScreenState extends State<QRScannerScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _isProcessing = false;
  String? _errorMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) async {
    if (_isProcessing) return;
    final barcode = capture.barcodes.firstOrNull;
    final rawValue = barcode?.rawValue;
    if (rawValue == null || rawValue.isEmpty) return;

    setState(() {
      _isProcessing = true;
      _errorMessage = null;
    });

    try {
      // Validate Gate QR format: PARKING_GATE:<gateId>:<facilityId>:<ENTRY|EXIT>
      final parts = rawValue.split(':');
      if (parts.length != 4 || parts[0] != 'PARKING_GATE') {
        throw 'Invalid parking QR code format. Please scan an authorized facility gate QR.';
      }

      final gateType = parts[3];
      final facilityId = parts[2];
      final isEntry = gateType == 'ENTRY';

      // Fetch user's registered vehicles (with their parking state) and, for entry,
      // the wallet balance and this facility's hourly rate for an up-front warning.
      final results = await Future.wait<dynamic>([
        VehicleService.getVehicles(),
        if (isEntry) WalletService.getWalletInfo(),
        if (isEntry) FacilityService.getFacility(facilityId),
      ]);
      final vehicles = results[0] as List<dynamic>;
      if (vehicles.isEmpty) {
        throw 'No registered vehicles found. Please add your vehicle under "My Vehicles" before entering.';
      }

      // A parked vehicle can't enter again; only a parked vehicle can exit.
      final eligible = vehicles.where((v) => (v['parkingState'] == 'PARKED') != isEntry).toList();
      if (eligible.isEmpty) {
        throw isEntry
            ? 'All your vehicles are already inside a parking facility. Exit first before entering again.'
            : 'None of your vehicles has an active parking session, so there is nothing to exit.';
      }

      String? balanceWarning;
      if (isEntry) {
        final wallet = results[1] as Map<String, dynamic>?;
        final facility = results[2] as Map<String, dynamic>?;
        final balance = (wallet?['balance'] as num?)?.toDouble();
        final rate = (facility?['feeRatePerHour'] as num?)?.toDouble();
        if (wallet?['isSuspended'] == true) {
          throw 'Your account is suspended due to unpaid dues. Top up your wallet to clear them before parking.';
        }
        if (balance != null && rate != null && balance < rate) {
          balanceWarning = balance < 0
              ? 'You owe ₹${balance.abs().toStringAsFixed(2)}. You can still park, but please top up soon.'
              : 'Your balance (₹${balance.toStringAsFixed(2)}) is below the 1-hour minimum of ₹${rate.toStringAsFixed(0)} here. '
                  'You can still park; top up before you exit to avoid going into debt.';
        }
      }

      if (!mounted) return;

      // Select Vehicle Bottom Sheet
      final selectedVehicle = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        builder: (ctx) => _VehicleSelectorSheet(
          vehicles: vehicles,
          gateType: gateType,
          balanceWarning: balanceWarning,
        ),
      );

      if (selectedVehicle == null) {
        setState(() => _isProcessing = false);
        return;
      }

      final vehicleId = selectedVehicle['id'] as String;

      if (gateType == 'ENTRY') {
        // Enter parking
        final session = await SessionService.enterParking(
          qrCodeData: rawValue,
          vehicleId: vehicleId,
        );

        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => SlotAssignedScreen(session: session),
          ),
        );
      } else {
        // Exit parking
        final exitResult = await SessionService.exitParking(
          qrCodeData: rawValue,
          vehicleId: vehicleId,
        );

        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => ExitSummaryScreen(exitData: exitResult),
          ),
        );
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception:', '').trim();
        _isProcessing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Scan Gate QR Code'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            onPressed: () => _controller.toggleTorch(),
            icon: const Icon(Icons.flash_on_rounded),
            tooltip: 'Flashlight',
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),

          // Reticle Scanner Overlay
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: const Color(0xFF38BDF8), width: 3),
                borderRadius: BorderRadius.circular(24),
              ),
            ),
          ),

          // Instructions at bottom
          Positioned(
            bottom: 40,
            left: 24,
            right: 24,
            child: Column(
              children: [
                if (_errorMessage != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.red.shade900.withOpacity(0.9),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.red.shade400),
                    ),
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                  ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(30),
                    border: Border.all(color: Colors.white24),
                  ),
                  child: const Text(
                    'Point camera at the parking gate QR display',
                    style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),

          if (_isProcessing)
            Container(
              color: Colors.black54,
              child: const Center(
                child: CircularProgressIndicator(color: Color(0xFF38BDF8)),
              ),
            ),
        ],
      ),
    );
  }
}

class _VehicleSelectorSheet extends StatefulWidget {
  final List<dynamic> vehicles;
  final String gateType;
  final String? balanceWarning;

  const _VehicleSelectorSheet({required this.vehicles, required this.gateType, this.balanceWarning});

  @override
  State<_VehicleSelectorSheet> createState() => _VehicleSelectorSheetState();
}

class _VehicleSelectorSheetState extends State<_VehicleSelectorSheet> {
  String? _selectedId;

  bool _isEligible(dynamic v) => (v['parkingState'] == 'PARKED') != (widget.gateType == 'ENTRY');

  @override
  void initState() {
    super.initState();
    final firstEligible = widget.vehicles.where(_isEligible);
    if (firstEligible.isNotEmpty) {
      _selectedId = firstEligible.first['id'];
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                widget.gateType == 'ENTRY' ? 'Select Vehicle for Entry' : 'Select Vehicle for Exit',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
            ],
          ),
          if (widget.balanceWarning != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFBEB),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFCD34D)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.account_balance_wallet_outlined, color: Color(0xFFB45309), size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.balanceWarning!,
                      style: const TextStyle(color: Color(0xFF92400E), fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
          ...widget.vehicles.map((v) {
            final isSelected = _selectedId == v['id'];
            final eligible = _isEligible(v);
            return GestureDetector(
              onTap: eligible ? () => setState(() => _selectedId = v['id']) : null,
              child: Opacity(
                opacity: eligible ? 1 : 0.45,
                child: Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFFEFF6FF) : Colors.grey.shade50,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: isSelected ? const Color(0xFF2563EB) : Colors.black12,
                    width: isSelected ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.directions_car_rounded,
                      color: isSelected ? const Color(0xFF2563EB) : Colors.black54,
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            v['licensePlate'] ?? '',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                          ),
                          if (v['nickname'] != null && v['nickname'].toString().isNotEmpty)
                            Text(
                              v['nickname'],
                              style: const TextStyle(color: Colors.black54, fontSize: 12),
                            ),
                          if (!eligible)
                            Text(
                              widget.gateType == 'ENTRY' ? 'Already inside a facility' : 'Not parked',
                              style: const TextStyle(color: Colors.black54, fontSize: 11, fontStyle: FontStyle.italic),
                            ),
                        ],
                      ),
                    ),
                    if (isSelected)
                      const Icon(Icons.check_circle_rounded, color: Color(0xFF2563EB)),
                  ],
                ),
              ),
              ),
            );
          }),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: _selectedId == null
                  ? null
                  : () {
                      final selected = widget.vehicles.firstWhere((v) => v['id'] == _selectedId);
                      Navigator.pop(context, selected);
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1E3A5F),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text(
                widget.gateType == 'ENTRY' ? 'Confirm & Enter' : 'Confirm & Exit',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

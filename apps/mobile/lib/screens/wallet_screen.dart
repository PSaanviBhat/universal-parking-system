import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/wallet_service.dart';
import 'topup_screen.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? _walletData;
  List<dynamic> _transactions = [];
  List<dynamic> _paymentMethods = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    setState(() => _isLoading = true);
    final results = await Future.wait([
      WalletService.getWalletInfo(),
      WalletService.getTransactions(),
      WalletService.getPaymentMethods(),
    ]);

    if (mounted) {
      setState(() {
        _walletData = results[0] as Map<String, dynamic>?;
        _transactions = (results[1] as List<dynamic>?) ?? [];
        _paymentMethods = (results[2] as List<dynamic>?) ?? [];
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final double balance = (_walletData?['balance'] as num?)?.toDouble() ?? 0.0;
    final bool isDebt = _walletData?['isDebt'] == true;
    final double debtAmount = (_walletData?['debtAmount'] as num?)?.toDouble() ?? 0.0;
    final double? debtHours = (_walletData?['debtHoursRemaining'] as num?)?.toDouble();

    final currencyFmt = NumberFormat.currency(locale: 'en_IN', symbol: '₹');
    final dateFmt = DateFormat('dd MMM yyyy, hh:mm a');

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Digital Wallet'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadAll,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Wallet Balance Card
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF1E3A5F), Color(0xFF0F172A)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(22),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF1E3A5F).withOpacity(0.3),
                            blurRadius: 18,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                'TOTAL AVAILABLE BALANCE',
                                style: TextStyle(
                                  color: Colors.white60,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 1,
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: isDebt ? Colors.red.shade500 : const Color(0xFF10B981),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  isDebt ? 'DEBT' : 'CLEAR',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(
                            currencyFmt.format(balance),
                            style: TextStyle(
                              color: isDebt ? const Color(0xFFFCA5A5) : Colors.white,
                              fontSize: 36,
                              fontWeight: FontWeight.bold,
                              letterSpacing: -1,
                            ),
                          ),
                          if (isDebt) ...[
                            const SizedBox(height: 8),
                            Text(
                              'Outstanding Debt: ₹${debtAmount.toStringAsFixed(2)}${debtHours != null ? " • Due in ${debtHours.toStringAsFixed(1)}h" : ""}',
                              style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 13),
                            ),
                          ],
                          const SizedBox(height: 20),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (_) => const TopUpScreen()),
                                ).then((_) => _loadAll());
                              },
                              icon: const Icon(Icons.add_rounded, size: 20),
                              label: const Text('Top Up Wallet (Min ₹35)'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF38BDF8),
                                foregroundColor: const Color(0xFF0F172A),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                elevation: 0,
                                textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 28),

                    // Payment Methods Section
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Linked Payment Methods',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                        ),
                        TextButton(
                          onPressed: () async {
                            final type = await showDialog<String>(
                              context: context,
                              builder: (ctx) => SimpleDialog(
                                title: const Text('Select Payment Type'),
                                children: [
                                  SimpleDialogOption(
                                    onPressed: () => Navigator.pop(ctx, 'UPI'),
                                    child: const Text('UPI (Google Pay, PhonePe, Paytm)'),
                                  ),
                                  SimpleDialogOption(
                                    onPressed: () => Navigator.pop(ctx, 'CARD'),
                                    child: const Text('Debit / Credit Card'),
                                  ),
                                  SimpleDialogOption(
                                    onPressed: () => Navigator.pop(ctx, 'NETBANKING'),
                                    child: const Text('Netbanking'),
                                  ),
                                ],
                              ),
                            );

                            if (type != null) {
                              await WalletService.addPaymentMethod(type: type);
                              _loadAll();
                            }
                          },
                          child: const Text('+ Add Method'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_paymentMethods.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: Colors.black.withOpacity(0.06)),
                        ),
                        child: const Text(
                          'No payment methods linked yet. Add UPI or Card for automatic debt clearance.',
                          style: TextStyle(color: Colors.black54, fontSize: 13),
                        ),
                      )
                    else
                      Column(
                        children: _paymentMethods.map((pm) {
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Colors.black.withOpacity(0.06)),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  pm['type'] == 'CARD'
                                      ? Icons.credit_card_rounded
                                      : Icons.account_balance_rounded,
                                  color: const Color(0xFF2563EB),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    pm['type'] ?? 'PAYMENT METHOD',
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                  ),
                                ),
                                if (pm['isPrimary'] == true)
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.blue.shade50,
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: Colors.blue.shade200),
                                    ),
                                    child: const Text(
                                      'PRIMARY',
                                      style: TextStyle(color: Colors.blue, fontSize: 10, fontWeight: FontWeight.bold),
                                    ),
                                  ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),

                    const SizedBox(height: 28),

                    // Transaction Passbook Section
                    const Text(
                      'Transaction History',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                    ),
                    const SizedBox(height: 12),
                    if (_transactions.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(24),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: Colors.black.withOpacity(0.06)),
                        ),
                        child: const Text(
                          'No transactions yet.',
                          style: TextStyle(color: Colors.black54),
                        ),
                      )
                    else
                      ListView.separated(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: _transactions.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final t = _transactions[index];
                          final isCredit = t['type'] == 'TOP_UP' || t['type'] == 'DEBT_REPAYMENT';
                          final double amt = (t['amount'] as num?)?.toDouble() ?? 0.0;
                          final dateStr = t['createdAt'] != null
                              ? dateFmt.format(DateTime.parse(t['createdAt']))
                              : '';

                          return Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Colors.black.withOpacity(0.06)),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: (isCredit ? const Color(0xFF10B981) : Colors.red).withOpacity(0.1),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    isCredit ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
                                    color: isCredit ? const Color(0xFF10B981) : Colors.red,
                                    size: 18,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        t['description'] ?? t['type'] ?? 'Transaction',
                                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        dateStr,
                                        style: const TextStyle(color: Colors.black45, fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                                Text(
                                  '${isCredit ? "+" : "-"} ₹${amt.toStringAsFixed(2)}',
                                  style: TextStyle(
                                    color: isCredit ? const Color(0xFF047857) : Colors.red.shade700,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 15,
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                  ],
                ),
              ),
            ),
    );
  }
}

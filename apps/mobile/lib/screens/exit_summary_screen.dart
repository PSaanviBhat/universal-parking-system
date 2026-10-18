import 'package:flutter/material.dart';
import 'home_screen.dart';

class ExitSummaryScreen extends StatelessWidget {
  final Map<String, dynamic> exitData;

  const ExitSummaryScreen({super.key, required this.exitData});

  @override
  Widget build(BuildContext context) {
    final closedSession = exitData['closedSession'] ?? exitData['session'] ?? {};
    final updatedWallet = exitData['updatedWallet'] ?? {};
    final double totalFee = (closedSession['totalFee'] as num?)?.toDouble() ?? 0.0;
    final int durationMins = (closedSession['durationMinutes'] as num?)?.toInt() ?? 0;
    final double newBalance = (updatedWallet['balance'] as num?)?.toDouble() ?? 0.0;
    final bool isDebt = newBalance < 0;

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
          child: Column(
            children: [
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withOpacity(0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.check_circle_rounded, color: Color(0xFF10B981), size: 64),
              ),
              const SizedBox(height: 16),
              const Text(
                'Exit Barrier Cleared!',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Thank you for using Universal Parking.',
                style: TextStyle(color: Colors.white60, fontSize: 13),
              ),
              const SizedBox(height: 28),

              // Summary Card
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(22),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.2),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    const Text(
                      'TOTAL PARKING FEE',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: Colors.black45,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '₹${totalFee.toStringAsFixed(2)}',
                      style: const TextStyle(
                        fontSize: 38,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF1E3A5F),
                        letterSpacing: -1,
                      ),
                    ),
                    const SizedBox(height: 20),
                    const Divider(),
                    const SizedBox(height: 12),
                    _summaryRow('Duration', '${(durationMins / 60).floor()}h ${durationMins % 60}m'),
                    _summaryRow('Payment Status', isDebt ? 'UNPAID (DEBT)' : 'PAID (WALLET)'),
                    _summaryRow(
                      'Wallet Balance',
                      '₹${newBalance.toStringAsFixed(2)}',
                      valueColor: isDebt ? Colors.red.shade700 : const Color(0xFF047857),
                    ),
                  ],
                ),
              ),

              if (isDebt) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFFCA5A5)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.info_outline_rounded, color: Color(0xFFDC2626), size: 22),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Your wallet had insufficient balance. A 48-hour repayment window is open before autopay/fine triggers.',
                          style: TextStyle(color: Color(0xFF991B1B), fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              const Spacer(),

              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pushAndRemoveUntil(
                      context,
                      MaterialPageRoute(builder: (_) => const HomeScreen()),
                      (route) => false,
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF38BDF8),
                    foregroundColor: const Color(0xFF0F172A),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Done / Back to Home',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.black54, fontSize: 13)),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 13,
              color: valueColor ?? Colors.black87,
            ),
          ),
        ],
      ),
    );
  }
}

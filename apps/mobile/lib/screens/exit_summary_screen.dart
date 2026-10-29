import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'home_screen.dart';

/// Receipt shown right after a successful exit.
/// Reads `POST /api/sessions/exit` data: `session{...}`, `wallet{previousBalance,
/// amountDeducted, remainingBalance, isDebt, debtAmount, debtDeadline}`, `exitGateName`.
class ExitSummaryScreen extends StatelessWidget {
  final Map<String, dynamic> exitData;

  const ExitSummaryScreen({super.key, required this.exitData});

  static double _num(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0.0;

  @override
  Widget build(BuildContext context) {
    final session = Map<String, dynamic>.from(exitData['session'] ?? const {});
    final wallet = Map<String, dynamic>.from(exitData['wallet'] ?? const {});
    final double totalFee = _num(session['totalFee']);
    final int durationMins = _num(session['durationMinutes']).toInt();
    final double previousBalance = _num(wallet['previousBalance']);
    final double deducted = _num(wallet['amountDeducted'] ?? totalFee);
    final double remaining = _num(wallet['remainingBalance']);
    final bool isDebt = wallet['isDebt'] == true || remaining < 0;
    final deadline = wallet['debtDeadline'] != null ? DateTime.tryParse(wallet['debtDeadline'].toString())?.toLocal() : null;

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
                child: Column(
                  children: [
                    const SizedBox(height: 12),
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
                      style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.bold, letterSpacing: -0.5),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      [session['licensePlate'], session['facilityName']].where((e) => e != null).join(' • '),
                      style: const TextStyle(color: Colors.white60, fontSize: 13),
                    ),
                    const SizedBox(height: 28),

                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(22),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(22),
                      ),
                      child: Column(
                        children: [
                          const Text(
                            'PARKING CHARGE',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.black45, letterSpacing: 1),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '₹${totalFee.toStringAsFixed(2)}',
                            style: const TextStyle(fontSize: 38, fontWeight: FontWeight.w900, color: Color(0xFF1E3A5F), letterSpacing: -1),
                          ),
                          const SizedBox(height: 16),
                          const Divider(),
                          const SizedBox(height: 12),
                          _summaryRow('Duration', '${durationMins ~/ 60}h ${durationMins % 60}m'),
                          if (session['slotNumber'] != null)
                            _summaryRow('Slot', '${session['slotNumber']} (${session['levelName'] ?? ''})'),
                          _summaryRow('Wallet before exit', '₹${previousBalance.toStringAsFixed(2)}'),
                          _summaryRow('Amount deducted', '− ₹${deducted.toStringAsFixed(2)}'),
                          _summaryRow(
                            'Remaining balance',
                            '₹${remaining.toStringAsFixed(2)}',
                            valueColor: isDebt ? Colors.red.shade700 : const Color(0xFF047857),
                          ),
                          _summaryRow('Payment status', isDebt ? 'UNPAID (DEBT)' : 'PAID FROM WALLET'),
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
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.info_outline_rounded, color: Color(0xFFDC2626), size: 22),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Your wallet didn\'t cover this charge, so you owe ₹${remaining.abs().toStringAsFixed(2)}. '
                                '${deadline != null ? 'Top up by ${DateFormat('dd MMM, hh:mm a').format(deadline)} ' : 'Top up soon '}'
                                'to avoid an automatic autopay charge, or a fine and account suspension if that fails.',
                                style: const TextStyle(color: Color(0xFF991B1B), fontSize: 12),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
              child: SizedBox(
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
                  child: const Text('Done / Back to Home', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
            ),
          ],
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
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: valueColor ?? Colors.black87),
          ),
        ],
      ),
    );
  }
}

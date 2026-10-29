import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../models/session_view.dart';
import '../widgets/slot_location_card.dart';
import 'active_session_screen.dart';

class SlotAssignedScreen extends StatelessWidget {
  final SessionView session;

  const SlotAssignedScreen({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    final sessionId = session.id ?? '';

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 20, 24, 12),
                child: Column(
                  children: [
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check_circle_rounded, color: Color(0xFF10B981), size: 56),
                    ),
                    const SizedBox(height: 14),
                    const Text(
                      'Gate Opened • Slot Assigned!',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      session.licensePlate,
                      style: const TextStyle(color: Colors.white70, fontSize: 14),
                    ),
                    const SizedBox(height: 20),

                    if (session.walletWarning != null) ...[
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFFCD34D)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.account_balance_wallet_outlined, color: Color(0xFFB45309)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                session.walletWarning!,
                                style: const TextStyle(color: Color(0xFF92400E), fontSize: 12.5),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    SlotLocationCard(session: session),
                    const SizedBox(height: 16),

                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Column(
                        children: [
                          if (sessionId.isNotEmpty)
                            QrImageView(
                              data: sessionId,
                              version: QrVersions.auto,
                              size: 120.0,
                            ),
                          const SizedBox(height: 8),
                          const Text(
                            'Show this to parking staff if they need to verify your session.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.black54, fontSize: 12),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Rate: ₹${session.hourlyRate.toStringAsFixed(0)}/hr (1st hour minimum applies)',
                            style: const TextStyle(color: Colors.black87, fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ),
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
                    Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(builder: (_) => ActiveSessionScreen(session: session)),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF38BDF8),
                    foregroundColor: const Color(0xFF0F172A),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: const Text(
                    'View Active Session Timer',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

import 'dart:async';
import 'package:flutter/material.dart';
import '../models/session_view.dart';
import '../services/session_service.dart';
import '../widgets/slot_location_card.dart';
import 'qr_scanner_screen.dart';

class ActiveSessionScreen extends StatefulWidget {
  final SessionView session;

  const ActiveSessionScreen({super.key, required this.session});

  @override
  State<ActiveSessionScreen> createState() => _ActiveSessionScreenState();
}

class _ActiveSessionScreenState extends State<ActiveSessionScreen> {
  late SessionView _session;
  Timer? _timer;
  DateTime _now = DateTime.now();
  bool _isLoading = false;
  bool _hasEnded = false;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _syncWithServer();
  }

  /// Picks up changes made elsewhere (operator reassignment or force-close).
  Future<void> _syncWithServer() async {
    final id = _session.id;
    if (id == null) return;
    try {
      final active = await SessionService.getActiveSessions();
      if (!mounted) return;
      final match = active.where((s) => s.id == id);
      setState(() {
        if (match.isNotEmpty) {
          _session = match.first;
          _hasEnded = false;
        } else {
          _hasEnded = true;
        }
      });
    } catch (_) {
      // Offline: keep showing the last known state.
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _handleReassign() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Slot Blocked / Obstructed?'),
        content: const Text(
          'We will automatically assign the next available slot and alert the parking staff.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E3A5F)),
            child: const Text('Reassign Slot', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm != true) return;
    final sessionId = _session.id;
    if (sessionId == null) return;

    setState(() => _isLoading = true);
    try {
      final reassigned = await SessionService.reassignSlot(sessionId);
      if (!mounted) return;
      final newSlot = Map<String, dynamic>.from(reassigned['newAssignedSlot'] as Map);
      setState(() {
        _session = _session.withSlot(newSlot);
        _isLoading = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('New slot assigned: ${_session.slotNumber} on ${_session.levelName}'),
          backgroundColor: const Color(0xFF10B981),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Reassign failed: $e'), backgroundColor: Colors.red),
      );
    }
  }

  String _formatDuration(Duration d) {
    String twoDigits(int n) => n.toString().padLeft(2, '0');
    return '${twoDigits(d.inHours)}:${twoDigits(d.inMinutes.remainder(60))}:${twoDigits(d.inSeconds.remainder(60))}';
  }

  @override
  Widget build(BuildContext context) {
    final entry = _session.entryTime;
    final elapsed = entry == null ? Duration.zero : _now.difference(entry);
    final runningFee = _session.feeAt(_now);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Active Parking Session'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _syncWithServer,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                if (_hasEnded)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFFCA5A5)),
                    ),
                    child: const Text(
                      'This session is no longer active — it was closed at the exit or by parking staff. '
                      'Check Parking History for the receipt.',
                      style: TextStyle(color: Color(0xFF991B1B), fontSize: 12.5),
                    ),
                  ),

                // Live timer
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: Colors.black.withOpacity(0.06)),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'SESSION ELAPSED TIME',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.black45, letterSpacing: 1.2),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _formatDuration(elapsed.isNegative ? Duration.zero : elapsed),
                        style: const TextStyle(fontSize: 42, fontWeight: FontWeight.bold, color: Color(0xFF0F172A), letterSpacing: -1),
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          'Estimated Fee: ₹${runningFee.toStringAsFixed(2)}',
                          style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.bold, fontSize: 14),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${_session.licensePlate} • ₹${_session.hourlyRate.toStringAsFixed(0)}/hr, 1-hour minimum',
                        style: const TextStyle(color: Colors.black54, fontSize: 12),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),
                SlotLocationCard(session: _session),
                const SizedBox(height: 20),

                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _isLoading || _hasEnded ? null : _handleReassign,
                    icon: const Icon(Icons.swap_horiz_rounded),
                    label: const Text('Slot Blocked? Request Reassignment'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFEA580C),
                      side: const BorderSide(color: Color(0xFFFDBA74)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                  ),
                ),

                const SizedBox(height: 28),

                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: ElevatedButton.icon(
                    onPressed: _hasEnded
                        ? null
                        : () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const QRScannerScreen()),
                            );
                          },
                    icon: const Icon(Icons.qr_code_scanner_rounded, color: Colors.white),
                    label: const Text(
                      'Scan Exit Gate QR to Leave',
                      style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1E3A5F),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 0,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

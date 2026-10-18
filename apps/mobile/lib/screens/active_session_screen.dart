import 'dart:async';
import 'package:flutter/material.dart';
import '../services/session_service.dart';
import 'qr_scanner_screen.dart';

class ActiveSessionScreen extends StatefulWidget {
  final Map<String, dynamic> session;

  const ActiveSessionScreen({super.key, required this.session});

  @override
  State<ActiveSessionScreen> createState() => _ActiveSessionScreenState();
}

class _ActiveSessionScreenState extends State<ActiveSessionScreen> {
  late Map<String, dynamic> _session;
  Timer? _timer;
  Duration _elapsed = Duration.zero;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    _initTimer();
  }

  void _initTimer() {
    final entryTimeStr = _session['entryTime'] as String?;
    if (entryTimeStr != null) {
      final entryTime = DateTime.parse(entryTimeStr);
      _elapsed = DateTime.now().difference(entryTime);
    }

    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {
          _elapsed += const Duration(seconds: 1);
        });
      }
    });
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
          'We will automatically find and reassign the next closest available slot on this level.',
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

    setState(() => _isLoading = true);
    final sessionId = _session['id'] ?? _session['sessionId'];

    try {
      final reassigned = await SessionService.reassignSlot(sessionId);
      if (!mounted) return;
      setState(() {
        _session = {
          ..._session,
          'slot': reassigned['newAssignedSlot'],
          'assignedSlot': reassigned['newAssignedSlot'],
        };
        _isLoading = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'New Slot Assigned: ${reassigned["newAssignedSlot"]?["slotNumber"]} on ${reassigned["newAssignedSlot"]?["levelName"]}',
          ),
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
    final hours = twoDigits(d.inHours);
    final minutes = twoDigits(d.inMinutes.remainder(60));
    final seconds = twoDigits(d.inSeconds.remainder(60));
    return '$hours:$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final slot = _session['assignedSlot'] ?? _session['slot'] ?? {};
    final level = slot['level'] ?? {};
    final facility = _session['facility'] ?? {};
    final vehicle = _session['vehicle'] ?? {};
    final rate = _session['hourlyRateSnapshot'] ?? _session['feeRateSnapshot'] ?? 30;

    // Calculate running fee
    final double durationHours = _elapsed.inMinutes / 60.0;
    final double hourlyRate = (rate as num).toDouble();
    final double runningFee = hourlyRate * (durationHours < 1.0 ? 1.0 : durationHours);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Active Parking Session'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Live Timer Circle
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: Colors.black.withOpacity(0.06)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    const Text(
                      'SESSION ELAPSED TIME',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: Colors.black45,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _formatDuration(_elapsed),
                      style: const TextStyle(
                        fontSize: 42,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF0F172A),
                        letterSpacing: -1,
                      ),
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
                        style: const TextStyle(
                          color: Color(0xFF2563EB),
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Location Details Card
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.black.withOpacity(0.06)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Parking Details',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                    const SizedBox(height: 16),
                    _detailRow('Facility', facility['name'] ?? 'Parking Facility'),
                    _detailRow('Vehicle', vehicle['licensePlate'] ?? 'Registered Vehicle'),
                    _detailRow('Assigned Slot', '${slot["slotNumber"] ?? "N/A"} (${level["displayName"] ?? ""})'),
                    _detailRow('Hourly Rate', '₹$rate/hr'),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Obstructed Slot Action
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _isLoading ? null : _handleReassign,
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

              // Exit Gate Button
              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton.icon(
                  onPressed: () {
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
    );
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.black54, fontSize: 13)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Receipt for one past session. Takes an item from `GET /api/sessions/history`
/// (flat fields: facilityName, licensePlate, slotNumber, levelName, entryGate,
/// exitGate, entryTime, exitTime, durationMinutes, hourlyRate, totalFee,
/// paymentStatus, status, resolutionNote).
class SessionDetailScreen extends StatelessWidget {
  final Map<String, dynamic> session;

  const SessionDetailScreen({super.key, required this.session});

  static String _paymentLabel(String? paymentStatus, String? status) {
    if (status == 'DISPUTED') return 'Under review (disputed)';
    switch (paymentStatus) {
      case 'PAID':
        return 'Paid from wallet';
      case 'DEBT':
        return 'Unpaid — within repayment window';
      case 'AUTOPAY_PENDING':
        return 'Autopay in progress';
      case 'FINED':
        return 'Unpaid — fined';
      default:
        return paymentStatus ?? '—';
    }
  }

  @override
  Widget build(BuildContext context) {
    final double totalFee = (session['totalFee'] as num?)?.toDouble() ?? 0.0;
    final int duration = (session['durationMinutes'] as num?)?.toInt() ?? 0;
    final double? rate = (session['hourlyRate'] as num?)?.toDouble();
    final dateFmt = DateFormat('dd MMM yyyy, hh:mm a');

    String fmt(dynamic v, String fallback) =>
        v != null ? dateFmt.format(DateTime.parse(v.toString()).toLocal()) : fallback;

    final paymentStatus = session['paymentStatus']?.toString();
    final isPaid = paymentStatus == 'PAID' && session['status'] != 'DISPUTED';

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Parking Receipt'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.black.withOpacity(0.06)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                session['facilityName'] ?? 'Parking Facility',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                session['facilityAddress'] ?? '',
                style: const TextStyle(color: Colors.black54, fontSize: 13),
              ),
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 16),
              _detailItem('Vehicle Number', session['licensePlate'] ?? 'N/A'),
              _detailItem('Parking Slot', '${session["slotNumber"] ?? "N/A"} (${session["levelName"] ?? ""})'),
              _detailItem('Entry', '${fmt(session['entryTime'], 'N/A')}\n${session['entryGate'] ?? ''}'),
              _detailItem('Exit', '${fmt(session['exitTime'], '—')}\n${session['exitGate'] ?? 'Closed by parking staff'}'),
              _detailItem('Duration', '${duration ~/ 60}h ${duration % 60}m'),
              if (rate != null) _detailItem('Rate Snapshot', '₹${rate.toStringAsFixed(0)}/hr (1-hour minimum)'),
              _detailItem('Payment', _paymentLabel(paymentStatus, session['status']?.toString()),
                  valueColor: isPaid ? const Color(0xFF047857) : Colors.red.shade700),
              if (session['resolutionNote'] != null)
                _detailItem('Staff note', session['resolutionNote'].toString()),
              const SizedBox(height: 12),
              const Divider(),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Total Charged', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  Text(
                    '₹${totalFee.toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Color(0xFF1E3A5F)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _detailItem(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.black54, fontSize: 13)),
          const SizedBox(width: 16),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: valueColor),
            ),
          ),
        ],
      ),
    );
  }
}

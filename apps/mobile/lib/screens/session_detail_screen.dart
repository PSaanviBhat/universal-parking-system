import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class SessionDetailScreen extends StatelessWidget {
  final Map<String, dynamic> session;

  const SessionDetailScreen({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    final facility = session['facility'] ?? {};
    final vehicle = session['vehicle'] ?? {};
    final slot = session['slot'] ?? {};
    final level = slot['level'] ?? {};
    final double totalFee = (session['totalFee'] as num?)?.toDouble() ?? 0.0;
    final int duration = (session['durationMinutes'] as num?)?.toInt() ?? 0;
    final dateFmt = DateFormat('dd MMM yyyy, hh:mm a');

    final entryTimeStr = session['entryTime'] != null
        ? dateFmt.format(DateTime.parse(session['entryTime']))
        : 'N/A';
    final exitTimeStr = session['exitTime'] != null
        ? dateFmt.format(DateTime.parse(session['exitTime']))
        : 'Active';

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
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
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
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    facility['name'] ?? 'Parking Facility',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    facility['address'] ?? '',
                    style: const TextStyle(color: Colors.black54, fontSize: 13),
                  ),
                  const SizedBox(height: 20),
                  const Divider(),
                  const SizedBox(height: 16),
                  _detailItem('Vehicle Number', vehicle['licensePlate'] ?? 'N/A'),
                  _detailItem('Parking Slot', '${slot["slotNumber"] ?? "N/A"} (${level["displayName"] ?? ""})'),
                  _detailItem('Entry Time', entryTimeStr),
                  _detailItem('Exit Time', exitTimeStr),
                  _detailItem('Duration', '${(duration / 60).floor()}h ${duration % 60}m'),
                  _detailItem('Rate Snapshot', '₹${session["feeRateSnapshot"] ?? 30}/hr'),
                  const SizedBox(height: 12),
                  const Divider(),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total Charged',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      Text(
                        '₹${totalFee.toStringAsFixed(2)}',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF1E3A5F),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailItem(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
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

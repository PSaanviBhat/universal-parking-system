import 'package:flutter/material.dart';
import '../models/session_view.dart';

/// Where the car is: facility, level, slot, step-by-step directions and a floor
/// map with the slot marked. Uses the level's floor-map image when the facility
/// uploaded one, otherwise a simple schematic with the marker at the slot's
/// coordinates (percent of the level plan).
class SlotLocationCard extends StatelessWidget {
  final SessionView session;

  const SlotLocationCard({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    final hasCoordinates = session.coordinateX != null && session.coordinateY != null;

    return Container(
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
          Row(
            children: [
              const Icon(Icons.location_on_rounded, color: Color(0xFF2563EB)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  session.facilityName.isEmpty ? 'Your parking spot' : session.facilityName,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _pill('Level', session.levelName.isEmpty ? '—' : session.levelName),
              const SizedBox(width: 10),
              _pill('Slot', session.slotNumber.isEmpty ? '—' : session.slotNumber),
            ],
          ),
          if (session.directions != null && session.directions!.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.turn_right_rounded, size: 20, color: Colors.black54),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    session.directions!,
                    style: const TextStyle(fontSize: 13, color: Color(0xFF334155), height: 1.4),
                  ),
                ),
              ],
            ),
          ],
          if (hasCoordinates || session.floorMapUrl != null) ...[
            const SizedBox(height: 16),
            _FloorMap(session: session),
          ],
        ],
      ),
    );
  }

  Widget _pill(String label, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFEFF6FF),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label.toUpperCase(),
                style: const TextStyle(fontSize: 10, color: Colors.black45, fontWeight: FontWeight.bold, letterSpacing: 1)),
            const SizedBox(height: 2),
            Text(value,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF1E3A5F))),
          ],
        ),
      ),
    );
  }
}

class _FloorMap extends StatelessWidget {
  final SessionView session;

  const _FloorMap({required this.session});

  @override
  Widget build(BuildContext context) {
    final x = (session.coordinateX ?? 50).clamp(0, 100) / 100;
    final y = (session.coordinateY ?? 50).clamp(0, 100) / 100;

    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: LayoutBuilder(
          builder: (context, constraints) {
            const markerSize = 34.0;
            return Stack(
              children: [
                Positioned.fill(
                  child: session.floorMapUrl != null
                      ? Image.network(
                          session.floorMapUrl!,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const _Schematic(),
                        )
                      : const _Schematic(),
                ),
                Positioned(
                  left: x * constraints.maxWidth - markerSize / 2,
                  top: y * constraints.maxHeight - markerSize,
                  child: Column(
                    children: [
                      const Icon(Icons.location_on, color: Color(0xFFDC2626), size: markerSize),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFDC2626),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          session.slotNumber,
                          style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Placeholder plan: parking bays drawn as a light grid.
class _Schematic extends StatelessWidget {
  const _Schematic();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFF1F5F9),
      child: CustomPaint(painter: _BayPainter()),
    );
  }
}

class _BayPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFFCBD5E1)
      ..strokeWidth = 1.5;
    const columns = 5;
    for (var i = 1; i < columns; i++) {
      final dx = size.width * i / columns;
      canvas.drawLine(Offset(dx, 0), Offset(dx, size.height * 0.4), paint);
      canvas.drawLine(Offset(dx, size.height * 0.6), Offset(dx, size.height), paint);
    }
    final lane = Paint()..color = const Color(0xFFE2E8F0);
    canvas.drawRect(Rect.fromLTWH(0, size.height * 0.42, size.width, size.height * 0.16), lane);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

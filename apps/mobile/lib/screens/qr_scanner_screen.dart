import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../services/session_service.dart';
import '../services/vehicle_service.dart';
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

      // Fetch user's registered vehicles
      final vehicles = await VehicleService.getVehicles();
      if (vehicles.isEmpty) {
        throw 'No registered vehicles found. Please add your vehicle under "My Vehicles" before entering.';
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
        ),
      );

      if (selectedVehicle == null) {
        setState(() => _isProcessing = false);
        return;
      }

      final vehicleId = selectedVehicle['id'] as String;

      if (gateType == 'ENTRY') {
        // Enter parking
        final sessionData = await SessionService.enterParking(
          qrCodeData: rawValue,
          vehicleId: vehicleId,
        );

        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => SlotAssignedScreen(session: sessionData),
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

  const _VehicleSelectorSheet({required this.vehicles, required this.gateType});

  @override
  State<_VehicleSelectorSheet> createState() => _VehicleSelectorSheetState();
}

class _VehicleSelectorSheetState extends State<_VehicleSelectorSheet> {
  String? _selectedId;

  @override
  void initState() {
    super.initState();
    if (widget.vehicles.isNotEmpty) {
      _selectedId = widget.vehicles.first['id'];
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
          const SizedBox(height: 16),
          ...widget.vehicles.map((v) {
            final isSelected = _selectedId == v['id'];
            return GestureDetector(
              onTap: () => setState(() => _selectedId = v['id']),
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
                        ],
                      ),
                    ),
                    if (isSelected)
                      const Icon(Icons.check_circle_rounded, color: Color(0xFF2563EB)),
                  ],
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

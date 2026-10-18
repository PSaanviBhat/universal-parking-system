import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import 'auth_service.dart';

class VehicleService {
  static Future<List<dynamic>> getVehicles() async {
    final token = await AuthService.getToken();
    if (token == null) return [];

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/vehicles'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true && json['data'] is List) {
        return json['data'];
      }
    }
    return [];
  }

  static Future<Map<String, dynamic>> addVehicle({
    required String licensePlate,
    String? nickname,
  }) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/vehicles'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'licensePlate': licensePlate.trim().toUpperCase(),
        'nickname': nickname?.trim(),
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 201 || data['success'] != true) {
      throw data['message'] ?? 'Failed to register vehicle.';
    }
    return data['data'];
  }

  static Future<void> deleteVehicle(String id) async {
    final token = await AuthService.getToken();
    if (token == null) return;

    final res = await http.delete(
      Uri.parse('${ApiConfig.baseUrl}/api/vehicles/$id'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode != 200) {
      final data = jsonDecode(res.body);
      throw data['message'] ?? 'Failed to delete vehicle.';
    }
  }
}

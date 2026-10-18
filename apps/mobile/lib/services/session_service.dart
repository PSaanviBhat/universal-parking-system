import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import 'auth_service.dart';

class SessionService {
  static Future<Map<String, dynamic>?> getActiveSession() async {
    final token = await AuthService.getToken();
    if (token == null) return null;

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/sessions/active'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true) {
        return json['data'];
      }
    }
    return null;
  }

  static Future<Map<String, dynamic>?> getSessionById(String id) async {
    final token = await AuthService.getToken();
    if (token == null) return null;

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/sessions/$id'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true) {
        return json['data'];
      }
    }
    return null;
  }

  static Future<Map<String, dynamic>> enterParking({
    required String qrCodeData,
    required String vehicleId,
  }) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/sessions/entry'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'qrCodeData': qrCodeData,
        'vehicleId': vehicleId,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 201 || data['success'] != true) {
      throw data['message'] ?? 'Failed to initiate parking session.';
    }
    return data['data'];
  }

  static Future<Map<String, dynamic>> exitParking({
    required String qrCodeData,
    required String vehicleId,
  }) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/sessions/exit'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'qrCodeData': qrCodeData,
        'vehicleId': vehicleId,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data['success'] != true) {
      throw data['message'] ?? 'Failed to exit parking.';
    }
    return data['data'];
  }

  static Future<List<dynamic>> getHistory({int page = 1, int limit = 20}) async {
    final token = await AuthService.getToken();
    if (token == null) return [];

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/sessions/history?page=$page&limit=$limit'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true && json['data']?['sessions'] is List) {
        return json['data']['sessions'];
      }
    }
    return [];
  }

  static Future<Map<String, dynamic>> reassignSlot(String sessionId, {String? reason}) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/sessions/$sessionId/reassign'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'reason': reason ?? 'Assigned slot was blocked/unavailable',
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data['success'] != true) {
      throw data['message'] ?? 'Failed to reassign slot.';
    }
    return data['data'];
  }
}

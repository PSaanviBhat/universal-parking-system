import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class FacilityService {
  /// Public facility details (name, address, feeRatePerHour, availability).
  static Future<Map<String, dynamic>?> getFacility(String facilityId) async {
    final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/facilities/$facilityId'));
    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true && json['data'] is Map) {
        return Map<String, dynamic>.from(json['data']);
      }
    }
    return null;
  }
}

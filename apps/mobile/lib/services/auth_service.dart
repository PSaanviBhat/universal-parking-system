import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class AuthService {
  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'auth_token';
  static const _userKey = 'user_data';

  static Future<Map<String, dynamic>> register({
    required String name,
    required String email,
    required String phone,
    required String password,
  }) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name.trim(),
        'email': email.trim().toLowerCase(),
        'phone': phone.trim(),
        'password': password,
        'tcAccepted': true,
        'indoorNavEnabled': true,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 201 || data['success'] != true) {
      throw data['message'] ?? 'Registration failed.';
    }

    final token = data['data']['token'];
    final user = data['data']['user'];
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _userKey, value: jsonEncode(user));
    return data['data'];
  }

  static Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'email': email.trim().toLowerCase(),
        'password': password,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data['success'] != true) {
      throw data['message'] ?? 'Invalid credentials.';
    }

    final token = data['data']['token'];
    final user = data['data']['user'];
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _userKey, value: jsonEncode(user));
    return data['data'];
  }

  static Future<String?> getToken() => _storage.read(key: _tokenKey);

  static Future<Map<String, dynamic>?> getUser() async {
    final raw = await _storage.read(key: _userKey);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> fetchProfile() async {
    final token = await getToken();
    if (token == null) return null;

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/auth/me'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true) {
        await _storage.write(key: _userKey, value: jsonEncode(json['data']));
        return json['data'];
      }
    }
    return null;
  }

  static Future<void> logout() async {
    await _storage.deleteAll();
  }
}

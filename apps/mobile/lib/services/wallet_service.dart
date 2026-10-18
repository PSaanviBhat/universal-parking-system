import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import 'auth_service.dart';

class WalletService {
  static Future<Map<String, dynamic>?> getWalletInfo() async {
    final token = await AuthService.getToken();
    if (token == null) return null;

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/wallet'),
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

  static Future<Map<String, dynamic>> createTopUpOrder(double amount) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/wallet/create-order'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'amount': amount}),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data['success'] != true) {
      throw data['message'] ?? 'Failed to initiate payment.';
    }
    return data['data'];
  }

  static Future<Map<String, dynamic>> topUp({
    required double amount,
    String? razorpayOrderId,
    String? razorpayPaymentId,
    String? razorpaySignature,
  }) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/wallet/topup'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'amount': amount,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data['success'] != true) {
      throw data['message'] ?? 'Wallet top-up failed.';
    }
    return data['data'];
  }

  static Future<List<dynamic>> getTransactions({int page = 1, int limit = 20}) async {
    final token = await AuthService.getToken();
    if (token == null) return [];

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/wallet/transactions?page=$page&limit=$limit'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(res.body);
      if (json['success'] == true && json['data']?['transactions'] is List) {
        return json['data']['transactions'];
      }
    }
    return [];
  }

  static Future<List<dynamic>> getPaymentMethods() async {
    final token = await AuthService.getToken();
    if (token == null) return [];

    final res = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/payment-methods'),
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

  static Future<Map<String, dynamic>> addPaymentMethod({
    required String type,
    String? tokenStr,
  }) async {
    final token = await AuthService.getToken();
    if (token == null) throw 'Unauthorized';

    final res = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/payment-methods'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'type': type,
        'razorpayToken': tokenStr,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode != 201 || data['success'] != true) {
      throw data['message'] ?? 'Failed to link payment method.';
    }
    return data['data'];
  }
}

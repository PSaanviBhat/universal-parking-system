import 'package:flutter/material.dart';
import '../services/auth_service.dart';

class AuthProvider extends ChangeNotifier {
  Map<String, dynamic>? _user;
  bool _isAuthenticated = false;
  bool _isLoading = true;

  Map<String, dynamic>? get user => _user;
  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;

  Future<void> checkAuthStatus() async {
    _isLoading = true;
    notifyListeners();

    final token = await AuthService.getToken();
    if (token != null) {
      _user = await AuthService.getUser();
      _isAuthenticated = true;
      // Refresh profile in background
      AuthService.fetchProfile().then((refreshed) {
        if (refreshed != null) {
          _user = refreshed;
          notifyListeners();
        }
      });
    } else {
      _user = null;
      _isAuthenticated = false;
    }

    _isLoading = false;
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final data = await AuthService.login(email: email, password: password);
    _user = data['user'];
    _isAuthenticated = true;
    notifyListeners();
  }

  Future<void> register({
    required String name,
    required String email,
    required String phone,
    required String password,
  }) async {
    final data = await AuthService.register(
      name: name,
      email: email,
      phone: phone,
      password: password,
    );
    _user = data['user'];
    _isAuthenticated = true;
    notifyListeners();
  }

  Future<void> logout() async {
    await AuthService.logout();
    _user = null;
    _isAuthenticated = false;
    notifyListeners();
  }
}

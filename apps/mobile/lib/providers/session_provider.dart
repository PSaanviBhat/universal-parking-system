import 'package:flutter/material.dart';
import '../services/session_service.dart';

class SessionProvider extends ChangeNotifier {
  Map<String, dynamic>? _activeSession;
  bool _isLoading = false;

  Map<String, dynamic>? get activeSession => _activeSession;
  bool get hasActiveSession => _activeSession != null;
  bool get isLoading => _isLoading;

  Future<void> fetchActiveSession() async {
    _isLoading = true;
    notifyListeners();

    try {
      _activeSession = await SessionService.getActiveSession();
    } catch (_) {
      _activeSession = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void setActiveSession(Map<String, dynamic>? session) {
    _activeSession = session;
    notifyListeners();
  }

  void clearSession() {
    _activeSession = null;
    notifyListeners();
  }
}

import 'package:flutter/material.dart';
import '../models/session_view.dart';
import '../services/session_service.dart';

class SessionProvider extends ChangeNotifier {
  SessionView? _activeSession;
  bool _isLoading = false;

  SessionView? get activeSession => _activeSession;
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

  void setActiveSession(SessionView? session) {
    _activeSession = session;
    notifyListeners();
  }

  void clearSession() {
    _activeSession = null;
    notifyListeners();
  }
}

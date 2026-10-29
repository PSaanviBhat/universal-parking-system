/// Read-only view over a parking session as returned by the backend.
///
/// The API returns sessions in a few shapes:
/// - `GET /api/sessions/active` items: `sessionId`, `hourlyRate`, `estimatedFee`, `assignedSlot{...}`
/// - `POST /api/sessions/entry` data: `session{id, entryTime, feeRatePerHour}`, `assignedSlot{...}`, `walletWarning`
/// - `GET /api/sessions/:id` data: `id`, `feeRateSnapshot`, `slot{slotNumber, level{displayName}}`
/// - `POST /api/sessions/:id/reassign` data: `newAssignedSlot{...}`
///
/// Screens read fields only through this class so the field names live in one place.
class SessionView {
  final Map<String, dynamic> raw;

  const SessionView(this.raw);

  Map<String, dynamic> get _session => _map(raw['session']) ?? raw;
  Map<String, dynamic> get _slot =>
      _map(raw['assignedSlot']) ?? _map(raw['newAssignedSlot']) ?? _map(raw['slot']) ?? const {};
  Map<String, dynamic> get _level => _map(_slot['level']) ?? const {};
  Map<String, dynamic> get _facility => _map(raw['facility']) ?? const {};
  Map<String, dynamic> get _vehicle => _map(raw['vehicle']) ?? const {};

  String? get id => (raw['sessionId'] ?? _session['id'] ?? raw['id'])?.toString();

  DateTime? get entryTime {
    final value = _session['entryTime'] ?? raw['entryTime'];
    return value == null ? null : DateTime.tryParse(value.toString())?.toLocal();
  }

  double get hourlyRate =>
      _num(raw['hourlyRate']) ??
      _num(_session['feeRatePerHour']) ??
      _num(raw['feeRateSnapshot']) ??
      _num(_facility['feeRatePerHour']) ??
      0;

  String get facilityName => (_facility['name'] ?? raw['facilityName'] ?? '').toString();
  String get facilityAddress => (_facility['address'] ?? raw['facilityAddress'] ?? '').toString();
  String get licensePlate => (_vehicle['licensePlate'] ?? raw['licensePlate'] ?? '').toString();
  String? get vehicleId => (_vehicle['id'] ?? raw['vehicleId'])?.toString();

  String get slotNumber => (_slot['slotNumber'] ?? '').toString();
  String get levelName => (_slot['levelName'] ?? _level['displayName'] ?? '').toString();
  String get levelCode => (_slot['levelCode'] ?? _level['levelCode'] ?? '').toString();
  String? get directions => _slot['directions']?.toString();
  String? get floorMapUrl => (_slot['floorMapUrl'] ?? _level['floorMapUrl'])?.toString();
  double? get coordinateX => _num(_slot['coordinateX']);
  double? get coordinateY => _num(_slot['coordinateY']);

  String? get entryGateName => (raw['entryGateName'] ?? _map(raw['entryGate'])?['gateName'])?.toString();

  /// Set by the entry endpoint when the wallet can't cover the 1-hour minimum.
  String? get walletWarning => raw['walletWarning']?.toString();

  /// Returns a copy with the slot replaced (after a reassignment).
  SessionView withSlot(Map<String, dynamic> newSlot) {
    final copy = Map<String, dynamic>.from(raw)
      ..remove('newAssignedSlot')
      ..remove('slot');
    copy['assignedSlot'] = newSlot;
    return SessionView(copy);
  }

  /// Same rule as the backend: whole minutes rounded up, pro-rata on the hourly
  /// rate, with a 1-hour minimum charge.
  double feeAt(DateTime now) {
    final start = entryTime;
    if (start == null) return hourlyRate;
    final ms = now.difference(start).inMilliseconds.clamp(0, 1 << 62);
    final minutes = (ms / 60000).ceil().clamp(1, 1 << 31);
    final fee = (minutes / 60 * hourlyRate * 100).round() / 100;
    return fee < hourlyRate ? hourlyRate : fee;
  }

  static Map<String, dynamic>? _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : null;

  static double? _num(dynamic v) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v);
    return null;
  }
}

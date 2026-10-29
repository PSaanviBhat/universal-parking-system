// Checks that the app reads the fields the backend actually returns.
// Fixtures in test/fixtures/ are real responses captured from the backend
// (register -> add vehicle -> entry -> active -> by id -> reassign -> exit -> history).
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parking_app/models/session_view.dart';
import 'package:parking_app/screens/exit_summary_screen.dart';
import 'package:parking_app/screens/session_detail_screen.dart';
import 'package:parking_app/screens/slot_assigned_screen.dart';

Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

Map<String, dynamic> dataOf(String name) => Map<String, dynamic>.from(fixture(name)['data'] as Map);

void main() {
  group('SessionView reads every session shape', () {
    final active = SessionView(Map<String, dynamic>.from((fixture('active')['data'] as List).first as Map));
    final entry = SessionView(dataOf('entry'));
    final byId = SessionView(dataOf('session_by_id'));

    test('entry response', () {
      expect(entry.id, active.id);
      expect(entry.slotNumber, isNotEmpty);
      expect(entry.levelName, isNotEmpty);
      expect(entry.directions, contains(entry.slotNumber));
      expect(entry.hourlyRate, 30);
      expect(entry.licensePlate, startsWith('KA03FX'));
      expect(entry.facilityName, 'Phoenix Mall');
      expect(entry.entryTime, isNotNull);
      expect(entry.coordinateX, isNotNull);
      // A new driver has ₹0, so the entry response warns about the balance
      expect(entry.walletWarning, isNotNull);
    });

    test('active list item', () {
      expect(active.id, isNotEmpty);
      expect(active.slotNumber, entry.slotNumber);
      expect(active.levelName, entry.levelName);
      expect(active.directions, isNotEmpty);
      expect(active.hourlyRate, 30);
      expect(active.licensePlate, entry.licensePlate);
      expect(active.entryTime, entry.entryTime);
    });

    test('session by id', () {
      expect(byId.id, active.id);
      expect(byId.slotNumber, entry.slotNumber);
      expect(byId.levelName, entry.levelName);
      expect(byId.hourlyRate, 30);
      expect(byId.facilityName, 'Phoenix Mall');
    });

    test('reassignment swaps the slot', () {
      final newSlot = Map<String, dynamic>.from(dataOf('reassign')['newAssignedSlot'] as Map);
      final moved = active.withSlot(newSlot);
      expect(moved.id, active.id);
      expect(moved.slotNumber, newSlot['slotNumber']);
      expect(moved.slotNumber, isNot(active.slotNumber));
      expect(moved.directions, contains(newSlot['slotNumber']));
    });

    test('fee matches the backend rule (1-hour minimum, pro-rata after)', () {
      final start = active.entryTime!;
      expect(active.feeAt(start.add(const Duration(minutes: 5))), 30);
      expect(active.feeAt(start.add(const Duration(minutes: 90))), 45);
      expect(active.feeAt(start.add(const Duration(minutes: 61, seconds: 1))), 31);
    });
  });

  test('vehicles report parking state', () {
    final before = (fixture('vehicles_not_parked')['data'] as List).first as Map;
    final during = (fixture('vehicles_parked')['data'] as List).first as Map;
    expect(before['parkingState'], 'NOT_PARKED');
    expect(during['parkingState'], 'PARKED');
    expect(during['activeSession']['slotNumber'], isNotNull);
  });

  test('wallet exposes rules the app shows', () {
    final wallet = dataOf('wallet');
    expect(wallet['rules']['fineAmount'], 500);
    expect(wallet['rules']['minimumTopUp'], 35);
    expect(wallet['isSuspended'], isFalse);
    expect(wallet['balance'], -30);
  });

  testWidgets('exit summary shows charge, deduction and remaining balance', (tester) async {
    await tester.pumpWidget(MaterialApp(home: ExitSummaryScreen(exitData: dataOf('exit'))));
    expect(find.text('₹30.00'), findsOneWidget); // charge
    expect(find.text('₹0.00'), findsOneWidget); // wallet before exit
    expect(find.text('− ₹30.00'), findsOneWidget); // deducted
    expect(find.text('₹-30.00'), findsOneWidget); // remaining
    expect(find.text('UNPAID (DEBT)'), findsOneWidget);
  });

  testWidgets('receipt shows history fields', (tester) async {
    final item = Map<String, dynamic>.from((dataOf('history')['sessions'] as List).first as Map);
    await tester.pumpWidget(MaterialApp(home: SessionDetailScreen(session: item)));
    expect(find.text('Phoenix Mall'), findsOneWidget);
    expect(find.text(item['licensePlate'] as String), findsOneWidget);
    expect(find.textContaining('₹30/hr'), findsOneWidget);
    expect(find.text('Unpaid — within repayment window'), findsOneWidget);
  });

  testWidgets('slot assigned screen shows slot, level, directions and the balance warning', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);

    final entry = SessionView(dataOf('entry'));
    await tester.pumpWidget(MaterialApp(home: SlotAssignedScreen(session: entry)));
    expect(find.text(entry.slotNumber), findsWidgets);
    expect(find.text(entry.levelName), findsOneWidget);
    expect(find.text(entry.directions!), findsOneWidget);
    expect(find.text(entry.walletWarning!), findsOneWidget);
  });
}

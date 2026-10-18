import 'package:flutter_test/flutter_test.dart';
import 'package:parking_app/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const UniversalParkingApp());
    expect(find.byType(UniversalParkingApp), findsOneWidget);
  });
}

# Smart Parking — driver app (Flutter)

Flutter 3.24.4 / Dart 3.5.4. Android and iOS.

## Backend URL

The app reads the API base URL at build time from `API_BASE_URL`
(`lib/config/api_config.dart`). The default, `http://10.0.2.2:4000`, is the host
machine as seen from the Android emulator. Plain HTTP is only allowed in debug
builds (`android/app/src/debug/AndroidManifest.xml`); release builds need HTTPS.

## Run (development)

Windows needs **Developer Mode** turned on (Settings → System → For developers)
because Flutter plugins are linked with symlinks.

```
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

On a physical phone on the same Wi-Fi, use your PC's LAN IP instead of `10.0.2.2`.

With no Razorpay keys on the backend and `ALLOW_SIMULATED_PAYMENTS=true`, top-ups
use simulated orders and skip the checkout sheet.

## Release APK

```
flutter build apk --release --dart-define=API_BASE_URL=https://<your-render-app>.onrender.com
```

The APK is written to `build/app/outputs/flutter-apk/app-release.apk`. It is
signed with the debug key; set up a release keystore before publishing to Play.

## Payments

Top-ups open Razorpay Checkout (`razorpay_flutter`) for an order the backend
created; the backend verifies the signature and the payment with Razorpay before
crediting the wallet. In Razorpay **test mode** use UPI `success@razorpay`, or a
test card from the Razorpay docs.

## Tests

```
flutter analyze
flutter test
```

`test/api_contract_test.dart` runs the app's parsing and screens against real
backend responses in `test/fixtures/`. Re-capture them whenever an API response
changes.

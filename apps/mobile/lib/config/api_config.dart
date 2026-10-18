class ApiConfig {
  // Use 10.0.2.2 for Android Emulator (maps to host localhost)
  // For physical devices on the same Wi-Fi, change to host machine IP (e.g. http://192.168.1.x:4000)
  // For production, change to the Render URL (e.g. https://parking-backend.onrender.com)
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );
}

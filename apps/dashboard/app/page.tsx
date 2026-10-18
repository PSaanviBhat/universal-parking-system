export default function DashboardHomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-primary mb-4">🚗 Parking System</h1>
        <p className="text-xl text-gray-600 mb-2">Operator Dashboard</p>
        <p className="text-gray-400 mb-8">Phase 1 — Scaffold Complete</p>

        <div className="bg-white rounded-xl shadow-md p-6 max-w-md mx-auto text-left">
          <h2 className="font-semibold text-gray-700 mb-4">System Status</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Backend API</span>
              <span className="text-green-600 font-medium">← Wire in Phase 8</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Real-time (Socket.io)</span>
              <span className="text-green-600 font-medium">← Wire in Phase 8</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Auth</span>
              <span className="text-green-600 font-medium">← Wire in Phase 8</span>
            </div>
          </div>
        </div>

        <p className="mt-8 text-xs text-gray-400">
          Universal Parking System · Built with Next.js + Tailwind CSS
        </p>
      </div>
    </main>
  );
}

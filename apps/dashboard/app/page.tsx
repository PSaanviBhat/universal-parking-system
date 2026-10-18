'use client';

import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface FacilityStats {
  facility: { id: string; name: string; feeRatePerHour: number };
  totalSlots: number;
  occupiedSlots: number;
  availableSlots: number;
  occupancyPercentage: number;
  activeSessions: number;
  todayExits: number;
  todayRevenue: number;
}

interface ActiveSession {
  sessionId: string;
  licensePlate: string;
  userName: string;
  userPhone: string;
  slotNumber: string;
  levelName: string;
  levelCode: string;
  entryGate: string;
  entryTime: string;
  durationMinutes: number;
  runningFee: number;
  status: string;
  paymentStatus: string;
}

interface SlotItem {
  id: string;
  slotNumber: string;
  status: 'AVAILABLE' | 'RESERVED_OCCUPIED';
  coordinateX?: number;
  coordinateY?: number;
  currentSession?: {
    id: string;
    vehicle: { licensePlate: string };
  };
}

interface LevelSlots {
  id: string;
  levelCode: string;
  displayName: string;
  slots: SlotItem[];
}

export default function OperatorDashboard() {
  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>('');
  const [stats, setStats] = useState<FacilityStats | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [levels, setLevels] = useState<LevelSlots[]>([]);
  const [selectedLevelCode, setSelectedLevelCode] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  // 1. Initial Load: Fetch facilities
  useEffect(() => {
    async function loadFacilities() {
      try {
        const res = await fetch(`${API_BASE}/api/admin/facilities`);
        const json = await res.json();
        if (json.success && json.data.length > 0) {
          setFacilities(json.data);
          setSelectedFacilityId(json.data[0].id);
        }
      } catch (err) {
        console.error('Failed to load facilities:', err);
      } finally {
        setLoading(false);
      }
    }
    loadFacilities();
  }, [API_BASE]);

  // 2. Setup Socket.io connection & room join
  useEffect(() => {
    if (!selectedFacilityId) return;

    const newSocket = io(API_BASE);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to operator websocket server');
      newSocket.emit('join:facility', selectedFacilityId);
    });

    newSocket.on('session:created', (data) => {
      showNotice(`Vehicle ${data.licensePlate} entered via ${data.gateName} (Slot: ${data.slotNumber})`);
      refreshData(selectedFacilityId);
    });

    newSocket.on('session:completed', (data) => {
      showNotice(`Vehicle ${data.licensePlate} exited (Fee: ₹${data.totalFee})`);
      refreshData(selectedFacilityId);
    });

    newSocket.on('slot:updated', () => {
      refreshData(selectedFacilityId);
    });

    newSocket.on('slot:released', () => {
      refreshData(selectedFacilityId);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [selectedFacilityId, API_BASE]);

  // 3. Refresh Dashboard Data
  async function refreshData(facId: string) {
    if (!facId) return;
    try {
      const [resStats, resSessions, resSlots] = await Promise.all([
        fetch(`${API_BASE}/api/operator/stats/${facId}`),
        fetch(`${API_BASE}/api/operator/sessions/${facId}`),
        fetch(`${API_BASE}/api/operator/slots/${facId}`),
      ]);

      const jsonStats = await resStats.json();
      const jsonSessions = await resSessions.json();
      const jsonSlots = await resSlots.json();

      if (jsonStats.success) setStats(jsonStats.data);
      if (jsonSessions.success) setSessions(jsonSessions.data);
      if (jsonSlots.success) {
        setLevels(jsonSlots.data);
        if (!selectedLevelCode && jsonSlots.data.length > 0) {
          setSelectedLevelCode(jsonSlots.data[0].levelCode);
        }
      }
    } catch (err) {
      console.error('Error refreshing operator data:', err);
    }
  }

  useEffect(() => {
    if (selectedFacilityId) {
      refreshData(selectedFacilityId);
      const interval = setInterval(() => refreshData(selectedFacilityId), 15000);
      return () => clearInterval(interval);
    }
  }, [selectedFacilityId]);

  function showNotice(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(null), 5000);
  }

  async function handleResolve(sessionId: string, action: 'FORCE_CLOSE' | 'DISPUTE') {
    try {
      const res = await fetch(`${API_BASE}/api/operator/sessions/${sessionId}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, resolutionNote: 'Resolved from operator portal' }),
      });
      const json = await res.json();
      if (json.success) {
        showNotice(action === 'FORCE_CLOSE' ? 'Session force-closed and slot freed!' : 'Session flagged as DISPUTED.');
        refreshData(selectedFacilityId);
      }
    } catch (err) {
      console.error('Resolve error:', err);
    }
  }

  const currentLevel = levels.find((l) => l.levelCode === selectedLevelCode) || levels[0];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950 px-8 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-4">
          <div className="h-10 w-10 bg-blue-600 rounded-lg flex items-center justify-center font-black text-xl text-white shadow">
            P
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Universal Parking Platform</h1>
            <p className="text-xs text-slate-400">Operator Real-Time Kiosk & Verification Portal</p>
          </div>
        </div>

        {/* Facility Selector */}
        <div className="flex items-center space-x-3">
          <label className="text-sm font-medium text-slate-400">Select Facility:</label>
          <select
            value={selectedFacilityId}
            onChange={(e) => {
              setSelectedFacilityId(e.target.value);
              setSelectedLevelCode('');
            }}
            className="bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} (₹{f.feeRatePerHour}/hr)
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Live Event Notification Pill */}
      {notification && (
        <div className="bg-emerald-600 text-white px-6 py-2 text-sm font-semibold flex items-center justify-between animate-fade-in shadow-lg">
          <div className="flex items-center space-x-2">
            <span className="animate-ping h-2 w-2 rounded-full bg-white mr-1 inline-block" />
            <span>{notification}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs text-emerald-200 hover:text-white">✕</button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-8">
        {/* KPI Summary Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Capacity</span>
              <div className="text-3xl font-extrabold text-white mt-2">{stats.totalSlots} Slots</div>
              <p className="text-xs text-slate-400 mt-1">Across all levels</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Current Occupancy</span>
              <div className="text-3xl font-extrabold text-amber-400 mt-2">
                {stats.occupiedSlots} <span className="text-lg font-normal text-slate-400">/ {stats.totalSlots}</span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-amber-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${stats.occupancyPercentage}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Available Slots</span>
              <div className="text-3xl font-extrabold text-emerald-400 mt-2">{stats.availableSlots}</div>
              <p className="text-xs text-emerald-400/80 mt-1">Open for incoming vehicles</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active Live Sessions</span>
              <div className="text-3xl font-extrabold text-blue-400 mt-2">{stats.activeSessions}</div>
              <p className="text-xs text-slate-400 mt-1">Vehicles inside facility</p>
            </div>
          </div>
        )}

        {/* Level Occupancy Visual Grid */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-700 gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">Interactive Slot Map</h2>
              <p className="text-xs text-slate-400">Visual occupancy layout by level</p>
            </div>

            {/* Level Tabs */}
            <div className="flex space-x-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
              {levels.map((lvl) => (
                <button
                  key={lvl.levelCode}
                  onClick={() => setSelectedLevelCode(lvl.levelCode)}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                    (selectedLevelCode || levels[0]?.levelCode) === lvl.levelCode
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {lvl.displayName}
                </button>
              ))}
            </div>
          </div>

          {/* Slots Grid */}
          <div className="mt-6">
            {currentLevel && currentLevel.slots.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-3">
                {currentLevel.slots.map((slot) => {
                  const isOccupied = slot.status === 'RESERVED_OCCUPIED';
                  return (
                    <div
                      key={slot.id}
                      className={`p-3 rounded-lg border text-center transition-all ${
                        isOccupied
                          ? 'bg-rose-950/60 border-rose-700/80 text-rose-200'
                          : 'bg-emerald-950/60 border-emerald-700/80 text-emerald-200'
                      }`}
                    >
                      <div className="text-xs font-bold">{slot.slotNumber}</div>
                      <div className="text-[10px] uppercase font-semibold mt-1">
                        {isOccupied ? 'Occupied' : 'Open'}
                      </div>
                      {isOccupied && slot.currentSession?.vehicle?.licensePlate && (
                        <div className="text-[9px] font-mono text-rose-300 mt-1 truncate">
                          {slot.currentSession.vehicle.licensePlate}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-8">No slots configured on this level.</p>
            )}
          </div>
        </section>

        {/* Active Parking Sessions Table */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow">
          <div className="p-6 border-b border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Active Parking Sessions</h2>
              <p className="text-xs text-slate-400">Live vehicles currently inside the premises</p>
            </div>
            <button
              onClick={() => refreshData(selectedFacilityId)}
              className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md font-medium text-slate-200 transition"
            >
              🔄 Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3">License Plate</th>
                  <th className="px-6 py-3">Driver</th>
                  <th className="px-6 py-3">Slot</th>
                  <th className="px-6 py-3">Entry Gate</th>
                  <th className="px-6 py-3">Entry Time</th>
                  <th className="px-6 py-3">Duration</th>
                  <th className="px-6 py-3">Running Fee</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60 font-medium">
                {sessions.length > 0 ? (
                  sessions.map((s) => (
                    <tr key={s.sessionId} className="hover:bg-slate-750 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-white tracking-wide">
                        {s.licensePlate}
                      </td>
                      <td className="px-6 py-4">
                        <div>{s.userName}</div>
                        <div className="text-[10px] text-slate-400">{s.userPhone}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded text-[11px] font-bold">
                          {s.levelCode} - {s.slotNumber}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-400">{s.entryGate}</td>
                      <td className="px-6 py-4 text-slate-400">
                        {new Date(s.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4">{s.durationMinutes} min</td>
                      <td className="px-6 py-4 font-bold text-emerald-400">₹{s.runningFee.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <span className="bg-amber-900/60 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold">
                          {s.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => handleResolve(s.sessionId, 'FORCE_CLOSE')}
                          className="bg-rose-700 hover:bg-rose-600 text-white px-2.5 py-1 rounded text-[10px] font-bold transition"
                        >
                          Force Exit
                        </button>
                        <button
                          onClick={() => handleResolve(s.sessionId, 'DISPUTE')}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-2.5 py-1 rounded text-[10px] font-bold transition"
                        >
                          Dispute
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-slate-500 text-xs">
                      No active vehicles parked in this facility right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { API_BASE, apiFetch, loadSession, type StaffSession } from './lib/api';
import type { Facility, FacilityStats, LevelSlots, OperatorSession } from './lib/types';
import AppHeader from './components/AppHeader';
import KpiCards from './components/KpiCards';
import SlotMap from './components/SlotMap';
import SessionsTable from './components/SessionsTable';
import PlateSearch from './components/PlateSearch';
import ResolveDialog from './components/ResolveDialog';

type LogTab = 'COMPLETED' | 'DISPUTED';

export default function OperatorConsole() {
  const router = useRouter();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [stats, setStats] = useState<FacilityStats | null>(null);
  const [active, setActive] = useState<OperatorSession[]>([]);
  const [log, setLog] = useState<OperatorSession[]>([]);
  const [logTab, setLogTab] = useState<LogTab>('COMPLETED');
  const [levels, setLevels] = useState<LevelSlots[]>([]);
  const [resolving, setResolving] = useState<OperatorSession | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [live, setLive] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  const showNotice = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setNotice({ text, tone });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  // Auth: operators are locked to their own facility; admins can switch.
  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.push('/login');
      return;
    }
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    apiFetch<{ data: Facility[] }>('/api/facilities')
      .then((res) => {
        const visible =
          session.role === 'operator' ? res.data.filter((f) => f.id === session.user.facilityId) : res.data;
        setFacilities(visible);
        if (visible.length > 0) setFacilityId((cur) => cur || visible[0].id);
      })
      .catch((e) => showNotice(e.message, 'error'));
  }, [session, showNotice]);

  const refresh = useCallback(async () => {
    if (!facilityId) return;
    try {
      const [s, a, l, slots] = await Promise.all([
        apiFetch<{ data: FacilityStats }>(`/api/operator/stats/${facilityId}`),
        apiFetch<{ data: OperatorSession[] }>(`/api/operator/sessions/${facilityId}`),
        apiFetch<{ data: OperatorSession[] }>(`/api/operator/sessions/${facilityId}?status=${logTab}&limit=25`),
        apiFetch<{ data: LevelSlots[] }>(`/api/operator/slots/${facilityId}`),
      ]);
      setStats(s.data);
      setActive(a.data);
      setLog(l.data);
      setLevels(slots.data);
    } catch (e: any) {
      showNotice(e.message, 'error');
    }
  }, [facilityId, logTab, showNotice]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Live updates for the selected facility
  useEffect(() => {
    if (!session || !facilityId) return;
    const socket = io(API_BASE, { auth: { token: session.token } });
    socket.on('connect', () => {
      setLive(true);
      socket.emit('join:facility', facilityId);
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('connect_error', () => setLive(false));
    socket.on('error:forbidden', (d: { message: string }) => showNotice(d.message, 'error'));
    socket.on('session:created', (d) => {
      showNotice(`${d.licensePlate} entered via ${d.gateName} → slot ${d.slotNumber}`);
      refresh();
    });
    socket.on('session:completed', (d) => {
      showNotice(`${d.licensePlate} exited · ₹${Number(d.totalFee).toFixed(2)}${d.isDebt ? ' (wallet went into debt)' : ''}`);
      refresh();
    });
    socket.on('slot:reassigned', (d) => {
      showNotice(`${d.licensePlate} moved ${d.oldSlotNumber} → ${d.newSlotNumber}: ${d.reason}`, 'error');
      refresh();
    });
    for (const evt of ['session:resolved', 'slot:updated', 'slot:released']) socket.on(evt, refresh);
    return () => {
      socket.disconnect();
    };
  }, [session, facilityId, refresh, showNotice]);

  async function reopenSlot(slotId: string, slotNumber: string) {
    if (!confirm(`Reopen slot ${slotNumber}? Only do this once the obstruction is cleared.`)) return;
    try {
      const res = await apiFetch<{ message: string }>(`/api/operator/slots/${slotId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true }),
      });
      showNotice(res.message);
      refresh();
    } catch (e: any) {
      showNotice(e.message, 'error');
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Verifying authentication...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <AppHeader session={session} subtitle="Live operator console">
        <span className={`text-xs font-semibold ${live ? 'text-emerald-400' : 'text-slate-500'}`}>
          ● {live ? 'Live' : 'Offline — auto-refreshing'}
        </span>
        {session.role === 'admin' ? (
          <select
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-1.5 text-sm"
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-semibold text-slate-200">{session.user.facilityName}</span>
        )}
      </AppHeader>

      {notice && (
        <div
          className={`px-6 py-2 text-sm font-semibold flex items-center justify-between ${
            notice.tone === 'ok' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full space-y-8">
        {stats && <KpiCards stats={stats} />}

        <section className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow">
          <div className="p-6 border-b border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Vehicles Inside</h2>
              <p className="text-xs text-slate-400">Active sessions — stale ones are highlighted</p>
            </div>
            <button onClick={refresh} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md">
              Refresh
            </button>
          </div>
          <SessionsTable
            sessions={active}
            live
            emptyText="No vehicles parked in this facility right now."
            onResolve={setResolving}
          />
        </section>

        <SlotMap levels={levels} onReopenSlot={reopenSlot} />

        {facilityId && <PlateSearch facilityId={facilityId} onResolve={setResolving} />}

        <section className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow">
          <div className="p-6 border-b border-slate-700 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">Exit Log</h2>
              <p className="text-xs text-slate-400">Recent exits and sessions waiting for a dispute decision</p>
            </div>
            <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
              {(['COMPLETED', 'DISPUTED'] as LogTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setLogTab(t)}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold ${
                    logTab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t === 'COMPLETED' ? 'Completed' : 'Disputed'}
                </button>
              ))}
            </div>
          </div>
          <SessionsTable
            sessions={log}
            live={false}
            emptyText={logTab === 'DISPUTED' ? 'No open disputes.' : 'No completed sessions yet.'}
            onResolve={setResolving}
          />
        </section>
      </main>

      {resolving && (
        <ResolveDialog
          session={resolving}
          onClose={() => setResolving(null)}
          onDone={(message) => {
            setResolving(null);
            showNotice(message);
            refresh();
          }}
        />
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';
import type { OperatorSession } from '../lib/types';
import { SessionBadges } from './Badges';

interface SearchResult {
  vehicleId: string;
  licensePlate: string;
  nickname: string | null;
  ownerName: string;
  ownerPhone: string;
  activeSession: OperatorSession | null;
}

/**
 * Lost-phone / "which car is this" lookup by (partial) licence plate. Operators
 * see sessions in their own facility; verify the driver, then resolve.
 */
export default function PlateSearch({
  facilityId,
  onResolve,
}: {
  facilityId: string;
  onResolve: (s: OperatorSession) => void;
}) {
  const [plate, setPlate] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ plate, facilityId });
      const res = await apiFetch<{ data: SearchResult[] }>(`/api/operator/vehicles/search?${qs}`);
      setResults(res.data);
    } catch (err: any) {
      setError(err.message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow">
      <h2 className="text-lg font-bold text-white">Find a Vehicle</h2>
      <p className="text-xs text-slate-400">
        Driver lost their phone or forgot to scan out? Search by plate, check their ID, then resolve the session.
      </p>
      <form onSubmit={search} className="mt-4 flex gap-2">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          placeholder="e.g. KA01AB1234 or 1234"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={busy || plate.trim().length < 3}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      {results && (
        <ul className="mt-4 divide-y divide-slate-700">
          {results.length === 0 && (
            <li className="py-3 text-xs text-slate-500">No vehicle with that plate is parked in this facility.</li>
          )}
          {results.map((r) => (
            <li key={r.vehicleId} className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-mono font-bold text-white">{r.licensePlate}</div>
                <div className="text-xs text-slate-400">
                  {r.ownerName} · {r.ownerPhone}
                  {r.activeSession
                    ? ` · Inside since ${new Date(r.activeSession.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, slot ${r.activeSession.levelCode}-${r.activeSession.slotNumber}`
                    : ' · Not parked here'}
                </div>
              </div>
              {r.activeSession && (
                <div className="flex items-center gap-3">
                  <SessionBadges session={r.activeSession} />
                  <button
                    onClick={() => onResolve(r.activeSession!)}
                    className="bg-rose-700 hover:bg-rose-600 text-white px-3 py-1 rounded text-[11px] font-bold"
                  >
                    Resolve
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import type { OperatorSession } from '../lib/types';
import { rupees, timeOf, dateTimeOf } from '../lib/api';
import { SessionBadges } from './Badges';

/**
 * Sessions table for the operator console. `live` shows the running fee and entry
 * details; otherwise it shows the exit and final fee. Rows open the resolve dialog.
 */
export default function SessionsTable({
  sessions,
  live,
  emptyText,
  onResolve,
}: {
  sessions: OperatorSession[];
  live: boolean;
  emptyText: string;
  onResolve: (s: OperatorSession) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs text-slate-300">
        <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700">
          <tr>
            <th className="px-5 py-3">Plate</th>
            <th className="px-5 py-3">Driver</th>
            <th className="px-5 py-3">Slot</th>
            <th className="px-5 py-3">{live ? 'Entry' : 'Exit'}</th>
            <th className="px-5 py-3">Duration</th>
            <th className="px-5 py-3">{live ? 'Running fee' : 'Fee'}</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/60 font-medium">
          {sessions.length > 0 ? (
            sessions.map((s) => (
              <tr key={s.sessionId} className={s.isStale ? 'bg-amber-950/20' : undefined}>
                <td className="px-5 py-3 font-mono font-bold text-white tracking-wide">{s.licensePlate}</td>
                <td className="px-5 py-3">
                  <div>{s.userName}</div>
                  <div className="text-[10px] text-slate-400">{s.userPhone}</div>
                </td>
                <td className="px-5 py-3">
                  <span className="bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap">
                    {s.levelCode} · {s.slotNumber}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-400">
                  {live ? (
                    <>
                      <div>{timeOf(s.entryTime)}</div>
                      <div className="text-[10px]">{s.entryGate}</div>
                    </>
                  ) : (
                    <>
                      <div>{dateTimeOf(s.exitTime)}</div>
                      <div className="text-[10px]">{s.exitGate || 'Closed by staff'}</div>
                    </>
                  )}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">{s.durationMinutes} min</td>
                <td className="px-5 py-3 font-bold text-emerald-400">{rupees(s.totalFee)}</td>
                <td className="px-5 py-3">
                  <SessionBadges session={s} />
                  {s.resolutionNote && (
                    <div className="text-[10px] text-slate-500 mt-1 max-w-[220px] truncate" title={s.resolutionNote}>
                      {s.resolutionNote}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => onResolve(s)}
                    className="bg-slate-700 hover:bg-slate-600 text-slate-100 px-3 py-1 rounded text-[11px] font-bold transition"
                  >
                    {s.status === 'DISPUTED' ? 'Settle' : 'Resolve'}
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="px-5 py-8 text-center text-slate-500 text-xs">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

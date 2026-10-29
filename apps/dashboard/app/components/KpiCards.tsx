import type { FacilityStats } from '../lib/types';
import { rupees } from '../lib/api';

function Card({ label, value, hint, tone = 'text-white', children }: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <div className={`text-3xl font-extrabold mt-2 ${tone}`}>{value}</div>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function KpiCards({ stats }: { stats: FacilityStats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
      <Card label="Occupancy" tone="text-amber-400" value={<>{stats.occupiedSlots} <span className="text-lg font-normal text-slate-400">/ {stats.totalSlots}</span></>}>
        <div className="w-full bg-slate-700 h-2 rounded-full mt-2 overflow-hidden">
          <div className="bg-amber-400 h-2 rounded-full transition-all duration-500" style={{ width: `${stats.occupancyPercentage}%` }} />
        </div>
      </Card>
      <Card label="Available Slots" tone="text-emerald-400" value={stats.availableSlots} hint="Open for incoming vehicles" />
      <Card label="Vehicles Inside" tone="text-blue-400" value={stats.activeSessions} hint="Active sessions" />
      <Card
        label="Stale Sessions"
        tone={stats.staleSessions > 0 ? 'text-amber-400' : 'text-slate-300'}
        value={stats.staleSessions}
        hint={stats.staleSessions > 0 ? 'Check these vehicles — force-close if they left' : 'None'}
      />
      <Card label="Entries Today" value={stats.todayEntries} hint="Since midnight" />
      <Card label="Exits Today" tone="text-purple-400" value={stats.todayExits} hint="Vehicles checked out" />
      <Card label="Today's Revenue" tone="text-emerald-400" value={rupees(stats.todayRevenue)} hint="Fees from today's exits" />
      <Card label="Hourly Rate" value={rupees(stats.facility.feeRatePerHour)} hint="1-hour minimum charge" />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiBlobUrl, apiFetch, loadSession, rupees, type StaffSession } from '../lib/api';
import AppHeader from '../components/AppHeader';

const FACILITY_TYPES = ['MALL', 'OFFICE', 'HOSPITAL', 'AIRPORT', 'HOTEL', 'UNIVERSITY', 'PUBLIC', 'EVENT_VENUE', 'COMMERCIAL'];

interface AdminLevel {
  id: string;
  levelCode: string;
  displayName: string;
  totalSlots: number;
  _count: { slots: number };
}
interface AdminGate {
  id: string;
  gateName: string;
  gateType: 'ENTRY' | 'EXIT';
  qrCodeData: string;
  isActive: boolean;
}
interface AdminFacility {
  id: string;
  name: string;
  type: string;
  address: string;
  feeRatePerHour: string | number;
  levels: AdminLevel[];
  gates: AdminGate[];
}
interface OperatorAccount {
  id: string;
  username: string;
  facilityId: string;
  isActive: boolean;
  createdAt: string;
  facility: { name: string };
}
interface PlatformStats {
  totalRevenue: number;
  todayRevenue: number;
  totalSessions: number;
  todayExits: number;
}

const input =
  'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const button = 'px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50';

export default function AdminConsole() {
  const router = useRouter();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [facilities, setFacilities] = useState<AdminFacility[]>([]);
  const [operators, setOperators] = useState<OperatorAccount[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [qr, setQr] = useState<{ gate: AdminGate; facility: string; url: string } | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.push('/login');
      return;
    }
    if (s.role !== 'admin') {
      router.push('/');
      return;
    }
    setSession(s);
  }, [router]);

  const load = useCallback(async () => {
    try {
      const [f, o, st] = await Promise.all([
        apiFetch<{ data: AdminFacility[] }>('/api/admin/facilities'),
        apiFetch<{ data: OperatorAccount[] }>('/api/admin/operators'),
        apiFetch<{ data: PlatformStats }>('/api/admin/stats'),
      ]);
      setFacilities(f.data);
      setOperators(o.data);
      setStats(st.data);
    } catch (e: any) {
      setNotice({ text: e.message, tone: 'error' });
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  /** Runs an admin write, shows its message, reloads. Returns true on success. */
  async function run(path: string, method: string, body: object): Promise<boolean> {
    try {
      const res = await apiFetch<{ message: string }>(path, { method, body: JSON.stringify(body) });
      setNotice({ text: res.message, tone: 'ok' });
      await load();
      return true;
    } catch (e: any) {
      setNotice({ text: e.message, tone: 'error' });
      return false;
    }
  }

  async function showQr(gate: AdminGate, facility: string) {
    try {
      setQr({ gate, facility, url: await apiBlobUrl(`/api/admin/gates/${gate.id}/qr`) });
    } catch (e: any) {
      setNotice({ text: e.message, tone: 'error' });
    }
  }

  function printQr() {
    if (!qr) return;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;
    w.document.write(`<!doctype html><title>${qr.gate.gateName}</title>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1 style="margin:0">${qr.facility}</h1>
        <h2 style="margin:8px 0 24px">${qr.gate.gateName} — ${qr.gate.gateType === 'ENTRY' ? 'ENTRY' : 'EXIT'}</h2>
        <img src="${qr.url}" style="width:400px;height:400px" onload="window.print()" />
        <p>Scan with the Smart Parking app to ${qr.gate.gateType === 'ENTRY' ? 'enter' : 'exit'}.</p>
      </body>`);
    w.document.close();
  }

  if (!session) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <AppHeader session={session} subtitle="Platform administration" />

      {notice && (
        <div
          className={`px-6 py-2 text-sm font-semibold flex justify-between ${
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
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              ['Total revenue', rupees(stats.totalRevenue)],
              ["Today's revenue", rupees(stats.todayRevenue)],
              ['Sessions (all time)', stats.totalSessions],
              ['Exits today', stats.todayExits],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
                <div className="text-3xl font-extrabold mt-2 text-white">{value}</div>
              </div>
            ))}
          </div>
        )}

        <CreateFacility onCreate={(body) => run('/api/admin/facilities', 'POST', body)} />

        {facilities.map((f) => (
          <FacilityCard key={f.id} facility={f} run={run} onShowQr={(g) => showQr(g, f.name)} />
        ))}

        <Operators operators={operators} facilities={facilities} run={run} />
      </main>

      {qr && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setQr(null)}>
          <div className="bg-white text-slate-900 rounded-2xl p-6 text-center max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{qr.facility}</h3>
            <p className="text-sm text-slate-600">
              {qr.gate.gateName} · {qr.gate.gateType}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.url} alt={`QR code for ${qr.gate.gateName}`} className="mx-auto my-4 w-64 h-64" />
            <p className="text-[10px] font-mono text-slate-500 break-all">{qr.gate.qrCodeData}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => setQr(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                Close
              </button>
              <button onClick={printQr} className={button}>
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateFacility({ onCreate }: { onCreate: (body: object) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('MALL');
  const [address, setAddress] = useState('');
  const [rate, setRate] = useState('30');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (await onCreate({ name, type, address, feeRatePerHour: Number(rate) })) {
      setName('');
      setAddress('');
    }
    setBusy(false);
  }

  return (
    <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-bold text-white">Add a facility</h2>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
          {FACILITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace('_', ' ')}
            </option>
          ))}
        </select>
        <input className={input} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
        <input className={input} type="number" min="1" step="1" placeholder="₹/hour" value={rate} onChange={(e) => setRate(e.target.value)} required />
        <button className={button} disabled={busy}>
          Create facility
        </button>
      </form>
    </section>
  );
}

function FacilityCard({
  facility,
  run,
  onShowQr,
}: {
  facility: AdminFacility;
  run: (path: string, method: string, body: object) => Promise<boolean>;
  onShowQr: (gate: AdminGate) => void;
}) {
  const [levelCode, setLevelCode] = useState('');
  const [levelName, setLevelName] = useState('');
  const [floorMapUrl, setFloorMapUrl] = useState('');
  const [gateName, setGateName] = useState('');
  const [gateType, setGateType] = useState<'ENTRY' | 'EXIT'>('ENTRY');
  const [slotForm, setSlotForm] = useState<Record<string, { count: string; start: string }>>({});

  const slotTotal = facility.levels.reduce((n, l) => n + l._count.slots, 0);
  const missing = [
    facility.levels.length === 0 && 'a level',
    slotTotal === 0 && 'slots',
    !facility.gates.some((g) => g.gateType === 'ENTRY') && 'an entry gate',
    !facility.gates.some((g) => g.gateType === 'EXIT') && 'an exit gate',
  ].filter(Boolean);

  return (
    <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">{facility.name}</h2>
          <p className="text-xs text-slate-400">
            {facility.type.replace('_', ' ')} · {facility.address} · {rupees(facility.feeRatePerHour)}/hr · {slotTotal} slots
          </p>
        </div>
        {missing.length > 0 && (
          <span className="text-xs font-semibold bg-amber-500 text-slate-950 px-2 py-1 rounded">
            Not ready: add {missing.join(', ')}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Levels & slots */}
        <div>
          <h3 className="text-sm font-bold text-slate-200">Levels</h3>
          <ul className="mt-2 space-y-2">
            {facility.levels.map((l) => {
              const form = slotForm[l.id] || { count: '10', start: String(l._count.slots + 1) };
              return (
                <li key={l.id} className="bg-slate-900 rounded-lg p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold text-white">
                      {l.displayName} ({l.levelCode})
                    </span>
                    <span className="text-slate-400">{l._count.slots} slots</span>
                  </div>
                  <form
                    className="mt-2 flex gap-2 items-center"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await run(`/api/admin/levels/${l.id}/slots`, 'POST', {
                        count: Number(form.count),
                        startingNumber: Number(form.start),
                      });
                    }}
                  >
                    <span className="text-slate-400">Add</span>
                    <input
                      className={`${input} w-16 py-1`}
                      type="number"
                      min="1"
                      max="100"
                      value={form.count}
                      onChange={(e) => setSlotForm({ ...slotForm, [l.id]: { ...form, count: e.target.value } })}
                    />
                    <span className="text-slate-400">slots from #</span>
                    <input
                      className={`${input} w-16 py-1`}
                      type="number"
                      min="1"
                      value={form.start}
                      onChange={(e) => setSlotForm({ ...slotForm, [l.id]: { ...form, start: e.target.value } })}
                    />
                    <button className={`${button} py-1`}>Add</button>
                  </form>
                </li>
              );
            })}
          </ul>
          <form
            className="mt-3 grid grid-cols-2 gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(`/api/admin/facilities/${facility.id}/levels`, 'POST', {
                  levelCode,
                  displayName: levelName,
                  floorMapUrl: floorMapUrl || undefined,
                })
              ) {
                setLevelCode('');
                setLevelName('');
                setFloorMapUrl('');
              }
            }}
          >
            <input className={input} placeholder="Code (e.g. B1)" value={levelCode} onChange={(e) => setLevelCode(e.target.value)} required />
            <input className={input} placeholder="Name (e.g. Basement 1)" value={levelName} onChange={(e) => setLevelName(e.target.value)} required />
            <input
              className={`${input} col-span-2`}
              placeholder="Floor map image URL (optional, shown in the driver app)"
              value={floorMapUrl}
              onChange={(e) => setFloorMapUrl(e.target.value)}
            />
            <button className={`${button} col-span-2`}>Add level</button>
          </form>
        </div>

        {/* Gates */}
        <div>
          <h3 className="text-sm font-bold text-slate-200">Gates</h3>
          <ul className="mt-2 space-y-2">
            {facility.gates.map((g) => (
              <li key={g.id} className="bg-slate-900 rounded-lg p-3 text-xs flex items-center justify-between">
                <span>
                  <span
                    className={`mr-2 px-2 py-0.5 rounded font-bold ${
                      g.gateType === 'ENTRY' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-blue-900/60 text-blue-300'
                    }`}
                  >
                    {g.gateType}
                  </span>
                  <span className="text-white font-semibold">{g.gateName}</span>
                  {!g.isActive && <span className="ml-2 text-slate-500">(inactive)</span>}
                </span>
                <button onClick={() => onShowQr(g)} className="text-blue-300 hover:text-white font-semibold">
                  QR code
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(`/api/admin/facilities/${facility.id}/gates`, 'POST', { gateName, gateType })) setGateName('');
            }}
          >
            <input className={`${input} flex-1`} placeholder="Gate name" value={gateName} onChange={(e) => setGateName(e.target.value)} required />
            <select className={input} value={gateType} onChange={(e) => setGateType(e.target.value as 'ENTRY' | 'EXIT')}>
              <option value="ENTRY">Entry</option>
              <option value="EXIT">Exit</option>
            </select>
            <button className={button}>Add gate</button>
          </form>
        </div>
      </div>
    </section>
  );
}

function Operators({
  operators,
  facilities,
  run,
}: {
  operators: OperatorAccount[];
  facilities: AdminFacility[];
  run: (path: string, method: string, body: object) => Promise<boolean>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [facilityId, setFacilityId] = useState('');

  return (
    <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-bold text-white">Operator accounts</h2>
      <p className="text-xs text-slate-400">Each operator can only see and act on their own facility.</p>

      <form
        className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run('/api/admin/operators', 'POST', { username, password, facilityId })) {
            setUsername('');
            setPassword('');
          }
        }}
      >
        <input className={input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input
          className={input}
          type="password"
          placeholder="Password (10+ characters)"
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
        <select className={input} value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required>
          <option value="">Facility…</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className={button}>Create operator</button>
      </form>

      <table className="mt-6 w-full text-left text-xs text-slate-300">
        <thead className="text-slate-400 uppercase tracking-wider border-b border-slate-700">
          <tr>
            <th className="py-2">Username</th>
            <th className="py-2">Facility</th>
            <th className="py-2">Status</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/60">
          {operators.map((o) => (
            <tr key={o.id}>
              <td className="py-2 font-mono text-white">{o.username}</td>
              <td className="py-2">{o.facility.name}</td>
              <td className="py-2">{o.isActive ? <span className="text-emerald-400">Active</span> : <span className="text-slate-500">Disabled</span>}</td>
              <td className="py-2 text-right space-x-3">
                <button
                  className="text-blue-300 hover:text-white"
                  onClick={() => {
                    const pw = prompt(`New password for ${o.username} (10+ characters):`);
                    if (pw) run(`/api/admin/operators/${o.id}`, 'PATCH', { password: pw });
                  }}
                >
                  Reset password
                </button>
                <button
                  className={o.isActive ? 'text-rose-300 hover:text-white' : 'text-emerald-300 hover:text-white'}
                  onClick={() => run(`/api/admin/operators/${o.id}`, 'PATCH', { isActive: !o.isActive })}
                >
                  {o.isActive ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>
          ))}
          {operators.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-slate-500">
                No operators yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

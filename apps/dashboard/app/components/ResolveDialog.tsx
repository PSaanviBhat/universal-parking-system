'use client';

import { useState } from 'react';
import { apiFetch, rupees, dateTimeOf } from '../lib/api';
import type { OperatorSession } from '../lib/types';
import { SessionBadges } from './Badges';

type Choice =
  | { action: 'FORCE_CLOSE' }
  | { action: 'DISPUTE' }
  | { action: 'SETTLE_DISPUTE'; outcome: 'CHARGE' | 'WAIVE' | 'REFUND' };

interface Option {
  key: string;
  choice: Choice;
  label: string;
  help: string;
  danger?: boolean;
}

/**
 * Offers only the actions the backend allows for the session's current state:
 * - ACTIVE:                 force close (charge now) or dispute (stop the clock, no charge yet)
 * - COMPLETED:              dispute (flag the charge for review)
 * - DISPUTED, not charged:  charge the frozen fee, or waive it
 * - DISPUTED, charged:      keep the charge, or refund it to the wallet
 */
function optionsFor(s: OperatorSession): Option[] {
  if (s.status === 'ACTIVE') {
    return [
      {
        key: 'force',
        choice: { action: 'FORCE_CLOSE' },
        label: 'Force close & charge',
        help: `Closes the session now (e.g. lost phone, barrier override), charges about ${rupees(s.totalFee)} to the wallet and frees the slot.`,
        danger: true,
      },
      {
        key: 'dispute',
        choice: { action: 'DISPUTE' },
        label: 'Dispute (no charge yet)',
        help: 'Stops the clock, frees the slot and holds the fee until you settle the dispute.',
      },
    ];
  }
  if (s.status === 'COMPLETED') {
    return [
      {
        key: 'dispute',
        choice: { action: 'DISPUTE' },
        label: 'Dispute this charge',
        help: 'Flags the session for review. The charge stays until you settle it.',
      },
    ];
  }
  const uncharged = s.paymentStatus === 'PENDING';
  return uncharged
    ? [
        {
          key: 'charge',
          choice: { action: 'SETTLE_DISPUTE', outcome: 'CHARGE' },
          label: `Charge ${rupees(s.totalFee)}`,
          help: 'The driver owes the fee. It is taken from the wallet (debt rules apply if the balance is short).',
        },
        {
          key: 'waive',
          choice: { action: 'SETTLE_DISPUTE', outcome: 'WAIVE' },
          label: 'Waive the fee',
          help: 'Close the session with no charge.',
        },
      ]
    : [
        {
          key: 'keep',
          choice: { action: 'SETTLE_DISPUTE', outcome: 'CHARGE' },
          label: 'Keep the charge',
          help: 'The original charge was correct. Close the dispute.',
        },
        {
          key: 'refund',
          choice: { action: 'SETTLE_DISPUTE', outcome: 'REFUND' },
          label: `Refund ${rupees(s.totalFee)}`,
          help: 'Credits the fee back to the driver’s wallet.',
          danger: true,
        },
      ];
}

export default function ResolveDialog({
  session,
  onClose,
  onDone,
}: {
  session: OperatorSession;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const options = optionsFor(session);
  const [selected, setSelected] = useState<string>(options[0].key);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const option = options.find((o) => o.key === selected)!;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>(`/api/operator/sessions/${session.sessionId}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ ...option.choice, resolutionNote: note.trim() || undefined }),
      });
      onDone(res.message);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white font-mono">{session.licensePlate}</h3>
            <p className="text-xs text-slate-400 mt-1">
              {session.userName} · {session.userPhone} · Slot {session.levelCode}-{session.slotNumber}
            </p>
            <p className="text-xs text-slate-400">
              Entered {dateTimeOf(session.entryTime)}
              {session.exitTime ? ` · Left ${dateTimeOf(session.exitTime)}` : ''} · {session.durationMinutes} min
            </p>
          </div>
          <SessionBadges session={session} />
        </div>

        {session.resolutionNote && (
          <p className="mt-3 text-xs text-slate-300 bg-slate-800 rounded-lg p-2">Note: {session.resolutionNote}</p>
        )}

        <div className="mt-5 space-y-2">
          {options.map((o) => (
            <label
              key={o.key}
              className={`block cursor-pointer rounded-xl border p-3 ${
                selected === o.key ? 'border-blue-500 bg-blue-950/40' : 'border-slate-700 hover:border-slate-500'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="resolve"
                  aria-label={o.label}
                  checked={selected === o.key}
                  onChange={() => setSelected(o.key)}
                />
                <span className={`text-sm font-semibold ${o.danger ? 'text-rose-300' : 'text-white'}`}>{o.label}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 ml-5">{o.help}</p>
            </label>
          ))}
        </div>

        <label className="block mt-4 text-xs font-semibold text-slate-400">
          Note (shown on the driver’s receipt)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. Driver lost phone, verified licence at security desk"
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

import type { OperatorSession } from '../lib/types';

const PAYMENT_STYLES: Record<string, string> = {
  PAID: 'bg-emerald-900/60 text-emerald-300',
  PENDING: 'bg-slate-700 text-slate-300',
  DEBT: 'bg-rose-900/60 text-rose-300',
  AUTOPAY_PENDING: 'bg-amber-900/60 text-amber-300',
  FINED: 'bg-rose-800 text-rose-100',
};

const PAYMENT_LABELS: Record<string, string> = {
  PAID: 'Paid',
  PENDING: 'Not charged',
  DEBT: 'Debt (48h)',
  AUTOPAY_PENDING: 'Autopay pending',
  FINED: 'Fined',
};

export function PaymentBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${PAYMENT_STYLES[status] || 'bg-slate-700 text-slate-300'}`}>
      {PAYMENT_LABELS[status] || status}
    </span>
  );
}

export function SessionBadges({ session }: { session: OperatorSession }) {
  return (
    <div className="flex flex-wrap gap-1">
      {session.status === 'DISPUTED' && (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 text-purple-300">Disputed</span>
      )}
      {session.isStale && (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-slate-950"
          title="Active much longer than usual — the vehicle may have left without scanning out."
        >
          Stale
        </span>
      )}
      <PaymentBadge status={session.paymentStatus} />
    </div>
  );
}

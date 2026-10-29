import { PaymentStatus, Prisma, SessionStatus, SlotStatus, TransactionType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export const DEBT_REPAYMENT_WINDOW_HOURS = Number(process.env.DEBT_REPAYMENT_WINDOW_HOURS || 48);
export const STALE_SESSION_HOURS = Number(process.env.STALE_SESSION_HOURS || 24);
const FACILITY_TIMEZONE = process.env.FACILITY_TIMEZONE || 'Asia/Kolkata';

// ─── Fee calculation ──────────────────────────────────────────────────────────

/**
 * Billable duration is rounded up to whole minutes; the fee is charged pro-rata
 * on the hourly rate snapshot with a 1-hour minimum.
 */
export function calculateFee(entryTime: Date, endTime: Date, hourlyRate: number) {
  const durationMs = Math.max(0, endTime.getTime() - new Date(entryTime).getTime());
  const durationMinutes = Math.max(1, Math.ceil(durationMs / (1000 * 60)));
  const fee = Math.max(hourlyRate, Math.round((durationMinutes / 60) * hourlyRate * 100) / 100);
  return { durationMs, durationMinutes, fee };
}

/** An ACTIVE session older than STALE_SESSION_HOURS is likely forgotten or stuck. */
export function isStaleSession(entryTime: Date, now = new Date()): boolean {
  return now.getTime() - new Date(entryTime).getTime() > STALE_SESSION_HOURS * 60 * 60 * 1000;
}

export function staleCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_SESSION_HOURS * 60 * 60 * 1000);
}

/**
 * Midnight of the current day in the facility time zone (default Asia/Kolkata),
 * so "today" stats are correct on servers running in UTC.
 */
export function startOfToday(now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FACILITY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const y = Number(parts.year);
  const m = Number(parts.month) - 1;
  const d = Number(parts.day);
  const zonedAsUtc = Date.UTC(y, m, d, Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMs = zonedAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(y, m, d) - offsetMs);
}

// ─── Wallet ledger ────────────────────────────────────────────────────────────

export interface CreditWalletArgs {
  walletId: string;
  amount: number;
  description: string;
  /** Defaults to DEBT_REPAYMENT when the wallet was negative before the credit, else TOP_UP. */
  type?: TransactionType;
  sessionId?: string;
}

/**
 * Credits a wallet atomically (balance increment in SQL, never read-modify-write),
 * clears the debt window once the balance is back to >= 0, and records the transaction.
 * Must be called inside a Prisma transaction.
 */
export async function creditWallet(tx: Tx, args: CreditWalletArgs) {
  const { walletId, amount, description, sessionId } = args;

  const credited = await tx.wallet.update({
    where: { id: walletId },
    data: { balance: { increment: amount } },
  });

  const newBalance = Number(credited.balance);
  const prevBalance = Math.round((newBalance - amount) * 100) / 100;
  const wasInDebt = prevBalance < 0;
  const isCleared = newBalance >= 0;

  const wallet =
    isCleared && (credited.debtCreatedAt || credited.debtDeadline)
      ? await tx.wallet.update({
          where: { id: walletId },
          data: { debtCreatedAt: null, debtDeadline: null },
        })
      : credited;

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId,
      sessionId,
      type: args.type ?? (wasInDebt ? TransactionType.DEBT_REPAYMENT : TransactionType.TOP_UP),
      amount,
      description,
    },
  });

  return { wallet, transaction, prevBalance, newBalance, wasInDebt, isCleared };
}

export interface DebitWalletArgs {
  userId: string;
  amount: number;
  description: string;
  sessionId?: string;
  at?: Date;
}

/**
 * Debits a wallet atomically. If the balance goes negative and no debt window is
 * open yet, opens one (debtCreatedAt = at, debtDeadline = at + DEBT_REPAYMENT_WINDOW_HOURS).
 * Must be called inside a Prisma transaction.
 */
export async function debitWallet(tx: Tx, args: DebitWalletArgs) {
  const at = args.at ?? new Date();

  const debited = await tx.wallet.update({
    where: { userId: args.userId },
    data: { balance: { decrement: args.amount } },
  });

  const newBalance = Number(debited.balance);
  const prevBalance = Math.round((newBalance + args.amount) * 100) / 100;
  const isDebt = newBalance < 0;

  let wallet = debited;
  if (isDebt && !debited.debtCreatedAt) {
    wallet = await tx.wallet.update({
      where: { id: debited.id },
      data: {
        debtCreatedAt: at,
        debtDeadline: new Date(at.getTime() + DEBT_REPAYMENT_WINDOW_HOURS * 60 * 60 * 1000),
      },
    });
  }

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      sessionId: args.sessionId,
      type: TransactionType.PARKING_CHARGE,
      amount: args.amount,
      description: args.description,
    },
  });

  return {
    wallet,
    transaction,
    prevBalance,
    newBalance,
    isDebt,
    debtDeadline: wallet.debtDeadline,
    paymentStatus: isDebt ? PaymentStatus.DEBT : PaymentStatus.PAID,
  };
}

// ─── Session settlement ───────────────────────────────────────────────────────

/** Thrown when a session was already closed by a concurrent or earlier request. */
export const SESSION_ALREADY_CLOSED = 'SESSION_ALREADY_CLOSED';

interface SettleableSession {
  id: string;
  userId: string;
  slotId: string;
  entryTime: Date;
  feeRateSnapshot: Prisma.Decimal | number;
}

/**
 * Releases a slot only if it is still held by this session, so a slot that was
 * already re-assigned to another vehicle is never freed by mistake.
 */
export async function releaseSlotForSession(tx: Tx, slotId: string, sessionId: string) {
  await tx.parkingSlot.updateMany({
    where: { id: slotId, currentSessionId: sessionId },
    data: { status: SlotStatus.AVAILABLE, currentSessionId: null },
  });
  return tx.parkingSlot.findUniqueOrThrow({ where: { id: slotId }, include: { level: true } });
}

/**
 * Closes an ACTIVE session and charges the wallet in one transaction:
 * 1. Claims the session with a conditional ACTIVE -> COMPLETED update. If another
 *    request already closed it, throws SESSION_ALREADY_CLOSED and nothing is charged.
 * 2. Debits the wallet atomically (opening the debt window if it goes negative).
 * 3. Records the payment status and releases the slot.
 */
export async function settleSessionCharge(
  tx: Tx,
  args: {
    session: SettleableSession;
    exitTime: Date;
    description: (durationMinutes: number) => string;
    exitGateId?: string;
    resolutionNote?: string;
  }
) {
  const { session, exitTime } = args;
  const { durationMinutes, fee } = calculateFee(session.entryTime, exitTime, Number(session.feeRateSnapshot));

  const claimed = await tx.parkingSession.updateMany({
    where: { id: session.id, status: SessionStatus.ACTIVE },
    data: {
      status: SessionStatus.COMPLETED,
      exitTime,
      durationMinutes,
      totalFee: fee,
      exitGateId: args.exitGateId,
      resolutionNote: args.resolutionNote,
    },
  });
  if (claimed.count === 0) {
    throw new Error(SESSION_ALREADY_CLOSED);
  }

  const debit = await debitWallet(tx, {
    userId: session.userId,
    amount: fee,
    description: args.description(durationMinutes),
    sessionId: session.id,
    at: exitTime,
  });

  const closedSession = await tx.parkingSession.update({
    where: { id: session.id },
    data: { paymentStatus: debit.paymentStatus },
  });

  const releasedSlot = await releaseSlotForSession(tx, session.slotId, session.id);

  return { closedSession, releasedSlot, durationMinutes, totalFee: fee, ...debit };
}

/**
 * Cookie persistence for the advance-tax schedule.
 *
 * The schedule isn't part of UserPayload (it's derived state — generated
 * from annual_tax_liability + country + today), so it lives in its own
 * cookie similar to activity-cookie.ts. Mirrors the read/write/mark-paid
 * pattern there.
 *
 * When the user lands on /plan and the cookie is missing OR stale (older
 * than the current FY's last instalment), the page generates a fresh
 * schedule and writes it. Mark-paid operations mutate the cookie in
 * place; auto-mint-missed detection runs at /plan render time.
 */
import {
  detectMissedInstalments,
  type AdvanceTaxSchedule,
  type AdvanceTaxInstalment,
} from './advance-tax';
import Decimal from 'decimal.js';
import { dec } from './safe-decimal';

const COOKIE_NAME = 'rightdue_advance_tax';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function writeScheduleClient(schedule: AdvanceTaxSchedule | null) {
  if (typeof document === 'undefined') return;
  if (schedule == null) {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
  } else {
    const value = encodeURIComponent(JSON.stringify(schedule));
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('advance_tax', schedule),
  );
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function readScheduleServer(): Promise<AdvanceTaxSchedule | null> {
  const { cookies } = await import('next/headers');
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdvanceTaxSchedule;
    if (!parsed.instalments || !Array.isArray(parsed.instalments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Mark-paid + missed-event helpers ───────────────────────────────────────

/**
 * Apply a payment to instalment `ordinal` in the schedule. Supports
 * partial — if `amount` is less than amountDue, status stays 'pending'
 * with paidAmount set (the shortfall accrues 234C until cleared).
 * If `amount >= amountDue`, status becomes 'paid'. Returns a new
 * schedule (caller writes it back via writeScheduleClient).
 */
export function markPaid(
  schedule: AdvanceTaxSchedule,
  ordinal: number,
  amount: string,
  paidOn: string,
): AdvanceTaxSchedule {
  const amountD = new Decimal(amount);
  if (amountD.lte(0)) return schedule;
  return {
    ...schedule,
    instalments: schedule.instalments.map((inst) => {
      if (inst.ordinal !== ordinal) return inst;
      const prevPaid = dec(inst.paidAmount);
      const due = new Decimal(inst.amountDue);
      const newPaid = prevPaid.add(amountD);
      const status: AdvanceTaxInstalment['status'] = newPaid.gte(due)
        ? 'paid'
        : inst.status === 'missed'
          ? 'missed'
          : 'pending';
      return {
        ...inst,
        paidAmount: newPaid.toFixed(0),
        status,
        paidOn,
      };
    }),
  };
}

/**
 * Flag any past-due-and-unpaid instalments as 'missed'. Mutates status
 * only — the user can still mark them paid retroactively (status would
 * flip back to 'paid' if shortfall is cleared).
 */
export function markMissedInstalments(
  schedule: AdvanceTaxSchedule,
  today: Date,
): AdvanceTaxSchedule {
  const missed = detectMissedInstalments(schedule, today);
  if (missed.length === 0) return schedule;
  const missedOrdinals = new Set(missed.map((m) => m.instalment.ordinal));
  return {
    ...schedule,
    instalments: schedule.instalments.map((inst) =>
      missedOrdinals.has(inst.ordinal) && inst.status === 'pending'
        ? { ...inst, status: 'missed' as const }
        : inst,
    ),
  };
}

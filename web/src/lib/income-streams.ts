/**
 * Multi-source income model — helpers for active-stream selection and
 * derived monthly income / tax-sleeve targets.
 *
 * A stream is active if `today` falls between its start_date and end_date
 * (end_date being omitted means "current"). The engine still consumes
 * a single monthly_income; we derive it from the sum of active streams
 * at save time and let the engine math run unchanged.
 *
 * For dates: streams accept YYYY-MM-DD or YYYY-MM (month-only is fine;
 * we treat it as the first of that month for comparisons).
 */
import Decimal from 'decimal.js';
import type { IncomeStreamPayload } from './api';

const D = (v: string | number | Decimal | null | undefined) =>
  new Decimal(v ?? '0');

/** Parse a YYYY-MM or YYYY-MM-DD date string to a Date at midnight UTC. */
export function parseStreamDate(d: string | undefined | null): Date | null {
  if (!d) return null;
  // Normalize YYYY-MM to YYYY-MM-01
  const normalized = d.length === 7 ? `${d}-01` : d;
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function isActive(
  stream: IncomeStreamPayload,
  asOf: Date = new Date(),
): boolean {
  const start = parseStreamDate(stream.start_date);
  if (!start) return false;
  if (start.getTime() > asOf.getTime()) return false;
  if (!stream.end_date) return true;
  const end = parseStreamDate(stream.end_date);
  if (!end) return true; // unparseable end → treat as still active
  return end.getTime() >= asOf.getTime();
}

export function activeStreams(
  streams: IncomeStreamPayload[] | undefined,
  asOf: Date = new Date(),
): IncomeStreamPayload[] {
  return (streams ?? []).filter((s) => isActive(s, asOf));
}

/**
 * Sum the gross_annual across all currently-active streams. Returns a
 * Decimal so callers can choose how to format.
 */
export function activeGrossAnnual(
  streams: IncomeStreamPayload[] | undefined,
  asOf: Date = new Date(),
): Decimal {
  return activeStreams(streams, asOf).reduce(
    (s, x) => s.plus(D(x.gross_annual)),
    D(0),
  );
}

/**
 * Derive monthly_income from active streams. Returns null when no
 * streams are active so callers can fall back to the user's manual
 * monthly_income input.
 */
export function deriveMonthlyIncome(
  streams: IncomeStreamPayload[] | undefined,
  asOf: Date = new Date(),
): Decimal | null {
  const active = activeStreams(streams, asOf);
  if (active.length === 0) return null;
  return activeGrossAnnual(active, asOf).div(12);
}

/**
 * Annualised non-TDS liability across active streams — the tax sleeve
 * target derived from streams. Each stream contributes
 * `gross_annual × marginal_rate × (1 − tds_pct)` to the sleeve.
 *
 * Returns null when no streams exist; the legacy `extra_income_annual_tax`
 * input remains the fallback.
 */
export function deriveNonTdsLiability(
  streams: IncomeStreamPayload[] | undefined,
  marginalRate: Decimal | string,
  asOf: Date = new Date(),
): Decimal | null {
  const active = activeStreams(streams, asOf);
  if (active.length === 0) return null;
  const marg = D(marginalRate);
  let total = D(0);
  for (const s of active) {
    const gross = D(s.gross_annual);
    const tds = D(s.tds_pct);
    const liability = gross.mul(marg).mul(D(1).minus(tds));
    if (liability.gt(0)) total = total.plus(liability);
  }
  return total;
}

/** Quick check — does the user have any historical (closed) streams? */
export function hasHistoricalTransitions(
  streams: IncomeStreamPayload[] | undefined,
): boolean {
  return (streams ?? []).some((s) => !!s.end_date);
}

/** Generate a stable client-side id without pulling in uuid. */
export function newStreamId(): string {
  return `is_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankStream(): IncomeStreamPayload {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  return {
    id: newStreamId(),
    kind: 'salaried',
    label: '',
    gross_annual: '',
    start_date: `${yyyy}-${mm}`,
    tds_pct: '0.3',
  };
}

export const KIND_LABELS: Record<IncomeStreamPayload['kind'], string> = {
  salaried: 'Salaried',
  business_owner: 'Business income',
  freelance: 'Freelance / consulting',
  rental: 'Rental income',
  capital_gains: 'Capital gains',
  other: 'Other',
};

/** TDS-default by kind — pre-fills when the user picks a kind. */
export function defaultTdsForKind(kind: IncomeStreamPayload['kind']): string {
  switch (kind) {
    case 'salaried':
      return '0.3';
    case 'freelance':
      return '0.1';
    case 'rental':
      return '0';
    case 'business_owner':
      return '0';
    case 'capital_gains':
      return '0';
    default:
      return '0';
  }
}

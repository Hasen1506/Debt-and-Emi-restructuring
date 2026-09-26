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
import { dec } from './safe-decimal';
import type {
  IncomeStreamPayload,
  IncomeStreamTaxTreatment,
} from './api';

const D = dec;

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
    tax_treatment: 'salary',
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

/**
 * Project income-stream transitions inside the simulation horizon as
 * engine-shaped lifecycle events.
 *
 * Why: the engine takes a scalar `monthly_income` and applies an annual
 * hike — it has no native concept of multiple streams switching on and
 * off mid-horizon. But it DOES support `salary_reset` lifecycle events
 * (engine/models.py:LifecycleEventKind), so we synthesise one per
 * transition month. The simulator already handles the rest.
 *
 * Algorithm: walk each calendar month from `today + 1` to
 * `today + horizonMonths`. Whenever the set of active streams changes
 * vs. the previous month, emit a salary_reset with the new monthly
 * take-home (sum of active gross / 12 — same formula as the at-save
 * monthly_income derivation, keeping a consistent scale).
 *
 * Streams already active at `today` are baked into the user's
 * monthly_income by the onboarding save path — we don't emit an event
 * for month 1.
 */
export function streamTransitionsAsLifecycleEvents(
  streams: IncomeStreamPayload[] | undefined,
  horizonMonths: number,
  today: Date = new Date(),
): { kind: 'salary_reset'; effective_month: number; new_monthly_take_home: string }[] {
  const list = streams ?? [];
  if (list.length === 0 || horizonMonths <= 1) return [];

  const events: {
    kind: 'salary_reset';
    effective_month: number;
    new_monthly_take_home: string;
  }[] = [];

  // Baseline: gross active right now. The save-time path bakes this into
  // monthly_income, so we don't emit a duplicate event for it.
  let prevGross = activeGrossAnnual(list, today).toString();

  for (let m = 2; m <= horizonMonths; m += 1) {
    const probe = new Date(
      today.getFullYear(),
      today.getMonth() + (m - 1),
      today.getDate(),
    );
    const gross = activeGrossAnnual(list, probe).toString();
    if (gross !== prevGross) {
      const takeHome = D(gross).div(12).toFixed(2);
      events.push({
        kind: 'salary_reset',
        effective_month: m,
        new_monthly_take_home: takeHome,
      });
      prevGross = gross;
    }
  }
  return events;
}

/**
 * Default tax_treatment for a given stream kind. Used by the UI when the
 * user picks a kind without explicitly setting treatment, and by the tax
 * routing when older saved streams have no treatment field at all.
 *
 *   salaried        → salary
 *   business_owner  → business_normal (full P&L; user can override to 44ADA)
 *   freelance       → business_44ada  (typical for professionals < ₹50L)
 *   rental          → rental
 *   capital_gains   → capital_gains
 *   other           → salary          (safe fallback: routes through slab)
 */
export function defaultTaxTreatment(
  kind: IncomeStreamPayload['kind'],
): IncomeStreamTaxTreatment {
  switch (kind) {
    case 'salaried':
      return 'salary';
    case 'business_owner':
      return 'business_normal';
    case 'freelance':
      return 'business_44ada';
    case 'rental':
      return 'rental';
    case 'capital_gains':
      return 'capital_gains';
    default:
      return 'salary';
  }
}

/**
 * How much of this stream's gross flows into the slab pool. Capital-gains
 * streams contribute 0 (taxed at flat rate separately). Presumptive 44ADA
 * contributes 50% (the deemed-profit portion). Rental contributes 70%
 * (after standard 30% deduction). Salary/business_normal contribute 100%
 * of gross — for business_normal, the user's separate `allowable_expenses`
 * pull it back at the deductions layer.
 */
export function streamSlabContribution(
  stream: IncomeStreamPayload,
): Decimal {
  const gross = D(stream.gross_annual);
  const treatment = stream.tax_treatment ?? defaultTaxTreatment(stream.kind);
  switch (treatment) {
    case 'salary':
    case 'business_normal':
      return gross;
    case 'business_44ada':
      return gross.mul('0.5');
    case 'rental':
      return gross.mul('0.7');
    case 'capital_gains':
      return D(0);
    default:
      return gross;
  }
}

/**
 * Sum of slab-eligible income across active streams — replacement for
 * raw `activeGrossAnnual` in the marginal-rate derivation. Capital-gains
 * streams excluded; presumptive / rental streams contribute their deemed
 * share. Used by the onboarding save path to compute `grossForBracket`.
 */
export function activeSlabGrossAnnual(
  streams: IncomeStreamPayload[] | undefined,
  asOf: Date = new Date(),
): Decimal {
  return activeStreams(streams, asOf).reduce(
    (s, x) => s.plus(streamSlabContribution(x)),
    D(0),
  );
}

/**
 * Flat tax owed on capital-gains streams — added to slab tax for the
 * total annual liability. Conservative default: LTCG 20% with indexation
 * (India) / LTCG 20% (US). Users with STCG-heavy streams can override
 * via the treatment-flat-rate override (future field, not yet exposed).
 * Country gate: India and US use the same 20% rate by happy coincidence
 * for LTCG on most asset classes; equity-specific rates handled later.
 */
export function activeCapitalGainsFlatTax(
  streams: IncomeStreamPayload[] | undefined,
  asOf: Date = new Date(),
): Decimal {
  return activeStreams(streams, asOf)
    .filter(
      (s) =>
        (s.tax_treatment ?? defaultTaxTreatment(s.kind)) === 'capital_gains',
    )
    .reduce((sum, s) => sum.plus(D(s.gross_annual).mul('0.2')), D(0));
}

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

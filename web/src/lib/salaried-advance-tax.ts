/**
 * Round 2 (founder, item 5): advance tax for a SALARIED user whose other
 * income has no TDS (interest, capital gains, rent, freelance). The engine
 * works it out (engine/tax/advance_tax.py, POST /api/tax/advance-tax/salaried:
 * s.404 [208] ₹10,000 or more after TDS; 15 Jun / 15 Sep / 15 Dec / 15 Mar at
 * 15 / 45 / 75 / 100%; s.425 [234C] and s.424 [234B] interest at 1% a month).
 * This file turns the profile's income streams into that request and the
 * answer into the Plan's AdvanceTaxPanel schedule.
 */
import Decimal from 'decimal.js';
import type { AdvanceTaxSchedule } from './advance-tax';
import type { IncomeStreamPayload, UserPayload } from './api';

export type OtherIncomeKind = 'interest' | 'rent' | 'freelance' | 'capital_gains' | 'other';

export interface OtherIncomeIn {
  kind: OtherIncomeKind;
  gross_annual: string;
  tds_pct?: string;
  presumptive?: boolean;
  cg_kind?: 'equity_stcg' | 'equity_ltcg' | 'other';
}

export interface SalariedAdvanceTaxRequest {
  annual_gross_salary: string;
  tax_regime?: 'new' | 'old';
  age?: number;
  resident?: boolean;
  streams: OtherIncomeIn[];
  today?: string;
}

export interface SalariedAdvanceTaxResponse {
  applies: boolean;
  liability: string;
  reason: string;
  tax_total: string;
  tax_on_salary: string;
  tds_on_other: string;
  presumptive: boolean;
  fiscal_year_label: string;
  instalments: { due: string; cumulative_share: string; amount: string; cumulative: string }[];
  interest_234c_if_unpaid: string;
  interest_234b_if_unpaid: string;
  interest_if_unpaid: string;
  assumptions: string[];
  sources: Record<string, string>;
  threshold: string;
}

/** The ₹10,000 line (s.404 [208]: "Rs. 10,000 or more"). */
export const ADVANCE_TAX_THRESHOLD_IN = 10_000;

function active(s: IncomeStreamPayload, todayIso: string): boolean {
  const start = (s.start_date || '').slice(0, 10);
  const end = (s.end_date || '').slice(0, 10);
  return (!start || start <= todayIso) && (!end || end >= todayIso);
}

/** The profile's active non-salary streams, as the engine's inputs. */
export function nonTdsStreams(streams: IncomeStreamPayload[] | undefined, todayIso: string): OtherIncomeIn[] {
  const out: OtherIncomeIn[] = [];
  for (const s of streams ?? []) {
    if (!active(s, todayIso) || !(Number(s.gross_annual) > 0)) continue;
    const tds = s.tds_pct && Number(s.tds_pct) > 0 ? String(s.tds_pct) : undefined;
    const base = { gross_annual: String(s.gross_annual), ...(tds ? { tds_pct: tds } : {}) };
    switch (s.kind) {
      case 'interest':
        out.push({ kind: 'interest', ...base });
        break;
      case 'rental':
        out.push({ kind: 'rent', ...base });
        break;
      case 'freelance':
        out.push({ kind: 'freelance', ...base, presumptive: (s.tax_treatment ?? 'business_44ada') !== 'business_normal' });
        break;
      case 'capital_gains':
        out.push({ kind: 'capital_gains', ...base, cg_kind: s.cg_kind ?? 'other' });
        break;
      case 'other':
        out.push({ kind: 'other', ...base });
        break;
      default:
        break; // salaried / business_owner: not this path
    }
  }
  return out;
}

/** The request for a salaried Indian user with at least one non-TDS stream
 *  and a gross salary on file; null otherwise (nothing to work out). */
export function salariedAdvanceTaxRequest(user: UserPayload, todayIso: string): SalariedAdvanceTaxRequest | null {
  if (user.country !== 'IN' || user.income_type !== 'salaried') return null;
  const gross = Number(user.annual_gross_salary || 0);
  const streams = nonTdsStreams(user.income_streams, todayIso);
  if (!(gross > 0) || streams.length === 0) return null;
  return {
    annual_gross_salary: String(gross),
    tax_regime: user.tax_regime === 'old' ? 'old' : 'new',
    ...(user.age_bracket === '60_plus' ? { age: 60 } : user.age_bracket === '80_plus' ? { age: 80 } : {}),
    streams,
    today: todayIso,
  };
}

/** The Plan panel's schedule (upcoming instalments only, as buildSchedule). */
export function scheduleFromResponse(r: SalariedAdvanceTaxResponse, todayIso: string): AdvanceTaxSchedule | null {
  if (!r.applies || new Decimal(r.liability).lt(ADVANCE_TAX_THRESHOLD_IN)) return null;
  const upcoming = r.instalments.filter((i) => i.due >= todayIso);
  if (upcoming.length === 0) return null;
  return {
    country: 'IN',
    fiscalYearLabel: r.fiscal_year_label,
    annualLiability: new Decimal(r.liability).toFixed(0),
    instalments: upcoming.map((i, k) => ({
      dueDate: i.due,
      ordinal: k + 1,
      cumulativePct: Math.round(Number(i.cumulative_share) * 100),
      amountDue: new Decimal(i.amount).toFixed(0),
      status: 'pending' as const,
    })),
  };
}

/** One line under the panel: what it's on and what skipping it costs. */
export function salariedAdvanceTaxNote(r: SalariedAdvanceTaxResponse, fmt: (v: string) => string): string {
  const c = fmt(r.interest_234c_if_unpaid);
  const b = fmt(r.interest_234b_if_unpaid);
  return (
    `Your salary's tax is deducted by your employer; your other income (interest, gains, rent, freelance) adds ` +
    `${fmt(r.liability)} this year after any TDS, which is ₹10,000 or more, so it is paid in advance. ` +
    `Paying none of it until July would add about ${fmt(r.interest_if_unpaid)} in interest ` +
    `(s.425 [234C] ${c} + s.424 [234B] ${b}).`
  );
}

/** Round 3 (ux-walkthrough fix 10): what Home sets aside this month for a
 *  salaried user's next unpaid advance-tax instalment: its amount spread over
 *  the months up to and including the one it falls due in. Null with nothing
 *  due. `due` is "15 Dec". */
export function homeTaxReserve(
  schedule: AdvanceTaxSchedule | null | undefined,
  todayIso: string,
): { amount: number; due: string } | null {
  const next = schedule?.instalments.find((i) => i.status !== 'paid' && i.dueDate >= todayIso);
  if (!next) return null;
  const owed = Number(next.amountDue) - Number(next.paidAmount || 0);
  if (!(owed >= 1)) return null;
  const [y, m] = todayIso.split('-').map(Number);
  const [dy, dm, dd] = next.dueDate.split('-').map(Number);
  const months = Math.max(1, (dy - y) * 12 + (dm - m) + 1);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { amount: Math.ceil(owed / months), due: `${dd} ${MON[dm - 1]}` };
}

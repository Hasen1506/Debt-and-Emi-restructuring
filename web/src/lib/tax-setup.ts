/**
 * Round 3 (UX walkthrough 2, #11): the tax questions Setup asks on its first
 * step, and what the answers do to the tax rate the plan uses.
 *
 * NRI outside India and the USA (r01uae). The plan stays in rupees with
 * India's rules (the loans are Indian), but pay earned abroad is not taxed
 * in India: a non-resident's total income is only what is received, or
 * accrues or arises, in India (Income-tax Act 2025 s.5(2), as 1961 s.5(2);
 * https://indiacode.ecourtsindia.com/income-tax-act-2025/section/5/, read
 * 17 Oct 2026; residence tests s.6, https://www.incometax.gov.in/iec/foportal/
 * help/all-topics/e-filing-services/non-resident). The Gulf states below levy
 * no personal income tax on salary, so no foreign tax is assumed either.
 * Indian tax then falls only on India-sourced income (rent, NRO interest,
 * gains), at the slab rates, without the s.156 [87A] rebate, which is for
 * residents only (incometax.gov.in "Salaried Individuals for AY 2026-27",
 * rebate table, read 17 Oct 2026). Labelled "verify with a tax adviser".
 */
import Decimal from 'decimal.js';
import type { AgeBracket, Country, FilingStatusUS, UserPayload } from './api';
import { activeStreams, streamSlabContribution } from './income-streams';
import TAX from './tax-tables.json';

/** Where an NRI on an Indian plan lives: a Gulf state, or elsewhere. */
export type Residence = 'AE' | 'SA' | 'QA' | 'OM' | 'KW' | 'BH' | 'OTHER';

export const GULF: ReadonlyArray<{ code: Exclude<Residence, 'OTHER'>; name: string; ccy: string }> = [
  { code: 'AE', name: 'UAE', ccy: 'AED' },
  { code: 'SA', name: 'Saudi Arabia', ccy: 'SAR' },
  { code: 'QA', name: 'Qatar', ccy: 'QAR' },
  { code: 'OM', name: 'Oman', ccy: 'OMR' },
  { code: 'KW', name: 'Kuwait', ccy: 'KWD' },
  { code: 'BH', name: 'Bahrain', ccy: 'BHD' },
];

/** The currency pay abroad arrives in (null for "another country"). */
export function residenceCurrency(r: Residence | undefined | null): string | null {
  return GULF.find((g) => g.code === r)?.ccy ?? null;
}

/** "NRI, lives in UAE" / "NRI, lives outside India" ('' in India). */
export function abroadLabel(r: Residence | undefined | null): string {
  if (!r) return '';
  return `NRI, lives ${r === 'OTHER' ? 'outside India' : `in ${GULF.find((g) => g.code === r)?.name ?? ''}`}`;
}

/** Setup's answers (lib/api UserPayload fields they write). `gulf` = the
 *  Gulf chip is on but no state picked yet; `earns` = pension (India). */
export interface TaxBasics {
  residence?: Residence | 'GULF';
  earns?: 'pension';
  age?: '60_plus' | '80_plus';
  filing?: FilingStatusUS;
  itemises?: boolean;
}

export function taxBasicsOf(u: Partial<UserPayload>): TaxBasics {
  return {
    ...(u.country === 'IN' && u.nri_residence ? { residence: u.nri_residence } : {}),
    ...(u.income_kind === 'pension' ? { earns: 'pension' as const } : {}),
    ...(u.age_bracket === '60_plus' || u.age_bracket === '80_plus' ? { age: u.age_bracket } : {}),
    ...(u.country === 'US' && u.filing_status ? { filing: u.filing_status } : {}),
    ...(u.itemises != null ? { itemises: u.itemises } : {}),
  };
}

/** The answers written onto the profile Setup saves. */
export function applyTaxBasics(u: UserPayload, tb: TaxBasics): UserPayload {
  const out: UserPayload = { ...u };
  const abroad = u.country === 'IN' && tb.residence && tb.residence !== 'GULF' ? tb.residence : undefined;
  if (abroad) out.nri_residence = abroad;
  else delete out.nri_residence;
  const pension = u.country === 'IN' && !abroad && tb.earns === 'pension' && u.income_type === 'salaried';
  if (pension) out.income_kind = 'pension';
  else delete out.income_kind;
  if (pension && tb.age) out.age_bracket = tb.age as AgeBracket;
  if (u.country === 'US') {
    if (tb.filing) out.filing_status = tb.filing;
    out.itemises = tb.itemises === true;
  } else delete out.itemises;
  return out;
}

/** What Setup still needs before it can go on, or null. A US filing status
 *  is asked, never assumed (u07couple: couples were silently Single). */
export function taxBasicsGap(country: Country, tb: TaxBasics): string | null {
  if (country === 'IN' && tb.residence === 'GULF') return 'Pick the country you live in.';
  if (country === 'US' && !tb.filing) return 'Pick how you file your tax return.';
  return null;
}

/** An NRI on an Indian plan (lives in a Gulf state or elsewhere). */
export function livesAbroad(u: Pick<UserPayload, 'country' | 'nri_residence'>): boolean {
  return u.country === 'IN' && !!u.nri_residence;
}

/** India-sourced income an NRI pays Indian tax on, a year, from Profile's
 *  income streams: rent (after the 30% standard deduction), interest and
 *  other income. Salary and business streams are taken as earned abroad. */
export function indiaSourcedIncome(u: Pick<UserPayload, 'income_streams'>, asOf: Date = new Date()): Decimal {
  return activeStreams(u.income_streams, asOf)
    .filter((s) => s.kind === 'rental' || s.kind === 'interest' || s.kind === 'other')
    .reduce((sum, s) => sum.add(streamSlabContribution(s)), new Decimal(0));
}

/** The rate on the next rupee of an NRI's Indian income: the slab with
 *  surcharge and 4% cess, no 87A rebate; 0 with no Indian income. */
export function abroadIndiaRate(u: Pick<UserPayload, 'income_streams' | 'tax_regime'>, asOf: Date = new Date()): number {
  const income = indiaSourcedIncome(u, asOf).toNumber();
  if (!(income > 0)) return 0;
  const table = u.tax_regime === 'old' ? TAX.in.old : TAX.in.new;
  const slab = (table.slabs as Array<[number | null, number]>).find(([to]) => to == null || income <= to);
  const band = (TAX.in.surcharge as Array<[number | null, number]>).find(([to]) => to == null || income <= to);
  const sur = Math.min(band?.[1] ?? 0, u.tax_regime === 'old' ? 1 : TAX.in.surcharge_cap_new_regime);
  return Number(((slab?.[1] ?? 0) * (1 + sur) * (1 + TAX.in.cess)).toFixed(4));
}

export const FILING_LABEL: Record<FilingStatusUS, string> = {
  single: 'Single',
  mfj: 'Married, filing jointly',
  mfs: 'Married, filing separately',
  hoh: 'Head of household',
};

/** Setup's pay field, by how the person earns. */
export function takeHomeWords(incomeType: UserPayload['income_type'], tb: TaxBasics): { label: string; hint: string } {
  if (tb.earns === 'pension') return { label: 'Pension a month, after TDS', hint: 'What reaches your bank each month' };
  return incomeType === 'salaried'
    ? { label: 'Take-home pay a month', hint: 'After tax, what reaches your bank' }
    : { label: 'What you take home a month', hint: 'After business costs and tax' };
}

/** One line for an NRI on a rupee plan: which tax is assumed. */
export function abroadNote(r: Residence | 'GULF'): string {
  const there = r === 'OTHER' ? 'Your country’s own tax isn’t added: enter pay after it.' : 'The Gulf states have no income tax on salary, so none is assumed there.';
  return `Pay earned abroad isn’t taxed in India (Income-tax Act 2025 s.5(2)). ${there} Indian tax applies only to income from India, like rent or NRO interest: add it in Profile → Income. Enter amounts in rupees. Verify with a tax adviser.`;
}

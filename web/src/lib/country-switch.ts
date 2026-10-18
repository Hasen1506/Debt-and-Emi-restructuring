/**
 * Changing country changes the currency every untagged amount is read in.
 *
 * Live QA (7 Oct 2026): switching India → USA silently re-read ₹20 lakh as
 * $2,000,000, and ₹50,000 take-home as $50,000 a month, so the plan ran on
 * about 80× the user's real money. A switch must never retag amounts
 * silently: the profile either converts them at a rate the user confirms,
 * keeps existing loans in their old currency (tagged), or stays put.
 *
 * Pure functions, no React, so the rule is unit-tested
 * (tests/country-switch.cjs).
 */
import type { Country, DeductionsPayload, IncomeStreamPayload, LoanPayload } from './api';
import { userDefaultCurrency, type CurrencyCode } from './currency';

export interface SwitchableAmounts {
  monthlyIncome: string;
  fixedExpenses: string;
  variableExpenses: string;
  annualGrossSalary: string;
  annualBusinessIncome: string;
  extraIncomeAnnualTax: string;
  savingsBalance: string;
  efundBalance: string;
  efundTarget: string;
  cashAccounts: { name: string; balance: string; apy: string; kind: 'checking' | 'savings' | 'hysa' | 'fd' | 'other' }[];
  incomeStreams: IncomeStreamPayload[];
  deductions?: DeductionsPayload;
  loans: LoanPayload[];
  fxRates: Record<string, string>;
}

const positive = (v: string | undefined) => Number(v || 0) > 0;

/** True when the profile holds any amount a currency change would re-read. */
export function hasAmountsInCurrency(a: SwitchableAmounts, country: Country): boolean {
  const home = userDefaultCurrency(country);
  return (
    [a.monthlyIncome, a.fixedExpenses, a.variableExpenses, a.annualGrossSalary,
      a.annualBusinessIncome, a.extraIncomeAnnualTax, a.savingsBalance, a.efundBalance, a.efundTarget]
      .some(positive) ||
    a.cashAccounts.some((c) => positive(c.balance)) ||
    a.incomeStreams.some((s) => positive(s.gross_annual)) ||
    a.loans.some((l) => positive(l.outstanding) && (l.currency ?? home) === home)
  );
}

/** Loans that would change meaning: untagged, or tagged with the old home currency. */
export function loansInHomeCurrency(loans: LoanPayload[], country: Country): number {
  const home = userDefaultCurrency(country);
  return loans.filter((l) => positive(l.outstanding) && (l.currency ?? home) === home).length;
}

/** Amount × rate, kept to 2 decimals and without trailing ".00". Blank stays blank. */
export function convertAmount(v: string | undefined, rate: number): string {
  if (v === undefined || v === null || String(v).trim() === '') return v ?? '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const out = (Math.round(n * rate * 100) / 100).toFixed(2);
  return out.endsWith('.00') ? out.slice(0, -3) : out;
}

/** Is `rate` a usable "1 old = rate new" figure? */
export function validSwitchRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate < 100000;
}

/**
 * The profile's amounts after moving from `from` to `to`.
 *
 * `rate` is what 1 unit of the old currency is worth in the new one
 * (₹ → $: about 0.012; $ → ₹: about 83).
 *
 * `keepLoans`: existing home-currency loans stay in the old currency and are
 * tagged with it (an NRI's Indian home loan is still in rupees); the rate is
 * saved as the loan's FX rate. Otherwise their amounts are converted too.
 * Income, spending and cash are always converted: they are read in the new
 * country's currency from now on.
 */
export function convertForCountrySwitch(
  a: SwitchableAmounts,
  from: Country,
  to: Country,
  rate: number,
  keepLoans: boolean,
  newPay?: string,
): SwitchableAmounts {
  const oldCcy: CurrencyCode = userDefaultCurrency(from);
  const newCcy: CurrencyCode = userDefaultCurrency(to);
  if (oldCcy === newCcy) return a;
  if (!validSwitchRate(rate)) throw new Error('A positive exchange rate is needed to switch country.');
  const c = (v: string) => convertAmount(v, rate);
  const loans = a.loans.map((l) => {
    const ccy = l.currency ?? oldCcy;
    if (ccy === newCcy) {
      // Already in the new home currency: no tag needed any more.
      const { currency: _drop, ...rest } = l;
      void _drop;
      return rest as LoanPayload;
    }
    if (keepLoans) return { ...l, currency: oldCcy } as LoanPayload;
    const out: LoanPayload = {
      ...l,
      outstanding: c(l.outstanding),
      scheduled_emi: c(l.scheduled_emi),
    };
    delete out.currency;
    if (l.min_payment_override) out.min_payment_override = c(l.min_payment_override);
    if (l.expected_monthly_spend) out.expected_monthly_spend = c(l.expected_monthly_spend);
    return out;
  });
  const fxRates: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.fxRates)) {
    if (k !== newCcy && k !== oldCcy) fxRates[k] = v;
  }
  if (loans.some((l) => l.currency === oldCcy)) {
    // 1 unit of the loan's (old) currency in the new home currency.
    fxRates[oldCcy] = String(rate);
  }
  const deductions = a.deductions
    ? (Object.fromEntries(
        Object.entries(a.deductions).map(([k, v]) =>
          [k, typeof v === 'string' && k.endsWith('_annual') ? c(v) : v]),
      ) as DeductionsPayload)
    : a.deductions;
  return {
    ...a,
    // UX2B-19: pay in a new country isn't the old pay converted; typed, it's used as is.
    monthlyIncome: Number(newPay) > 0 ? String(newPay).trim() : c(a.monthlyIncome),
    fixedExpenses: c(a.fixedExpenses),
    variableExpenses: c(a.variableExpenses),
    annualGrossSalary: c(a.annualGrossSalary),
    annualBusinessIncome: c(a.annualBusinessIncome),
    extraIncomeAnnualTax: c(a.extraIncomeAnnualTax),
    savingsBalance: c(a.savingsBalance),
    efundBalance: c(a.efundBalance),
    efundTarget: c(a.efundTarget),
    cashAccounts: a.cashAccounts.map((x) => ({ ...x, balance: c(x.balance) })),
    incomeStreams: a.incomeStreams.map((s) => ({ ...s, gross_annual: c(s.gross_annual) })),
    deductions,
    loans,
    fxRates,
  };
}

/** UX2B-19: today's rate as a person reads it ("0.01201", not
 *  "0.012012012012"): 4 significant figures below 1, else 2 decimals. */
export function formatSwitchRate(rate: number | string): string {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n < 1 ? String(Number(n.toPrecision(4))) : String(Number(n.toFixed(2)));
}

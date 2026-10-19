'use client';

import { carryPlanInputs } from '@/lib/plan-inputs';
import { assumptionError, wholeMonthsError, wholeMonthsValue, LOCK_IN_RANGE, PART_PAY_FREQ_RANGE } from '@/lib/r8-inputs';
import { creditScoreError, usableCreditScore } from '@/lib/r7-inputs';
import { INFLATION_FORECAST } from '@/lib/inflation-modeling';
import { SAFE_RATES } from '@/lib/invest-vs-prepay';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HYDRATED_EVENT, REMOTE_APPLIED_EVENT, useAccountSettled } from '@/lib/server-sync';
import { profileMarginalRate } from '@/lib/marginal-rate'; import { abroadIndiaRate, livesAbroad } from '@/lib/tax-setup';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/Card';
import { BankCombobox, Field, Select } from '@/components/ToolPrimitives';
import { LBracket, LButton, LShell, L_T } from '@/components/ledger/primitives';
import { previousPage } from '@/lib/nav-trail';
import { PROFILE_SECTIONS, ProfileSummary } from '@/components/profile/ProfileSummary';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { RateRangeHint } from '@/components/RateRangeHint';
import type {
  AgeBracket,
  Country,
  DeductionsPayload,
  FilingStatusUS,
  IncomeStreamPayload,
  IncomeType,
  LoanPayload,
  LoanType,
  TaxRegimeIN,
  UserPayload,
} from '@/lib/api';
import { DeductionsPanel } from '@/components/onboarding/DeductionsPanel';
import { IncomeStreamsPanel } from '@/components/onboarding/IncomeStreamsPanel';
import {
  activeSlabGrossAnnual,
  deriveMonthlyIncome,
} from '@/lib/income-streams';
import { deriveMarginalRate } from '@/lib/deductions';
import { newLoanId, withLoanIds } from '@/lib/loan-ids';
import { loadProfileClient, summaryProfile, type StoredProfile } from '@/lib/user-store';
import { currencySymbol, fxPerDollar, loanCurrency, loanMarket, userDefaultCurrency, type CurrencyCode } from '@/lib/currency';
import { dateProfileRates } from '@/lib/fx-refresh';
import { efMonths } from '@/lib/assumptions';
import { salaryDeductionsPhrase, takeHomeLabel } from '@/lib/payroll-labels';
import { convertForCountrySwitch, formatSwitchRate, hasAmountsInCurrency, loansInHomeCurrency, validSwitchRate, type SwitchableAmounts } from '@/lib/country-switch';
import {
  FY_ANCHOR_MONTH,
  getCountryToday,
  MONTH_NAMES,
  localIsoDate,
} from '@/lib/today';
import { BALANCES_ENTERED_KEY, type BalanceDropReason } from '@/lib/activity';
import { balanceDropOf, logBalanceDrops } from '@/lib/prepay-choice';
import { BalanceDropQuestion } from '@/components/profile/BalanceDropQuestion';
import { OwedNowHintLazy as OwedNowHint } from '@/components/profile/OwedNowHintLazy';
import { asksEmiPaid, emiAnswer, emiAnswerPatch, nextMonth, stampBalanceDates } from '@/lib/roll-forward';
import { saveProfileWithPaidEmis } from '@/lib/paid-at-entry';
import { EmiPaidQuestion, emiPaidError } from '@/components/EmiPaidQuestion';
import {
  applyRateTypeChoice,
  assumedRateTypeNote,
  HOW_TO_TELL,
  likelyRateType,
  patchLoanKeepingRateType,
  rateTypeChoice,
  type RateType,
} from '@/lib/rate-type';
import { suggestedGraceDays } from '@/lib/min-payment';
import { api, formatCurrency, type FxRateResponse } from '@/lib/api';
import { computedEmi, deriveTenureMonths } from '@/lib/derived';
import { typicalRate, withEstimate } from '@/lib/setup-estimates';
import { loanDraftErrors, needsEmi } from '@/lib/loan-gaps';
import { classifyBracket, grossMarginalRate, IN_TAX_YEAR_LABEL, inNewRegimeSlabLines } from '@/lib/tax-brackets';
import type { LoanTermsResponse } from '@/lib/api';
import { RBI_PREPAYMENT_RULE } from '@/lib/prepayment-fee';
import { asksBusinessPurpose, feeShownWithPurpose as feeShown, PURPOSE_HELP, PURPOSE_QUESTION } from '@/lib/loan-purpose';
import { cleanCity, stateFor, statesFor, STATE_HELP } from '@/lib/locations';
import { NICKNAME_MAX } from '@/lib/loan-types';
import { dropKfsFields, kfsNote } from '@/lib/kfs';
import { KfsImport } from '@/components/profile/KfsImport';
import { CreditReportImport } from '@/components/profile/CreditReportImport';
import { SmsImport } from '@/components/profile/SmsImport';
import { whereToFind, type FindKey } from '@/lib/where-to-find';
import { MarketRateLine } from '@/components/profile/MarketRateLine';
import { UsLoanFields, UsStateField } from '@/components/profile/UsLoanFields';
import dynamic from 'next/dynamic';
import { usLoanFieldsFor } from '@/lib/us-loans';
import { BackLink, ProfileHeader, SectionTabs } from './parts/chrome';
import { CountrySwitchPanel } from './parts/country-switch';
import { AdvancedTaxDetails } from './parts/income-fields';
import { HikeScheduleEditor, MinPaymentExplainer, TenureField } from './parts/loan-fields';
import { EfLiquidityWarning, EfTierPicker, OtherBanksField } from './parts/savings-fields';
import { formWouldEraseSavedLoans, useProfileEditGuard } from '@/lib/tab-guard';
const LoanExtras = dynamic(() => import('@/components/setup/LoanExtras').then((m) => m.LoanExtras)); // r3e: route budget
/**
 * True when any field on the deductions payload is set to a meaningful
 * (truthy + > 0) value. Used to decide whether to persist the slice.
 */
function hasAnyDeductions(d: DeductionsPayload | undefined): boolean {
  if (!d) return false;
  return Object.values(d).some((v) => v != null && Number(v) > 0);
}

/** Under the fixed-or-floating choice: what "Not sure" took it as, or a
 *  saved choice that differs from the usual for this kind of loan. */
/** Where this loan's figure is printed: India's papers for a rupee loan,
 *  US papers for a dollar one, whatever country the borrower lives in. */
function findFor(l: LoanPayload, country: Country, key: FindKey): string | null {
  return whereToFind(key, { country: loanMarket(l, country), loanType: l.loan_type });
}

function rateTypeHint(l: LoanPayload, country: Country): string {
  const usual = likelyRateType(l.loan_type, country, l.currency);
  if (l.rate_type_assumed === undefined) {
    // Saved before "Not sure" existed: new loans started as fixed.
    return l.rate_type !== usual
      ? `Saved as ${l.rate_type}, the old starting choice. Loans like this are usually ${usual}. ${HOW_TO_TELL}`
      : HOW_TO_TELL;
  }
  return l.rate_type_assumed ? `${assumedRateTypeNote(l.loan_type, country, l.currency)} ${HOW_TO_TELL}` : HOW_TO_TELL;
}

/**
 * Format a loan-terms suggestion label. Honest about provenance:
 * regulatory mandates (is_indicative=false) are presented as ground
 * truth ("RBI mandate — tap to use"); typical industry norms get a
 * "confirm SoC" caveat so users don't treat the number as verified.
 */
function suggestionLabel(
  source: string,
  value: string,
  terms: LoanTermsResponse,
): string {
  if (!terms.is_indicative) {
    return `${source}: ${value} (${terms.last_verified || 'regulatory mandate'} — tap to use)`;
  }
  return `${source}: ~${value} (indicative — confirm with sanction letter)`;
}

// `optional: true` steps are skippable — they don't gate the engine and
// the progress chip is rendered lighter so first-time users can finish
// in 90s with just the load-bearing steps (country / income / loans).
// The credit score sits on the Savings step: a step of its own for one
// optional field was friction.
const STEPS: ReadonlyArray<{ label: string; optional?: boolean }> = [
  { label: 'You', optional: true },
  { label: 'Country' },
  { label: 'Income' },
  { label: 'Loans' },
  { label: 'Savings', optional: true },
  { label: 'Review' },
] as const;

// `?step=loans` (or `?step=income`, etc.) deep-links to a specific step so
// CTAs like "+ Add debt" on the Debts page can drop the user directly on the
// Loans card instead of the country picker.
const STEP_ALIASES: Record<string, number> = {
  you: 0,
  country: 1,
  tax: 1,
  income: 2,
  loans: 3,
  savings: 4,
  credit: 4,
  review: 5,
};

const AGE_BRACKETS: { value: AgeBracket; label: string }[] = [
  { value: 'under_25', label: 'Under 25' },
  { value: '25_35', label: '25 to 35' },
  { value: '35_50', label: '35 to 50' },
  { value: '50_plus', label: '50–59' },
  { value: '60_plus', label: '60–79' }, { value: '80_plus', label: '80+' },
];

function parseStepParam(raw: string | null): number {
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  if (lower in STEP_ALIASES) return STEP_ALIASES[lower];
  const n = Number(lower);
  if (Number.isInteger(n) && n >= 0 && n < STEPS.length) return n;
  return 0;
}

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: 'home_loan', label: 'Home loan' },
  { value: 'auto_loan', label: 'Auto loan' },
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'education_loan', label: 'Education loan' },
  { value: 'gold_loan', label: 'Gold loan' }, { value: 'bnpl', label: 'BNPL / pay-later' },
  { value: 'home_topup', label: 'Home loan top-up' }, { value: 'loan_against_property', label: 'Loan against property' },
  { value: 'two_wheeler_loan', label: 'Two-wheeler loan' }, { value: 'medical_loan', label: 'Medical loan or bill' },
];

function blankLoan(): LoanPayload {
  return {
    // Its id from the start, so saving twice in one visit keeps it.
    id: newLoanId(),
    loan_type: 'credit_card',
    bank: '',
    outstanding: '',
    nominal_rate: '',
    // Not sure until picked: the usual type for the kind of loan (lib/rate-type).
    rate_type: 'fixed',
    rate_type_assumed: true,
    tenure_months_remaining: 0,
    scheduled_emi: '',
    processing_fee_amortised: '',
    insurance_premium_pct: '',
  };
}

/**
 * Profile (REDESIGN R1.5): the saved profile as a summary, and one section
 * of the form at a time to change it. `?step=loans` (and the other names in
 * STEP_ALIASES) opens that section. Cancel and Save start the form again
 * from the saved profile, so nothing half-edited lingers.
 */
export function ProfileClient({ payoffOrder, initial }: { payoffOrder: ReactNode; initial: StoredProfile }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState(() => ({
    key: 0,
    section: searchParams.get('step') ? parseStepParam(searchParams.get('step')) : (null as number | null),
    saved: false,
  }));
  // Account data from another device just replaced this browser's copy (the
  // account copy loaded after a reload, a save refused as stale, or "use
  // this device's version"): draw the summary again from it. The form reads
  // the profile once when it mounts, so without this it kept showing the
  // old figure. An open form is left alone (critique #63).
  useEffect(() => {
    const redraw = () => setView((v) => (v.section === null ? { ...v, key: v.key + 1 } : v));
    window.addEventListener(REMOTE_APPLIED_EVENT, redraw);
    window.addEventListener(HYDRATED_EVENT, redraw);
    return () => {
      window.removeEventListener(REMOTE_APPLIED_EVENT, redraw);
      window.removeEventListener(HYDRATED_EVENT, redraw);
    };
  }, []);
  const done = (saved: boolean) => {
    if (searchParams.get('step')) router.replace('/profile', { scroll: false });
    setView((v) => ({ key: v.key + 1, section: null, saved }));
    window.scrollTo({ top: 0 });
    // The payoff orders were worked out on the old numbers.
    if (saved) router.refresh();
  };
  return (
    <ProfileEditor
      key={view.key}
      initial={initial}
      section={view.section}
      saved={view.saved}
      onOpen={(n) => {
        setView((v) => ({ ...v, section: n, saved: false }));
        window.scrollTo({ top: 0 });
      }}
      onDone={done}
      payoffOrder={payoffOrder}
      focus={searchParams.get('focus')}
    />
  );
}

function ProfileEditor({
  initial,
  section,
  saved: justSaved,
  onOpen,
  onDone,
  payoffOrder,
  focus,
}: {
  /** The profile the server already read, so the summary is in the first HTML. */
  initial: StoredProfile;
  section: number | null;
  saved: boolean;
  onOpen: (n: number) => void;
  onDone: (saved: boolean) => void;
  payoffOrder: ReactNode;
  /** A field to scroll to and focus, from `?focus=` ("hike"). */
  focus?: string | null;
}) {
  // -1 while the summary shows: no form section is open.
  const step = section ?? -1;
  const [ready, setReady] = useState(initial.isLive);
  // Form state starts empty. Until the effect copies the saved profile into
  // it, the summary must show that profile, not the empty fields on top of it.
  const [filled, setFilled] = useState(false);
  // False until this tab's account copy has arrived. The loans form must
  // not snapshot, or save, the blank fields it starts with.
  const accountReady = useAccountSettled();
  // The page the user came from ("Plan"), for a way back to it.
  const [back, setBack] = useState<{ href: string; name: string } | null>(null);
  useEffect(() => setBack(previousPage('/profile')), []);
  // A link that names a field (?focus=hike) lands on it, not the top.
  useEffect(() => {
    if (!ready || !focus || section === null) return;
    const box = document.getElementById(`pf-${focus}`);
    if (!box) return;
    box.scrollIntoView({ block: 'center' });
    box.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true });
  }, [ready, focus, section]);

  // ─── form state ─────────────────────────────────────────────────────────
  // Both optional. We never gate the flow on them — the "You" step is a soft
  // landing, not a required gate.
  const [displayName, setDisplayName] = useState('');
  const [ageBracket, setAgeBracket] = useState<AgeBracket | ''>('');
  const [country, setCountry] = useState<Country>('IN');
  const [isNriUs, setIsNriUs] = useState(false);
  // Where they live (live test #5): optional, by country.
  const [homeState, setHomeState] = useState('');
  const [city, setCity] = useState('');
  const [incomeType, setIncomeType] = useState<IncomeType>('salaried');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [fixedExpenses, setFixedExpenses] = useState('');
  const [variableExpenses, setVariableExpenses] = useState('');
  // Pre-tax annual income. One of these is filled depending on income_type;
  // the other stays blank. Empty = user provided only take-home, and the
  // bracket / marginal-rate auto-derivation is skipped (engine falls back
  // to the manual marginalRate field below).
  const [annualGrossSalary, setAnnualGrossSalary] = useState('');
  const [annualBusinessIncome, setAnnualBusinessIncome] = useState('');
  // Salaried-only: tax owed on non-TDS income (rental, FD interest,
  // cap gains, freelance). Drives the tax-sleeve card on /debts.
  const [extraIncomeAnnualTax, setExtraIncomeAnnualTax] = useState('');
  // Old-regime + itemized deductions. Captured at step 2 conditionally
  // (IN-old or US). Engine ignores; drives the derived-marginal preview
  // and the tax breakdown panel. Round-trips via the cookie.
  const [deductions, setDeductions] = useState<DeductionsPayload | undefined>(undefined);
  // Multi-source income streams. Empty = legacy single-source mode
  // (monthlyIncome alone). When non-empty, derived monthly_income from
  // active streams takes priority at save time.
  const [incomeStreams, setIncomeStreams] = useState<IncomeStreamPayload[]>([]);
  // By default we show a single "Monthly expenses" field — users don't
  // need to think about fixed vs. variable. Power users (and anyone with
  // existing variable_expenses from a previous session) get the detailed
  // breakdown. The split matters for the WhatIf "trim spending" slider:
  // combined mode → slider operates on fixed_expenses; detailed mode →
  // slider operates on variable_expenses (more honest).
  const [showDetailedExpenses, setShowDetailedExpenses] = useState(false);
  const [primaryBank, setPrimaryBank] = useState('');
  const [otherBanks, setOtherBanks] = useState<string[]>([]);
  const [newOtherBank, setNewOtherBank] = useState('');
  const [taxRegime, setTaxRegime] = useState<TaxRegimeIN>('new');
  // US filing status drives the federal slab table. Defaults to 'single'
  // for back-compat with profiles that pre-date the picker.
  const [filingStatus, setFilingStatus] = useState<FilingStatusUS>('single');
  // Optional US state marginal rate (decimal). Added on top of federal
  // marginal_rate when present so combined math reflects state burden.
  const [stateMarginalRate, setStateMarginalRate] = useState('');
  const [usState, setUsState] = useState('');
  const [annualHikeRate, setAnnualHikeRate] = useState('');
  // Optional hike phases for users who want varied rates over time (e.g.
  // "first 2yrs 7%, next 4yrs 10%, job switch at year 6"). Empty list →
  // engine uses annualHikeRate uniformly. Each row is { from, to, rate }
  // with `from` 1-based inclusive and `to` 1-based exclusive.
  const [hikeSchedule, setHikeSchedule] = useState<
    { from: string; to: string; rate: string }[]
  >([]);
  const [marginalRate, setMarginalRate] = useState('');
  // The rate as loaded, so a save can tell a typed rate from a stale estimate (lib/marginal-rate).
  const loadedMarginalRate = useRef('');
  // 1-12. Defaults to country FY-1 (April for IN, January for US). When the
  // user changes country and HASN'T manually picked a month, we follow the
  // country default. `hikeMonthTouched` tracks the manual override.
  const [hikeEffectiveMonth, setHikeEffectiveMonth] = useState<number>(FY_ANCHOR_MONTH.IN);
  const [hikeMonthTouched, setHikeMonthTouched] = useState(false);
  useEffect(() => {
    if (!hikeMonthTouched) setHikeEffectiveMonth(FY_ANCHOR_MONTH[country]);
  }, [country, hikeMonthTouched]);

  const [loans, setLoans] = useState<LoanPayload[]>([blankLoan()]);
  // The loans as saved, to tell a changed balance from one left alone.
  const savedLoansRef = useRef<LoanPayload[]>([]);
  // Set when Continue is pressed with a loan missing its rate or EMI.
  const [showLoanErrors, setShowLoanErrors] = useState(false);
  const [dropReasons, setDropReasons] = useState<Record<string, BalanceDropReason>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  // Why SAVE CHANGES did not save (live-test #2/#27): it used to do nothing,
  // or jump to Loans, with no word, so a blocked save looked like a lost one.
  const [saveBlocked, setSaveBlocked] = useState<string | null>(null);
  const formReady = accountReady && filled;
  const tabGuard = useProfileEditGuard(() => save(), formReady && section !== null); // UX2 #23 two tabs
  // R8-7: the text typed in whole-month loan fields, by `${loan id}:lock|freq`.
  const [monthsText, setMonthsText] = useState<Record<string, string>>({});
  // Exchange rate per foreign loan currency ("0.012" = $ per ₹1), filled
  // from today's quote when it loads and editable. Required: without it a
  // ₹20 lakh loan was added to dollars at parity.
  const [fxRates, setFxRates] = useState<Record<string, string>>({});
  const [ownEfMonths, setOwnEfMonths] = useState(6);
  const [fxQuotes, setFxQuotes] = useState<Record<string, 'loading' | 'failed' | FxRateResponse>>({});
  // Most users don't know their exact remaining tenure — they know
  // outstanding, EMI, rate. We default to deriving tenure from those three
  // and only let the user override when they explicitly ask. This set tracks
  // which loan indices the user has chosen to enter manually.
  const [moreOpen, setMoreOpen] = useState<Record<number, boolean>>({});
  const [manualTenureIdxs, setManualTenureIdxs] = useState<Set<number>>(
    () => new Set(),
  );
  // Per-loan True-APR suggestions, keyed by loan index. Populated by a
  // background fetch to /api/loan-terms whenever the bank / loan_type /
  // rate_type triplet changes — the Field components render these as
  // click-to-fill hints below the prepay/lock-in/freq inputs. Engine math
  // is unaffected; this is pure UX scaffolding.
  const [loanSuggestions, setLoanSuggestions] = useState<
    Record<number, import('@/lib/api').LoanTermsResponse | null>
  >({});

  const [savingsBalance, setSavingsBalance] = useState('');
  const [efundBalance, setEfundBalance] = useState('');
  const [efundTarget, setEfundTarget] = useState('');
  // Optional rich cash breakdown. Empty list = legacy single-total mode
  // (savingsBalance alone is used). When user adds at least one account
  // here, savingsBalance is auto-derived from the sum of optimizable
  // (non-checking) balances at save() time.
  const [cashAccounts, setCashAccounts] = useState<
    { name: string; balance: string; apy: string; kind: 'checking' | 'savings' | 'hysa' | 'fd' | 'other' }[]
  >([]);

  const [creditScore, setCreditScore] = useState('');

  // Country switch guard (live QA, 7 Oct): a new country is held here until
  // the user confirms how existing amounts move to the new currency.
  const [pendingCountry, setPendingCountry] = useState<Country | null>(null);
  const [switchRate, setSwitchRate] = useState('');
  const [switchRateState, setSwitchRateState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [keepLoansInOld, setKeepLoansInOld] = useState(true);
  const [switchNote, setSwitchNote] = useState<string | null>(null);

  // Rehydrate from the saved profile cookie on mount so re-visiting Setup
  // shows the data the user already entered (not blank defaults).
  // isLive=false means there's no cookie — leave empty defaults in place.
  useEffect(() => {
    setReady(true);
    // Wait for the account copy before copying it into the form. Filling
    // earlier snapshots the empty cookie and then calls that load a conflict.
    if (!accountReady) return;
    const stored = loadProfileClient();
    // No saved cookie in this browser: a signed-out page opens the empty
    // form. A page the server already painted from the request cookie keeps
    // those figures (the cookie was not in document.cookie).
    if (!stored.isLive) {
      if (!initial.isLive) setFilled(true);
      return;
    }
    const u = stored.user;
    if (u.display_name) setDisplayName(u.display_name);
    if (u.age_bracket) setAgeBracket(u.age_bracket);
    setCountry(u.country);
    setIsNriUs(!!u.is_nri_us);
    setHomeState(stateFor(u.country, u.state));
    setCity(cleanCity(u.city));
    if (u.fx_to_user_currency) setFxRates(u.fx_to_user_currency);
    setOwnEfMonths(efMonths(u));
    setIncomeType(u.income_type);
    setMonthlyIncome(u.monthly_income ?? '');
    setFixedExpenses(u.fixed_expenses ?? '');
    setVariableExpenses(u.variable_expenses ?? '');
    setAnnualGrossSalary(u.annual_gross_salary ?? '');
    setAnnualBusinessIncome(u.annual_business_income ?? '');
    setExtraIncomeAnnualTax(u.extra_income_annual_tax ?? '');
    setDeductions(u.deductions);
    setIncomeStreams(u.income_streams ?? []);
    // Preserve the user's chosen view: if they previously filled out a
    // variable_expenses split, default the form to detailed mode.
    if (Number(u.variable_expenses || 0) > 0) {
      setShowDetailedExpenses(true);
    }
    // creditScore state lives below and is hydrated from stored.creditScore
    // (a top-level field on the cookie). The fallback below allows reading
    // it from u.credit_score for backend round-trips too.
    if (u.credit_score) setCreditScore(u.credit_score);
    setPrimaryBank(u.primary_bank ?? '');
    setOtherBanks(u.other_banks ?? []);
    if (u.country === 'IN' && u.tax_regime) setTaxRegime(u.tax_regime);
    if (u.country === 'US' && u.filing_status) setFilingStatus(u.filing_status);
    if (u.state_marginal_rate) setStateMarginalRate(u.state_marginal_rate);
    if (u.state) setUsState(u.state);
    setAnnualHikeRate(u.annual_hike_rate ?? '');
    if (u.hike_schedule && u.hike_schedule.length > 0) {
      setHikeSchedule(
        u.hike_schedule.map(([from, to, rate]) => ({
          from: String(from),
          to: String(to),
          rate,
        })),
      );
    }
    if (u.hike_effective_month) {
      setHikeEffectiveMonth(u.hike_effective_month);
      setHikeMonthTouched(true);
    }
    if (u.loans && u.loans.length > 0) {
      savedLoansRef.current = withLoanIds(u.loans).map((l) => ({ ...l, currency: loanCurrency(l, u.country) })); // currency: balanceDropOf
      setLoans(withLoanIds(u.loans));
      // Decide auto vs manual per loan on rehydrate: if the saved tenure
      // matches what we'd derive from the current outstanding+EMI+rate,
      // the user is in auto mode — re-deriving on next submit gives the
      // same number, no surprise. If the saved tenure differs (manual
      // entry, or numbers have drifted), preserve it as manual.
      const manualOnLoad = new Set<number>();
      u.loans.forEach((loan, idx) => {
        if (loan.loan_type === 'credit_card') return;
        if (loan.tenure_months_remaining <= 0) return;
        const derived = deriveTenureMonths(
          loan.outstanding,
          loan.nominal_rate,
          loan.scheduled_emi,
        );
        if (derived == null || derived !== loan.tenure_months_remaining) {
          manualOnLoad.add(idx);
        }
      });
      setManualTenureIdxs(manualOnLoad);
    }
    setSavingsBalance(u.savings_balance ?? '');
    setEfundBalance(u.efund_balance ?? '');
    setEfundTarget(u.efund_target ?? '');
    if (u.cash_accounts && u.cash_accounts.length > 0) {
      setCashAccounts(
        u.cash_accounts.map((a) => ({
          name: a.name,
          balance: a.balance,
          apy: a.apy,
          kind: a.kind,
        })),
      );
    }
    setMarginalRate(stored.marginalRate ?? '');
    loadedMarginalRate.current = stored.marginalRate ?? '';
    if (stored.creditScore != null) setCreditScore(String(stored.creditScore));
    setFilled(true);
  }, [initial.isLive, accountReady]);

  // Fetch True-APR suggestions whenever the bank / loan_type / rate_type
  // triplet of any loan changes. Keyed by JSON.stringify of the relevant
  // fields so unrelated edits (rate, EMI, outstanding) don't trigger a
  // re-fetch. Failures stash a null so the suggestion stays hidden rather
  // than blocking the form. No spinner UI — these are decorations, the
  // field is fully usable while loading.
  const triplets = loans
    .map((l) => `${l.bank}|${l.loan_type}|${l.rate_type ?? 'floating'}`)
    .join('§');
  useEffect(() => {
    loans.forEach((l, i) => {
      if (!l.loan_type) return;
      if (!l.bank && country !== 'US') return; // empty bank only useful when country regs cover it
      api
        .loanTerms(
          country,
          l.loan_type,
          l.bank || '',
          (l.rate_type as 'floating' | 'fixed') || 'floating',
        )
        .then((res) =>
          setLoanSuggestions((prev) => ({ ...prev, [i]: res })),
        )
        .catch(() =>
          setLoanSuggestions((prev) => ({ ...prev, [i]: null })),
        );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triplets, country]);

  function updateLoan(idx: number, patch: Partial<LoanPayload>) {
    setLoans((cur) =>
      cur.map((l, i) =>
        i === idx
          ? // A field changed here stops being "from your Key Facts Statement" (lib/kfs).
            { ...patchLoanKeepingRateType(l, patch, country), kfs_fields: dropKfsFields(l, patch) }
          : l,
      ),
    );
  }

  function addLoan() {
    setLoans((cur) => [...cur, blankLoan()]);
  }

  function removeLoan(idx: number) {
    setLoans((cur) => cur.filter((_, i) => i !== idx));
    // Indices shift down when a loan is removed — rebuild the manual set
    // accordingly so the right loans stay flagged as manually-tenured.
    setManualTenureIdxs((cur) => {
      const next = new Set<number>();
      cur.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  }

  function setTenureMode(idx: number, manual: boolean) {
    setManualTenureIdxs((cur) => {
      const next = new Set(cur);
      if (manual) next.add(idx);
      else next.delete(idx);
      return next;
    });
    // When switching back to derived mode, blank the stored tenure so the
    // engine sees the derived value (computed in buildUser) instead of a
    // stale manual entry.
    if (!manual) updateLoan(idx, { tenure_months_remaining: 0 });
  }

  // Coalesce empty strings to sensible numeric defaults so the engine accepts
  // the payload even if the user skipped optional fields.
  const num = (v: string, fallback = '0') => (v.trim() === '' ? fallback : v);

  function buildUser(): UserPayload {
    return {
      country,
      income_type: incomeType,
      display_name: displayName.trim() || undefined,
      age_bracket: ageBracket || undefined,
      annual_income: (() => {
        // Streams override the manual monthly field when present.
        const derived = incomeStreams.length > 0
          ? deriveMonthlyIncome(incomeStreams)
          : null;
        return derived
          ? derived.mul(12).toFixed(0)
          : String(Number(num(monthlyIncome)) * 12);
      })(),
      monthly_income: (() => {
        const derived = incomeStreams.length > 0
          ? deriveMonthlyIncome(incomeStreams)
          : null;
        return derived ? derived.toFixed(0) : num(monthlyIncome);
      })(),
      fixed_expenses: num(fixedExpenses),
      variable_expenses: num(variableExpenses),
      annual_gross_salary:
        incomeType === 'salaried' && annualGrossSalary.trim()
          ? num(annualGrossSalary)
          : undefined,
      annual_business_income:
        incomeType === 'business_owner' && annualBusinessIncome.trim()
          ? num(annualBusinessIncome)
          : undefined,
      extra_income_annual_tax:
        incomeType === 'salaried' && extraIncomeAnnualTax.trim() && Number(extraIncomeAnnualTax) > 0
          ? num(extraIncomeAnnualTax)
          : undefined,
      deductions: hasAnyDeductions(deductions) ? deductions : undefined,
      income_streams: incomeStreams.length > 0 ? incomeStreams : undefined,
      credit_score: usableCreditScore(creditScore, country) || undefined,
      // When user has populated rich per-account cash, derive the legacy
      // total from the sum of optimizable balances (everything except
      // 'checking', which is operational float). Single-field users keep
      // the legacy behaviour.
      savings_balance: (() => {
        const valid = cashAccounts.filter(
          (a) => a.name.trim() !== '' && Number(a.balance) > 0,
        );
        if (valid.length === 0) return num(savingsBalance);
        const optimizable = valid
          .filter((a) => a.kind !== 'checking')
          .reduce((s, a) => s + Number(a.balance || 0), 0);
        return String(optimizable);
      })(),
      cash_accounts: cashAccounts
        .filter((a) => a.name.trim() !== '' && Number(a.balance) >= 0)
        .map((a) => ({
          name: a.name.trim(),
          balance: num(a.balance),
          apy: num(a.apy),
          kind: a.kind,
        })),
      primary_bank: primaryBank,
      other_banks: otherBanks,
      // One `state` (integration L3 x G3): India uses L3's state list; the
      // US uses G3's two-letter state field, which drives the mortgage-interest
      // state-tax rule (lib/us-loans).
      state: (country === 'US' ? usState : stateFor(country, homeState)) || undefined,
      city: cleanCity(city) || undefined,
      location_tier: 'urban',
      tax_regime: country === 'IN' ? taxRegime : undefined,
      filing_status: country === 'US' ? filingStatus : undefined,
      state_marginal_rate:
        country === 'US' && stateMarginalRate.trim()
          ? num(stateMarginalRate)
          : undefined,
      efund_balance: num(efundBalance),
      efund_target: num(efundTarget),
      loans: loans
        .map((l, originalIdx) => ({ l, originalIdx }))
        .filter(({ l }) => Number(l.outstanding) > 0)
        .map(({ l, originalIdx }) => {
          // Tenure: cards never have one; for everyone else, derive from
          // outstanding + EMI + rate unless the user has explicitly chosen
          // to enter it manually.
          let tenure = l.tenure_months_remaining;
          if (l.loan_type === 'credit_card') {
            tenure = 0;
          } else if (!manualTenureIdxs.has(originalIdx)) {
            const derived = deriveTenureMonths(
              l.outstanding,
              l.nominal_rate,
              l.scheduled_emi,
            );
            if (derived != null) tenure = derived;
          }
          return {
            ...l,
            tenure_months_remaining: tenure,
            outstanding: num(l.outstanding),
            nominal_rate: num(l.nominal_rate, '0'),
            scheduled_emi: num((l.scheduled_emi ?? '').trim() || computedEmi(l)),
            processing_fee_amortised: num(l.processing_fee_amortised ?? '', '0'),
            insurance_premium_pct: num(l.insurance_premium_pct ?? '', '0'),
            expected_monthly_spend:
              l.loan_type === 'credit_card'
                ? num(l.expected_monthly_spend ?? '', '0')
                : '0',
            ...(l.min_payment_override && l.min_payment_override.trim() !== ''
              ? { min_payment_override: num(l.min_payment_override) }
              : {}),
            // US-only fields leave with US-market loans only (lib/us-loans).
            ...usLoanFieldsFor(l, country),
          };
        }),
      investment_options: [
        {
          name: country === 'IN' ? 'Liquid fund' : 'HYSA',
          expected_return: country === 'IN' ? SAFE_RATES.liquid_in.rate : SAFE_RATES.hysa_us.rate,
          liquidity_class: 'liquid',
          is_in_pool: true,
        },
      ],
      annual_hike_rate: num(annualHikeRate),
      hike_effective_month: hikeEffectiveMonth,
      // Drop phases that are blank or have non-positive ranges. Engine
      // tolerates any list shape but we shouldn't ship garbage.
      hike_schedule: hikeSchedule
        .map(({ from, to, rate }) => [
          Number(from) || 0,
          Number(to) || 0,
          num(rate, '0'),
        ] as [number, number, string])
        .filter(([f, t, r]) => f > 0 && t > f && Number(r) >= 0),
      inflation_rate: INFLATION_FORECAST[country].rate,
      is_nri_us: isNriUs,
      // Only the currencies still in use, at the rate entered above.
      fx_to_user_currency: Object.fromEntries(
        foreignCcys.filter((c) => Number(fxRates[c]) > 0).map((c) => [c, String(fxRates[c]).trim()]),
      ),
    };
  }

  function switchableAmounts(): SwitchableAmounts {
    return {
      monthlyIncome, fixedExpenses, variableExpenses, annualGrossSalary,
      annualBusinessIncome, extraIncomeAnnualTax, savingsBalance, efundBalance,
      efundTarget, cashAccounts, incomeStreams, deductions, loans, fxRates,
    };
  }

  /** Picking a new country never re-reads amounts silently: with money in
   *  the profile it opens the confirm panel instead (see country-switch). */
  function requestCountry(v: Country) {
    setSwitchNote(null);
    if (v === country) {
      setPendingCountry(null);
      return;
    }
    if (!hasAmountsInCurrency(switchableAmounts(), country)) {
      setCountry(v);
      if (v !== 'US') setIsNriUs(false);
      setPendingCountry(null);
      return;
    }
    const from = userDefaultCurrency(country), to = userDefaultCurrency(v);
    setPendingCountry(v);
    setKeepLoansInOld(true);
    setSwitchRate('');
    setSwitchRateState('loading');
    api
      .fxRate(from, to)
      .then((r) => {
        setSwitchRate((cur) => (cur.trim() ? cur : String(r.rate)));
        setSwitchRateState('idle');
      })
      .catch(() => setSwitchRateState('failed'));
  }

  function confirmCountrySwitch(newPay?: string) {
    if (!pendingCountry) return;
    const rate = Number(switchRate);
    if (!validSwitchRate(rate)) return;
    const from = country, to = pendingCountry;
    const keep = keepLoansInOld && loansInHomeCurrency(loans, from) > 0;
    const next = convertForCountrySwitch(switchableAmounts(), from, to, rate, keep, newPay);
    setMonthlyIncome(next.monthlyIncome);
    setFixedExpenses(next.fixedExpenses);
    setVariableExpenses(next.variableExpenses);
    setAnnualGrossSalary(next.annualGrossSalary);
    setAnnualBusinessIncome(next.annualBusinessIncome);
    setExtraIncomeAnnualTax(next.extraIncomeAnnualTax);
    setSavingsBalance(next.savingsBalance);
    setEfundBalance(next.efundBalance);
    setEfundTarget(next.efundTarget);
    setCashAccounts(next.cashAccounts);
    setIncomeStreams(next.incomeStreams);
    setDeductions(next.deductions);
    setLoans(next.loans);
    setFxRates(next.fxRates);
    setCountry(to);
    // Per-loan currency tagging is the NRI mode on a US profile.
    setIsNriUs(to === 'US' && keep);
    setPendingCountry(null);
    const sFrom = currencySymbol(userDefaultCurrency(from)), sTo = currencySymbol(userDefaultCurrency(to));
    setSwitchNote(
      `Converted at ${sFrom}1 = ${sTo}${formatSwitchRate(rate)}. ` +
      (keep ? `Your existing loans stay in ${sFrom}. ` : 'Your loans were converted too. ') +
      (Number(newPay) > 0 ? 'Take-home is the new pay you typed. Check your spending before you save: it is now read in ' : 'Check your income and spending before you save: they are now read in ') + sTo + '.',
    );
  }

  function assumptionBlock(): { step: number; what: string } | null {
    if (assumptionError('payRise', annualHikeRate)) return { step: 2, what: 'the yearly pay rise is out of range' };
    if (hikeSchedule.some((ph) => assumptionError('payRise', num(ph.rate, '0'))))
      return { step: 2, what: 'a pay-rise phase is out of range' };
    if (assumptionError('tax', marginalRate) || assumptionError('tax', stateMarginalRate))
      return { step: 2, what: 'the tax rate is out of range' };
    for (const [idx, l] of loans.entries()) {
      if (
        assumptionError('fee', l.prepayment_penalty_pct) ||
        assumptionError('fee', l.processing_fee_amortised) ||
        assumptionError('fee', l.insurance_premium_pct) ||
        assumptionError('rateDrift', l.rate_drift_annualized) ||
        wholeMonthsError(monthsText[`${l.id ?? idx}:lock`] ?? '', LOCK_IN_RANGE) ||
        wholeMonthsError(monthsText[`${l.id ?? idx}:freq`] ?? '', PART_PAY_FREQ_RANGE)
      )
        return { step: 3, what: 'a loan has a fee, rate change or month count out of range' };
    }
    if (creditScoreError(creditScore, country)) return { step: 4, what: 'the credit score isn’t a valid score' };
    return null;
  }

  async function save() {
    // Country switch, another tab, or the account copy still loading (UX2 #23).
    if (pendingCountry || tabGuard.blocks()) return;
    if (formWouldEraseSavedLoans(loadProfileClient().user.loans ?? [], loans, filled)) {
      setSaveBlocked('Not saved yet: your saved profile is still loading.');
      return;
    }
    // A deep link can reach Review without passing the Loans check.
    if (!loansComplete) {
      onOpen(3);
      setShowLoanErrors(true);
      setSaveBlocked('Not saved yet: a loan needs a fix first. The Loans part is open with what to change; then save again.');
      return;
    }
    // R8-6/7/8: an assumption out of range blocks the save, with the part
    // that holds it open, instead of saving a value the plan can't use.
    const badAssumption = assumptionBlock();
    if (badAssumption) {
      onOpen(badAssumption.step);
      setSaveBlocked(`Not saved yet: ${badAssumption.what}. Fix the highlighted field, then save again.`);
      return;
    }
    setSaveBlocked(null);
    const score = Number(usableCreditScore(creditScore, country) || 'x');
    // Foreign loans carry the exchange rate entered on the Loans step
    // (loansComplete requires one), so every page converts at the same rate.
    // Start from the saved profile, so what this form doesn't edit
    // (holdings from /profile/assets, Plan's FX drift) is kept.
    const stored = loadProfileClient();
    // Date each foreign rate (lib/fx-refresh): kept, fetched just now, or
    // typed (a typed rate is marked manual so app-open refresh leaves it be).
    const fetchedQuotes = Object.fromEntries(
      Object.entries(fxQuotes).flatMap(([c, q]) => (typeof q === 'object' ? [[c, q]] : [])),
    );
    // Round 2: what only Plan edits (borrowing limit, date of birth, own
    // return, each loan's rate-rise choice) goes back unchanged.
    const userWithFx = dateProfileRates(
      carryPlanInputs({ ...(stored.isLive ? stored.user : {}), ...buildUser() } as UserPayload, stored.isLive ? stored.user : null),
      stored.isLive ? stored.user : null,
      fetchedQuotes,
      Date.now(),
    );
    // Gross income given: marginal_rate comes from its bracket (sharper than Step 4's manual field).
    // Streams (when present) override the single annual_gross_salary /
    // annual_business_income input. Each stream contributes per its
    // tax_treatment: salary/business_normal at 100%, 44ADA at 50%,
    // rental at 70% (post-30% std ded), capital_gains at 0% (taxed flat,
    // routed below). Avoids over-counting deemed-profit / std-ded buckets.
    const streamGross =
      incomeStreams.length > 0
        ? Number(activeSlabGrossAnnual(incomeStreams).toString())
        : 0;
    const grossForBracket =
      streamGross > 0
        ? streamGross
        : incomeType === 'salaried'
          ? Number(annualGrossSalary)
          : Number(annualBusinessIncome);

    // When deductions are populated, they refine the bracket math by
    // pulling taxable income (and thus marginal rate) down. Use the
    // deductions-aware derivation as the primary source; fall back to
    // bracket-only and then the manual field.
    const deductionDerived =
      hasAnyDeductions(deductions) && grossForBracket > 0
        ? deriveMarginalRate({
            grossAnnual: grossForBracket,
            country,
            taxRegime,
            filingStatus,
            deductions,
            ageBracket: ageBracket || undefined,
            stateMarginalRate,
          })
        : null;

    const derivedBracket =
      grossForBracket > 0
        ? classifyBracket(
            country, taxRegime, incomeType, grossForBracket,
            country === 'US' ? filingStatus : undefined,
          )
        : null;
    // Combined marginal rate = federal/national (from gross) + state (US only); it feeds tax-aware APRs and savings.
    const stateRate =
      country === 'US' && stateMarginalRate.trim()
        ? Number(num(stateMarginalRate, '0'))
        : 0;
    // Gross pay first, then a rate typed now, then the saved rate while its inputs are unchanged,
    // else a fresh estimate from take-home (lib/marginal-rate: a stale 0% survived an IN→US switch).
    const { rate: composedRate } = profileMarginalRate({
      // UX fix 23: India with surcharge + cess (30% slab = 31.2%), as the engine.
      bracketRate: derivedBracket ? grossMarginalRate(country, taxRegime, incomeType, grossForBracket, country === 'US' ? filingStatus : undefined) : null,
      stateRate, abroadRate: livesAbroad(stored.user) ? abroadIndiaRate({ ...stored.user, income_streams: userWithFx.income_streams, tax_regime: taxRegime }) : null,
      manualRate: marginalRate,
      loadedRate: loadedMarginalRate.current,
      prev: stored.isLive ? stored.user : undefined,
      country,
      incomeType,
      monthlyIncome: userWithFx.monthly_income,
      regime: taxRegime,
      filing: filingStatus,
    });
    // Deductions-derived rate wins when present — it already includes
    // state for US users (via stateMarginalRate threaded into the
    // helper).
    const resolvedMarginalRate = deductionDerived
      ? deductionDerived.toFixed(4)
      : composedRate.toFixed(4);
    // A balance typed now is dated today; one left as it was keeps its date.
    const savedBefore = loadProfileClient().user.loans, recordedAt = new Date().toISOString();
    const stampedUser = {
      ...userWithFx,
      loans: stampBalanceDates(userWithFx.loans, savedBefore, localIsoDate(getCountryToday(country)), recordedAt),
    };
    const saved = saveProfileWithPaidEmis({
      user: stampedUser,
      marginalRate: resolvedMarginalRate,
      creditScore: Number.isFinite(score) && score >= 300 ? score : null,
    }, localIsoDate(getCountryToday(country)));
    // The browser didn't keep it (cookies blocked, or a profile too large):
    // say so and stay, instead of landing on home with nothing saved.
    if (!saved) {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    logBalanceDrops(savedBefore, stampedUser, dropReasons, localIsoDate(getCountryToday(country)), recordedAt); // UX2 #20
    // The balances were just entered, so cards aren't "never updated".
    try {
      window.localStorage.setItem(BALANCES_ENTERED_KEY, localIsoDate(new Date()));
    } catch {
      /* private mode: the stale-card nudge falls back to activity only */
    }
    // Back to the summary, which now shows what was saved.
    onDone(true);
  }

  // Loans need what the projection needs; no loans at all is fine (goals,
  // portfolio and purchase planning work without one).
  const loanErrors = loans.map((l) => loanDraftErrors(l, country));
  // A new or changed balance on an EMI loan says whether this month's EMI
  // is already off it (lib/roll-forward).
  const thisMonth = localIsoDate(getCountryToday(country)).slice(0, 7);
  const thisMonthName = MONTH_NAMES[Number(thisMonth.slice(5, 7)) - 1];
  const nextMonthName = MONTH_NAMES[Number(nextMonth(thisMonth).slice(5, 7)) - 1];
  const savedLoans = savedLoansRef.current;
  // Loans added by an import and not saved yet: say so, and warn before a reload
  // drops them (UX50 D-08).
  const unsavedImports = loans.filter((l) => l.imported_from && !savedLoans.some((p) => p.id && p.id === l.id)).length;
  useEffect(() => {
    if (!unsavedImports) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedImports]);
  const askPaid = (l: LoanPayload) =>
    needsEmi(l.loan_type) && asksEmiPaid(l, savedLoans.find((p) => p.id === l.id));
  const paidErrors = loans.map((l) => (askPaid(l) && emiAnswer(l, thisMonth) === undefined ? emiPaidError(thisMonthName) : null));
  const dropOf = (l: LoanPayload) => balanceDropOf({ ...l, currency: loanCurrency(l, country) }, savedLoans); // UX2 #20
  const dropErrors = loans.map((l) => (dropOf(l) > 0 && !(l.id && dropReasons[l.id]) ? 'Choose one, so Activity records it right.' : null));
  // Currencies of entered loans other than the user's own.
  const userCcy = userDefaultCurrency(country);
  const foreignCcys = Array.from(
    new Set(
      loans
        .filter((l) => Number(l.outstanding) > 0)
        .map((l) => loanCurrency(l, country))
        .filter((c) => c !== userCcy),
    ),
  );
  const fxErrors: Record<string, string> = {};
  for (const c of foreignCcys) {
    const r = Number(fxRates[c]);
    if (!(r > 0)) {
      fxErrors[c] =
        fxQuotes[c] === 'failed'
          ? `Today's rate couldn't be fetched. Enter what 1 ${c} is worth in ${userCcy} (your bank's app or a currency site shows it).`
          : `Enter what 1 ${c} is worth in ${userCcy}.`;
    } else if (r > 100000) {
      fxErrors[c] = `That rate looks too large. Check the direction: 1 ${c} in ${userCcy}.`;
    }
  }
  const loansComplete =
    loanErrors.every((e) => Object.keys(e).length === 0) &&
    paidErrors.every((e) => !e) && dropErrors.every((e) => !e) &&
    Object.keys(fxErrors).length === 0;
  const canAdvance =
    step === 0 ? true                                                       // 'You' is fully optional — never gate the flow
      : step === 1 ? !!country && pendingCountry === null
      : step === 2 ? Number(monthlyIncome) > 0 && Number(fixedExpenses) >= 0
      : step === 4 ? Number(savingsBalance) >= 0
      : true;

  // Fetch today's rate for each foreign currency once; the user can change
  // it. A failed fetch leaves the field blank and asks for it.
  const foreignKey = foreignCcys.join(',');
  useEffect(() => {
    for (const c of foreignKey ? foreignKey.split(',') : []) {
      if (fxQuotes[c] || Number(fxRates[c]) > 0) continue;
      setFxQuotes((q) => ({ ...q, [c]: 'loading' }));
      api
        .fxRate(c, userCcy)
        .then((r) => {
          setFxQuotes((q) => ({ ...q, [c]: r }));
          setFxRates((cur) => (Number(cur[c]) > 0 ? cur : { ...cur, [c]: r.rate }));
        })
        .catch(() => setFxQuotes((q) => ({ ...q, [c]: 'failed' })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreignKey, userCcy]);

  if (!ready) {
    return (
      <LShell>
        <p style={{ color: L_T.muted }}>Loading your profile…</p>
      </LShell>
    );
  }

  if (section === null) {
    // The server has no document.cookie, so it uses the profile it already
    // read. The browser reads the cookie, which is the same profile, including
    // a save that happened after this page was rendered.
    const stored = summaryProfile(initial);
    return (
      <LShell>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
          {back && <BackLink back={back} />}
          <ProfileHeader title="Your profile">
            Everything the plan uses. Change a part with its [EDIT]; the rest stays as it is.
          </ProfileHeader>
          {justSaved && (
            <p role="status" style={{ margin: 0, padding: '8px 12px', border: `1px solid ${L_T.positive}`, color: L_T.positive }}>
              {/* One way back: the link above (QA: two stacked BACK TO PLAN links). */}
              Saved. Home and Plan use the new numbers.
            </p>
          )}
          <ProfileSummary
            user={(filled ? { ...(stored.isLive ? stored.user : {}), ...buildUser() } : stored.user) as UserPayload}
            creditScore={filled ? creditScore : (stored.creditScore != null ? String(stored.creditScore) : '')}
            assets={stored.user.assets ?? []}
            marginalRate={stored.marginalRate}
            payoffOrder={payoffOrder}
            onEdit={onOpen}
          />
        </div>
      </LShell>
    );
  }

  return (
    <LShell>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {back && <BackLink back={back} />}
      <ProfileHeader title={PROFILE_SECTIONS[step] ?? 'Your profile'} editing>
        Change what you need and save. You can move between parts first;
        Save keeps every change, Cancel drops them all.
      </ProfileHeader>
      <SectionTabs step={step} onOpen={onOpen} onAll={() => onDone(false)} />

      <Card>
        {!formReady ? (
          <p role="status" data-testid="profile-form-loading">Loading your saved profile…</p>
        ) : (<>
        {step === 0 && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
              Both optional. Leave them blank to stay anonymous; the plan is the same.
            </div>
            <Field
              label="Your name (optional)"
              kind="text"
              value={displayName}
              onChange={setDisplayName}
              hint="Used only as a greeting. Saved with your plan; shown only to you."
            />
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginBottom: 6,
                }}
              >
                Age bracket (optional)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {AGE_BRACKETS.map((b) => {
                  const selected = ageBracket === b.value;
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() =>
                        setAgeBracket(selected ? '' : b.value)
                      }
                      style={{
                        padding: '7px 14px',
                        borderRadius: 999,
                        border: `1px solid ${
                          selected ? 'var(--accent)' : 'var(--border)'
                        }`,
                        background: selected ? 'var(--accent)' : 'var(--card)',
                        color: selected ? 'var(--card)' : 'var(--ink)',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
              <div
                className="muted"
                style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}
              >
                Used for age-based limits in tax deductions and, later, nudges
                such as emergency-fund-first under 25.
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
              <Select
                label="Country"
                value={country}
                onChange={(v: Country) => requestCountry(v)}
                options={[
                  { value: 'IN' as Country, label: 'India' },
                  { value: 'US' as Country, label: 'USA' },
                ]}
              />
              {country === 'IN' && (
                <Select
                  label="State (optional)"
                  value={stateFor(country, homeState)}
                  onChange={(v: string) => setHomeState(v)}
                  options={[{ value: '', label: 'Not set' }, ...statesFor(country).map((st) => ({ value: st, label: st }))]}
                  hint={STATE_HELP[country]}
                />
              )}
              <Field
                label="City (optional)"
                kind="text"
                value={city}
                onChange={(v) => setCity(v.slice(0, 60))}
                placeholder={country === 'IN' ? 'e.g. Chennai' : 'e.g. Austin'}
                hint="For your own reference. Nothing is worked out from it."
              />
            </div>
            {pendingCountry && (
              <CountrySwitchPanel
                from={country}
                to={pendingCountry}
                rate={switchRate}
                rateState={switchRateState}
                onRate={setSwitchRate}
                loanCount={loansInHomeCurrency(loans, country)}
                keepLoans={keepLoansInOld}
                onKeepLoans={setKeepLoansInOld}
                onConfirm={confirmCountrySwitch}
                onCancel={() => setPendingCountry(null)}
              />
            )}
            {switchNote && (
              <p role="status" style={{ margin: 0, fontSize: 13, color: L_T.positive }}>{switchNote}</p>
            )}
            {country === 'US' && (
              <label
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  border: '1px dashed var(--dash)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                <input
                  type="checkbox"
                  checked={isNriUs}
                  onChange={(e) => setIsNriUs(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>I&apos;m an NRI on a US work visa</strong> with debts back
                  in India (home loan, family obligations).
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Turns on per-loan currency tagging (INR / USD) and auto-fills
                    the NRI prepay tool. You stay US-resident for tax purposes.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
            <Select
              label="Income type"
              value={incomeType}
              onChange={setIncomeType}
              options={[
                { value: 'salaried' as IncomeType, label: 'Salaried' },
                { value: 'business_owner' as IncomeType, label: 'Business owner / self-employed' },
              ]}
              info={
                <>
                  <strong>Salaried</strong> = fixed monthly inflow from an
                  employer, {salaryDeductionsPhrase(country)}.{' '}
                  <strong>Self-employed / business owner</strong> = variable
                  income from your own work. The engine handles surplus
                  calculations slightly differently for each.
                </>
              }
            />
            <Field
              label={takeHomeLabel(country, incomeType)}
              findIt={incomeType === 'salaried' ? whereToFind('takeHome', { country }) : null}
              kind="money"
              currency={userCcy}
              value={monthlyIncome}
              onChange={setMonthlyIncome}
              hint={
                incomeType !== 'salaried'
                  ? 'A typical month after business costs and the tax you set aside. If it varies, use a lean month.'
                  : country === 'IN'
                  ? "What reaches your account each month, not your CTC. Leave out bonuses; add them in Tools › Spare cash when they come."
                  : 'Take-home, post-tax, post-401(k). Add bonuses via Tools › Spare cash.'
              }
              info={
                country === 'IN' && incomeType === 'salaried' ? (
                  <>
                    The amount your bank account receives each month — <em>NOT</em>{' '}
                    your CTC.
                    <br />
                    <br />
                    <strong>CTC</strong> (Cost to Company) is the full annual
                    package including employer's PF contribution, gratuity, and
                    insurance — most of which you never see in your account.
                    <br />
                    <br />
                    <strong>In-hand salary</strong> = CTC minus employer PF
                    minus gratuity minus your employee PF minus{' '}
                    <strong>TDS</strong> minus professional tax. This is what
                    you can actually spend.
                    <br />
                    <br />
                    <strong>What's TDS?</strong> Your employer estimates your
                    annual income tax and withholds a slice each month before
                    paying you. The number you enter here is already net of
                    that — don't subtract tax again.
                    <br />
                    <br />
                    Skip annual bonuses and one-off incentives — log them via
                    Tools › Spare cash when they actually credit.
                  </>
                ) : (
                  <>
                    Take-home pay each month, <strong>after</strong> federal /
                    state tax withholding and 401(k) contributions, not your
                    gross salary. Add bonuses separately via Tools › Spare cash.
                  </>
                )
              }
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <AdvancedTaxDetails
                country={country}
                incomeType={incomeType}
                taxRegime={taxRegime}
                filingStatus={filingStatus}
                stateMarginalRate={stateMarginalRate}
                annualGrossSalary={annualGrossSalary}
                annualBusinessIncome={annualBusinessIncome}
                extraIncomeAnnualTax={extraIncomeAnnualTax}
                onFilingStatusChange={setFilingStatus}
                onStateMarginalRateChange={setStateMarginalRate}
                onAnnualGrossSalaryChange={setAnnualGrossSalary}
                onAnnualBusinessIncomeChange={setAnnualBusinessIncome}
                onExtraIncomeAnnualTaxChange={setExtraIncomeAnnualTax}
              />
            </div>
            {country === 'US' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <UsStateField value={usState} onChange={setUsState} />
              </div>
            )}
            {!showDetailedExpenses ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <Field
                  label="Monthly spending, without EMIs"
                  kind="money"
                  currency={userCcy}
                  value={(() => {
                    const total = Number(fixedExpenses || 0) + Number(variableExpenses || 0);
                    return total > 0 ? String(total) : '';
                  })()}
                  onChange={(v) => { setFixedExpenses(v); setVariableExpenses(''); }}
                  hint="Rent, food, bills and subscriptions, on average. Leave out loan EMIs: the plan adds them."
                  info={
                    <>
                      Everything non-debt: rent, groceries, fuel, utilities,
                      eating out, subscriptions, school fees. One rough
                      number is fine — best estimate works.
                      <br />
                      <br />
                      <strong>Don&apos;t include EMIs</strong> — your loan EMIs
                      are tracked separately on the debt cards above. The
                      surplus calc subtracts EMIs out of income on its own,
                      so adding them here double-counts and makes the plan
                      under-promise.
                      <br />
                      <br />
                      <strong>Don&apos;t include income tax</strong> — your
                      monthly income is post-tax (take-home), so tax is
                      already accounted for.
                      <br />
                      <br />
                      If you want the What-if &quot;trim spending&quot;
                      slider on /plan to operate on just the squeezable
                      bucket (eating out, shopping) instead of your rent,
                      use the detailed breakdown below.
                    </>
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowDetailedExpenses(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    padding: 0,
                    marginTop: 6,
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  Add detailed breakdown ▸
                </button>
              </div>
            ) : (
              <>
                <Field
                  label="Monthly fixed expenses (excludes EMIs)"
                  kind="money"
                  currency={userCcy}
                  value={fixedExpenses}
                  onChange={setFixedExpenses}
                  hint="Rent, utilities, school fees — locked. Do NOT include loan EMIs."
                  info={
                    <>
                      Recurring <strong>locked-in</strong> non-debt outflows:
                      rent (not loan EMI), utilities, school fees, insurance
                      premiums. You&apos;d need to make a real change (move,
                      switch plan) to cut these.
                      <br />
                      <br />
                      <strong>EMIs are excluded</strong> — they&apos;re
                      tracked on the debt cards above and subtracted out of
                      income by the surplus calc.
                    </>
                  }
                />
                <div>
                  <Field
                    label="Monthly variable / discretionary spending"
                    kind="money"
                    currency={userCcy}
                    value={variableExpenses}
                    onChange={setVariableExpenses}
                    hint="Eating out, travel, shopping — squeezable"
                    info={
                      <>
                        Discretionary outflows: eating out, entertainment,
                        travel, shopping, subscriptions. The number you'd
                        cut into if you needed to free up cash.
                        <br />
                        <br />
                        Splitting this out makes the{' '}
                        <strong>What-if "trim spending"</strong> slider on
                        /plan honest — it operates on this bucket, not on
                        your rent.
                      </>
                    }
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setVariableExpenses('');
                      setShowDetailedExpenses(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted)',
                      padding: 0,
                      marginTop: 6,
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    ← Use combined expenses
                  </button>
                </div>
              </>
            )}
            <div id="pf-hike">
            <Field
              label="Yearly pay rise (%)"
              kind="percent"
              value={annualHikeRate}
              onChange={setAnnualHikeRate}
              error={assumptionError('payRise', annualHikeRate)}
              hint="e.g. 8. Leave 0 if uncertain."
              info={
                <>
                  Yearly raise you expect, as a percent, e.g.{' '}
                  <strong>8</strong>. The simulation applies it once
                  every 12 months, on the month you pick below. Use 0 if
                  uncertain — better to be conservative. You can also toggle
                  the hike off entirely on the Plan page to compare flat-income
                  vs growing-income scenarios.
                </>
              }
            />
            </div>
            <Select
              label="Rise comes in"
              value={String(hikeEffectiveMonth)}
              onChange={(v) => {
                setHikeEffectiveMonth(Number(v));
                setHikeMonthTouched(true);
              }}
              options={MONTH_NAMES.map((name, i) => ({
                value: String(i + 1),
                label: name,
              }))}
              info={
                country === 'IN' ? (
                  <>
                    The calendar month your hike usually kicks in.{' '}
                    <strong>Default: April</strong> (FY-1) — most Indian
                    salaried employees get appraised in March and the new salary
                    lands in April. Government / PSU staff often follow the
                    same cycle. Pick a different month if your employer's cycle
                    differs (Jan / July / your work-anniversary month, etc.).
                  </>
                ) : (
                  <>
                    The calendar month your hike usually kicks in.{' '}
                    <strong>Default: January</strong> (calendar-year start).
                    Pick your work-anniversary month, or whatever your employer
                    uses for annual raises.
                  </>
                )
              }
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <HikeScheduleEditor
                phases={hikeSchedule}
                onChange={setHikeSchedule}
                fallbackRate={annualHikeRate}
              />
            </div>
            <Field
              label="Tax on your next rupee or dollar earned (%)"
              findIt={whereToFind('taxRate', { country })}
              kind="percent"
              value={marginalRate}
              onChange={setMarginalRate}
              error={assumptionError('tax', marginalRate)}
              hint="Tax on your next rupee or dollar of income, e.g. 30."
              info={
                country === 'IN' ? (
                  <>
                    Tax on your <strong>next ₹</strong> of income — not your
                    average rate.
                    <br />
                    <br />
                    <strong>New regime ({IN_TAX_YEAR_LABEL}):</strong>
                    <br />
                    {inNewRegimeSlabLines().map((line) => (
                      <span key={line} data-testid="slab-line">
                        • {line}
                        <br />
                      </span>
                    ))}
                    <br />
                    The engine uses this to decide whether prepaying debt or
                    investing the surplus is better for you.
                  </>
                ) : (
                  <>
                    Tax on your <strong>next $</strong> of income — not your
                    average rate. Federal marginal rate plus state. For most
                    salaried filers in 2026: 22–32% federal, plus state. The
                    engine uses this for invest-vs-prepay decisions.
                  </>
                )
              }
            />
            {country === 'IN' && (
              <Select
                label="Tax regime"
                value={taxRegime}
                onChange={setTaxRegime}
                options={[
                  { value: 'new' as TaxRegimeIN, label: 'New (default)' },
                  { value: 'old' as TaxRegimeIN, label: 'Old (with 80C / HRA / 24(b))' },
                ]}
                info={
                  <>
                    <strong>New regime (default):</strong> lower flat rates, no
                    deductions allowed.
                    <br />
                    <br />
                    <strong>Old regime:</strong> higher rates, but you can claim
                    80C (₹1.5 lakh), HRA, 80D, 80E, NPS top-up, and home-loan
                    interest under section 24(b), now s.22 (up to ₹2 lakh on self-occupied
                    property). Pick whichever you've filed under — if you
                    pick old, the deductions panel below captures the numbers
                    we use to derive your true marginal rate.
                  </>
                }
              />
            )}
            <DeductionsPanel
              country={country}
              taxRegime={taxRegime}
              filingStatus={filingStatus}
              ageBracket={ageBracket || undefined}
              incomeType={incomeType}
              grossAnnual={
                incomeType === 'salaried' ? annualGrossSalary : annualBusinessIncome
              }
              stateMarginalRate={stateMarginalRate}
              value={deductions}
              onChange={setDeductions}
            />
            <IncomeStreamsPanel
              country={country}
              value={incomeStreams}
              onChange={setIncomeStreams}
            />
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              For each loan or card: what you owe, the interest rate and the
              monthly EMI. No loans? Remove them and save: goals, portfolio
              and purchase planning work without one.
            </p>
            {country === 'IN' && (
              <KfsImport
                blankLoan={blankLoan}
                todayIso={localIsoDate(getCountryToday(country))}
                onAdd={(loan) => setLoans((cur) => [...cur, loan])}
              />
            )}
            {country === 'IN' && (
              <CreditReportImport
                blankLoan={blankLoan}
                todayIso={localIsoDate(getCountryToday(country))}
                existing={loans}
                onUpdate={updateLoan}
                onAdd={(added) => setLoans((cur) => [...cur, ...added])}
              />
            )}
            {country === 'IN' && (
              <SmsImport loans={loans}
                onPatchLoan={updateLoan}
                onAddLoan={(patch) => setLoans((cur) => [...cur, { ...blankLoan(), ...patch } as LoanPayload])}
              />
            )}
            {unsavedImports > 0 && (
              <p role="status" data-testid="import-unsaved" style={{ margin: 0, fontSize: 13, position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg, #fff)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                {unsavedImports} imported loan{unsavedImports === 1 ? '' : 's'} not saved yet. Check the figures, then save at the bottom.
              </p>
            )}
            {loans.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  position: 'relative',
                }}
              >
                {l.imported_from && (
                  <p data-testid="import-chip" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12 }}>
                    <span style={{ border: '1px solid currentColor', padding: '1px 6px' }}>
                      {l.imported_from === 'credit_report' ? 'From your credit report' : l.imported_from === 'kfs' ? 'From your KFS' : 'From a bank SMS'}
                    </span>
                    {(!l.nominal_rate || (l.loan_type !== 'credit_card' && !l.scheduled_emi) || !Number(l.outstanding)) && (
                      <span style={{ color: 'var(--warn, #8a5a00)' }}>
                        {' '}· check {[
                          !Number(l.outstanding) && 'the balance',
                          !l.nominal_rate && 'the rate',
                          l.loan_type !== 'credit_card' && !l.scheduled_emi && 'the EMI',
                        ].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </p>
                )}
                {kfsNote(l) && (
                  <p data-testid="kfs-note" className="muted" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12 }}>
                    {kfsNote(l)}
                  </p>
                )}
                <Select
                  label="Loan type"
                  value={l.loan_type}
                  onChange={(v) => {
                    const guessed = (l.estimated_fields ?? []).includes('rate') || !(l.nominal_rate ?? '').trim();
                    const rate = typicalRate(country, v);
                    updateLoan(i, {
                      loan_type: v,
                      ...(guessed && rate != null
                        ? { nominal_rate: String(rate), estimated_fields: withEstimate(l, 'rate', true).estimated_fields }
                        : {}),
                    });
                  }}
                  options={LOAN_TYPES}
                  info={
                    <>
                      <strong>Credit cards</strong> and <strong>BNPL</strong>{' '}
                      are revolving — no fixed payoff date.{' '}
                      <strong>Home / auto / personal / education / gold</strong>{' '}
                      loans amortize over a tenure. Determines how the engine
                      prices each line.
                    </>
                  }
                />
                <BankCombobox
                  label="Bank / lender"
                  value={l.bank}
                  onChange={(v) => updateLoan(i, { bank: v })}
                  country={country}
                  info={
                    <>
                      The institution holding this debt. Tap to open the list,
                      type to filter. If your lender isn't shown, type it
                      manually — free text is accepted.
                    </>
                  }
                />
                <Field
                  label="Nickname (optional)"
                  kind="text"
                  value={l.nickname ?? ''}
                  onChange={(v) => updateLoan(i, { nickname: v.slice(0, NICKNAME_MAX) || undefined })}
                  placeholder="e.g. Dad's car loan"
                  hint="Your own name for it. Shown with the lender everywhere this loan appears."
                />
                <Field
                  label="Outstanding balance"
                  findIt={findFor(l, country, 'balance')}
                  kind="money"
                  currency={loanCurrency(l, country)}
                  value={l.outstanding}
                  onChange={(v) => updateLoan(i, { outstanding: v })}
                  info={
                    <>
                      How much you still owe <strong>today</strong>.
                      <br />
                      <br />
                      For instalment loans (home, auto, personal): the{' '}
                      <strong>remaining principal</strong>, not the original
                      loan amount.
                      <br />
                      <br />
                      For credit cards: the <strong>unpaid statement
                      balance</strong> you'd see on your latest statement.
                    </>
                  }
                />
                <OwedNowHint loan={l} country={country} />
                {askPaid(l) && (
                  <EmiPaidQuestion
                    monthName={thisMonthName}
                    nextMonthName={nextMonthName}
                    value={emiAnswer(l, thisMonth)}
                    onChange={(a) => updateLoan(i, emiAnswerPatch(a, thisMonth))}
                    error={showLoanErrors ? paidErrors[i] : null}
                  />
                )}
                {dropOf(l) > 0 && l.id && <BalanceDropQuestion drop={formatCurrency(dropOf(l), loanCurrency(l, country))} value={dropReasons[l.id]}
                  onChange={(r) => setDropReasons((d) => ({ ...d, [l.id as string]: r }))} error={showLoanErrors ? dropErrors[i] : null} />}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Field
                    label="Interest rate (%)"
                    findIt={findFor(l, country, 'rate')}
                    kind="percent"
                    value={l.nominal_rate}
                    onChange={(v) => updateLoan(i, { nominal_rate: v })}
                    hint="e.g. 8.5"
                    error={showLoanErrors ? loanErrors[i]?.rate : null}
                    info={
                      <>
                        The <strong>headline interest rate</strong> your bank
                        advertises. <strong>Doesn't include</strong> GST,
                        processing fees, or other charges.
                        <br />
                        <br />
                        Enter as a percent: <strong>8.5</strong> for 8.5%,{' '}
                        <strong>36</strong> for 36%.
                        <br />
                        <br />
                        The Debts view will show your true <strong>effective
                        APR</strong> (nominal + 18% GST on interest + annualized
                        fees) so you see the real cost.
                      </>
                    }
                  />
                  <RateRangeHint
                    bank={l.bank}
                    loanType={l.loan_type}
                    userRate={l.nominal_rate}
                    variant="inline"
                    incomeType={incomeType}
                    country={country}
                    monthlyIncome={Number(monthlyIncome) || undefined}
                    creditScore={Number(creditScore) || null}
                    onUsePrediction={(rate) =>
                      updateLoan(i, { nominal_rate: rate })
                    }
                  />
                  <MarketRateLine loan={l} country={country} />
                </div>
                {l.loan_type !== 'credit_card' && (
                <Select<RateType | 'unsure'>
                  label="Fixed or floating rate"
                  findIt={findFor(l, country, 'rateType')}
                  value={rateTypeChoice(l)}
                  onChange={(v) => updateLoan(i, applyRateTypeChoice(v, l.loan_type, country, l.currency))}
                  options={[
                    { value: 'unsure', label: `Not sure (taken as ${l.rate_type_assumed === undefined ? l.rate_type : likelyRateType(l.loan_type, country, l.currency)})` },
                    { value: 'floating', label: 'Floating' },
                    { value: 'fixed', label: 'Fixed' },
                  ]}
                  hint={rateTypeHint(l, country)}
                  info={
                    <>
                      <strong>Fixed</strong> — your interest rate is{' '}
                      <em>locked at today&apos;s value</em> for the entire
                      tenure (or for a fixed initial period, then floats
                      after). Your EMI never goes up because of a rate move.
                      The trade-off: if benchmark rates fall, you don&apos;t
                      benefit unless you refinance. Common on personal loans,
                      credit-card revolving balances, auto loans, and most US
                      mortgages.
                      <br />
                      <br />
                      <strong>Floating</strong> — your rate <em>tracks a
                      benchmark</em> (RBI repo / EBLR / RLLR / MCLR in IN,
                      SOFR / prime rate in US) and re-prices on the bank&apos;s
                      reset cadence. When the benchmark moves, your EMI (or
                      tenure) adjusts. You benefit when rates fall, take the
                      hit when they rise. Default for most India home loans
                      post-Oct-2019; common for US HELOCs and ARMs.
                      <br />
                      <br />
                      <strong>Rule of thumb.</strong> Read your sanction
                      letter — it says &quot;Type of Interest&quot; explicitly.
                      Your EMI changing between cycles for the same loan =
                      floating; never changing = fixed.
                    </>
                  }
                />
                )}
                {['personal_loan', 'auto_loan', 'two_wheeler_loan', 'medical_loan', 'gold_loan', 'bnpl'].includes(l.loan_type) && (
                  <Select
                    label="How the interest is worked out"
                    findIt={findFor(l, country, 'rateBasis')}
                    value={l.rate_basis ?? 'reducing'}
                    onChange={(v) =>
                      updateLoan(i, { rate_basis: v as 'flat' | 'reducing' })
                    }
                    options={[
                      { value: 'reducing' as const, label: 'Reducing balance (banks)' },
                      { value: 'flat' as const, label: 'Flat rate (consumer-durable / NBFC)' },
                    ]}
                    info={
                      <>
                        <strong>Reducing balance</strong> — interest is computed
                        each month on the <em>outstanding</em>. The rate the
                        bank quotes <em>is</em> the APR. Default for all bank
                        loans.
                        <br />
                        <br />
                        <strong>Flat rate</strong> — interest is computed on
                        the <em>original principal</em> for every month. Common
                        on consumer-durable loans (TV, phone EMI at the store)
                        and some NBFC personal loans. A &quot;flat 8% over 24
                        months&quot; is mathematically ~14-15% APR
                        (reducing-balance equivalent).
                        <br />
                        <br />
                        We auto-convert flat → reducing internally so the
                        engine math compares apples-to-apples with bank loans.
                        Pick &quot;Flat&quot; if your loan agreement shows
                        a flat rate or the EMI was computed as principal × rate
                        × tenure / 12 / months.
                      </>
                    }
                  />
                )}
                {asksBusinessPurpose(l, country) && (
                  <div style={{ gridColumn: '1 / -1' }} data-testid="business-purpose">
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{PURPOSE_QUESTION}</div>
                    <div role="group" aria-label={PURPOSE_QUESTION} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {([
                        [false, 'No, a personal loan'],
                        [true, 'Yes, for a business'],
                      ] as const).map(([v, text]) => {
                        const on = l.business_purpose === v;
                        return (
                          <button
                            key={String(v)}
                            type="button"
                            aria-pressed={on}
                            onClick={() => updateLoan(i, { business_purpose: v })}
                            style={{
                              padding: '7px 14px',
                              borderRadius: 999,
                              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                              background: on ? 'var(--accent)' : 'var(--card)',
                              color: on ? 'var(--card)' : 'var(--ink)',
                              fontSize: 13,
                              cursor: 'pointer',
                            }}
                          >
                            {text}
                          </button>
                        );
                      })}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                      {l.business_purpose === undefined ? 'Not answered yet, so the app treats it as a personal loan. ' : ''}
                      {PURPOSE_HELP}
                    </div>
                  </div>
                )}
                {isNriUs && (
                  <Select
                    label="Currency"
                    value={l.currency ?? 'USD'}
                    onChange={(v: 'INR' | 'USD') =>
                      updateLoan(i, { currency: v })
                    }
                    options={[
                      { value: 'USD' as const, label: 'USD ($) — US loan' },
                      { value: 'INR' as const, label: 'INR (₹) — Indian loan' },
                    ]}
                    info={
                      <>
                        Which currency is this loan denominated in? An NRI on a
                        US work visa typically has both: a USD car loan or US
                        credit card, and an INR home loan or family obligation
                        back in India. Tag each so the NRI prepay tool can
                        autofill currencies + FX correctly.
                      </>
                    }
                  />
                )}
                <TenureField
                  country={country}
                  loan={l}
                  manualMode={manualTenureIdxs.has(i)}
                  onChangeTenure={(v) =>
                    updateLoan(i, { tenure_months_remaining: Number(v) || 0 })
                  }
                  onSetManual={(manual) => setTenureMode(i, manual)}
                />
                <Field
                  label={l.loan_type === 'credit_card' ? 'Usual monthly payment (optional)' : 'Bank-required EMI'}
                  findIt={findFor(l, country, 'emi')}
                  kind="money"
                  currency={loanCurrency(l, country)}
                  value={(l.scheduled_emi ?? '').trim() || computedEmi(l)}
                  onChange={(v) => {
                    const patch: Partial<LoanPayload> = { scheduled_emi: v };
                    // Clearing the EMI keeps the months that were on screen, so the
                    // box fills again with the EMI those months imply.
                    if (!(v ?? '').trim() && !(l.tenure_months_remaining > 0)) {
                      const derived = deriveTenureMonths(l.outstanding, l.nominal_rate, l.scheduled_emi);
                      if (derived) patch.tenure_months_remaining = derived;
                    }
                    updateLoan(i, patch);
                  }}
                  hint={(l.scheduled_emi ?? '').trim() || l.loan_type === 'credit_card' ? undefined : (computedEmi({ ...l, scheduled_emi: '' }) ? 'Worked out from the balance, rate and months left. Change it if the EMI on your statement is different.' : undefined)}
                  error={showLoanErrors ? loanErrors[i]?.emi : null}
                  info={
                    <>
                      The <strong>contractual monthly amount</strong> the bank auto-debits, not what you pay when you overpay.
                      Anything above it goes in Activity as an extra payment, or the plan sends it as spare cash.<br /><br />
                      For credit cards: your usual payment, or <strong>0</strong> if you only ever pay the minimum.
                    </>
                  }
                />
                {l.loan_type === 'credit_card' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <MinPaymentExplainer
                      loan={l}
                      country={country}
                      onOverrideChange={(v) =>
                        updateLoan(i, { min_payment_override: v })
                      }
                    />
                  </div>
                )}
                {loanMarket(l, country) === 'US' && <UsLoanFields loan={l} onChange={(p) => updateLoan(i, p)} />}
                <div style={{ gridColumn: '1 / -1' }}>
                  <button
                    type="button"
                    data-testid="loan-more-options"
                    aria-expanded={!!moreOpen[i]}
                    onClick={() => setMoreOpen((cur) => ({ ...cur, [i]: !cur[i] }))}
                    style={{ fontFamily: 'inherit', fontSize: 12, letterSpacing: '0.08em', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--muted)' }}
                  >
                    {moreOpen[i] ? '− More options' : '+ More options'}
                  </button>
                </div>
                {moreOpen[i] && <>
                {l.rate_type === 'floating' && (
                  <>
                    <Select
                      label="Bank's reset frequency"
                      findIt={findFor(l, country, 'resetFrequency')}
                      value={String(l.rate_reset_frequency_months ?? '')}
                      onChange={(v) =>
                        updateLoan(i, {
                          rate_reset_frequency_months:
                            v === '' ? undefined : Number(v),
                        })
                      }
                      options={
                        country === 'IN'
                          ? [
                              { value: '', label: 'Not sure' },
                              { value: '1', label: 'Every month' },
                              { value: '3', label: 'Every three months (most repo-linked loans)' },
                              { value: '6', label: 'Every six months (MCLR)' },
                              { value: '12', label: 'Every year (MCLR)' },
                            ]
                          : [
                              { value: '', label: 'Not sure' },
                              { value: '1', label: 'Every month (HELOC, card)' },
                              { value: '6', label: 'Every six months' },
                              { value: '12', label: 'Every year (most adjustable mortgages)' },
                            ]
                      }
                      info={
                        <>
                          <strong>How often the bank re-prices this loan.</strong>{' '}
                          {country === 'IN'
                            ? 'Bank home loans since October 2019 are mostly linked to the repo rate and reset at least every three months; older MCLR loans every six or twelve. The bank applies the new rate itself.'
                            : 'An adjustable mortgage adjusts on its schedule after the fixed period, usually yearly; a HELOC follows the prime rate monthly.'}{' '}
                          Your loan letter&apos;s reset clause says which.
                          <br />
                          <br />
                          The plan keeps today&apos;s rate either way, unless
                          you set an expected change below. Then a change
                          reaches this loan at its resets (not sure: taken as{' '}
                          {loanMarket(l, country) === 'IN' ? 'every three months' : 'yearly'}).
                        </>
                      }
                    />
                    <Field
                      label="Next reset (optional)"
                      findIt={findFor(l, country, 'nextReset')}
                      kind="date"
                      value={l.next_reset_date?.length === 7 ? `${l.next_reset_date}-01` : (l.next_reset_date ?? '')}
                      onChange={(v) =>
                        updateLoan(i, { next_reset_date: v || undefined })
                      }
                      hint="Plan shows a reset within three months, and the next RBI or Fed decision's effect from it."
                    />
                    <Field
                      label="Expected rate change a year (%)"
                      kind="percent"
                      value={l.rate_drift_annualized ?? ''}
                      onChange={(v) =>
                        updateLoan(i, { rate_drift_annualized: v })
                      }
                      error={assumptionError('rateDrift', l.rate_drift_annualized)}
                      placeholder="0"
                      hint="0.5 = rates up half a point a year; -0.5 = cuts"
                      info={
                        <>
                          Your view of where the benchmark rate is going.
                          The simulator bumps this loan&apos;s rate by{' '}
                          <em>drift × (reset_freq / 12)</em> at each scheduled
                          reset.
                          <br />
                          <br />
                          Example: +0.005 with a 12-month reset adds 50bps
                          per reset; with a 1-month reset adds ~4bps per
                          month. Compounds across resets.
                          <br />
                          <br />
                          Default 0 (no drift) — flat-rate floating
                          baseline. Reasonable starter values are RBI repo
                          neutral so 0; if you have a strong view, ±0.005
                          to ±0.015 is the typical range.
                        </>
                      }
                    />
                  </>
                )}
                {l.loan_type !== 'credit_card' && (
                  <>
                <Field
                  label="Prepayment fee (%, optional)"
                  findIt={findFor(l, country, 'prepayFee')}
                  kind="percent"
                  value={l.prepayment_penalty_pct ?? ''}
                  onChange={(v) =>
                    updateLoan(i, { prepayment_penalty_pct: v })
                  }
                  error={assumptionError('fee', l.prepayment_penalty_pct)}
                  placeholder={feeShown(l, country).placeholder}
                  hint={feeShown(l, country).hint}
                  suggestion={
                    // A bank's curated fee is only offered where no rule
                    // fixes it (roadmap PR K): never on a floating-rate
                    // Indian loan, where RBI bars the fee.
                    feeShown(l, country).status === 'unknown' &&
                    loanSuggestions[i]?.prepayment_penalty_pct != null &&
                    Number(loanSuggestions[i]!.prepayment_penalty_pct) > 0
                      ? {
                          value: loanSuggestions[i]!.prepayment_penalty_pct!,
                          label: suggestionLabel(
                            `${l.bank || 'default'} ${l.rate_type || 'floating'}`,
                            `${(Number(loanSuggestions[i]!.prepayment_penalty_pct!) * 100).toFixed(1)}%`,
                            loanSuggestions[i]!,
                          ),
                        }
                      : undefined
                  }
                  info={
                    <>
                      What the bank charges on payments above the
                      schedule, as a % of the amount prepaid. Leave it
                      blank if you don&apos;t know. For a floating-rate
                      loan in India it is taken as 0%: RBI bars
                      prepayment charges on floating-rate loans to
                      individuals for non-business purposes ({RBI_PREPAYMENT_RULE}).
                      For a fixed-rate or US loan nothing is assumed; the
                      sanction letter or Key Facts Statement states it.
                    </>
                  }
                />
                <Field
                  label="Prepay lock-in left (months)"
                  findIt={findFor(l, country, 'lockIn')}
                  value={monthsText[`${l.id ?? i}:lock`] ?? String(l.prepay_lock_in_months ?? '')}
                  onChange={(v) => {
                    // R8-7: keep what's typed; store a number only when it's a whole one.
                    setMonthsText((m) => ({ ...m, [`${l.id ?? i}:lock`]: v }));
                    updateLoan(i, { prepay_lock_in_months: wholeMonthsValue(v, LOCK_IN_RANGE) });
                  }}
                  error={wholeMonthsError(monthsText[`${l.id ?? i}:lock`] ?? '', LOCK_IN_RANGE)}
                  placeholder="0"
                  hint="Months from now before the bank takes an extra payment; 0 if the lock-in is over (typically 6-12 from the loan's start)"
                  suggestion={
                    loanSuggestions[i]?.prepay_lock_in_months != null
                      ? {
                          value: String(loanSuggestions[i]!.prepay_lock_in_months),
                          label: suggestionLabel(
                            `${l.bank || 'default'} ${l.rate_type || 'floating'}`,
                            `${loanSuggestions[i]!.prepay_lock_in_months} months`,
                            loanSuggestions[i]!,
                          ),
                        }
                      : undefined
                  }
                  info={
                    <>
                      During the lock-in, the bank rejects any
                      above-minimum payment. Surplus that would have gone
                      here gets routed to the next-priority debt that
                      isn&apos;t locked. Most floating-rate retail loans
                      have no lock-in; fixed-rate often 6-12 months.
                    </>
                  }
                />
                <Field
                  label="How often you can prepay (every N months)"
                  value={monthsText[`${l.id ?? i}:freq`] ?? String(l.part_payment_freq_months ?? '')}
                  onChange={(v) => {
                    setMonthsText((m) => ({ ...m, [`${l.id ?? i}:freq`]: v }));
                    updateLoan(i, { part_payment_freq_months: wholeMonthsValue(v, PART_PAY_FREQ_RANGE) });
                  }}
                  error={wholeMonthsError(monthsText[`${l.id ?? i}:freq`] ?? '', PART_PAY_FREQ_RANGE)}
                  placeholder="(unlimited)"
                  hint="Minimum gap between extra payments — e.g. 12 = once a year"
                  suggestion={
                    loanSuggestions[i]?.part_payment_freq_months != null
                      ? {
                          value: String(loanSuggestions[i]!.part_payment_freq_months),
                          label: suggestionLabel(
                            `${l.bank || 'default'}`,
                            `every ${loanSuggestions[i]!.part_payment_freq_months} months`,
                            loanSuggestions[i]!,
                          ),
                        }
                      : undefined
                  }
                  info={
                    <>
                      Some banks restrict part-payments to once per
                      calendar year, or to once every N months. Leave blank
                      for &quot;as often as you want&quot;. When the gate
                      blocks a payment, surplus cascades to the next loan.
                    </>
                  }
                />
                  </>
                )}
                {moreOpen[i] && l.loan_type === 'home_loan' && (
                  <Field
                    label="Pre-EMI months remaining"
                    value={String(l.pre_emi_months_remaining ?? '')}
                    onChange={(v) =>
                      updateLoan(i, {
                        pre_emi_months_remaining:
                          v === '' ? undefined : Number(v),
                      })
                    }
                    placeholder="0"
                    hint="For under-construction property: months until full possession + EMI start"
                    info={
                      <>
                        During pre-EMI, the bank charges interest-only on
                        the disbursed amount (no principal repayment).
                        Once possession completes and full disbursal lands,
                        EMI kicks in. Set to the number of months remaining
                        in the pre-EMI window; default 0 for
                        already-possessed property.
                      </>
                    }
                  />
                )}
                <div style={{ gridColumn: '1 / -1' }}>{/* UI revert 2: a whole row, so later fields keep their column */}<LoanExtras loan={l} country={country} onPatch={(p) => updateLoan(i, p)} /></div>
                {l.loan_type === 'credit_card' && (
                  <Field
                    label="New spending you won't clear each month"
                    kind="money"
                    currency={loanCurrency(l, country)}
                    value={l.expected_monthly_spend ?? ''}
                    onChange={(v) =>
                      updateLoan(i, { expected_monthly_spend: v })
                    }
                    placeholder="0"
                    hint="0 if you pay each statement in full"
                    info={
                      <>
                        <strong>What this is.</strong> Only the slice of new
                        spend that will <em>revolve</em> — i.e. carry past the
                        statement due date and accrue interest. If you pay
                        the full bill on time, this is <strong>0</strong>;
                        the EMI/minimum-only crowd is who needs it non-zero.
                        <br />
                        <br />
                        <strong>How the projection works.</strong> Each
                        sim month:
                        <div style={{ marginTop: 4 }}>
                          <code>
                            outstanding[m] = outstanding[m−1] + spend × (1 −
                            payoff_pct) + interest
                          </code>
                        </div>
                        Here <em>payoff_pct</em> is the fraction of the
                        statement you typically clear (≈ 1.0 if you pay in
                        full). The field captures only the carried portion,
                        so the formula simplifies to:
                        <div style={{ marginTop: 4 }}>
                          <code>
                            outstanding[m] = outstanding[m−1] + spend +
                            interest
                          </code>
                        </div>
                        Engine path:{' '}
                        <code>engine/simulation.py:317-322</code> bumps
                        outstanding by this amount <strong>before</strong>{' '}
                        computing the minimum, so trajectory reflects real
                        behaviour, not the optimistic &quot;freeze the
                        card&quot; default.
                        <br />
                        <br />
                        <strong>Rule of thumb.</strong> If you have monthly
                        surplus &gt; statement, leave at <strong>0</strong> —
                        we&apos;ll model card paid in full. Otherwise enter
                        the chunk that genuinely rolls over.
                      </>
                    }
                  />
                )}
                {l.loan_type === 'credit_card' && (
                  <Field
                    label="Statement day (1-28, optional)"
                    findIt={findFor(l, country, 'statementDay')}
                    value={l.statement_day != null ? String(l.statement_day) : ''}
                    onChange={(v) => {
                      const n = Number(v);
                      updateLoan(i, {
                        statement_day:
                          v.trim() === '' || Number.isNaN(n) || n < 1 || n > 28
                            ? undefined
                            : n,
                      });
                    }}
                    placeholder="e.g. 5"
                    hint="The day of the month it's made"
                    info={
                      <>
                        The day each month your bank generates the bill for
                        this card. Used to frame the activity log around your
                        actual cycle (&quot;May 5 statement, due May 25&quot;)
                        instead of generic &quot;this month&quot;.
                        <br />
                        <br />
                        Doesn&apos;t change interest math — the engine still
                        accrues monthly. Optional; leave blank if you&apos;d
                        rather not specify.
                      </>
                    }
                  />
                )}
                {l.loan_type === 'credit_card' && (
                  <Field
                    label="Last 4 digits, only to tell two cards apart (optional)"
                    value={l.card_last_6 ?? ''}
                    onChange={(v) => {
                      const digits = v.replace(/\D/g, '').slice(0, 4); // UX fix 18: never more than 4
                      updateLoan(i, { card_last_6: digits || undefined });
                    }}
                    placeholder="e.g. 4657"
                    hint="Never needed for the plan, and never the card number"
                    info={
                      <>
                        Optional — purely a UI label. We mask the rest of the
                        number (xxxx xx{l.card_last_6 || '••'}) and never
                        display these digits anywhere outside your own
                        device. Skip if you&apos;d rather not.
                      </>
                    }
                  />
                )}
                {l.loan_type === 'credit_card' && (
                  <Field
                    label="Whose card, only to tell a joint card apart (optional)"
                    value={l.cardholder_name ?? ''}
                    onChange={(v) =>
                      updateLoan(i, { cardholder_name: v || undefined })
                    }
                    placeholder="e.g. Mine, or Asha’s add-on"
                    hint="Never needed for the plan"
                  />
                )}
                {l.loan_type === 'credit_card' && l.statement_day != null && (
                  <Field
                    label="Due day (1-28)"
                    findIt={findFor(l, country, 'dueDay')}
                    value={
                      l.due_day != null
                        ? String(l.due_day)
                        : String(
                            ((l.statement_day - 1 +
                              suggestedGraceDays(l.bank, country)) %
                              28) +
                              1,
                          )
                    }
                    onChange={(v) => {
                      const n = Number(v);
                      updateLoan(i, {
                        due_day:
                          v.trim() === '' || Number.isNaN(n) || n < 1 || n > 28
                            ? undefined
                            : n,
                      });
                    }}
                    placeholder={String(
                      ((l.statement_day - 1 +
                        suggestedGraceDays(l.bank, country)) %
                        28) +
                        1,
                    )}
                    hint={`Pre-filled from ${l.bank || 'country default'} (${suggestedGraceDays(l.bank, country)}-day grace) — override if your card differs`}
                    info={
                      <>
                        The day your payment is due each cycle. Indian banks
                        give 18-26 days grace from statement to due; US banks
                        21-25 days (CARD Act ≥21).
                        <br />
                        <br />
                        We pre-fill from a registry of typical grace periods
                        per bank. If your specific card differs (some premium
                        variants give longer), override here.
                      </>
                    }
                  />
                )}
                {l.loan_type !== 'credit_card' && (
                  <>
                <Field
                  label="Processing fee a year (%, optional)"
                  findIt={findFor(l, country, 'processingFee')}
                  kind="percent"
                  value={l.processing_fee_amortised ?? ''}
                  onChange={(v) => updateLoan(i, { processing_fee_amortised: v })}
                  error={assumptionError('fee', l.processing_fee_amortised)}
                  hint="Spread over the loan's life, e.g. 0.5"
                  info={
                    <>
                      One-time processing fee, amortised across the loan's
                      tenure. Personal loans typically <strong>1-2%</strong>{' '}
                      upfront; home loans <strong>0.25-0.50%</strong>; auto
                      loans <strong>0.5-1%</strong>.
                      <br />
                      <br />
                      Enter the <strong>annualised</strong> value. If your
                      personal loan charges 1.5% upfront on a 3-year tenure,
                      that's 0.5%/yr → enter <strong>0.5</strong>.
                      <br />
                      <br />
                      Leave blank for credit cards (annual fee separately).
                    </>
                  }
                />
                <Field
                  label="Insurance premium a year (%, optional)"
                  findIt={findFor(l, country, 'insurance')}
                  kind="percent"
                  value={l.insurance_premium_pct ?? ''}
                  onChange={(v) => updateLoan(i, { insurance_premium_pct: v })}
                  error={assumptionError('fee', l.insurance_premium_pct)}
                  hint="e.g. 0.1; leave blank if none"
                  info={
                    <>
                      Some lenders bundle loan-protection insurance (technically
                      optional but often pushed). Enter the yearly premium as a percent of the loan.
                      Leave blank if you declined or weren't offered insurance.
                    </>
                  }
                />
                  </>
                )}
                </>}
                <div style={{ gridColumn: '1 / -1' }}>
                  <EffectiveAprBreakdown
                    loan={l}
                    marginalTaxRate={marginalRate || '0.30'}
                    country={country}
                    taxRegime={country === 'IN' ? taxRegime : undefined}
                    incomeType={incomeType}
                  />
                </div>
                {loans.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLoan(i)}
                    style={{
                      gridColumn: '1 / -1',
                      padding: '6px 10px',
                      fontSize: 12,
                      background: 'transparent',
                      color: 'var(--negative)',
                      border: '1px solid var(--negative)',
                      borderRadius: 4,
                      cursor: 'pointer',
                      justifySelf: 'end',
                    }}
                  >
                    Remove this loan
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addLoan}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              + Add another loan
            </button>
            {foreignCcys.map((c) => {
              const q = fxQuotes[c];
              const quoted = q && typeof q === 'object' ? q : null;
              return (
                <Field
                  key={c}
                  label={`Exchange rate: 1 ${c} in ${userCcy}`}
                  value={fxRates[c] ?? ''}
                  onChange={(v) => setFxRates((cur) => ({ ...cur, [c]: v }))}
                  placeholder={q === 'loading' ? 'Fetching today’s rate…' : c === 'INR' ? 'e.g. 0.012' : 'e.g. 83'}
                  hint={
                    `${fxPerDollar(c as CurrencyCode, userCcy as CurrencyCode, Number(fxRates[c])) ? `That is ${fxPerDollar(c as CurrencyCode, userCcy as CurrencyCode, Number(fxRates[c]))}. ` : ''}${quoted
                      ? `Today's rate${quoted.as_of ? ` (${quoted.as_of})` : ''}. Change it if your bank uses a different one.`
                      : `Your ${c} loans are added to your ${userCcy} budget at this rate.`}`
                  }
                  error={showLoanErrors || q === 'failed' ? fxErrors[c] : null}
                />
              );
            })}
            {showLoanErrors && !loansComplete && (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--negative)' }}>
                Fill in the fields marked above so the plan can work out your
                payments.
                {loanErrors.some((e) => Object.keys(e).length > 0) &&
                  ' Without a rate or EMI it would treat the loan as interest-free or never paid down.'}
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div id="pf-banks" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <BankCombobox
                  label="Primary bank"
                  value={primaryBank}
                  onChange={setPrimaryBank}
                  country={country}
                  info={
                    <>
                      Your salary account. <strong>Doesn't affect the math</strong> —
                      used by Spare cash to suggest a sweep or liquid fund at the
                      bank you already use.
                    </>
                  }
                />
                <div style={{ gridColumn: '1 / -1' }}>
                  <OtherBanksField
                    country={country}
                    primaryBank={primaryBank}
                    value={otherBanks}
                    onAdd={(name) => {
                      const trimmed = name.trim();
                      if (!trimmed) return;
                      if (trimmed === primaryBank) return;
                      if (otherBanks.includes(trimmed)) return;
                      setOtherBanks([...otherBanks, trimmed]);
                      setNewOtherBank('');
                    }}
                    onRemove={(name) =>
                      setOtherBanks(otherBanks.filter((b) => b !== name))
                    }
                    draft={newOtherBank}
                    onDraftChange={setNewOtherBank}
                  />
                </div>
            </div>
            {cashAccounts.length === 0 && (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
                <Field
                  label="Total savings balance"
                  kind="money"
                  currency={userCcy}
                  value={savingsBalance}
                  onChange={setSavingsBalance}
                  hint="Excludes locked retirement accounts"
                  info={
                    <>
                      Liquid funds you can access within a few days — savings
                      accounts, FDs, liquid mutual funds.{' '}
                      <strong>Excludes</strong> EPF, NPS, 401(k), PPF, and other
                      locked instruments.
                    </>
                  }
                />
                <div style={{ alignSelf: 'end', paddingBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setCashAccounts([
                        {
                          name: country === 'IN' ? 'Primary savings' : 'Checking',
                          balance: savingsBalance,
                          apy: '',
                          kind: country === 'IN' ? 'savings' : 'checking',
                        },
                      ])
                    }
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--accent)',
                      fontSize: 12,
                      cursor: 'pointer',
                      padding: '6px 10px',
                      borderRadius: 6,
                    }}
                  >
                    + Split by account (recommended)
                  </button>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Tracking each account with its APY lets the advisor compare
                    idle cash against debt payoff (e.g. 0.01% checking vs 24%
                    card).
                  </div>
                </div>
              </div>
            )}

            {cashAccounts.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  <strong style={{ color: 'var(--ink)' }}>Cash accounts.</strong>{' '}
                  Each one — checking, savings, HYSA, FD. APY can be 0 if you
                  don't know it; you can update later.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {cashAccounts.map((acct, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 1fr 0.8fr 1fr auto',
                        gap: 8,
                        alignItems: 'end',
                      }}
                    >
                      <Field
                        label="Account name"
                        value={acct.name}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) => (i === idx ? { ...a, name: v } : a)),
                          )
                        }
                        hint={idx === 0 ? 'e.g. Chase Checking, Ally HYSA' : undefined}
                      />
                      <Field
                        label={`Balance (${country === 'IN' ? '₹' : '$'})`}
                        kind="money"
                        currency={userCcy}
                        value={acct.balance}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) => (i === idx ? { ...a, balance: v } : a)),
                          )
                        }
                      />
                      <Field
                        label="APY (%)"
                        value={acct.apy === '' ? '' : String(Number(acct.apy) * 100)}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) =>
                              i === idx
                                ? {
                                    ...a,
                                    apy:
                                      v.trim() === ''
                                        ? ''
                                        : String(Number(v) / 100),
                                  }
                                : a,
                            ),
                          )
                        }
                        hint={idx === 0 ? 'e.g. 4.5' : undefined}
                      />
                      <Select
                        label="Kind"
                        value={acct.kind}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) =>
                              i === idx
                                ? { ...a, kind: v as typeof acct.kind }
                                : a,
                            ),
                          )
                        }
                        options={[
                          { value: 'checking', label: 'Checking' },
                          { value: 'savings', label: 'Savings' },
                          { value: 'hysa', label: 'HYSA' },
                          { value: 'fd', label: 'FD' },
                          { value: 'other', label: 'Other' },
                        ]}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCashAccounts((cur) => cur.filter((_, i) => i !== idx))
                        }
                        aria-label="Remove account"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          color: 'var(--muted-ink)',
                          padding: '6px 10px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          height: 38,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCashAccounts((cur) => [
                      ...cur,
                      { name: '', balance: '', apy: '', kind: 'savings' },
                    ])
                  }
                  style={{
                    marginTop: 10,
                    background: 'transparent',
                    border: '1px dashed var(--border)',
                    color: 'var(--accent)',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '6px 10px',
                    borderRadius: 6,
                  }}
                >
                  + Add another account
                </button>
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Total optimizable (excluding checking):{' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    {formatCurrency(
                      String(
                        cashAccounts
                          .filter((a) => a.kind !== 'checking')
                          .reduce((s, a) => s + Number(a.balance || 0), 0),
                      ),
                      country === 'IN' ? 'INR' : 'USD',
                    )}
                  </strong>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
              <Field
                label="Emergency fund — current"
                kind="money"
                currency={userCcy}
                value={efundBalance}
                onChange={setEfundBalance}
                info={
                  <>
                    The portion of your savings earmarked for emergencies.
                    <div style={{ marginTop: 6 }}>
                      <strong>Liquidity rule:</strong> only count money you can
                      withdraw the same day without breaking — savings account,
                      sweep deposit, or a liquid mutual fund. Lock-in FDs,
                      equity, gold, and bonds <em>do not</em> belong here even
                      if you mentally label them as "backup". Park them as
                      holdings under What you own; the engine will treat
                      them as idle yield candidates instead.
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Why it matters: in an emergency you need cash in hours,
                      not days. Anything illiquid forces you to sell at the
                      worst possible moment or take a fresh loan — the exact
                      situation EF is meant to prevent.
                    </div>
                  </>
                }
              />
              <Field
                label="Emergency fund — target"
                kind="money"
                currency={userCcy}
                value={efundTarget}
                onChange={setEfundTarget}
                hint="Pick a tier below, or enter your own number"
                info={
                  <>
                    The "Lean / Standard / Conservative" buttons below set this
                    to 3 / 6 / 9 months of your stated expenses respectively.
                    /plan diverts your chosen share (30% unless you move the slider on Plan) of each month's surplus into EF top-up
                    until this target is met — debt-free is pushed out a bit
                    in exchange for a real safety net.
                    <div style={{ marginTop: 6 }}>
                      The target counts only liquid balances (savings / sweep /
                      liquid fund). Any illiquid wealth — FDs, equity, gold,
                      property — is tracked separately and doesn't reduce this
                      gap, even if you'd <em>technically</em> tap it in an
                      emergency.
                    </div>
                  </>
                }
              />
            </div>

            <EfLiquidityWarning
              efundBalance={efundBalance}
              cashAccounts={cashAccounts}
              currency={country === 'IN' ? 'INR' : 'USD'}
            />

            <EfTierPicker
              monthlyExpenses={fixedExpenses}
              variableExpenses={variableExpenses}
              efundBalance={efundBalance}
              currency={country === 'IN' ? 'INR' : 'USD'}
              currentTarget={efundTarget}
              onPick={(t) => setEfundTarget(t)}
              monthlyIncome={monthlyIncome}
              loans={loans}
              country={country}
              fxRates={fxRates}
              ownMonths={ownEfMonths}
            />
            <div id="pf-credit" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
              <Field
                label="Current credit score (optional)"
                findIt={whereToFind('creditScore', { country })}
                value={creditScore}
                onChange={setCreditScore}
                // R8-8: the same check as New debt (R7-6).
                error={creditScoreError(creditScore, country)}
                hint={
                  country === 'IN'
                    ? 'CIBIL/Experian — 300 to 900'
                    : 'FICO/VantageScore — 300 to 850'
                }
                info={
                  country === 'IN' ? (
                    <>
                      <strong>India:</strong> CIBIL or Experian, range 300-900.
                      Used to judge which cheaper-rate offers a lender would
                      likely give you, and to flag which actions might affect
                      your score. Skip if you don&apos;t know it.
                    </>
                  ) : (
                    <>
                      <strong>US:</strong> FICO or VantageScore, range 300-850.
                      Used to judge which cheaper-rate offers a lender would
                      likely give you, and to flag which actions might affect
                      your score. Skip if you don&apos;t know it.
                    </>
                  )
                }
              />
              <div className="muted" style={{ fontSize: 12, alignSelf: 'end' }}>
                Cheaper rates on Home use it to leave out offers lenders seldom give at your score. Skip if you don&apos;t know it.
              </div>
            </div>
          </div>
        )}

        {pendingCountry && (
          <p role="alert" style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--negative)' }}>
            Confirm or cancel the country change above before saving.
          </p>
        )}
        {tabGuard.ui}
        {saveBlocked && (
          <p role="alert" style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--negative)' }}>
            {saveBlocked}
          </p>
        )}
        {saveFailed && (
          <p role="alert" style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--negative)' }}>
            Your profile wasn&apos;t saved: this browser didn&apos;t keep it. Check
            that cookies are allowed for this site and try again. Nothing you
            entered here is lost while this page stays open.
          </p>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap-reverse',
            marginTop: 20,
            gap: 12,
          }}
        >
          <LBracket onClick={() => onDone(false)}>CANCEL</LBracket>
          <span style={{ opacity: canAdvance ? 1 : 0.4 }}>
            <LButton onClick={canAdvance ? save : () => setSaveBlocked(
              step === 1 ? 'Not saved yet: choose a country, and confirm or cancel a country change first.'
                : step === 2 ? 'Not saved yet: take-home pay must be more than 0, and spending 0 or more.'
                  : step === 4 ? 'Not saved yet: savings must be 0 or more.'
                    : 'Not saved yet: check the fields above.',
            )}>SAVE CHANGES</LButton>
          </span>
        </div>
        </>)}
      </Card>
    </div>
    </LShell>
  );
}

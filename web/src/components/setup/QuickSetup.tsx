'use client';

/**
 * First-run setup in three steps (REDESIGN R1): you and your money, what you
 * owe, and the plan those numbers give — about a dozen typed values for a
 * person with two loans. Everything else (gross pay, deductions, savings,
 * card dates, fees, holdings) lives in Profile, and is kept untouched when a
 * saved profile is edited here.
 */
import { carryPlanInputs, rateRiseOptions, type RateRiseMode } from '@/lib/plan-inputs';
import { LIKELY_HOW, LIKELY_LABEL, SAME_AS_LIKELY_NOTE, WORST_CASE_LABEL, likelySaving, likelySavingText } from '@/lib/savings-baseline';
import { track } from '@/lib/funnel';
import { engineRequests, isAbortError, PREVIEW_DEBOUNCE_MS } from '@/lib/engine-requests';
import { INFLATION_FORECAST } from '@/lib/inflation-modeling';
import { SAFE_RATES } from '@/lib/invest-vs-prepay';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import { BankCombobox, Field, Select } from '@/components/ToolPrimitives';
import {
  L_MONO,
  L_T,
  LBracket,
  LButton,
  LChip as Chip,
  LChipRow as ChipRow,
  LSectionHeader,
  LShell,
  lStrip,
} from '@/components/ledger/primitives';
import { api, formatCurrencyWhole } from '@/lib/api';
import { FX_WAIT_LABEL, fxGate } from '@/lib/fx-gate';
import { defaultDriftForLoanCurrency, readFxDriftClient } from '@/lib/fx-drift';
import { UsStudentChips } from '@/components/setup/UsStudentChips';
import type {
  Country,
  FxRateResponse,
  IncomeType,
  LoanPayload,
  LoanType,
  SimulateArgs,
  SimulateResponse,
  UserPayload,
} from '@/lib/api';
import { BALANCES_ENTERED_KEY } from '@/lib/activity';
import { parseAmountText, sameAmount } from '@/lib/amount';
import { fxPerDollar, loanCurrency, userDefaultCurrency, type CurrencyCode } from '@/lib/currency';
import { whereToFind, type FindKey } from '@/lib/where-to-find';
import { deriveTenureMonths } from '@/lib/derived';
import { HORIZON_MONTHS } from '@/lib/horizon';
import { emiBelowInterest, formatAsOfDate, loanDraftErrors, loanRateOutOfRange, needsEmi, rateSanityNote, setupLoanName, setupSummaryLine, slowPayoffNote } from '@/lib/loan-gaps';
import { newLoanId } from '@/lib/loan-ids';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { feeShown } from '@/lib/prepayment-fee';
import { readEfSplitClient, writeEfSplitClient } from '@/lib/ef-split';
import { SetupChoices } from '@/components/setup/SetupChoices';
import { InsightsPanel } from '@/components/insights/InsightsPanel';
import { orderChoice, type PlanInsights } from '@/lib/insights';
import { SetupImportCard } from '@/components/setup/SetupImportCard';
import { applyChoices, choicesFrom, missingChoices, startingChoices, type SetupChoices as Choices } from '@/lib/setup-choices';
import { emiFromMonths, setupMarginalRate } from '@/lib/quick-setup';
import { TaxBasicsRows } from './TaxBasics';
import { applyTaxBasics, takeHomeWords, taxBasicsGap, taxBasicsOf, type TaxBasics } from '@/lib/tax-setup';
const SetupThisMonth = dynamic(() => import('./SetupThisMonth').then((m) => m.SetupThisMonth)); // r3e: route budget (shown with the plan preview)
import { typicalRate, TYPICAL_RATE_AS_OF, withEstimate } from '@/lib/setup-estimates';
import { EstimateBalance } from './EstimateBalance';
import { RepaymentChips } from './RepaymentChips';
import dynamic from 'next/dynamic';
// Status / salary / house-use extras load after the form (route budget, round 3).
const LoanExtras = dynamic(() => import('./LoanExtras').then((m) => m.LoanExtras));
import { PromoFields } from './PromoFields';
import { JointShare } from './JointShare';
import { jointForEngine } from '@/lib/joint-share';
import { promoError } from '@/lib/promo-rate';
import { emiOptional, finishShape, moratoriumMonths, payingNow, savedEndMonth, shapeError, shapeNeedsEmi, typeSwitch } from '@/lib/repayment-shape';
import { readStrategyClient, strategyName, STRATEGY_SHORT, writeStrategyClient, type StrategyName } from '@/lib/strategy';
import { FY_ANCHOR_MONTH, MONTH_NAMES, getCountryMonth, getCountryToday, localIsoDate, monthIndexToCountryLabel, monthsSpan } from '@/lib/today';
import { loadProfileClient, type StoredProfile } from '@/lib/user-store';
import { asksEmiPaid, emiAnswer, emiAnswerPatch, lastEmiMonthIndex, nextMonth, rollBalancesForward, stampBalanceDates, prepareLoanPaymentTiming } from '@/lib/roll-forward';
import { saveProfileWithPaidEmis } from '@/lib/paid-at-entry';
import { disambiguateLoans } from '@/lib/loan-types';
import { balancePlaceholder, emiPlaceholder } from '@/lib/placeholders';
import { PRIVACY_PROMISE } from '@/components/PrivacyPromise';
import { HYDRATED_EVENT, flushPendingState, signedInAccount } from '@/lib/server-sync';
import { ONBOARDING_DONE_HREF } from '@/lib/onboarding-save';
import { LAST_SEEN_KEY } from '@/lib/guest-return';
import { cappedRow, saneCap, shortGapLine, shownDebtFreeMonth } from '@/lib/plan-gap';
import { loanKindsFor, paymentWords } from '@/lib/r7-inputs';
import { formatTaxRate } from '@/lib/tax-profile';
import { checkSpend, dropDraft, parseDraft, readDraftText, serializeDraft, SETUP_DRAFT_KEY, SETUP_EDIT_DRAFT_MAX_AGE_MS, SPEND_COPY, stepFromParam, urlWithStep } from '@/lib/setup-draft';
import { dateProfileRates } from '@/lib/fx-refresh';
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

const STEPS = ['You and your money', 'What you owe', 'Your plan'] as const;

const TYPE_CHIPS: Array<[LoanType, string]> = [
  ['credit_card', 'Card'], ['personal_loan', 'Personal'], ['home_loan', 'Home'], ['home_topup', 'Home top-up'],
  ['loan_against_property', 'Against property'], ['auto_loan', 'Car'], ['two_wheeler_loan', 'Two-wheeler'],
  ['education_loan', 'Education'], ['gold_loan', 'Gold'], ['medical_loan', 'Medical'], ['bnpl', 'Pay later'],
];

type Issues = Partial<Record<'balance' | 'rate' | 'emi' | 'months' | 'fee' | 'paid' | 'end', string>>;

/** Per-loan form state that isn't part of the saved loan. */
interface LoanUi {
  /** Months left typed instead of the EMI; the EMI is worked out. */
  byMonths: boolean;
  months: string;
  more: boolean;
  /** "I don't know the balance": work it out from what was borrowed. */
  estOpen?: boolean;
  estAmount?: string;
  estStart?: string;
  estTerm?: string;
  estError?: string | null;
  /** The rate box holds text that isn't a number ("8.5x"); the loan gets ''. */
  rateUnreadable?: boolean;
  /** UX2-3: 'YYYY-MM' an interest-only or bullet loan ends (lib/repayment-shape). */
  endMonth?: string;
}

type FxQuote = FxRateResponse | 'loading' | 'failed';

interface Preview {
  plan: SimulateResponse;
  minimums: SimulateResponse;
  /** B4/A22: the same total, smallest first: what they'd likely do without RightDue. */
  likely: SimulateResponse | null;
  loans: LoanPayload[];
  /** What the engine ran on (R10-4: Home's whole-rupee split reads it). */
  planUser: UserPayload;
  /** The run itself, for the plan-insight cards (audit 80+ A1/A2/A5/A6). */
  simArgs: SimulateArgs;
}

/** What Setup keeps in localStorage between Back, Forward, reload and visits (B-10, UX2-6). */
interface DraftState {
  country?: Country;
  isNriUs?: boolean;
  incomeType?: IncomeType;
  takeHome?: string;
  spend?: string;
  zeroSpendOk?: boolean;
  loans?: LoanPayload[];
  ui?: Record<string, LoanUi>;
  fxRates?: Record<string, string>;
  choices?: Choices;
  tb?: TaxBasics;
}

function readDraft(editing: boolean) {
  try {
    const d = parseDraft<DraftState>(readDraftText(), Date.now(), editing ? SETUP_EDIT_DRAFT_MAX_AGE_MS : undefined);
    if (!d) dropDraft();
    return d;
  } catch {
    return null;
  }
}

function blankLoan(): LoanPayload {
  return {
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
  };
}

const num = (v: string | undefined, fallback = '0') => ((v ?? '').trim() === '' ? fallback : v!.trim());
const isAmount = (v: string) => v.trim() === '' || /^\d*\.?\d+$/.test(v.trim());
const NO_PAY_HINT = 'No pay coming in right now? 0 is fine: the plan shows which payments to protect first, and what to say to lenders.';

export function QuickSetup() {
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<StoredProfile | null>(null);
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const [country, setCountry] = useState<Country>('IN');
  const [isNriUs, setIsNriUs] = useState(false);
  const [countryNote, setCountryNote] = useState<string | null>(null);
  const [incomeType, setIncomeType] = useState<IncomeType>('salaried');
  const [tb, setTb] = useState<TaxBasics>({}); // round 3: tax questions (lib/tax-setup)
  const [takeHome, setTakeHome] = useState('');
  const [spend, setSpend] = useState('');
  const [spendAtStart, setSpendAtStart] = useState('');
  // UX50 B-28: the loan just removed, while it can be brought back.
  const [removed, setRemoved] = useState<{ loan: LoanPayload; index: number; name: string } | null>(null);
  const undoTimer = useRef<number | null>(null);
  // UX50 B-35: a typed ₹0 is used only once confirmed.
  const [zeroSpendOk, setZeroSpendOk] = useState(false);

  const [loans, setLoans] = useState<LoanPayload[]>([blankLoan()]);
  const [ui, setUi] = useState<Record<string, LoanUi>>({});
  const [fxRates, setFxRates] = useState<Record<string, string>>({});
  const [fxQuotes, setFxQuotes] = useState<Record<string, FxQuote>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  // Choices only the person can make (lib/setup-choices, grill #22).
  const [choices, setChoices] = useState<Choices>(startingChoices({ efMonths: null, efSplit: null, strategy: null }));
  const [choiceErrors, setChoiceErrors] = useState(false);
  // Audit 80+ A2: whether the payoff order changes anything for these loans.
  const [orderInfo, setOrderInfo] = useState<ReturnType<typeof orderChoice> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const stepRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const edited = useRef(false);

  // Start from the saved profile when there is one (browser-only).
  useEffect(() => {
    function restore() {
      if (edited.current) return;
      const stored = loadProfileClient();
      if (stored.isLive) {
        // Ids from the start, so each loan can be matched to its saved self.
        const loansWithIds = stored.user.loans.map((l) => ({ ...l, id: l.id ?? newLoanId() }));
        const u = { ...stored.user, loans: loansWithIds };
        setSaved({ ...stored, user: u });
        setCountry(u.country);
        setIsNriUs(!!u.is_nri_us);
        setIncomeType(u.income_type);
        setTb(taxBasicsOf(u));
        setTakeHome(u.monthly_income ?? '');
        const s = new Decimal(num(u.fixed_expenses)).add(num(u.variable_expenses)).toString();
        setSpend(s);
        setSpendAtStart(s);
        // From Plan's "+ LOAN" (?step=loans): straight to the loans, with a
        // blank one to fill in.
        const addOne = new URLSearchParams(window.location.search).get('step') === 'loans';
        setLoans(addOne ? [...loansWithIds, blankLoan()] : loansWithIds.length > 0 ? loansWithIds : [blankLoan()]);
        if (addOne) setStep(1);
        setFxRates(u.fx_to_user_currency ?? {});
        setChoices(startingChoices(choicesFrom(u, readEfSplitClient(), readStrategyClient())));
      }
      // UX50 B-10: what was typed in this tab before a Back, Forward or
      // reload comes back, on the step the URL names.
      const draft = readDraft(stored.isLive);
      const urlStep = stepFromParam(new URLSearchParams(window.location.search).get('step'));
      if (draft) {
        const d = draft.state;
        if (d.country) setCountry(d.country);
        setIsNriUs(!!d.isNriUs);
        if (d.incomeType) setIncomeType(d.incomeType);
        if (d.tb) setTb(d.tb);
        setTakeHome(d.takeHome ?? '');
        setSpend(d.spend ?? '');
        setZeroSpendOk(!!d.zeroSpendOk);
        if (Array.isArray(d.loans)) setLoans(d.loans.length > 0 || draft.step === 2 ? d.loans : [blankLoan()]);
        setUi(d.ui ?? {});
        setFxRates(d.fxRates ?? {});
        if (d.choices) setChoices(startingChoices(d.choices));
        setStep(Math.min(urlStep ?? draft.step, draft.step));
      }
      setReady(true);
    }
    restore();
    window.addEventListener(HYDRATED_EVENT, restore);
    return () => window.removeEventListener(HYDRATED_EVENT, restore);
  }, []);

  // UX50 B-10 / UX2-6: keep the draft in this browser while it is being typed.
  const draftOn = useRef(true);
  useEffect(() => {
    if (!ready || !edited.current || !draftOn.current) return;
    try {
      const state: DraftState = { country, isNriUs, incomeType, tb, takeHome, spend, zeroSpendOk, loans, ui, fxRates, choices };
      window.localStorage.setItem(SETUP_DRAFT_KEY, serializeDraft(state, step, Date.now()));
    } catch {
      /* private mode or full: Back still works within the page */
    }
  }, [ready, country, isNriUs, incomeType, tb, takeHome, spend, zeroSpendOk, loans, ui, fxRates, choices, step]);
  // Back and Forward move between the steps instead of leaving Setup.
  const goToRef = useRef<(n: number, fromHistory?: boolean) => void>(() => {});
  useEffect(() => {
    function onPop() {
      const n = stepFromParam(new URLSearchParams(window.location.search).get('step'));
      goToRef.current(n ?? 0, true);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Move focus to the new step's heading so keyboard and screen-reader
  // users start at the top of it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const prev = saved?.isLive ? saved.user : null;
  const userCcy = userDefaultCurrency(country);
  const fromStreams = !!prev && (prev.income_streams?.length ?? 0) > 0;
  const income = fromStreams ? num(prev!.monthly_income) : takeHome;
  const uiOf = (id: string | undefined): LoanUi => ui[id ?? ''] ?? { byMonths: false, months: '', more: false };
  const setUiOf = (id: string | undefined, patch: Partial<LoanUi>) =>
    setUi((cur) => ({ ...cur, [id ?? '']: { ...uiOf(id), ...patch } }));
  const patchLoan = (i: number, patch: Partial<LoanPayload>) =>
    setLoans((cur) => cur.map((l, j) => (j === i ? patchLoanKeepingRateType(l, patch, country) : l)));

  // ── Step 1 checks ──
  const incomeOk = income.trim() !== '' && isAmount(income); // UX2-2: 0 is a real answer (job loss, student)
  const spendCheck = checkSpend(spend, zeroSpendOk);
  const spendOk = spendCheck === 'ok';
  const step1Ok = incomeOk && spendOk && !taxBasicsGap(country, tb);
  const leftBeforeEmis =
    incomeOk && spendOk ? new Decimal(income).sub(num(spend)) : null;

  // ── Step 2: each loan as it will be saved, and what's missing ──
  function emiOf(l: LoanPayload): string {
    const u = uiOf(l.id);
    if (needsEmi(l.loan_type) && !shapeNeedsEmi(l, endOf(l))) return finishShape(l, endOf(l), thisMonth, loanCurrency(l, country)).scheduled_emi ?? '';
    if (!needsEmi(l.loan_type) || !u.byMonths) return l.scheduled_emi;
    return emiFromMonths(l.outstanding, l.nominal_rate, Number(u.months), loanCurrency(l, country)) ?? '';
  }
  // This month, by name, for "has its EMI gone out?".
  const thisMonth = localIsoDate(getCountryToday(country)).slice(0, 7);
  const thisMonthName = MONTH_NAMES[Number(thisMonth.slice(5, 7)) - 1];
  const nextMonthName = MONTH_NAMES[Number(nextMonth(thisMonth).slice(5, 7)) - 1];
  // A loan whose balance is new or changed is asked whether this month's
  // EMI is already off it (lib/roll-forward); one left as saved isn't.
  const endOf = (l: LoanPayload) => uiOf(l.id).endMonth ?? savedEndMonth(l, thisMonth);
  const askPaid = (l: LoanPayload) =>
    needsEmi(l.loan_type) && asksEmiPaid(l, prev?.loans.find((p) => p.id === l.id));
  function issuesOf(l: LoanPayload): Issues {
    const u = uiOf(l.id);
    const out: Issues = {};
    const eg = loanCurrency(l, country) === 'INR' ? '25,00,000 or 25L' : '250,000 or 250k';
    if (!isAmount(l.outstanding)) out.balance = `Type a number, like ${eg}.`;
    const fee = (l.prepayment_penalty_pct ?? '').trim();
    if (fee && !(/^\d*\.?\d+$/.test(fee) && Number(fee) < 1)) out.fee = 'Enter the fee as a percent, e.g. 2, or leave it blank.';
    if (Number(l.outstanding) <= 0) return out;
    if (askPaid(l) && emiAnswer(l, thisMonth) === undefined) {
      out.paid = emiPaidError(thisMonthName);
    }
    const draft = loanDraftErrors({ ...l, scheduled_emi: emiOf(l), currency: loanCurrency(l, country) as 'INR' | 'USD' }, country);
    if (draft.rate) out.rate = draft.rate;
    // Live re-test 3 R3-4: unreadable rate text is not a blank rate.
    if (u.rateUnreadable && (l.nominal_rate ?? '').trim() === '') out.rate = 'unreadable';
    const shapeErr = shapeError(l, endOf(l), thisMonth) ?? promoError(l, thisMonth);
    if (shapeErr) out.end = shapeErr;
    if (needsEmi(l.loan_type) && shapeNeedsEmi(l, endOf(l))) {
      if (u.byMonths) {
        const m = Number(u.months);
        if (!(Number.isInteger(m) && m > 0 && m <= 600)) out.months = 'Enter the months left, 1 to 600 (on your statement or loan app).';
      } else if (!isAmount(l.scheduled_emi)) {
        out.emi = `Type a number, like ${eg}.`;
      } else if (draft.emi && !emiOptional(l, endOf(l))) {
        out.emi = draft.emi;
      }
    }
    return out;
  }
  // Live re-test 6B R6B-7: a rate out of range (−42, 4200) is marked as
  // soon as it's typed and left, not only after Continue.
  function rateRangeOnly(l: LoanPayload): Issues {
    const bad = loanRateOutOfRange(l.nominal_rate);
    return bad ? { rate: bad } : {};
  }
  const activeLoans = loans.filter((l) => Number(l.outstanding) > 0);
  const foreignCcys = Array.from(
    new Set(activeLoans.map((l) => loanCurrency(l, country)).filter((c) => c !== userCcy)),
  );
  // E6 (audit 80): a rate still being fetched is pending, not an error.
  const { pending: fxPending, errors: fxErrors } = fxGate(foreignCcys, fxRates, fxQuotes, userCcy);
  const loansOk = loans.every((l) => Object.keys(issuesOf(l)).length === 0);
  const step2Ok = loansOk && Object.keys(fxErrors).length === 0 && fxPending.length === 0;
  // Live re-test 2 R2-2: the summary names what's wrong. An EMI below the
  // month's interest isn't a missing number.
  // Live re-test 3 R3-4: a rate that can't be read (or is out of range) is
  // "not valid", not "missing"; only blank fields are missing numbers.
  const summaryFlags = loans.map((l) => {
    const issues = issuesOf(l);
    if (Object.keys(issues).length === 0) return { emiTooSmall: false, invalid: false, outOfRange: false, missing: false };
    const emiTooSmall = !!emiBelowInterest({ ...l, currency: loanCurrency(l, country) as 'INR' | 'USD' }, country);
    const invalid = (!!uiOf(l.id).rateUnreadable && (l.nominal_rate ?? '').trim() === '') || !!loanRateOutOfRange(l.nominal_rate);
    const others = Object.keys(issues).filter((k) => !(invalid && k === 'rate') && !(emiTooSmall && k === 'emi'));
    // UX50 B-36: an unanswered "has this month's EMI gone out?" is a
    // question, not a missing number.
    const numbers = others.filter((k) => k !== 'paid');
    const outOfRange = !!loanRateOutOfRange(l.nominal_rate) && Number.isFinite(Number(l.nominal_rate));
    return { emiTooSmall, invalid, outOfRange, missing: !emiTooSmall && numbers.length > 0, unanswered: others.includes('paid') };
  });
  const step2Summary = setupSummaryLine({
    emiTooSmall: summaryFlags.some((f) => f.emiTooSmall),
    invalid: summaryFlags.some((f) => f.invalid),
    outOfRange: summaryFlags.some((f) => f.invalid) && summaryFlags.filter((f) => f.invalid).every((f) => f.outOfRange),
    missing: summaryFlags.some((f) => f.missing),
    fx: Object.keys(fxErrors).length > 0,
    unanswered: summaryFlags.filter((f) => f.unanswered).length,
    monthName: thisMonthName,
  });

  // Today's rate for each foreign currency, once; the person can change it.
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

  // EMIs a month in the person's own currency (cards are left out: the
  // plan works out their minimums).
  const emisInUserCcy = activeLoans.reduce<Decimal | null>((sum, l) => {
    if (sum === null || !needsEmi(l.loan_type)) return sum;
    const ccy = loanCurrency(l, country);
    const emi = payingNow(l, endOf(l), ccy) ?? emiOf(l);
    if (!isAmount(emi) || emi.trim() === '') return sum;
    const rate = ccy === userCcy ? '1' : fxRates[ccy];
    if (!(Number(rate) > 0)) return null;
    return sum.add(new Decimal(emi).mul(rate));
  }, new Decimal(0));

  // ── The profile to save: the saved one, with what this page shows replaced ──
  function finishLoan(l: LoanPayload): LoanPayload {
    const u = uiOf(l.id);
    let emi = l.scheduled_emi;
    let tenure = l.tenure_months_remaining;
    if (l.loan_type === 'credit_card') {
      tenure = 0;
    } else if (u.byMonths) {
      emi = emiOf(l);
      tenure = Number(u.months);
    } else {
      // A saved loan whose balance, rate and EMI weren't touched keeps its
      // months left (Profile may hold a typed tenure that differs from
      // the worked-out one).
      const was = prev?.loans.find((p) => p.id === l.id);
      const untouched =
        !!was &&
        sameAmount(num(was.outstanding), num(l.outstanding)) &&
        sameAmount(num(was.nominal_rate), num(l.nominal_rate)) &&
        sameAmount(num(was.scheduled_emi), num(l.scheduled_emi));
      if (!untouched) tenure = deriveTenureMonths(l.outstanding, l.nominal_rate, l.scheduled_emi) ?? tenure;
    }
    const out: LoanPayload = {
      ...l,
      outstanding: num(l.outstanding),
      nominal_rate: num(l.nominal_rate),
      scheduled_emi: num(emi),
      tenure_months_remaining: tenure,
      processing_fee_amortised: num(l.processing_fee_amortised),
      insurance_premium_pct: num(l.insurance_premium_pct),
      expected_monthly_spend: l.loan_type === 'credit_card' ? num(l.expected_monthly_spend) : '0',
    };
    Object.assign(out, finishShape(out, endOf(l), thisMonth, loanCurrency(l, country)));
    if (out.currency === userCcy) delete out.currency;
    if (!(out.min_payment_override ?? '').trim()) delete out.min_payment_override;
    if (!(out.prepayment_penalty_pct ?? '').trim()) delete out.prepayment_penalty_pct;
    if (Number(out.nominal_rate) !== 0 || !(out.promo_until ?? '').trim()) { delete out.promo_until; delete out.rate_after_promo; }
    return out;
  }

  function buildUser(): UserPayload {
    const sameCountry = prev?.country === country;
    const keepSpend = !!prev && sameAmount(num(spend), num(spendAtStart));
    const finished = activeLoans.map(finishLoan);
    const defaults: Partial<UserPayload> = {
      savings_balance: '0',
      efund_balance: '0',
      efund_target: '0',
      annual_hike_rate: '0',
      location_tier: 'urban',
      investment_options: [
        {
          name: country === 'IN' ? 'Liquid fund' : 'HYSA',
          expected_return: country === 'IN' ? SAFE_RATES.liquid_in.rate : SAFE_RATES.hysa_us.rate,
          liquidity_class: 'liquid',
          is_in_pool: true,
        },
      ],
    };
    const base = prev ?? ({} as Partial<UserPayload>);
    const monthlySpend = Number(num(spend));
    return applyTaxBasics(applyChoices({
      ...defaults,
      ...base,
      ...(sameCountry
        ? {}
        : {
            inflation_rate: INFLATION_FORECAST[country].rate,
            hike_effective_month: FY_ANCHOR_MONTH[country],
            state_marginal_rate: undefined,
          }),
      country,
      income_type: incomeType,
      is_nri_us: country === 'US' && isNriUs,
      monthly_income: num(income),
      annual_income: fromStreams ? num(prev!.annual_income) : new Decimal(num(income)).mul(12).toString(),
      fixed_expenses: keepSpend ? num(prev!.fixed_expenses) : num(spend),
      variable_expenses: keepSpend ? num(prev!.variable_expenses) : '0',
      tax_regime: country === 'IN' ? (base.tax_regime ?? 'new') : undefined,
      filing_status: country === 'US' ? base.filing_status : undefined,
      primary_bank: base.primary_bank || finished.find((l) => l.bank)?.bank || '',
      loans: finished,
      fx_to_user_currency: Object.fromEntries(
        foreignCcys.filter((c) => Number(fxRates[c]) > 0).map((c) => [c, String(fxRates[c]).trim()]),
      ),
    } as UserPayload, choices, monthlySpend, localIsoDate(getCountryToday(country))), tb);
  }

  /** The saved rate when gross pay (or the same take-home) backs it; else an estimate. */
  function marginal(): { rate: string; estimated: boolean } {
    const hasGross =
      !!prev &&
      (Number(prev.annual_gross_salary) > 0 || Number(prev.annual_business_income) > 0 || fromStreams);
    const unchanged =
      !!prev && prev.country === country && prev.income_type === incomeType && JSON.stringify(taxBasicsOf(prev)) === JSON.stringify(taxBasicsOf(applyTaxBasics({ ...prev, country, income_type: incomeType }, tb))) &&
      (hasGross || sameAmount(num(prev.monthly_income), num(income)));
    if (saved && unchanged) return { rate: saved.marginalRate, estimated: false };
    return { rate: setupMarginalRate(income, country, incomeType, tb, prev ?? undefined).toFixed(4), estimated: true };
  }

  // ── Step 3: run the plan and the minimums-only plan ──
  const runKey = step === 2 ? JSON.stringify([buildUser(), marginal().rate, choices.strategy, choices.efSplit]) : '';
  useEffect(() => {
    if (!runKey) return;
    const [built, marginalRate, pickedStrategy, pickedSplit] = JSON.parse(runKey) as [UserPayload, string, Choices['strategy'], string | null];
    // As Plan will see them: dated today, with this month's EMI added back
    // where it has already gone out (lib/roll-forward).
    const asOf = localIsoDate(getCountryToday(built.country));
    const stamped = stampBalanceDates(built.loans, prev?.loans ?? [], asOf);
    const user: UserPayload = { ...built, loans: prepareLoanPaymentTiming(rollBalancesForward(stamped, asOf.slice(0, 7)).loans, asOf.slice(0, 7)).map(jointForEngine) };
    // NEW-19: the API doesn't read the setup's own record of what was
    // confirmed; left in, it would make every choice click look like a new
    // baseline request.
    const planUser: UserPayload = { ...user };
    delete planUser.assumptions;
    // R5-2: nor the moment each balance was typed (the API schema drops
    // it), which made every request look new to the de-dup and memory.
    planUser.loans = planUser.loans.map((l) => {
      const c = { ...l };
      delete c.balance_recorded_at;
      return c;
    });
    // E5: the same rupee slide Plan and Home apply (load-plan.ts), so step 3
    // shows the numbers they will.
    if (readFxDriftClient() === 'on') {
      const drift: Record<string, string> = {};
      for (const ccy of Object.keys(planUser.fx_to_user_currency ?? {})) {
        const r = defaultDriftForLoanCurrency(ccy, planUser.country);
        if (r !== '0') drift[ccy] = r;
      }
      if (Object.keys(drift).length > 0) planUser.fx_drift_annualized = drift;
    }
    let live = true;
    setPreview(null);
    setPreviewError(null);
    if (user.loans.length === 0) return;
    // NEW-19: wait until the choices stop changing, cancel what a newer
    // choice replaced, and reuse an identical run (the minimums-only
    // baseline doesn't depend on the strategy or the split, so a strategy
    // click doesn't re-run it).
    const controller = new AbortController();
    const simArgs = {
      user: planUser,
      strategy: pickedStrategy ?? readStrategyClient(),
      horizon_months: HORIZON_MONTHS,
      marginal_rate: marginalRate,
      simulation_start_month: getCountryMonth(user.country),
      // Plan's emergency-fund split, so the two show the same numbers.
      ef_top_up_rate:
        Number(user.efund_target ?? 0) > 0 && Number(user.efund_balance ?? 0) < Number(user.efund_target)
          ? (pickedSplit ?? readEfSplitClient())
          : undefined,
    };
    const baselineArgs = { user: planUser, horizon_months: HORIZON_MONTHS };
    const likelyArgs = { ...simArgs, strategy: 'snowball' as const };
    const timer = setTimeout(() => {
      Promise.all([
        engineRequests.run('simulate', simArgs, (signal) => api.simulate(simArgs, { signal }), controller.signal),
        engineRequests.run('baseline', baselineArgs, (signal) => api.baseline(baselineArgs, { signal }), controller.signal),
        // A failed likely-baseline run never blocks the preview: the row says "—".
        engineRequests
          .run('simulate', likelyArgs, (signal) => api.simulate(likelyArgs, { signal }), controller.signal)
          .catch((e) => {
            if (isAbortError(e)) throw e;
            return null;
          }),
      ])
        .then(([plan, minimums, likely]) => live && setPreview({ plan, minimums, likely, loans: disambiguateLoans(user.loans), planUser, simArgs }))
        .catch((e) => {
          if (!live || isAbortError(e)) return;
          setPreviewError("The plan couldn't be worked out just now. You can still save, and Home will try again.");
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  function goTo(next: number, fromHistory = false) {
    let to = next;
    let errors = false;
    if (next > 0 && !step1Ok) {
      to = 0;
      errors = true;
    } else if (next > 1 && !step2Ok) {
      to = 1;
      errors = true;
    }
    setShowErrors(errors);
    setStep(to);
    // UX50 B-10: one history entry per step, so Back goes to the step before.
    try {
      const href = urlWithStep(window.location.href, to);
      if (fromHistory || to !== next) window.history.replaceState(window.history.state, '', href);
      else if (to !== step) window.history.pushState(window.history.state, '', href);
    } catch {
      /* history unavailable: the buttons still work */
    }
  }
  goToRef.current = goTo;

  // E6: Continue tapped while today's rate is on its way waits for it, then
  // moves on (or shows the "couldn't be fetched" error if the fetch failed).
  const [continueQueued, setContinueQueued] = useState(false);
  const fxWaiting = fxPending.length > 0;
  useEffect(() => {
    if (continueQueued && !fxWaiting) {
      setContinueQueued(false);
      goToRef.current?.(2);
    }
  }, [continueQueued, fxWaiting]);
  function continueToPlan() {
    if (fxWaiting && loansOk && Object.keys(fxErrors).length === 0) {
      setContinueQueued(true);
      return;
    }
    goTo(2);
  }

  /** A country change never re-reads typed amounts in the new currency
   *  (live QA: ₹20 lakh became $2,000,000). Loans already entered keep
   *  their currency (tagged, so the loans step asks for a rate); take-home
   *  and spending are cleared so they're entered again in the new one. */
  function pickCountry(next: Country) {
    if (next === country) return;
    const from = userDefaultCurrency(country);
    const fromSym = from === 'INR' ? '₹' : '$';
    const nextSym = next === 'US' ? '$' : '₹';
    const hasLoans = loans.some((l) => Number(l.outstanding) > 0 && (l.currency ?? from) === from);
    const hasPay = Number(takeHome) > 0 || Number(spend) > 0;
    if (hasLoans) {
      setLoans((cur) => cur.map((l) => (Number(l.outstanding) > 0 && !l.currency ? { ...l, currency: from } : l)));
      if (next === 'US') setIsNriUs(true);
    }
    if (hasPay) {
      setTakeHome('');
      setSpend('');
    }
    setCountry(next);
    setCountryNote(
      hasLoans || hasPay
        ? [
            hasPay ? `Take-home and spending were cleared: enter them again in ${nextSym}.` : '',
            hasLoans ? `Loans you entered stay in ${fromSym}; you'll be asked for an exchange rate.` : '',
          ].filter(Boolean).join(' ')
        : null,
    );
  }

  function skipLoans() {
    setLoans([]);
    setShowErrors(false);
    setStep(2);
    try {
      window.history.pushState(window.history.state, '', urlWithStep(window.location.href, 2));
    } catch {
      /* history unavailable */
    }
  }

  async function save() {
    if (saving) return;
    if (missingChoices(choices, activeLoans.length > 0).length > 0) {
      setChoiceErrors(true);
      return;
    }
    // The order and the split live beside the profile (their own cookies
    // and synced slices); write the person's picks there too.
    if (choices.strategy) writeStrategyClient(choices.strategy);
    if (choices.efSplit) writeEfSplitClient(choices.efSplit);
    setSaving(true);
    setSaveFailed(false);
    const current = loadProfileClient();
    // Each exchange rate keeps the date of the quote it came from, so the
    // plan doesn't fetch it again the moment it opens.
    const quotes = Object.fromEntries(Object.entries(fxQuotes).filter((e): e is [string, FxRateResponse] => typeof e[1] === 'object'));
    // Round 2: what only Plan edits goes back unchanged (lib/plan-inputs).
    const built = dateProfileRates(carryPlanInputs(buildUser(), current.isLive ? current.user : null), current.isLive ? current.user : null, quotes, Date.now());
    // Date changed balances today; preserve the anchor when only other fields changed.
    const asOf = localIsoDate(getCountryToday(built.country));
    // Audit 80 E3: identical rows (three cards with no lender) get Card 1/2/3.
    const user = { ...built, loans: disambiguateLoans(stampBalanceDates(built.loans, current.user.loans, asOf)) };
    const ok = saveProfileWithPaidEmis({ ...current, user, marginalRate: marginal().rate }, asOf);
    if (!ok) {
      setSaving(false);
      setSaveFailed(true);
      return;
    }
    // UX50 B-02: this visit is on record, so Home doesn't greet a plan
    // made seconds ago with "Welcome back… is it yours?". The draft is done.
    // Guests only: signed in, Home never asks, and sign-out must leave this
    // browser empty (india/usa-journey "sign out clears this browser").
    draftOn.current = false;
    try {
      if (!signedInAccount()) window.localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
      dropDraft();
    } catch {
      /* private mode */
    }
    try {
      window.localStorage.setItem(BALANCES_ENTERED_KEY, localIsoDate(new Date()));
    } catch {
      /* private mode: the stale-card nudge falls back to activity only */
    }
    // Give the account copy a moment to reach the server (it stays queued
    // in this browser either way), then open the plan with a full
    // navigation. router.push('/') could replay a cached redirect back to
    // /onboarding from before the profile existed, so the button looked
    // dead and nothing said the save had worked (live QA, 7 Oct).
    setJustSaved(true);
    track('plan_saved', { country: built.country === 'US' ? 'US' : 'IN' }); // A15: a count, nothing else
    await Promise.race([flushPendingState().catch(() => false), new Promise((r) => setTimeout(r, 4000))]);
    window.location.assign(ONBOARDING_DONE_HREF);
  }

  if (!ready) {
    return (
      <LShell>
        <p style={{ color: L_T.muted }}>Loading your details…</p>
      </LShell>
    );
  }

  // Whole amounts, as on every other page.
  const money = (v: Decimal | string, ccy: CurrencyCode = userCcy) => formatCurrencyWhole(v, ccy);

  return (
    <LShell>
      <div onInputCapture={() => { edited.current = true; }} onClickCapture={() => { edited.current = true; }} style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
        <header>
          <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>
            SETUP · 3 STEPS · ABOUT 2 MINUTES
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>
            {prev ? 'Update your numbers' : 'Your loans, and a plan to clear them'}
          </h1>
          <p style={{ color: L_T.muted, margin: '8px 0 0', lineHeight: 1.6 }}>
            {prev ? (
              <>
                Savings, card dates, fees and everything else you entered stay as they are.{' '}
                <a href="/profile" style={{ color: L_T.accent }}>All details are in Profile →</a>
              </>
            ) : (
              // UX50 E-11: the notice at the time the figures are asked for (DPDP s.5).
              <>
                {/* Audit 80 B8: the one in-app wording (components/PrivacyPromise). */}
                {PRIVACY_PROMISE} You can change them any time in Profile.{' '}
                <a href="/privacy" style={{ color: L_T.accent }} data-testid="setup-privacy-line">Privacy notice →</a>
              </>
            )}
          </p>
        </header>

        <section ref={stepRef} tabIndex={-1} aria-label={STEPS[step]} style={{ outline: 'none' }}>
          <LSectionHeader step={step + 1} right={<StepStrip step={step} onGo={goTo} />}>
            {STEPS[step]}
          </LSectionHeader>

          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <TaxBasicsRows country={country} pickCountry={pickCountry} isNriUs={isNriUs} setIsNriUs={setIsNriUs} countryNote={countryNote}
                incomeType={incomeType} setIncomeType={setIncomeType} tb={tb} setTb={setTb} showErrors={showErrors} />
              <div style={grid2}>
                {fromStreams ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 'var(--fs-dense)', color: L_T.muted }}>Take-home a month</span>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{money(income)}</span>
                    <span style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>
                      From your income sources. <a href="/profile?step=income" style={{ color: L_T.accent }}>Change them in Profile</a>
                    </span>
                  </div>
                ) : (
                  <Field
                    label={takeHomeWords(incomeType, tb).label}
                    findIt={incomeType === 'salaried' ? whereToFind('takeHome', { country }) : null}
                    kind="money"
                    currency={userCcy}
                    value={takeHome}
                    onChange={setTakeHome}
                    placeholder={userCcy === 'INR' ? 'e.g. 65,000 or 65k' : 'e.g. 6,500'}
                    hint={takeHome.trim() !== '' && Number(takeHome) === 0 ? NO_PAY_HINT : takeHomeWords(incomeType, tb).hint}
                    error={showErrors && !incomeOk ? 'Enter what reaches your bank each month.' : null}
                  />
                )}
                <Field
                  label={`Spending a month, without ${paymentWords(country).many}`}
                  kind="money"
                  currency={userCcy}
                  value={spend}
                  onChange={setSpend}
                  placeholder={userCcy === 'INR' ? 'e.g. 30,000 or 30k' : 'e.g. 3,000'}
                  hint="Rent, bills, food, travel: everything but loan and card payments"
                  error={showErrors && (spendCheck === 'blank' || spendCheck === 'invalid') ? (spendCheck === 'blank' ? SPEND_COPY.blank : SPEND_COPY.invalid) : null}
                />
                {spendCheck === 'zero-unconfirmed' || (zeroSpendOk && checkSpend(spend, false) === 'zero-unconfirmed') ? (
                  <label data-testid="zero-spend-confirm" className="l-check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--fs-body)', lineHeight: 1.5, color: showErrors && !zeroSpendOk ? L_T.negative : L_T.ink }}>
                    <input type="checkbox" checked={zeroSpendOk} onChange={(e) => setZeroSpendOk(e.target.checked)} />
                    <span>{SPEND_COPY.zero(userCcy === 'INR' ? '₹' : '$')} {SPEND_COPY.zeroConfirm(userCcy === 'INR' ? '₹' : '$')}</span>
                  </label>
                ) : null}
              </div>
              {leftBeforeEmis && (
                <MoneyLine
                  label={`Left each month, before ${paymentWords(country).many}`}
                  value={money(leftBeforeEmis)}
                  tone={leftBeforeEmis.lt(0) ? 'negative' : 'ink'}
                />
              )}
              {/* Live re-test 6B: spending above take-home went through to step 3
                  with only a muted note; warn here, where both numbers are. */}
              {leftBeforeEmis && leftBeforeEmis.lt(0) && (
                <p
                  role="status"
                  data-testid="spend-over-income"
                  style={{ margin: 0, padding: '10px 12px', border: `1px solid ${L_T.negative}`, color: L_T.negative, fontSize: 'var(--fs-body)', lineHeight: 1.55 }}
                >
                  You spend {money(leftBeforeEmis.neg())} a month more than you take home, before any {paymentWords(country).one}. Check both
                  numbers. If they&apos;re right, the plan can&apos;t give a payoff date: it borrows the gap on a card
                  until spending or income changes.
                </p>
              )}
              <Actions>
                <LButton onClick={() => goTo(1)}>CONTINUE · WHAT YOU OWE</LButton>
              </Actions>
            </div>
          )}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <p style={{ color: L_T.muted, margin: '4px 0 6px', fontSize: 'var(--fs-dense)' }}>
                {country === 'US'
                  ? 'Keep your latest statements handy: each number below says where it is printed.'
                  : 'Keep your Key Facts Statement (KFS) or latest loan statement handy: each number below says where it is printed.'}{' '}
                Not sure of a number? Tap I DON&apos;T KNOW beside it for a marked estimate.
              </p>
              {country === 'IN' && (
                <SetupImportCard
                  loans={loans}
                  blankLoan={blankLoan}
                  todayIso={localIsoDate(getCountryToday(country))}
                  // An untouched blank block gives way to the imported loans (UX50 D-04).
                  onAdd={(added) => setLoans((cur) => [...cur.filter((l) => l.bank || Number(l.outstanding) > 0), ...added])}
                  onUpdate={(i, patch) => setLoans((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)))}
                />
              )}
              {!prev && (
                <p style={{ color: L_T.inkSoft, margin: '0 0 6px', fontSize: 'var(--fs-dense)' }}>
                  One loan is enough to start: you&apos;ll see your plan next, and can add the rest from Plan with + LOAN.
                </p>
              )}
              {loans.length === 0 && (
                <p style={{ color: L_T.muted, margin: '4px 0 14px' }}>No loans entered.</p>
              )}
              {loans.map((l, i) => (
                <LoanBlock
                  key={l.id ?? i}
                  index={i}
                  name={setupLoanName(loans, i)}
                  loan={l}
                  country={country}
                  showCurrency={(country === 'US' && isNriUs) || loanCurrency(l, country) !== userCcy}
                  ui={uiOf(l.id)}
                  issues={showErrors ? issuesOf(l) : rateRangeOnly(l)}
                  computedEmi={uiOf(l.id).byMonths ? emiOf(l) : ''}
                  askPaid={askPaid(l)}
                  monthName={thisMonthName}
                  nextMonthName={nextMonthName}
                  thisMonth={thisMonth}
                  onPatch={(p) => patchLoan(i, p)}
                  onUi={(p) => setUiOf(l.id, p)}
                  onRemove={() => {
                    // UX50 B-28: a filled loan can be brought back for a few seconds.
                    const filled = [l.outstanding, l.nominal_rate, l.scheduled_emi].some((v) => (v ?? '').trim() !== '');
                    if (filled) {
                      if (undoTimer.current) window.clearTimeout(undoTimer.current);
                      setRemoved({ loan: l, index: i, name: setupLoanName(loans, i) });
                      undoTimer.current = window.setTimeout(() => setRemoved(null), 8000);
                    }
                    setLoans((cur) => cur.filter((_, j) => j !== i));
                  }}
                />
              ))}
              {removed && (
                <p role="status" style={{ margin: '4px 0', fontSize: 'var(--fs-body)' }}>
                  {removed.name} removed.{' '}
                  <LBracket
                    onClick={() => {
                      const r = removed;
                      setLoans((cur) => [...cur.slice(0, r.index), r.loan, ...cur.slice(r.index)]);
                      setRemoved(null);
                    }}
                  >
                    UNDO
                  </LBracket>
                </p>
              )}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '12px 0' }}>
                <LBracket accent onClick={() => setLoans((cur) => [...cur, blankLoan()])}>
                  + ADD {loans.length === 0 ? 'A' : 'ANOTHER'} LOAN
                </LBracket>
                {activeLoans.length === 0 && (
                  <LBracket onClick={skipLoans}>NO LOANS · SKIP</LBracket>
                )}
              </div>

              {foreignCcys.map((c) => {
                const q = fxQuotes[c];
                const quote = q && q !== 'loading' && q !== 'failed' ? q : null;
                return (
                  <div key={c} style={{ maxWidth: 320, marginBottom: 14 }}>
                    <Field
                      label={`1 ${c} in ${userCcy}`}
                      value={fxRates[c] ?? ''}
                      onChange={(v) => setFxRates((cur) => ({ ...cur, [c]: v }))}
                      hint={
                        q === 'loading'
                          ? "Fetching today's rate…"
                          : `${fxPerDollar(c, userCcy, Number(fxRates[c])) ? `That is ${fxPerDollar(c, userCcy, Number(fxRates[c]))}. ` : ''}${quote
                            ? `Today's rate${quote.as_of ? `, ${quote.as_of}` : ''}. Change it to your bank's if you like.`
                            : 'The rate your bank converts at'}`
                      }
                      error={showErrors ? fxErrors[c] : null}
                    />
                  </div>
                );
              })}

              {emisInUserCcy && leftBeforeEmis && activeLoans.some((l) => needsEmi(l.loan_type)) && (
                <MoneyLine
                  label={`Left each month, after ${paymentWords(country).many}`}
                  value={money(leftBeforeEmis.sub(emisInUserCcy))}
                  tone={leftBeforeEmis.sub(emisInUserCcy).lt(0) ? 'negative' : 'ink'}
                  note={`${money(leftBeforeEmis)} − ${money(emisInUserCcy)} in ${paymentWords(country).many}${
                    activeLoans.some((l) => l.loan_type === 'credit_card') ? '; card minimums come out of this' : ''
                  }`}
                />
              )}
              {continueQueued && fxWaiting && (
                <p role="status" data-testid="fx-waiting" style={{ color: L_T.inkSoft, margin: '10px 0 0' }}>
                  Getting today&apos;s exchange rate. Your plan opens as soon as it arrives.
                </p>
              )}
              {showErrors && !step2Ok && !fxWaiting && (
                <p role="alert" style={{ color: L_T.negative, margin: '10px 0 0' }}>
                  {step2Summary}
                </p>
              )}
              <Actions back={<LBracket onClick={() => goTo(0)}>← BACK</LBracket>}>
                <LButton onClick={continueToPlan} disabled={continueQueued}>
                  {fxWaiting ? FX_WAIT_LABEL : 'CONTINUE · SEE YOUR PLAN'}
                </LButton>
              </Actions>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <PlanPreview
                onInsights={(i) => {
                  // A2: ask only when the orders differ; otherwise pick the cheapest.
                  const o = orderChoice(i ? i.order : undefined);
                  setOrderInfo(i ? o : null);
                  if (i && !o.ask && o.preselect) setChoices((c) => (c.strategy == null ? { ...c, strategy: o.preselect } : c));
                }}
                preview={preview}
                error={previewError}
                noLoans={activeLoans.length === 0}
                country={country}
                money={money}
                hasFund={Number(buildUser().efund_balance ?? 0) > 0}
              />
              <SetupChoices
                value={choices}
                onChange={(c) => {
                  setChoices(c);
                  setChoiceErrors(false);
                }}
                showErrors={choiceErrors}
                hasLoans={activeLoans.length > 0}
                orderInfo={orderInfo}
                monthlySpend={Number(num(spend))}
                money={(v) => money(v)}
              />
              <PlanFootnotes
                country={country} incomeType={incomeType}
                estimated={marginal().estimated}
                rate={marginal().rate}
                noLoans={activeLoans.length === 0}
                picked={choices.strategy}
              />
              {saveFailed && (
                <p role="alert" style={{ color: L_T.negative, margin: 0 }}>
                  This browser didn&apos;t keep your profile (cookies blocked, or it&apos;s too large). Allow cookies for this
                  site and try again.
                </p>
              )}
              {justSaved && (
                <p role="status" style={{ color: L_T.positive, margin: 0 }}>
                  Saved in this browser. Sending it to your account, then opening your plan (a slow connection can take several seconds)…
                </p>
              )}
              <Actions back={<LBracket onClick={() => goTo(1)}>← BACK</LBracket>}>
                <LButton onClick={save} disabled={saving}>{saving ? 'SAVING…' : 'SAVE · OPEN MY PLAN'}</LButton>
              </Actions>
            </div>
          )}
        </section>
      </div>
    </LShell>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

const grid2 = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: 14,
} as const;

/** The three steps as numbers beside the heading; the names are in the labels. */
function StepStrip({ step, onGo }: { step: number; onGo: (n: number) => void }) {
  return (
    <nav aria-label="Setup steps">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 10 }}>
        {STEPS.map((name, i) => {
          const here = i === step;
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={here ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${name}${i < step ? ', done' : ''}`}
                className="l-hit"
                style={{
                  fontFamily: L_MONO,
                  fontSize: 'var(--fs-label)',
                  letterSpacing: '0.08em',
                  background: 'none',
                  borderWidth: '0 0 2px',
                  borderStyle: 'solid',
                  borderColor: here ? L_T.accent : 'transparent',
                  padding: '0 4px 1px',
                  cursor: 'pointer',
                  color: here ? L_T.ink : i < step ? L_T.positive : L_T.muted,
                  fontWeight: here ? 700 : 500,
                }}
              >
                {i < step ? '✓' : ''}
                {String(i + 1).padStart(2, '0')}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MoneyLine({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone: 'ink' | 'negative';
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: L_T.paper,
        border: `1px solid ${L_T.ruleSoft}`,
        ...lStrip(tone === 'negative' ? 'negative' : 'accent'),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: L_T.muted }}>
          {label}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: tone === 'negative' ? L_T.negative : L_T.ink }}>
          {value}
        </span>
      </div>
      {note && <div style={{ fontSize: 'var(--fs-small)', color: tone === 'negative' ? L_T.negative : L_T.muted, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

function Actions({ back, children }: { back?: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: back ? 'space-between' : 'flex-end',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap-reverse',
        paddingTop: 14,
        marginTop: 6,
        borderTop: `1px dashed ${L_T.ruleSoft}`,
      }}
    >
      {back}
      {children}
    </div>
  );
}

function LoanBlock({
  index,
  name: nameProp,
  loan,
  country,
  showCurrency,
  ui,
  issues,
  computedEmi,
  askPaid,
  monthName,
  nextMonthName,
  thisMonth,
  onPatch,
  onUi,
  onRemove,
}: {
  index: number;
  /** Live re-test 2 NEW-23: the loan's header, by type and lender. */
  name?: string;
  loan: LoanPayload;
  country: Country;
  showCurrency: boolean;
  ui: LoanUi;
  issues: Issues;
  computedEmi: string;
  /** Ask whether this month's EMI is already off the balance. */
  askPaid: boolean;
  /** This month's name, e.g. "October". */
  monthName: string;
  nextMonthName: string;
  /** 'YYYY-MM'. */
  thisMonth: string;
  onPatch: (p: Partial<LoanPayload>) => void;
  onUi: (p: Partial<LoanUi>) => void;
  onRemove: () => void;
}) {
  const ccy = loanCurrency(loan, country);
  const card = loan.loan_type === 'credit_card';
  const end = ui.endMonth ?? savedEndMonth(loan, thisMonth);
  const tenure = !card && !ui.byMonths ? deriveTenureMonths(loan.outstanding, loan.nominal_rate, loan.scheduled_emi) : null;
  const emiTooSmall =
    !card && !ui.byMonths && Number(loan.outstanding) > 0 && Number(loan.scheduled_emi) > 0 &&
    Number(loan.nominal_rate) > 0 && tenure === null;
  // Live re-test 2 NEW-23: "Credit card", "HDFC car loan", not "LOAN 1".
  const name = nameProp ?? setupLoanName([loan], 0) ?? `Loan ${index + 1}`;
  const setCurrency = (c: CurrencyCode) => onPatch({ currency: c });
  const find = (key: FindKey) => whereToFind(key, { country: ccy === 'INR' ? 'IN' : 'US', loanType: loan.loan_type });
  const estimated = new Set(loan.estimated_fields ?? []);
  // A typical rate in the loan's own currency's market (rupee loans: India's banks).
  const typical = typicalRate(ccy === 'INR' ? 'IN' : 'US', loan.loan_type);
  return (
    <div
      role="group"
      aria-label={name}
      style={{ padding: '14px 0 16px', borderBottom: `1px dashed ${L_T.ruleSoft}`, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{name}</span>
        <LBracket onClick={onRemove}>REMOVE</LBracket>
      </div>
      <ChipRow label="Kind of loan">
        {/* R7-7: no gold loans on a US borrower's dollar loan (an Indian product). */}
        {loanKindsFor(TYPE_CHIPS, ccy === 'INR' ? 'IN' : country, loan.loan_type).map(([t, label]) => (
          <Chip key={t} on={loan.loan_type === t} onClick={() => onPatch(typeSwitch(loan, t, country))}>
            {label}
          </Chip>
        ))}
      </ChipRow>
      {showCurrency && (
        <ChipRow label="Currency of this loan">
          <Chip on={ccy === 'INR'} onClick={() => setCurrency('INR')}>₹ Rupees</Chip>
          <Chip on={ccy === 'USD'} onClick={() => setCurrency('USD')}>$ Dollars</Chip>
        </ChipRow>
      )}
      {loan.loan_type === 'education_loan' && ccy === 'USD' && (
        <UsStudentChips loan={loan} onPatch={onPatch} />
      )}
      <RepaymentChips loan={loan} country={country} endMonth={end} onPatch={onPatch} onEnd={(v) => onUi({ endMonth: v })} error={issues.end} money={(v) => formatCurrencyWhole(String(v), ccy)} />
      <div style={grid2}>
        <BankCombobox
          label={card ? 'Card from (optional)' : 'Lender (optional)'}
          value={loan.bank}
          onChange={(v) => onPatch({ bank: v })}
          country={ccy === 'INR' ? 'IN' : 'US'}
        />
        <Field
          label={card ? 'Balance on the card' : 'Balance left to repay'}
          findIt={find('balance')}
          kind="money"
          currency={ccy}
          value={loan.outstanding}
          placeholder={balancePlaceholder(loan.loan_type, ccy)}
          onChange={(v) => onPatch({ outstanding: v, estimated_fields: withEstimate(loan, 'balance', false).estimated_fields })}
          hint={estimated.has('balance') ? 'An estimate from what you borrowed. Replace it with your statement’s figure when you can.' : undefined}
          error={issues.balance}
        />
        <Field
          label={card ? 'Card APR, % a year' : 'Interest rate, % a year'}
          findIt={find('rate')}
          kind="percent"
          value={loan.nominal_rate}
          onChange={(v) => onPatch({ nominal_rate: v, estimated_fields: withEstimate(loan, 'rate', false).estimated_fields })}
          onUnreadable={(bad) => {
            if (bad !== !!ui.rateUnreadable) onUi({ rateUnreadable: bad });
          }}
          hint={rateSanityNote(loan.loan_type, loan.nominal_rate, country) ?? (
            estimated.has('rate')
              ? `Typical for this kind of loan: the middle of the published rates of the banks RightDue tracks, as of ${formatAsOfDate(TYPICAL_RATE_AS_OF)}. Yours may differ; your statement or loan app shows it.`
              : card
                ? 'A 3.5% monthly rate is 42% a year'
                : undefined)}
          error={issues.rate}
        />
        {!card && !ui.byMonths && shapeNeedsEmi(loan, end) && (
          <Field
            label={paymentWords(country).field}
            findIt={find('emi')}
            kind="money"
            currency={ccy}
            value={loan.scheduled_emi}
            placeholder={emiPlaceholder(loan.loan_type, ccy)}
            onChange={(v) => onPatch({ scheduled_emi: v })}
            hint={
              emiTooSmall
                ? issues.emi
                  ? undefined
                  : (emiBelowInterest({ ...loan, currency: ccy }, country) ?? `At this ${paymentWords(country).one} the balance doesn't go down. Check the ${paymentWords(country).one} and the rate.`)
                : tenure
                  ? `About ${tenure} months left, to ${monthIndexToCountryLabel(lastEmiMonthIndex(loan, tenure, thisMonth) + moratoriumMonths(loan, end, thisMonth), country)}${slowPayoffNote(loan, ccy, country, tenure)}`
                  : undefined
            }
            error={issues.emi}
          />
        )}
        {!card && ui.byMonths && shapeNeedsEmi(loan, end) && (
          <Field
            label="Months left"
            findIt={find('monthsLeft')}
            kind="integer"
            value={ui.months}
            onChange={(v) => onUi({ months: v })}
            hint={computedEmi ? `${paymentWords(country).field.replace(/ a month$/, '')} works out to ${formatCurrencyWhole(computedEmi, ccy)} a month` : `We work out the ${paymentWords(country).one}`}
            error={issues.months}
          />
        )}
      </div>
      <PromoFields loan={loan} onPatch={onPatch} error={issues.end} />
      <JointShare loan={loan} onPatch={onPatch} />
      <LoanExtras loan={loan} country={country === 'US' ? 'US' : 'IN'} onPatch={onPatch} />
      {askPaid && (
        <EmiPaidQuestion
          monthName={monthName}
          nextMonthName={nextMonthName}
          value={emiAnswer(loan, thisMonth)}
          onChange={(a) => onPatch(emiAnswerPatch(a, thisMonth))}
          error={issues.paid}
          word={paymentWords(country).one}
        />
      )}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {typical != null && (loan.nominal_rate.trim() === '' || estimated.has('rate')) && (
          <LBracket
            onClick={() =>
              onPatch({ nominal_rate: String(typical), estimated_fields: withEstimate(loan, 'rate', true).estimated_fields })
            }
          >
            I DON&apos;T KNOW THE RATE
          </LBracket>
        )}
        {!card && (
          <LBracket aria-expanded={!!ui.estOpen} onClick={() => onUi({ estOpen: !ui.estOpen, estError: null })}>
            {ui.estOpen ? '− I KNOW THE BALANCE' : 'I DON’T KNOW THE BALANCE'}
          </LBracket>
        )}
        {!card && shapeNeedsEmi(loan, end) && (
          <LBracket
            onClick={() => {
              // Keep the EMI worked out from the months, so switching back shows it.
              if (ui.byMonths && computedEmi) onPatch({ scheduled_emi: computedEmi });
              onUi({ byMonths: !ui.byMonths, months: ui.months || (loan.tenure_months_remaining > 0 ? String(loan.tenure_months_remaining) : '') });
            }}
          >
            {ui.byMonths ? `I KNOW THE ${paymentWords(country).upper} INSTEAD` : 'I KNOW THE MONTHS LEFT INSTEAD'}
          </LBracket>
        )}
        <button
          type="button"
          aria-expanded={ui.more}
          onClick={() => onUi({ more: !ui.more })}
          style={{ fontFamily: L_MONO, fontSize: 'var(--fs-label)', letterSpacing: '0.14em', color: L_T.muted, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <span aria-hidden="true">[</span>{ui.more ? '−' : '+'} MORE TERMS · OPTIONAL<span aria-hidden="true">]</span>
        </button>
      </div>
      {!card && ui.estOpen && (
        <EstimateBalance loan={loan} ui={ui} onUi={onUi} onPatch={onPatch} country={country} ccy={ccy} typical={typical} thisMonth={thisMonth} />
      )}
      {ui.more && (
        <div style={{ ...grid2, padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}` }}>
          {!showCurrency && (
            <Select<CurrencyCode>
              label="Currency"
              value={ccy}
              onChange={setCurrency}
              options={[
                { value: 'INR', label: '₹ Rupees' },
                { value: 'USD', label: '$ Dollars' },
              ]}
            />
          )}
          {!card && (
            <Select<RateType | 'unsure'>
              label="Fixed or floating rate"
              findIt={find('rateType')}
              value={rateTypeChoice(loan)}
              onChange={(v) => onPatch(applyRateTypeChoice(v, loan.loan_type, country, loan.currency))}
              options={[
                { value: 'unsure', label: `Not sure (taken as ${loan.rate_type_assumed === undefined ? loan.rate_type : likelyRateType(loan.loan_type, country, loan.currency)})` },
                { value: 'fixed', label: 'Fixed' },
                { value: 'floating', label: 'Floating' },
              ]}
              hint={
                rateTypeChoice(loan) === 'unsure'
                  ? `${assumedRateTypeNote(loan.loan_type, country, loan.currency)} ${HOW_TO_TELL}`
                  : HOW_TO_TELL
              }
            />
          )}
          {!card && loan.rate_type === 'floating' && (
            <Select<'' | RateRiseMode>
              label="If the rate rises"
              value={loan.on_rate_rise ?? ''}
              onChange={(v) => onPatch({ on_rate_rise: v === '' ? undefined : v })}
              options={rateRiseOptions(loan, country)}
              hint="Your choice at each reset (RBI, 18 Aug 2023). Change it any time on Plan, with your lender's maximum tenure."
            />
          )}
          {!card && (
            <Field
              label="Prepayment fee, % (optional)"
              findIt={find('prepayFee')}
              kind="percent"
              value={loan.prepayment_penalty_pct ?? ''}
              onChange={(v) => onPatch({ prepayment_penalty_pct: v })}
              placeholder={feeShown(loan, country).placeholder}
              hint={feeShown(loan, country).hint}
              error={issues.fee}
            />
          )}
          {!card && (
            <Field
              label="Lock-in, months"
              findIt={find('lockIn')}
              kind="integer"
              value={loan.prepay_lock_in_months ? String(loan.prepay_lock_in_months) : ''}
              onChange={(v) => onPatch({ prepay_lock_in_months: Number(v) > 0 ? Math.floor(Number(v)) : undefined })}
              hint="Months before extra payments are allowed"
            />
          )}
          {card && (
            <Field
              label="New spending a month on this card"
              kind="money"
              currency={ccy}
              value={loan.expected_monthly_spend ?? ''}
              onChange={(v) => onPatch({ expected_monthly_spend: v })}
              hint="Blank if you've stopped using it"
            />
          )}
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 'var(--fs-small)', color: L_T.muted }}>
            Fees, rate resets, card dates and the rest are in Profile.
          </p>
        </div>
      )}
    </div>
  );
}

/** UX50 B-19: a slow first answer (the calculator waking up) says so. */
function PreviewWaiting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div role="status" style={{ color: L_T.muted, margin: 0, lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>Working out your plan…</p>
      {slow && (
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-body)' }}>
          Still working: the calculator wakes up after a quiet spell, which can take up to a minute. You can save
          now; Plan finishes it.
        </p>
      )}
    </div>
  );
}

function PlanPreview({
  preview,
  error,
  noLoans,
  country,
  money,
  hasFund = false,
  onInsights,
}: {
  onInsights?: (i: PlanInsights | null) => void;
  preview: Preview | null;
  error: string | null;
  noLoans: boolean;
  country: Country;
  money: (v: Decimal | string, ccy?: CurrencyCode) => string;
  /** Savings set aside: a short month draws on them before a card (UX50 B-32). */
  hasFund?: boolean;
}) {
  if (noLoans) {
    return (
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        No loans, so nothing to clear. Home will show your monthly cash flow, and Goals &amp; Tools can plan a
        purchase or check a loan offer. You can add a loan any time in Profile.
      </p>
    );
  }
  if (error) return <p role="alert" style={{ color: L_T.negative, margin: 0 }}>{error}</p>;
  if (!preview) return <PreviewWaiting />;
  const { plan, minimums, likely, loans, planUser } = preview;
  const shortfall = new Decimal(plan.shortfall || 0);
  // Month m of the plan is the m-th payment, as Home and Plan count it.
  const freeIn = (m: number) => (m <= 1 ? 'this month' : `in ${monthsSpan(m)}`);
  const interestSaved = new Decimal(minimums.total_interest_paid || 0).sub(plan.total_interest_paid || 0);
  const monthsSaved =
    shownDebtFreeMonth(plan) != null && minimums.debt_free_month != null
      ? minimums.debt_free_month - plan.debt_free_month!
      : null;
  // UX50 B-13: short, Plan's and Home's headline (date if the gap closes, date as things stand) and no
  // "years sooner" with no date to measure from. Phase 5 (C11): capped has no date either (reads as short).
  const capped = cappedRow(plan, (m) => monthIndexToCountryLabel(m, country), (v) => money(new Decimal(v)));
  const short = shortfall.gt(0) || plan.infeasible_from_month != null;
  const closedMonth = plan.gap_closed?.debt_free_month ?? null;
  // Live re-test 7 R7-2: the words come from the one helper Plan and Home use.
  const debtFreeRow: [string, ReactNode, string?] = capped ? ['Debt-free', ...capped] : short
    ? [
        'Debt-free',
        // Audit 80+ A5: the gap is the headline (and the card above); the date
        // it would take to close it is demoted to the note.
        `${money(shortfall)}/mo short`,
        shortGapLine({
          shortfall: shortfall.toNumber(),
          asIsMonth: plan.debt_free_month ?? null,
          closedMonth,
          infeasibleFrom: plan.infeasible_from_month ?? null,
          label: (m) => monthIndexToCountryLabel(m, country),
          money: (v) => money(new Decimal(v)),
        }) ?? '',
      ]
    : [
        'Debt-free',
        plan.debt_free_month != null ? monthIndexToCountryLabel(plan.debt_free_month, country) : 'Not in sight',
        plan.debt_free_month != null ? freeIn(plan.debt_free_month) : 'Payments don’t cover the interest yet',
      ];
  // Live re-test 6B R6B-1: the same branch as Plan's TOTAL INTEREST. Short
  // with no date as things stand, the gap borrowing compounds for decades
  // (crore-scale totals on a ₹-lakh debt), and with no date at all a total
  // above 100x what's owed today means nothing: say so instead of a figure.
  const owedToday = loans.reduce((t, l) => t + Math.max(0, Number(l.outstanding) || 0), 0);
  const gapRunsAway = short && shownDebtFreeMonth(plan) == null;
  const insane = !Number.isFinite(Number(plan.total_interest_paid)) || Number(plan.total_interest_paid) > saneCap(owedToday);
  const interestRow: [string, ReactNode, string?] = gapRunsAway
    ? ['Interest you’ll pay', '—', 'the gap borrowing keeps growing']
    : plan.debt_free_month == null && insane
      ? ['Interest you’ll pay', '—', 'doesn’t clear at these figures']
      : ['Interest you’ll pay', money(plan.total_interest_paid), 'over the whole plan'];
  // Audit 80 B4/A22/E4: the headline saving is against what they'd likely
  // do without RightDue (lib/savings-baseline), the same baseline as the
  // landing page. Paying only the minimums is the worst case, in an expander.
  const likelyS = likely
    ? likelySaving(
        { debtFreeMonth: plan.debt_free_month ?? null, totalInterest: plan.total_interest_paid },
        { debtFreeMonth: likely.debt_free_month ?? null, totalInterest: likely.total_interest_paid },
      )
    : null;
  const rows: Array<[string, ReactNode, string?]> = [
    debtFreeRow,
    interestRow,
    short
      ? [LIKELY_LABEL, '—', 'needs a payoff date first']
      : [LIKELY_LABEL, likelySavingText(likelyS, (v) => money(String(v))), likelyS?.same ? SAME_AS_LIKELY_NOTE : LIKELY_HOW],
  ];
  const worstCase = short
    ? null
    : minimums.debt_free_month == null
      ? 'Paying only the minimums never clears these loans.'
      : `Paying only the minimums would cost ${interestSaved.gt(0) ? `${money(interestSaved)} more interest` : 'about the same interest'}${monthsSaved && monthsSaved > 0 ? ` and take ${monthsSpan(monthsSaved)} longer` : ''}. That is the most any plan could save, not a typical saving.`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* UX walkthrough fix 1/11: what to do this month first, then the date;
          the insight cards (the A6 card-to-loan move among them) come after. */}
      <SetupThisMonth plan={plan} minimums={minimums} planUser={planUser} loans={loans} country={country} money={money} />
      {shortfall.gt(0) && (
        <p role="alert" style={{ margin: 0, padding: '10px 12px', border: `1px solid ${L_T.negative}`, color: L_T.negative, lineHeight: 1.55 }}>
          Your take-home is {money(shortfall)} a month short of spending plus minimum payments. The date below is
          if you close that gap. As things stand, the plan {hasFund ? 'pays the gap from your emergency fund, then ' : ''}borrows it
          on a card at card rates until it&apos;s repaid; Home shows which payments to protect.
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ position: 'absolute', left: -9999 }}>Your plan</caption>
        <tbody>
          {rows.map(([k, v, note]) => (
            <tr key={k} style={{ borderBottom: `1px dashed ${L_T.ruleSoft}` }}>
              <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: L_T.muted, padding: '10px 0', fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {k}
              </th>
              <td style={{ textAlign: 'right', padding: '10px 0' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{v}</div>
                {note && <div style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>{note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {worstCase && (
        <details data-testid="setup-worst-case" style={{ fontSize: 'var(--fs-dense)', color: L_T.muted }}>
          <summary style={{ cursor: 'pointer' }}>{WORST_CASE_LABEL}</summary>
          <p style={{ margin: '6px 0 0', lineHeight: 1.55 }}>{worstCase}</p>
        </details>
      )}
      <InsightsPanel
        runArgs={{ ...preview.simArgs, strategy: undefined }}
        variant="setup"
        closedDebtFreeMonth={closedMonth}
        capped={plan.infeasible_from_month != null}
        onInsights={onInsights}
      />
    </div>
  );
}

function PlanFootnotes({
  country, incomeType = 'salaried',
  estimated,
  rate,
  noLoans,
  picked,
}: {
  country: Country; incomeType?: string;
  estimated: boolean;
  rate: string;
  noLoans: boolean;
  /** The order the person picked above; the saved one until they do. */
  picked: StrategyName | null;
}) {
  const strategy = picked ?? readStrategyClient();
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: L_T.muted, fontSize: 'var(--fs-small)', lineHeight: 1.7 }}>
      {!noLoans && (
        <li>
          Order: <strong style={{ color: L_T.ink }}>{strategyName(strategy)}</strong>. {STRATEGY_SHORT[strategy]} Switch
          it at the top of any page.
        </li>
      )}
      <li>
        {/* R6B-5: one decimal, as Profile, Tax and Invest-or-prepay show it (31.2%, not 31%). */}
        Tax bracket {formatTaxRate(rate)}
        {estimated
          ? `, estimated from take-home. Add your gross ${incomeType !== 'salaried' ? (country === 'IN' ? 'yearly business income (from your ITR)' : 'yearly business income (Schedule C)') : country === 'IN' ? 'salary (Form 16)' : 'pay (W-2)'} in Profile to make it exact.`
          : ', from your profile.'}
      </li>
    </ul>
  );
}

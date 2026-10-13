'use client';

/**
 * First-run setup in three steps (REDESIGN R1): you and your money, what you
 * owe, and the plan those numbers give — about a dozen typed values for a
 * person with two loans. Everything else (gross pay, deductions, savings,
 * card dates, fees, holdings) lives in Profile, and is kept untouched when a
 * saved profile is edited here.
 */
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
import type {
  Country,
  FxRateResponse,
  IncomeType,
  LoanPayload,
  LoanType,
  SimulateResponse,
  UserPayload,
} from '@/lib/api';
import { BALANCES_ENTERED_KEY } from '@/lib/activity';
import { parseAmountText, sameAmount } from '@/lib/amount';
import { loanCurrency, userDefaultCurrency, type CurrencyCode } from '@/lib/currency';
import { whereToFind, type FindKey } from '@/lib/where-to-find';
import { deriveTenureMonths } from '@/lib/derived';
import { HORIZON_MONTHS } from '@/lib/horizon';
import { emiBelowInterest, loanDraftErrors, needsEmi } from '@/lib/loan-gaps';
import { newLoanId } from '@/lib/loan-ids';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { feeShown } from '@/lib/prepayment-fee';
import { readEfSplitClient, writeEfSplitClient } from '@/lib/ef-split';
import { SetupChoices } from '@/components/setup/SetupChoices';
import { applyChoices, choicesFrom, missingChoices, type SetupChoices as Choices } from '@/lib/setup-choices';
import { emiFromMonths, firstExtraPayment, marginalRateFromTakeHome } from '@/lib/quick-setup';
import { estimateBalance, monthsSince, typicalRate, TYPICAL_RATE_AS_OF, withEstimate } from '@/lib/setup-estimates';
import { readStrategyClient, strategyName, STRATEGY_SHORT, writeStrategyClient, type StrategyName } from '@/lib/strategy';
import { FY_ANCHOR_MONTH, MONTH_NAMES, getCountryMonth, getCountryToday, localIsoDate, monthIndexToCountryLabel, monthsSpan } from '@/lib/today';
import { loadProfileClient, type StoredProfile } from '@/lib/user-store';
import { asksEmiPaid, emiAnswer, emiAnswerPatch, nextMonth, rollBalancesForward, stampBalanceDates, prepareLoanPaymentTiming } from '@/lib/roll-forward';
import { saveProfileWithPaidEmis } from '@/lib/paid-at-entry';
import { HYDRATED_EVENT, flushPendingState } from '@/lib/server-sync';
import { ONBOARDING_DONE_HREF } from '@/lib/onboarding-save';
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
  ['credit_card', 'Card'],
  ['personal_loan', 'Personal'],
  ['home_loan', 'Home'],
  ['auto_loan', 'Car'],
  ['education_loan', 'Education'],
  ['gold_loan', 'Gold'],
  ['bnpl', 'Pay later'],
];

type Issues = Partial<Record<'balance' | 'rate' | 'emi' | 'months' | 'fee' | 'paid', string>>;

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
}

type FxQuote = FxRateResponse | 'loading' | 'failed';

interface Preview {
  plan: SimulateResponse;
  minimums: SimulateResponse;
  loans: LoanPayload[];
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
  const [takeHome, setTakeHome] = useState('');
  const [spend, setSpend] = useState('');
  const [spendAtStart, setSpendAtStart] = useState('');

  const [loans, setLoans] = useState<LoanPayload[]>([blankLoan()]);
  const [ui, setUi] = useState<Record<string, LoanUi>>({});
  const [fxRates, setFxRates] = useState<Record<string, string>>({});
  const [fxQuotes, setFxQuotes] = useState<Record<string, FxQuote>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  // Choices only the person can make (lib/setup-choices, grill #22).
  const [choices, setChoices] = useState<Choices>({ efMonths: null, efSplit: null, strategy: null });
  const [choiceErrors, setChoiceErrors] = useState(false);
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
        setChoices(choicesFrom(u, readEfSplitClient(), readStrategyClient()));
      }
      setReady(true);
    }
    restore();
    window.addEventListener(HYDRATED_EVENT, restore);
    return () => window.removeEventListener(HYDRATED_EVENT, restore);
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
  const incomeOk = Number(income) > 0 && isAmount(income);
  const spendOk = isAmount(spend);
  const step1Ok = incomeOk && spendOk;
  const leftBeforeEmis =
    incomeOk && spendOk ? new Decimal(income).sub(num(spend)) : null;

  // ── Step 2: each loan as it will be saved, and what's missing ──
  function emiOf(l: LoanPayload): string {
    const u = uiOf(l.id);
    if (!needsEmi(l.loan_type) || !u.byMonths) return l.scheduled_emi;
    return emiFromMonths(l.outstanding, l.nominal_rate, Number(u.months), loanCurrency(l, country)) ?? '';
  }
  // This month, by name, for "has its EMI gone out?".
  const thisMonth = localIsoDate(getCountryToday(country)).slice(0, 7);
  const thisMonthName = MONTH_NAMES[Number(thisMonth.slice(5, 7)) - 1];
  const nextMonthName = MONTH_NAMES[Number(nextMonth(thisMonth).slice(5, 7)) - 1];
  // A loan whose balance is new or changed is asked whether this month's
  // EMI is already off it (lib/roll-forward); one left as saved isn't.
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
    const draft = loanDraftErrors({ ...l, scheduled_emi: emiOf(l) });
    if (draft.rate) out.rate = draft.rate;
    if (needsEmi(l.loan_type)) {
      if (u.byMonths) {
        const m = Number(u.months);
        if (!(Number.isInteger(m) && m > 0 && m <= 600)) out.months = 'Enter the months left, 1 to 600 (on your statement or loan app).';
      } else if (!isAmount(l.scheduled_emi)) {
        out.emi = `Type a number, like ${eg}.`;
      } else if (draft.emi) {
        out.emi = draft.emi;
      }
    }
    return out;
  }
  const activeLoans = loans.filter((l) => Number(l.outstanding) > 0);
  const foreignCcys = Array.from(
    new Set(activeLoans.map((l) => loanCurrency(l, country)).filter((c) => c !== userCcy)),
  );
  const fxErrors: Record<string, string> = {};
  for (const c of foreignCcys) {
    const r = Number(fxRates[c]);
    if (!(r > 0)) {
      fxErrors[c] =
        fxQuotes[c] === 'failed'
          ? `Today's rate couldn't be fetched. Enter what 1 ${c} is worth in ${userCcy} (your bank's app shows it).`
          : `Enter what 1 ${c} is worth in ${userCcy}.`;
    } else if (r > 100000) {
      fxErrors[c] = `That rate looks too large. Check the direction: 1 ${c} in ${userCcy}.`;
    }
  }
  const step2Ok =
    loans.every((l) => Object.keys(issuesOf(l)).length === 0) && Object.keys(fxErrors).length === 0;

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
    const emi = emiOf(l);
    if (!isAmount(emi) || emi.trim() === '') return sum;
    const ccy = loanCurrency(l, country);
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
    if (out.currency === userCcy) delete out.currency;
    if (!(out.min_payment_override ?? '').trim()) delete out.min_payment_override;
    if (!(out.prepayment_penalty_pct ?? '').trim()) delete out.prepayment_penalty_pct;
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
    return applyChoices({
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
      filing_status: country === 'US' ? (base.filing_status ?? 'single') : undefined,
      primary_bank: base.primary_bank || finished.find((l) => l.bank)?.bank || '',
      loans: finished,
      fx_to_user_currency: Object.fromEntries(
        foreignCcys.filter((c) => Number(fxRates[c]) > 0).map((c) => [c, String(fxRates[c]).trim()]),
      ),
    } as UserPayload, choices, monthlySpend, localIsoDate(getCountryToday(country)));
  }

  /** The saved rate when gross pay (or the same take-home) backs it; else an estimate. */
  function marginal(): { rate: string; estimated: boolean } {
    const hasGross =
      !!prev &&
      (Number(prev.annual_gross_salary) > 0 || Number(prev.annual_business_income) > 0 || fromStreams);
    const unchanged =
      !!prev && prev.country === country && prev.income_type === incomeType &&
      (hasGross || sameAmount(num(prev.monthly_income), num(income)));
    if (saved && unchanged) return { rate: saved.marginalRate, estimated: false };
    const est = marginalRateFromTakeHome(
      income,
      country,
      incomeType,
      country === 'IN' ? (prev?.tax_regime ?? 'new') : undefined,
      country === 'US' ? (prev?.filing_status ?? 'single') : undefined,
    );
    return { rate: (est?.rate ?? 0.3).toFixed(4), estimated: true };
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
    const user: UserPayload = { ...built, loans: prepareLoanPaymentTiming(rollBalancesForward(stamped, asOf.slice(0, 7)).loans, asOf.slice(0, 7)) };
    let live = true;
    setPreview(null);
    setPreviewError(null);
    if (user.loans.length === 0) return;
    Promise.all([
      api.simulate({
        user,
        strategy: pickedStrategy ?? readStrategyClient(),
        horizon_months: HORIZON_MONTHS,
        marginal_rate: marginalRate,
        simulation_start_month: getCountryMonth(user.country),
        // Plan's emergency-fund split, so the two show the same numbers.
        ef_top_up_rate:
          Number(user.efund_target ?? 0) > 0 && Number(user.efund_balance ?? 0) < Number(user.efund_target)
            ? (pickedSplit ?? readEfSplitClient())
            : undefined,
      }),
      api.baseline({ user, horizon_months: HORIZON_MONTHS }),
    ])
      .then(([plan, minimums]) => live && setPreview({ plan, minimums, loans: user.loans }))
      .catch(() => live && setPreviewError("The plan couldn't be worked out just now. You can still save, and Home will try again."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  function goTo(next: number) {
    if (next > 0 && !step1Ok) {
      setShowErrors(true);
      setStep(0);
      return;
    }
    if (next > 1 && !step2Ok) {
      setShowErrors(true);
      setStep(1);
      return;
    }
    setShowErrors(false);
    setStep(next);
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
    const built = dateProfileRates(buildUser(), current.isLive ? current.user : null, quotes, Date.now());
    // Date changed balances today; preserve the anchor when only other fields changed.
    const asOf = localIsoDate(getCountryToday(built.country));
    const user = { ...built, loans: stampBalanceDates(built.loans, current.user.loans, asOf) };
    const ok = saveProfileWithPaidEmis({ ...current, user, marginalRate: marginal().rate }, asOf);
    if (!ok) {
      setSaving(false);
      setSaveFailed(true);
      return;
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
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>
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
              <>Your numbers stay in this browser (and your account, if you sign in). You can change them any time in Profile.</>
            )}
          </p>
        </header>

        <section ref={stepRef} tabIndex={-1} aria-label={STEPS[step]} style={{ outline: 'none' }}>
          <LSectionHeader step={step + 1} right={<StepStrip step={step} onGo={goTo} />}>
            {STEPS[step]}
          </LSectionHeader>

          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <ChipRow label="Where you live">
                <Chip on={country === 'IN'} onClick={() => pickCountry('IN')}>India · ₹</Chip>
                <Chip on={country === 'US'} onClick={() => pickCountry('US')}>USA · $</Chip>
                {country === 'US' && (
                  <Chip on={isNriUs} onClick={() => setIsNriUs(!isNriUs)}>
                    {isNriUs ? '✓ ' : '+ '}I also have loans in India
                  </Chip>
                )}
              </ChipRow>
              {countryNote && (
                <p role="status" style={{ margin: 0, fontSize: 13, color: L_T.negative }}>{countryNote}</p>
              )}
              <ChipRow label="How you earn">
                <Chip on={incomeType === 'salaried'} onClick={() => setIncomeType('salaried')}>Salaried</Chip>
                <Chip on={incomeType === 'business_owner'} onClick={() => setIncomeType('business_owner')}>
                  Self-employed
                </Chip>
              </ChipRow>
              <div style={grid2}>
                {fromStreams ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, color: L_T.muted }}>Take-home a month</span>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{money(income)}</span>
                    <span style={{ fontSize: 11, color: L_T.muted }}>
                      From your income sources. <a href="/profile?step=income" style={{ color: L_T.accent }}>Change them in Profile</a>
                    </span>
                  </div>
                ) : (
                  <Field
                    label={incomeType === 'salaried' ? 'Take-home pay a month' : 'What you take home a month'}
                    findIt={incomeType === 'salaried' ? whereToFind('takeHome', { country }) : null}
                    kind="money"
                    currency={userCcy}
                    value={takeHome}
                    onChange={setTakeHome}
                    hint={incomeType === 'salaried' ? 'After tax, what reaches your bank' : 'After business costs and tax'}
                    error={showErrors && !incomeOk ? 'Enter what reaches your bank each month.' : null}
                  />
                )}
                <Field
                  label="Spending a month, without EMIs"
                  kind="money"
                  currency={userCcy}
                  value={spend}
                  onChange={setSpend}
                  hint="Rent, bills, food, travel: everything but loan and card payments"
                  error={showErrors && !spendOk ? 'Type a number, or leave it blank for none.' : null}
                />
              </div>
              {leftBeforeEmis && (
                <MoneyLine
                  label="Left each month, before EMIs"
                  value={money(leftBeforeEmis)}
                  tone={leftBeforeEmis.lt(0) ? 'negative' : 'ink'}
                  note={leftBeforeEmis.lt(0) ? 'You spend more than you take home. Check both numbers.' : undefined}
                />
              )}
              <Actions>
                <LButton onClick={() => goTo(1)}>CONTINUE · WHAT YOU OWE</LButton>
              </Actions>
            </div>
          )}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <p style={{ color: L_T.muted, margin: '4px 0 6px', fontSize: 12 }}>
                {country === 'US'
                  ? 'Keep your latest statements handy: each number below says where it is printed.'
                  : 'Keep your Key Facts Statement (KFS) or latest loan statement handy: each number below says where it is printed.'}{' '}
                Not sure of a number? Tap I DON&apos;T KNOW beside it for a marked estimate.
              </p>
              {!prev && (
                <p style={{ color: L_T.inkSoft, margin: '0 0 6px', fontSize: 12 }}>
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
                  loan={l}
                  country={country}
                  showCurrency={(country === 'US' && isNriUs) || loanCurrency(l, country) !== userCcy}
                  ui={uiOf(l.id)}
                  issues={showErrors ? issuesOf(l) : {}}
                  computedEmi={uiOf(l.id).byMonths ? emiOf(l) : ''}
                  askPaid={askPaid(l)}
                  monthName={thisMonthName}
                  nextMonthName={nextMonthName}
                  thisMonth={thisMonth}
                  onPatch={(p) => patchLoan(i, p)}
                  onUi={(p) => setUiOf(l.id, p)}
                  onRemove={() => setLoans((cur) => cur.filter((_, j) => j !== i))}
                />
              ))}
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
                          : quote
                            ? `Today's rate${quote.as_of ? `, ${quote.as_of}` : ''}. Change it to your bank's if you like.`
                            : 'The rate your bank converts at'
                      }
                      error={showErrors ? fxErrors[c] : null}
                    />
                  </div>
                );
              })}

              {emisInUserCcy && leftBeforeEmis && activeLoans.some((l) => needsEmi(l.loan_type)) && (
                <MoneyLine
                  label="Left each month, after EMIs"
                  value={money(leftBeforeEmis.sub(emisInUserCcy))}
                  tone={leftBeforeEmis.sub(emisInUserCcy).lt(0) ? 'negative' : 'ink'}
                  note={`${money(leftBeforeEmis)} − ${money(emisInUserCcy)} in EMIs${
                    activeLoans.some((l) => l.loan_type === 'credit_card') ? '; card minimums come out of this' : ''
                  }`}
                />
              )}
              {showErrors && !step2Ok && (
                <p role="alert" style={{ color: L_T.negative, margin: '10px 0 0' }}>
                  Some loans are missing a number. They&apos;re marked above.
                </p>
              )}
              <Actions back={<LBracket onClick={() => goTo(0)}>← BACK</LBracket>}>
                <LButton onClick={() => goTo(2)}>CONTINUE · SEE YOUR PLAN</LButton>
              </Actions>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <PlanPreview
                preview={preview}
                error={previewError}
                noLoans={activeLoans.length === 0}
                country={country}
                money={money}
              />
              <SetupChoices
                value={choices}
                onChange={(c) => {
                  setChoices(c);
                  setChoiceErrors(false);
                }}
                showErrors={choiceErrors}
                hasLoans={activeLoans.length > 0}
                monthlySpend={Number(num(spend))}
                money={(v) => money(v)}
              />
              <PlanFootnotes
                country={country}
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
                  Saved. Opening your plan…
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
                  fontSize: 11,
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
        <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: L_T.muted }}>
          {label}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: tone === 'negative' ? L_T.negative : L_T.ink }}>
          {value}
        </span>
      </div>
      {note && <div style={{ fontSize: 11, color: tone === 'negative' ? L_T.negative : L_T.muted, marginTop: 4 }}>{note}</div>}
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
  const tenure = !card && !ui.byMonths ? deriveTenureMonths(loan.outstanding, loan.nominal_rate, loan.scheduled_emi) : null;
  const emiTooSmall =
    !card && !ui.byMonths && Number(loan.outstanding) > 0 && Number(loan.scheduled_emi) > 0 &&
    Number(loan.nominal_rate) > 0 && tenure === null;
  const name = loan.bank ? `${loan.bank} ${LOAN_TYPE_NAME[loan.loan_type]}` : `Loan ${index + 1}`;
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
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{name}</span>
        <LBracket onClick={onRemove}>REMOVE</LBracket>
      </div>
      <ChipRow label="Kind of loan">
        {TYPE_CHIPS.map(([t, label]) => (
          <Chip key={t} on={loan.loan_type === t} onClick={() => onPatch({ loan_type: t })}>
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
          hint={
            estimated.has('rate')
              ? `Typical for this kind of loan: the middle of the published rates of the banks RightDue tracks, as of ${TYPICAL_RATE_AS_OF}. Yours may differ; your statement or loan app shows it.`
              : card
                ? 'A 3.5% monthly rate is 42% a year'
                : undefined
          }
          error={issues.rate}
        />
        {!card && !ui.byMonths && (
          <Field
            label="EMI a month"
            findIt={find('emi')}
            kind="money"
            currency={ccy}
            value={loan.scheduled_emi}
            onChange={(v) => onPatch({ scheduled_emi: v })}
            hint={
              emiTooSmall
                ? issues.emi
                  ? undefined
                  : (emiBelowInterest({ ...loan, currency: ccy }) ?? "At this EMI the balance doesn't go down. Check the EMI and the rate.")
                : tenure
                  ? `About ${tenure} months left, to ${monthIndexToCountryLabel(tenure, country)}`
                  : undefined
            }
            error={issues.emi}
          />
        )}
        {!card && ui.byMonths && (
          <Field
            label="Months left"
            findIt={find('monthsLeft')}
            kind="integer"
            value={ui.months}
            onChange={(v) => onUi({ months: v })}
            hint={computedEmi ? `EMI works out to ${formatCurrencyWhole(computedEmi, ccy)} a month` : 'We work out the EMI'}
            error={issues.months}
          />
        )}
      </div>
      {askPaid && (
        <EmiPaidQuestion
          monthName={monthName}
          nextMonthName={nextMonthName}
          value={emiAnswer(loan, thisMonth)}
          onChange={(a) => onPatch(emiAnswerPatch(a, thisMonth))}
          error={issues.paid}
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
        {!card && (
          <LBracket
            onClick={() => {
              // Keep the EMI worked out from the months, so switching back shows it.
              if (ui.byMonths && computedEmi) onPatch({ scheduled_emi: computedEmi });
              onUi({ byMonths: !ui.byMonths, months: ui.months || (loan.tenure_months_remaining > 0 ? String(loan.tenure_months_remaining) : '') });
            }}
          >
            {ui.byMonths ? 'I KNOW THE EMI INSTEAD' : 'I KNOW THE MONTHS LEFT INSTEAD'}
          </LBracket>
        )}
        <button
          type="button"
          aria-expanded={ui.more}
          onClick={() => onUi({ more: !ui.more })}
          style={{ fontFamily: L_MONO, fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          [{ui.more ? '−' : '+'} MORE TERMS · OPTIONAL]
        </button>
      </div>
      {!card && ui.estOpen && (
        <div role="group" aria-label="Work out the balance" style={{ ...grid2, padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}` }}>
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: L_T.inkSoft }}>
            From what you borrowed, when it started and its term, at the rate above. It assumes every EMI was paid on time
            and nothing extra: an estimate, marked as one, until you enter the real balance.
          </p>
          <Field label="Amount borrowed" kind="money" currency={ccy} value={ui.estAmount ?? ''} onChange={(v) => onUi({ estAmount: v })} />
          <Field label="First EMI (year-month)" kind="text" placeholder="2022-04" value={ui.estStart ?? ''} onChange={(v) => onUi({ estStart: v })} />
          <Field label="Term when you took it, months" kind="integer" value={ui.estTerm ?? ''} onChange={(v) => onUi({ estTerm: v })} />
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <LBracket
              accent
              onClick={() => {
                const rate = loan.nominal_rate.trim() || (typical != null ? String(typical) : '');
                const paid = monthsSince((ui.estStart ?? '').trim(), thisMonth);
                const term = Number(ui.estTerm);
                const bal = rate && paid != null && term > 0 ? estimateBalance(ui.estAmount ?? '', rate, term, paid) : null;
                if (!bal || !(Number(rate) > 0)) {
                  onUi({ estError: 'Enter the amount, the month of the first EMI (like 2022-04), the term in months, and the rate above (or tap I DON’T KNOW THE RATE).' });
                  return;
                }
                let next = withEstimate(loan, 'balance', true);
                if (!loan.nominal_rate.trim()) next = withEstimate(next, 'rate', true);
                onPatch({ outstanding: bal, nominal_rate: rate, estimated_fields: next.estimated_fields });
                onUi({ estOpen: false, estError: null, byMonths: true, months: String(Math.max(1, term - (paid ?? 0))) });
              }}
            >
              USE THIS ESTIMATE
            </LBracket>
            {ui.estError && <span role="alert" style={{ fontSize: 12, color: L_T.negative }}>{ui.estError}</span>}
          </div>
        </div>
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
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 11, color: L_T.muted }}>
            Fees, rate resets, card dates and the rest are in Profile.
          </p>
        </div>
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
}: {
  preview: Preview | null;
  error: string | null;
  noLoans: boolean;
  country: Country;
  money: (v: Decimal | string, ccy?: CurrencyCode) => string;
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
  if (!preview) {
    return (
      <p role="status" style={{ color: L_T.muted, margin: 0 }}>
        Working out your plan…
      </p>
    );
  }
  const { plan, minimums, loans } = preview;
  const shortfall = new Decimal(plan.shortfall || 0);
  // Month m of the plan is the m-th payment, as Home and Plan count it.
  const freeIn = (m: number) => (m <= 1 ? 'this month' : `in ${monthsSpan(m)}`);
  const interestSaved = new Decimal(minimums.total_interest_paid || 0).sub(plan.total_interest_paid || 0);
  const monthsSaved =
    plan.debt_free_month != null && minimums.debt_free_month != null
      ? minimums.debt_free_month - plan.debt_free_month
      : null;
  const move = firstExtraPayment(
    plan.trajectory[0]?.payments_by_loan_index,
    minimums.trajectory[0]?.payments_by_loan_index,
  );
  const moveLoan = move ? loans[move.index] : null;
  const rows: Array<[string, ReactNode, string?]> = [
    [
      'Debt-free',
      plan.debt_free_month != null ? monthIndexToCountryLabel(plan.debt_free_month, country) : 'Not in sight',
      plan.debt_free_month != null ? freeIn(plan.debt_free_month) : 'Payments don’t cover the interest yet',
    ],
    ['Interest you’ll pay', money(plan.total_interest_paid), 'over the whole plan'],
    [
      'Vs paying minimums',
      interestSaved.gt(0) ? `${money(interestSaved)} less` : 'about the same',
      minimums.debt_free_month == null
        ? 'minimums alone never clear it'
        : monthsSaved && monthsSaved > 0
          ? `${monthsSpan(monthsSaved)} sooner`
          : undefined,
    ],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {shortfall.gt(0) && (
        <p role="alert" style={{ margin: 0, padding: '10px 12px', border: `1px solid ${L_T.negative}`, color: L_T.negative, lineHeight: 1.55 }}>
          Your take-home is {money(shortfall)} a month short of spending plus minimum payments. The date below
          pays that gap from your emergency fund, then borrows it on a card at card rates until it&apos;s repaid; Home
          shows where to cut.
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ position: 'absolute', left: -9999 }}>Your plan</caption>
        <tbody>
          {rows.map(([k, v, note]) => (
            <tr key={k} style={{ borderBottom: `1px dashed ${L_T.ruleSoft}` }}>
              <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: L_T.muted, padding: '10px 0', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {k}
              </th>
              <td style={{ textAlign: 'right', padding: '10px 0' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{v}</div>
                {note && <div style={{ fontSize: 11, color: L_T.muted }}>{note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '12px 14px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip('accent') }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 4 }}>THIS MONTH</div>
        {move && moveLoan ? (
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Pay every EMI and card minimum, then put{' '}
            <strong>{money(move.extra, loanCurrency(moveLoan, country))}</strong> extra on your{' '}
            <strong>{moveLoan.bank ? `${moveLoan.bank} ` : ''}{LOAN_TYPE_NAME[moveLoan.loan_type]}</strong>.
          </div>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Pay every EMI and card minimum. Nothing is left over for extra payments this month.
          </div>
        )}
      </div>
    </div>
  );
}

function PlanFootnotes({
  country,
  estimated,
  rate,
  noLoans,
  picked,
}: {
  country: Country;
  estimated: boolean;
  rate: string;
  noLoans: boolean;
  /** The order the person picked above; the saved one until they do. */
  picked: StrategyName | null;
}) {
  const strategy = picked ?? readStrategyClient();
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: L_T.muted, fontSize: 11, lineHeight: 1.7 }}>
      {!noLoans && (
        <li>
          Order: <strong style={{ color: L_T.ink }}>{strategyName(strategy)}</strong>. {STRATEGY_SHORT[strategy]} Switch
          it at the top of any page.
        </li>
      )}
      <li>
        Tax bracket {(Number(rate) * 100).toFixed(0)}%
        {estimated
          ? `, estimated from take-home. Add your gross ${country === 'IN' ? 'salary (Form 16)' : 'pay (W-2)'} in Profile to make it exact.`
          : ', from your profile.'}
      </li>
    </ul>
  );
}

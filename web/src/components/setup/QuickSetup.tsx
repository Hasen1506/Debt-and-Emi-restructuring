'use client';

/**
 * First-run setup in three steps (REDESIGN R1): you and your money, what you
 * owe, and the plan those numbers give — about a dozen typed values for a
 * person with two loans. Everything else (gross pay, deductions, savings,
 * card dates, fees, holdings) lives in Profile, and is kept untouched when a
 * saved profile is edited here.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { BankCombobox, Field, Select } from '@/components/ToolPrimitives';
import { L_MONO, L_T, LBracket, LButton, LSectionHeader, LShell, lStrip } from '@/components/ledger/primitives';
import { api, formatCurrency } from '@/lib/api';
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
import { deriveTenureMonths } from '@/lib/derived';
import { HORIZON_MONTHS } from '@/lib/horizon';
import { loanDraftErrors, needsEmi } from '@/lib/loan-gaps';
import { newLoanId } from '@/lib/loan-ids';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { readEfSplitClient } from '@/lib/ef-split';
import { emiFromMonths, firstExtraPayment, marginalRateFromTakeHome } from '@/lib/quick-setup';
import { readStrategyClient, STRATEGY_LABEL, STRATEGY_SHORT } from '@/lib/strategy';
import { FY_ANCHOR_MONTH, getCountryMonth, localIsoDate, monthIndexToCountryLabel, monthsSpan } from '@/lib/today';
import { loadProfileClient, saveProfileClient, type StoredProfile } from '@/lib/user-store';

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

type Issues = Partial<Record<'balance' | 'rate' | 'emi' | 'months' | 'fee', string>>;

/** Per-loan form state that isn't part of the saved loan. */
interface LoanUi {
  /** Months left typed instead of the EMI; the EMI is worked out. */
  byMonths: boolean;
  months: string;
  more: boolean;
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
    rate_type: 'fixed',
    tenure_months_remaining: 0,
    scheduled_emi: '',
  };
}

const num = (v: string | undefined, fallback = '0') => ((v ?? '').trim() === '' ? fallback : v!.trim());
const isAmount = (v: string) => v.trim() === '' || /^\d*\.?\d+$/.test(v.trim());

export function QuickSetup() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<StoredProfile | null>(null);
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const [country, setCountry] = useState<Country>('IN');
  const [isNriUs, setIsNriUs] = useState(false);
  const [incomeType, setIncomeType] = useState<IncomeType>('salaried');
  const [takeHome, setTakeHome] = useState('');
  const [spend, setSpend] = useState('');
  const [spendAtStart, setSpendAtStart] = useState('');

  const [loans, setLoans] = useState<LoanPayload[]>([blankLoan()]);
  const [ui, setUi] = useState<Record<string, LoanUi>>({});
  const [fxRates, setFxRates] = useState<Record<string, string>>({});
  const [fxQuotes, setFxQuotes] = useState<Record<string, FxQuote>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const stepRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Start from the saved profile when there is one (browser-only).
  useEffect(() => {
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
      setLoans(loansWithIds.length > 0 ? loansWithIds : [blankLoan()]);
      setFxRates(u.fx_to_user_currency ?? {});
    }
    setReady(true);
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
    setLoans((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

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
  function issuesOf(l: LoanPayload): Issues {
    const u = uiOf(l.id);
    const out: Issues = {};
    const eg = loanCurrency(l, country) === 'INR' ? '25,00,000 or 25L' : '250,000 or 250k';
    if (!isAmount(l.outstanding)) out.balance = `Type a number, like ${eg}.`;
    const fee = (l.prepayment_penalty_pct ?? '').trim();
    if (fee && !(/^\d*\.?\d+$/.test(fee) && Number(fee) < 1)) out.fee = 'Enter the fee as a percent, e.g. 2, or leave it blank.';
    if (Number(l.outstanding) <= 0) return out;
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
          expected_return: country === 'IN' ? '0.068' : '0.045',
          liquidity_class: 'liquid',
          is_in_pool: true,
        },
      ],
    };
    const base = prev ?? ({} as Partial<UserPayload>);
    return {
      ...defaults,
      ...base,
      ...(sameCountry
        ? {}
        : {
            inflation_rate: country === 'IN' ? '0.046' : '0.025',
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
    } as UserPayload;
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
  const runKey = step === 2 ? JSON.stringify([buildUser(), marginal().rate]) : '';
  useEffect(() => {
    if (!runKey) return;
    const [user, marginalRate] = JSON.parse(runKey) as [UserPayload, string];
    let live = true;
    setPreview(null);
    setPreviewError(null);
    if (user.loans.length === 0) return;
    Promise.all([
      api.simulate({
        user,
        strategy: readStrategyClient(),
        horizon_months: HORIZON_MONTHS,
        marginal_rate: marginalRate,
        simulation_start_month: getCountryMonth(user.country),
        // Plan's emergency-fund split, so the two show the same numbers.
        ef_top_up_rate:
          Number(user.efund_target ?? 0) > 0 && Number(user.efund_balance ?? 0) < Number(user.efund_target)
            ? readEfSplitClient()
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

  function skipLoans() {
    setLoans([]);
    setShowErrors(false);
    setStep(2);
  }

  function save() {
    const user = buildUser();
    const ok = saveProfileClient({ user, marginalRate: marginal().rate });
    if (!ok) {
      setSaveFailed(true);
      return;
    }
    try {
      window.localStorage.setItem(BALANCES_ENTERED_KEY, localIsoDate(new Date()));
    } catch {
      /* private mode: the stale-card nudge falls back to activity only */
    }
    router.push('/');
  }

  if (!ready) {
    return (
      <LShell>
        <p style={{ color: L_T.muted }}>Loading your details…</p>
      </LShell>
    );
  }

  const money = (v: Decimal | string, ccy: CurrencyCode = userCcy) => formatCurrency(v, ccy);

  return (
    <LShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}>
        <header>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>
            $ SETUP · 3 STEPS · ABOUT 2 MINUTES
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
                <Chip on={country === 'IN'} onClick={() => setCountry('IN')}>India · ₹</Chip>
                <Chip on={country === 'US'} onClick={() => setCountry('US')}>USA · $</Chip>
                {country === 'US' && (
                  <Chip on={isNriUs} onClick={() => setIsNriUs(!isNriUs)}>
                    {isNriUs ? '✓ ' : '+ '}I also have loans in India
                  </Chip>
                )}
              </ChipRow>
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
              <PlanFootnotes country={country} estimated={marginal().estimated} rate={marginal().rate} />
              {saveFailed && (
                <p role="alert" style={{ color: L_T.negative, margin: 0 }}>
                  This browser didn&apos;t keep your profile (cookies blocked, or it&apos;s too large). Allow cookies for this
                  site and try again.
                </p>
              )}
              <Actions back={<LBracket onClick={() => goTo(1)}>← BACK</LBracket>}>
                <LButton onClick={save}>SAVE · OPEN MY PLAN</LButton>
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
                style={{
                  fontFamily: L_MONO,
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  background: 'none',
                  borderWidth: '0 0 2px',
                  borderStyle: 'solid',
                  borderColor: here ? L_T.accent : 'transparent',
                  padding: '0 0 1px',
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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        fontFamily: L_MONO,
        fontSize: 12,
        padding: '7px 12px',
        border: `1px solid ${on ? L_T.ink : L_T.ruleSoft}`,
        background: on ? L_T.ink : L_T.paper,
        color: on ? L_T.bg : L_T.ink,
        fontWeight: on ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: L_T.muted }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
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
          kind="money"
          currency={ccy}
          value={loan.outstanding}
          onChange={(v) => onPatch({ outstanding: v })}
          hint={card ? 'Your latest statement balance' : 'Principal outstanding, from your statement or loan app'}
          error={issues.balance}
        />
        <Field
          label={card ? 'Card APR, % a year' : 'Interest rate, % a year'}
          kind="percent"
          value={loan.nominal_rate}
          onChange={(v) => onPatch({ nominal_rate: v })}
          hint={card ? 'A 3.5% monthly rate is 42% a year' : undefined}
          error={issues.rate}
        />
        {!card && !ui.byMonths && (
          <Field
            label="EMI a month"
            kind="money"
            currency={ccy}
            value={loan.scheduled_emi}
            onChange={(v) => onPatch({ scheduled_emi: v })}
            hint={
              emiTooSmall
                ? "At this EMI the balance doesn't go down. Check the EMI and the rate."
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
            kind="integer"
            value={ui.months}
            onChange={(v) => onUi({ months: v })}
            hint={computedEmi ? `EMI works out to ${formatCurrency(computedEmi, ccy)} a month` : 'We work out the EMI'}
            error={issues.months}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
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
            <Select<'fixed' | 'floating'>
              label="Rate type"
              value={loan.rate_type}
              onChange={(v) => onPatch({ rate_type: v })}
              options={[
                { value: 'fixed', label: 'Fixed' },
                { value: 'floating', label: 'Floating' },
              ]}
            />
          )}
          {!card && (
            <Field
              label="Prepayment fee, %"
              kind="percent"
              value={loan.prepayment_penalty_pct ?? ''}
              onChange={(v) => onPatch({ prepayment_penalty_pct: v })}
              hint="Of any extra you pay. Blank if none"
              error={issues.fee}
            />
          )}
          {!card && (
            <Field
              label="Lock-in, months"
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
          assumes money you don&apos;t have; Home shows where to cut.
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

function PlanFootnotes({ country, estimated, rate }: { country: Country; estimated: boolean; rate: string }) {
  const strategy = readStrategyClient();
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: L_T.muted, fontSize: 11, lineHeight: 1.7 }}>
      <li>
        Order: <strong style={{ color: L_T.ink }}>{STRATEGY_LABEL[strategy]}</strong>. {STRATEGY_SHORT[strategy]} Change it on Plan.
      </li>
      <li>
        Tax bracket {(Number(rate) * 100).toFixed(0)}%
        {estimated
          ? `, estimated from take-home. Add your gross ${country === 'IN' ? 'salary (Form 16)' : 'pay (W-2)'} in Profile to make it exact.`
          : ', from your profile.'}
      </li>
    </ul>
  );
}

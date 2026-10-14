'use client';

import { LoanCheckSignals } from '@/components/retention/LoanCheckSignals';
import { whereToFind } from '@/lib/where-to-find';
import { useEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { ComplaintPanel, RuleQuote } from './complaint';
import { EMPTY_CHOICE, LenderPicker, choiceFromName, resolveChoice, useLoanCheckLenders, type LenderChoice } from './lender-picker';
import { OfferPanel } from './offers';
import { LenderRecord } from './outcome';
import { RateProblem } from './rate-problem';
import { HikeQuestions, PassThroughCard, PlanBridge, RateHistoryRows, RateRiseCard, ResetChoicePanel } from './hike';
import { historyToRequest, type HistoryRow } from '@/lib/loan-check-hike';
import { rememberLoanCheck } from '@/lib/loan-check-memory';
import {
  Field,
  Select,
  SubmitBar,
} from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LStepSub, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import { loanLabel } from '@/lib/loan-types';
import {
  api,
  formatCurrency,
  formatPct,
  type LoanBankAction,
  type LoanBenchmark,
  type LoanCheckFinding,
  type LoanCheckRequest,
  type LoanCheckResetWatch,
  type LoanCheckResponse,
  type SpreadChanged,
} from '@/lib/api';
import { useStoredProfile } from '@/lib/use-profile';
import { parsePercentInput, parseSpreadInput } from '@/lib/rate-input';
import { formatAsOf } from '@/lib/as-of';
import { TOL, gapWords, parseSpreadChange } from '@/lib/loan-check';
import { useFormErrors } from '@/lib/form-errors';

type StartMode = 'headline' | 'split';

// The API's field names → this form's inputs (api/routes/loan_check.py).

const IN = { country: 'IN' } as const;
const FIELDS: Record<string, string> = {
  lender: 'lender',
  lender_type: 'lender',
  spread_change: 'spreadChange',
  loan_start: 'loanStart',
  start_rate: 'startRate',
  start_benchmark_rate: 'startBench',
  start_spread: 'startSpread',
  current_rate: 'currentRate',
  outstanding: 'outstanding',
  tenure_months_remaining: 'months',
  emi: 'emi',
  last_reset: 'lastReset',
  rate_history: 'rateHistory',
  switch_rate: 'switchRate',
  switch_cost: 'switchCost',
};

const BENCHMARK_OPTIONS: { value: LoanBenchmark; label: string }[] = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'repo', label: 'RBI repo rate (RLLR / EBLR)' },
  { value: 'mclr', label: 'MCLR' },
  { value: 'base_rate', label: 'Base rate / BPLR' },
];

function pctFromFraction(f: string | undefined): string {
  if (!f) return '';
  try {
    return new Decimal(f).mul(100).toDecimalPlaces(2).toString();
  } catch {
    return '';
  }
}

export function LoanCheckTool() {
  const profile = useStoredProfile();
  const country = profile.user.country;
  // Only a real profile pre-fills; the demo profile's loan would look
  // like the visitor's own numbers.
  const homeLoans = useMemo(
    () =>
      profile.isLive
        ? (profile.user.loans ?? [])
            .map((l, i) => ({ l, i }))
            .filter(({ l }) => l.loan_type === 'home_loan' && Number(l.outstanding) > 0)
        : [],
    [profile.isLive, profile.user.loans],
  );
  const homeLoan = homeLoans[0]?.l;
  const [loanIdx, setLoanIdx] = useState<number | null>(homeLoans[0]?.i ?? null);
  // A saved loan shows as one line; EDIT opens its fields.
  const [editLoan, setEditLoan] = useState(!homeLoan);
  const [more, setMore] = useState(false);

  const { list: lenderList, failed: lenderListFailed } = useLoanCheckLenders();
  const [choice, setChoice] = useState<LenderChoice>(EMPTY_CHOICE);
  // A saved loan's bank fills the picker once the list has loaded.
  const [lenderSeed, setLenderSeed] = useState<string>(homeLoan?.bank ?? '');
  useEffect(() => {
    if (lenderList.length && lenderSeed) {
      setChoice(choiceFromName(lenderSeed, lenderList));
      setLenderSeed('');
    }
  }, [lenderList, lenderSeed]);
  const resolvedLender = resolveChoice(choice, lenderList);
  const lender = resolvedLender.lender ?? '';
  const [spreadChanged, setSpreadChanged] = useState<SpreadChanged | ''>('');
  const [spreadChange, setSpreadChange] = useState('');
  const [loanStart, setLoanStart] = useState('');
  const [benchmark, setBenchmark] = useState<LoanBenchmark>('unknown');
  const [startMode, setStartMode] = useState<StartMode>('headline');
  const [startRate, setStartRate] = useState('');
  const [startBench, setStartBench] = useState('');
  const [startSpread, setStartSpread] = useState('');
  const [currentRate, setCurrentRate] = useState(pctFromFraction(homeLoan?.nominal_rate));
  const [outstanding, setOutstanding] = useState(homeLoan?.outstanding ?? '');
  const [months, setMonths] = useState(
    homeLoan ? String(homeLoan.tenure_months_remaining) : '',
  );
  const [emi, setEmi] = useState(homeLoan?.scheduled_emi ?? '');
  const [lastReset, setLastReset] = useState('');
  // Hike cycle (audit 80+ A11).
  const [bankAction, setBankAction] = useState<LoanBankAction>('unknown');
  const [choiceOffered, setChoiceOffered] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [switchRate, setSwitchRate] = useState('');
  const [switchCost, setSwitchCost] = useState('');

  function pickLoan(i: number | null) {
    setLoanIdx(i);
    const l = i === null ? undefined : profile.user.loans[i];
    setLenderSeed(l?.bank ?? '');
    if (!l?.bank) setChoice(EMPTY_CHOICE);
    setCurrentRate(pctFromFraction(l?.nominal_rate));
    setOutstanding(l?.outstanding ?? '');
    setMonths(l ? String(l.tenure_months_remaining) : '');
    setEmi(l?.scheduled_emi ?? '');
    setEditLoan(!l);
  }
  useEffect(() => { if (loanIdx != null) pickLoan(loanIdx); }, [profile.user.loans]); // eslint-disable-line react-hooks/exhaustive-deps

  const [resultValue, setResult] = useState<LoanCheckResponse | null>(null);
  const fingerprint = JSON.stringify([loanIdx,choice,spreadChanged,spreadChange,loanStart,benchmark,startMode,startRate,startBench,startSpread,currentRate,outstanding,months,emi,lastReset,bankAction,choiceOffered,historyRows,switchRate,switchCost,profile.user]);
  const [checkedKey, setCheckedKey] = useState('');
  const result = checkedKey === fingerprint ? resultValue : null;
  // The request behind `result`, reused by the complaint panel.
  const [checked, setChecked] = useState<LoanCheckRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const resultRef = useRef<HTMLDivElement>(null);

  const pStart = parsePercentInput(startRate);
  const pBench = parsePercentInput(startBench, { min: 1, max: 20 });
  const pSpread = parseSpreadInput(startSpread);
  const pCurrent = parsePercentInput(currentRate);
  const pSwitch = parsePercentInput(switchRate);
  const parsedHistory = historyToRequest(historyRows);
  const onOldBenchmark = benchmark === 'mclr' || benchmark === 'base_rate';
  const pSpreadChange = parseSpreadChange(spreadChange);

  // What is still missing before the check can run. Shown next to the
  // button, so nobody has to guess why nothing happens.
  const stillNeeded: string[] = [];
  if (resolvedLender.missing) stillNeeded.push(resolvedLender.missing);
  if (!loanStart) stillNeeded.push('the month the loan started');
  if (startMode === 'headline') {
    if (!startRate) stillNeeded.push('the starting rate');
  } else {
    if (!startBench) stillNeeded.push('the benchmark rate at the start');
    if (!startSpread) stillNeeded.push('your spread');
  }
  if (!currentRate) stillNeeded.push('your current rate');
  if (!outstanding) stillNeeded.push('the outstanding balance');
  if (!months) stillNeeded.push('months left');
  if (!spreadChanged) stillNeeded.push('whether your spread changed');
  else if (spreadChanged === 'yes' && !spreadChange) stillNeeded.push('how much your spread changed');

  const hasInputError =
    (startMode === 'headline' ? !!pStart.error : !!pBench.error || !!pSpread.error) ||
    !!pCurrent.error ||
    (spreadChanged === 'yes' && !!pSpreadChange.error) ||
    !!parsedHistory.error ||
    (onOldBenchmark && !!pSwitch.error);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (stillNeeded.length) {
      setErr(`Still needed: ${stillNeeded.join(', ')}.`);
      return;
    }
    if (hasInputError) {
      setErr('Fix the highlighted rate first.');
      return;
    }
    setBusy(true);
    clear();
    try {
      const req: LoanCheckRequest = {
        lender: lender || undefined,
        lender_type: resolvedLender.lender_type,
        spread_changed: spreadChanged || 'unsure',
        spread_change: spreadChanged === 'yes' ? (pSpreadChange.fraction ?? undefined) : undefined,
        loan_start: loanStart,
        ...(startMode === 'headline'
          ? { start_rate: pStart.fraction ?? undefined }
          : {
              start_benchmark_rate: pBench.fraction ?? undefined,
              start_spread: pSpread.fraction ?? undefined,
            }),
        current_rate: pCurrent.fraction as string,
        outstanding: outstanding.replace(/,/g, ''),
        tenure_months_remaining: Number(months),
        emi: emi ? emi.replace(/,/g, '') : undefined,
        benchmark,
        last_reset: lastReset || undefined,
        bank_action: bankAction,
        choice_offered: choiceOffered,
        rate_history: parsedHistory.history.length ? parsedHistory.history : undefined,
        switch_rate: onOldBenchmark ? (pSwitch.fraction ?? undefined) : undefined,
        switch_cost: onOldBenchmark && switchCost ? switchCost.replace(/,/g, '') : undefined,
      };
      const res = await api.loanCheck(req);
      setResult(res);
      // Audit 80+ A1: keep the findings on this device so the plan's
      // "where we disagree, worth ₹X" card can count them.
      rememberLoanCheck(res);
      setChecked(req);
      setCheckedKey(fingerprint);
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (e) {
      setResult(null);
      setChecked(null);
      // Given as benchmark + spread, a bad starting rate is the benchmark's.
      fail(e, startMode === 'split' ? { ...FIELDS, start_rate: 'startBench' } : FIELDS);
    } finally {
      setBusy(false);
    }
  }

  if (country !== 'IN') {
    return (
      <LNote style={{ margin: 0, fontSize: 13, color: L_T.ink }}>
        Loan check covers Indian floating-rate home loans for now. The US
        version (adjustable-rate mortgages and card billing errors) is on
        the way.
      </LNote>
    );
  }

  const picked = loanIdx !== null ? profile.user.loans[loanIdx] : null;
  const loanSummary = (
    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
      {formatCurrency(outstanding || '0', 'INR')} left at {currentRate || '—'}%, {months || '—'} months to go
      {lender ? ` · ${lender}` : ''}.{' '}
      <LBracket onClick={() => setEditLoan(true)}>EDIT</LBracket>
    </p>
  );

  return (
    <LSteps>
      <LStep no="01" id="lc-in" title={homeLoans.length > 0 && loanIdx === null ? 'Another loan' : 'Your home loan'}>
        <form onSubmit={check} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {homeLoans.length > 0 && (
            <LChipRow label="Which loan?">
              {homeLoans.map(({ l, i }) => (
                <LChip key={i} on={loanIdx === i} onClick={() => pickLoan(i)}>
                  {loanLabel(l)}
                </LChip>
              ))}
              <LChip on={loanIdx === null} onClick={() => pickLoan(null)}>
                Another loan
              </LChip>
            </LChipRow>
          )}
          {picked && !editLoan && (
            <div style={{ maxWidth: 360 }}>
              <LenderPicker value={choice} onChange={setChoice} list={lenderList} failed={lenderListFailed} error={at('lender')} />
            </div>
          )}
          {picked && !editLoan ? (
            loanSummary
          ) : (
            <LFieldGrid>
              <LenderPicker value={choice} onChange={setChoice} list={lenderList} failed={lenderListFailed} error={at('lender')} />
              <div>
                <Field
                  label="Rate you pay now (%)"
                  value={currentRate}
                  error={at('currentRate') ?? pCurrent.error}
                  onChange={setCurrentRate}
                  placeholder="8.90"
                  findIt={whereToFind('rate', IN)}
                />
                <RateProblem parsed={pCurrent} onFix={setCurrentRate} fixOnly />
              </div>
              <Field label="Still owed" kind="money" currency="INR" value={outstanding} error={at('outstanding')} onChange={setOutstanding} findIt={whereToFind('balance', IN)} />
              <Field label="Months left" value={months} error={at('months')} onChange={setMonths} kind="integer" placeholder="200" findIt={whereToFind('monthsLeft', IN)} />
              <Field label="EMI (optional)" kind="money" currency="INR" value={emi} error={at('emi')} onChange={setEmi} placeholder="e.g. 22,000" hint="Blank: worked out for you" findIt={whereToFind('emi', IN)} />
            </LFieldGrid>
          )}

          <LStepSub>How it started</LStepSub>
          <LFieldGrid>
            <MonthYearPicker
              label="Month the loan started"
              value={loanStart}
              error={at('loanStart')}
              onChange={setLoanStart}
              minYear={1995}
              hint={`If you later moved to a repo-linked rate, the month you moved. Find it: ${whereToFind('loanStart', IN)}`}
            />
            <Select
              label="What is the rate linked to?"
              value={benchmark}
              onChange={setBenchmark}
              options={BENCHMARK_OPTIONS}
              findIt={whereToFind('rateBasis', IN)}
              info={
                <>
                  Your sanction letter or loan statement names it: &ldquo;RLLR&rdquo;,
                  &ldquo;EBLR&rdquo; or &ldquo;repo-linked&rdquo; all mean the RBI
                  repo rate. Loans from October 2019 on are almost always
                  repo-linked.
                </>
              }
            />
          </LFieldGrid>
          <div>
            {/* UX50 C-16: the KFS has the starting rate; the import was hidden in Profile → Loans → [EDIT]. */}
            <p data-testid="loan-check-import-link" style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.5 }}>
              Have the KFS or sanction letter? It shows the starting rate.{' '}
              <a href="/profile?step=loans" style={{ color: 'var(--accent)' }}>[IMPORT IT ON PROFILE →]</a>
            </p>
            <LChipRow label="The rate it started at">
              <LChip on={startMode === 'headline'} onClick={() => setStartMode('headline')}>
                One rate
              </LChip>
              <LChip on={startMode === 'split'} onClick={() => setStartMode('split')}>
                Benchmark + spread
              </LChip>
            </LChipRow>
            <div style={{ marginTop: 10 }}>
              {startMode === 'headline' ? (
                <div style={{ maxWidth: 320 }}>
                  <Field label="Rate when the loan started (%)" value={startRate} error={at('startRate') ?? pStart.error} onChange={setStartRate} placeholder="8.55" findIt={whereToFind('startRate', IN)} />
                  <RateProblem parsed={pStart} onFix={setStartRate} fixOnly />
                </div>
              ) : (
                <LFieldGrid min={200}>
                  <div>
                    <Field
                      label="Bank's benchmark rate then (%)"
                      value={startBench}
                      error={at('startBench') ?? pBench.error}
                      onChange={setStartBench}
                      placeholder="8.20"
                      findIt={'sanction letter or KFS, "Benchmark rate"'}
                      info={<>The lender&apos;s RLLR / EBLR on the day the loan started, as shown in the sanction letter.</>}
                    />
                    <RateProblem parsed={pBench} onFix={setStartBench} fixOnly />
                  </div>
                  <div>
                    <Field
                      label="Your spread (%)"
                      value={startSpread}
                      error={at('startSpread') ?? pSpread.error}
                      onChange={setStartSpread}
                      placeholder="0.35"
                      findIt={whereToFind('spread', IN)}
                      info={<>The extra over the benchmark that applies to you, often called the spread, margin or credit risk premium.</>}
                    />
                    <RateProblem parsed={pSpread} onFix={setStartSpread} fixOnly />
                  </div>
                </LFieldGrid>
              )}
            </div>
          </div>

          <div data-testid="lc-spread-question">
            <LChipRow label="Has your bank told you in writing that your spread changed since the loan started?">
              <LChip on={spreadChanged === 'no'} onClick={() => setSpreadChanged('no')}>No</LChip>
              <LChip on={spreadChanged === 'yes'} onClick={() => setSpreadChanged('yes')}>Yes</LChip>
              <LChip on={spreadChanged === 'unsure'} onClick={() => setSpreadChanged('unsure')}>Not sure</LChip>
            </LChipRow>
            <p style={{ fontSize: 11, margin: '6px 0 0', color: L_T.muted }}>
              The spread (margin) is what your bank adds on top of the repo rate. A bank may
              raise it only if your credit assessment changed substantially, as your loan
              contract says, or the operating-cost part once in three years. A raised spread
              explains part of a higher rate, so the check needs to know.
            </p>
            {spreadChanged === 'yes' && (
              <div style={{ maxWidth: 320, marginTop: 8 }}>
                <Field
                  label="By how much? (points: +0.25 raised, -0.10 cut)"
                  value={spreadChange}
                  onChange={setSpreadChange}
                  placeholder="+0.25"
                  error={at('spreadChange') ?? (spreadChange ? pSpreadChange.error : null)}
                  findIt="the bank's rate-change letter or SMS, or your statement"
                />
              </div>
            )}
          </div>

          <HikeQuestions
            action={bankAction}
            onAction={setBankAction}
            offered={choiceOffered}
            onOffered={setChoiceOffered}
          />

          {onOldBenchmark && (
            <div data-testid="lc-switch-fields">
              <LStepSub>Switching to the repo-linked rate (optional)</LStepSub>
              <LFieldGrid min={200}>
                <div>
                  <Field
                    label="Repo-linked rate your bank quotes (%)"
                    value={switchRate}
                    onChange={setSwitchRate}
                    placeholder="8.15"
                    error={at('switchRate') ?? pSwitch.error}
                    hint="Blank: the top of its published range"
                  />
                  <RateProblem parsed={pSwitch} onFix={setSwitchRate} fixOnly />
                </div>
                <Field label="Switch charge (₹)" kind="money" currency="INR" value={switchCost} onChange={setSwitchCost} error={at('switchCost')} hint="Its administrative or legal charge, if quoted" />
              </LFieldGrid>
            </div>
          )}

          <div>
            <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
            {!more && (
              <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>
                {lastReset ? `Rate last changed ${lastReset}` : 'When your rate last changed'}
              </span>
            )}
            {more && (
              <div style={{ marginTop: 10, maxWidth: 360 }}>
                <MonthYearPicker
                  label="Month your rate last changed"
                  value={lastReset}
                  error={at('lastReset')}
                  onChange={setLastReset}
                  minYear={2019}
                  optional
                  hint="Counts the overcharge further back. Find it: the rate-change letter or SMS, or the statement where the rate moved. Skip if unsure."
                />
              </div>
            )}
            {more && (
              <div style={{ marginTop: 14 }}>
                <RateHistoryRows rows={historyRows} onChange={setHistoryRows} error={at('rateHistory') ?? parsedHistory.error} />
              </div>
            )}
          </div>

          <div>
            <SubmitBar busy={busy} error={err} label="Check my loan" />
            {!err && stillNeeded.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: L_T.muted }}>Still needed: {stillNeeded.join(', ')}.</div>
            )}
          </div>
        </form>
      </LStep>

      <div aria-live="polite" ref={resultRef} tabIndex={-1} style={{ outline: 'none' }}>
        {result && <LoanCheckResult r={result} />}
        {result && <LoanCheckSignals r={result} />}
      </div>
      {result?.rate_rise && <RateRiseCard rr={result.rate_rise} />}
      {result?.reset_watch && <ResetWatchCard w={result.reset_watch} />}
      {result?.pass_through && <PassThroughCard pt={result.pass_through} />}
      {result && checked && result.findings.some((f) => f.kind === 'choice_not_offered') && (
        <ResetChoicePanel request={checked} />
      )}
      {result && checked && result.findings.some((f) => f.claimable) && (
        <>
          <LenderRecord lender={checked.lender} />
          <ComplaintPanel request={checked} />
        </>
      )}
      {result && checked && <OfferPanel request={checked} />}
      {result && <PlanBridge r={result} />}
    </LSteps>
  );
}

function LoanCheckResult({ r }: { r: LoanCheckResponse }) {
  const inr = (v: string) => formatCurrency(v, 'INR');
  const claimable = r.findings.some((f) => f.claimable);
  const gap = r.expected_rate ? new Decimal(r.current_rate).minus(r.expected_rate) : null;
  return (
    <LSteps>
      <LStep no="02" id="lc-out" title="The answer" answer>
        <LVerdict tone={r.verdict === 'missed_rate_cut' ? 'accent' : r.verdict === 'old_benchmark' || r.verdict === 'rule_not_binding' ? 'accent' : 'pos'}>
          {VERDICT[r.verdict] ?? (claimable ? VERDICT.missed_rate_cut : VERDICT.matches)}
        </LVerdict>
        <LNote>{r.summary}</LNote>
        <LKpi
          items={[
            { l: 'YOU PAY', v: formatPct(r.current_rate, 2) },
            ...(r.expected_rate ? [{ l: 'SHOULD BE ABOUT', v: formatPct(r.expected_rate, 2), tone: L_T.positive }] : []),
            ...(claimable
              ? [
                  { l: 'ESTIMATE, NEXT 12 MONTHS', v: inr(r.amount_at_stake_this_year), s: 'for your conversation with the bank, not a confirmed refund', tone: L_T.negative },
                  { l: 'POSSIBLY OVERCHARGED SO FAR', v: inr(r.claim_amount), s: 'a cautious estimate a complaint asks the bank to check', tone: L_T.negative },
                ]
              : []),
          ]}
        />
        {r.stale_rates_warning && (
          <p role="note" style={{ fontSize: 12, color: L_T.accent, margin: '12px 0 0' }}>
            {r.stale_rates_warning}
          </p>
        )}
        {r.findings.map((f, i) => (
          <FindingCard key={i} f={f} />
        ))}
        {r.new_borrower_note && (
          <p data-testid="lc-new-borrower-note" style={{ fontSize: 12, margin: '14px 0 0', color: L_T.muted }}>
            {r.new_borrower_note}
          </p>
        )}
      </LStep>

      <LMathBlock
        rows={[
          { k: 'you pay', v: formatPct(r.current_rate, 2) },
          ...(r.expected_rate
            ? [
                {
                  k: 'should be about',
                  v: formatPct(r.expected_rate, 2),
                  note: 'your starting rate, moved as much as the repo rate has, with up to 3 months to reset',
                },
              ]
            : []),
          ...(gap
            ? [
                {
                  k: 'gap',
                  v: gapWords(gap),
                  tone: gap.gt(TOL) ? ('neg' as const) : undefined,
                  note: gap.gt(TOL)
                    ? 'you pay more than the repo moves imply'
                    : gap.lt(-TOL)
                      ? 'you pay less than the repo moves imply: in your favour, nothing to claim'
                      : 'level, within rounding',
                },
              ]
            : []),
          ...(claimable
            ? [
                { k: 'at stake, next 12 months', v: inr(r.amount_at_stake_this_year) },
                { k: 'overcharged so far', v: inr(r.claim_amount), note: "at today's balance, whole months only: a cautious figure" },
              ]
            : []),
          {
            k: 'repo rate today',
            v: formatPct(r.repo_today, 2),
            note: r.rates_source.includes(formatAsOf(r.rates_as_of))
              ? r.rates_source
              : `${r.rates_source}, ${formatAsOf(r.rates_as_of)}`,
          },
        ]}
      />

      {(r.repo_changes_since_start.length > 0 || r.assumptions.length > 0) && (
        <details style={{ border: `1px solid ${L_T.ruleSoft}`, padding: '12px 16px', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', letterSpacing: '0.12em', fontSize: 11 }}>
            REPO RATE MOVES AND ASSUMPTIONS
          </summary>
          {r.repo_changes_since_start.length > 0 && (
            <div role="region" aria-label="RBI repo rate changes" tabIndex={0} style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 300 }}>
                <thead>
                  <tr>
                    <th scope="col" style={th}>DATE</th>
                    <th scope="col" style={th}>FROM</th>
                    <th scope="col" style={th}>TO</th>
                    <th scope="col" style={th}>MOVE</th>
                  </tr>
                </thead>
                <tbody>
                  {r.repo_changes_since_start.map((c) => {
                    const move = new Decimal(c.new_rate).minus(c.old_rate);
                    return (
                      <tr key={c.date}>
                        <td style={td}>
                          {new Date(c.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="num" style={td}>{formatPct(c.old_rate, 2)}</td>
                        <td className="num" style={td}>{formatPct(c.new_rate, 2)}</td>
                        <td className="num" style={{ ...td, color: move.lt(0) ? L_T.positive : L_T.negative }}>
                          {move.lt(0) ? 'cut ' : 'rise '}
                          {formatPct(move.abs().toString(), 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <ul style={{ lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 18 }}>
            {r.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </LSteps>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 12px 6px 0',
  borderBottom: '1px solid var(--border)',
  fontWeight: 500,
  fontSize: 10,
  letterSpacing: '0.12em',
  color: 'var(--muted)',
};
const td: React.CSSProperties = { padding: '6px 12px 6px 0' };

const VERDICT: Record<LoanCheckResponse['verdict'], string> = {
  missed_rate_cut: 'Your rate looks higher than the RBI rules allow.',
  matches: 'No missed rate cut.',
  below_expected: 'You pay less than the repo moves imply: in your favour.',
  old_benchmark: 'Your loan is on an old benchmark.',
  rule_not_binding: "The repo-rate rule for banks doesn't bind this lender.",
};

function icsDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/** A one-event calendar file, made in the browser (nothing is sent). */
function downloadIcs(w: LoanCheckResetWatch) {
  if (!w.check_by) return;
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RightDue//Loan Check reset watch//EN',
    'BEGIN:VEVENT',
    `UID:rightdue-reset-${w.check_by}@rightdue.app`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;VALUE=DATE:${icsDate(w.check_by)}`,
    'SUMMARY:Check your home-loan rate (RightDue Loan Check)',
    `DESCRIPTION:${w.detail.replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, ' ')}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `rightdue-rate-check-${w.check_by}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function ResetWatchCard({ w }: { w: LoanCheckResetWatch }) {
  return (
    <LStep no="03" id="lc-reset" title="Reset watch">
      <div data-testid="lc-reset-watch">
        <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px' }}>{w.headline}</p>
        <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>{w.detail}</p>
        {w.check_by && (
          <p style={{ margin: '10px 0 0' }}>
            <LBracket onClick={() => downloadIcs(w)}>ADD A REMINDER TO MY CALENDAR (.ICS)</LBracket>
          </p>
        )}
        {w.citations.map((c, i) => (
          <div key={i} style={{ fontSize: 12, marginTop: 8 }}>
            {c.requirement}
            <RuleQuote c={c} />
          </div>
        ))}
      </div>
    </LStep>
  );
}

function FindingCard({ f }: { f: LoanCheckFinding }) {
  const tag =
    f.kind === 'missed_rate_cut'
      ? 'Possible refund claim: an estimate to check with the bank'
      : f.kind === 'pricing_gap'
        ? 'For information, not a refund claim'
        : f.kind === 'below_expected'
          ? 'In your favour, nothing to claim'
          : f.kind === 'rule_not_binding'
            ? 'Information, not a refund claim'
            : f.kind === 'rate_rise'
              ? 'The rate rise: your choice, not a refund claim'
              : f.kind === 'choice_not_offered'
                ? 'Your right to choose: a letter, not a refund claim'
                : f.kind === 'asymmetric_pass_through'
                  ? 'Worth asking about, not a refund claim yet'
                  : 'A switch, not a refund claim';
  return (
    <div style={{ marginTop: 18 }}>
      <LStepSub>{tag}</LStepSub>
      <p style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 6px' }}>{f.headline}</p>
      <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>{f.detail}</p>
      {f.citations.map((c, i) => (
        <div key={i} style={{ margin: '10px 0 0', padding: '6px 12px', borderLeft: `3px solid ${L_T.ruleSoft}`, fontSize: 12 }}>
          <div>{c.requirement}</div>
          <div style={{ fontSize: 11, marginTop: 4, color: L_T.muted }}>{c.rule}</div>
          <RuleQuote c={c} />
        </div>
      ))}
      <p style={{ fontSize: 12, margin: '10px 0 0' }}>
        <strong>Next step:</strong> {f.next_step}
      </p>
    </div>
  );
}

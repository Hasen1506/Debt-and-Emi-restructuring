'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { ComplaintPanel } from './complaint';
import { OfferPanel } from './offers';
import { LenderRecord } from './outcome';
import { RateProblem } from './rate-problem';
import {
  BankCombobox,
  Field,
  InfoTip,
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
  type LoanBenchmark,
  type LoanCheckFinding,
  type LoanCheckRequest,
  type LoanCheckResponse,
} from '@/lib/api';
import { useStoredProfile } from '@/lib/use-profile';
import { parsePercentInput, parseSpreadInput } from '@/lib/rate-input';
import { formatAsOf } from '@/lib/as-of';
import { useFormErrors } from '@/lib/form-errors';

type StartMode = 'headline' | 'split';

// The API's field names → this form's inputs (api/routes/loan_check.py).
const FIELDS: Record<string, string> = {
  lender: 'lender',
  loan_start: 'loanStart',
  start_rate: 'startRate',
  start_benchmark_rate: 'startBench',
  start_spread: 'startSpread',
  current_rate: 'currentRate',
  outstanding: 'outstanding',
  tenure_months_remaining: 'months',
  emi: 'emi',
  last_reset: 'lastReset',
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

  const [lender, setLender] = useState(homeLoan?.bank ?? '');
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

  function pickLoan(i: number | null) {
    setLoanIdx(i);
    const l = i === null ? undefined : profile.user.loans[i];
    setLender(l?.bank ?? '');
    setCurrentRate(pctFromFraction(l?.nominal_rate));
    setOutstanding(l?.outstanding ?? '');
    setMonths(l ? String(l.tenure_months_remaining) : '');
    setEmi(l?.scheduled_emi ?? '');
    setEditLoan(!l);
  }
  useEffect(() => { if (loanIdx != null) pickLoan(loanIdx); }, [profile.user.loans]); // eslint-disable-line react-hooks/exhaustive-deps

  const [resultValue, setResult] = useState<LoanCheckResponse | null>(null);
  const fingerprint = JSON.stringify([loanIdx,lender,loanStart,benchmark,startMode,startRate,startBench,startSpread,currentRate,outstanding,months,emi,lastReset,profile.user]);
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

  // What is still missing before the check can run. Shown next to the
  // button, so nobody has to guess why nothing happens.
  const stillNeeded: string[] = [];
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

  const hasInputError =
    (startMode === 'headline' ? !!pStart.error : !!pBench.error || !!pSpread.error) ||
    !!pCurrent.error;

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
      };
      const res = await api.loanCheck(req);
      setResult(res);
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
      <LStep no="01" id="lc-in" title="Your home loan">
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
          {picked && !editLoan ? (
            loanSummary
          ) : (
            <LFieldGrid>
              <BankCombobox label="Lender" value={lender} onChange={setLender} country="IN" hint="To compare with what it charges new borrowers" />
              <div>
                <Field
                  label="Rate you pay now (%)"
                  value={currentRate}
                  error={at('currentRate')}
                  onChange={setCurrentRate}
                  placeholder="8.90"
                  hint="From your latest statement or the bank's app"
                />
                <RateProblem parsed={pCurrent} onFix={setCurrentRate} />
              </div>
              <Field label="Still owed" kind="money" currency="INR" value={outstanding} error={at('outstanding')} onChange={setOutstanding} />
              <Field label="Months left" value={months} error={at('months')} onChange={setMonths} kind="integer" placeholder="200" />
              <Field label="EMI (optional)" kind="money" currency="INR" value={emi} error={at('emi')} onChange={setEmi} hint="Blank: worked out for you" />
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
              hint="If you later moved to a repo-linked rate, the month you moved"
            />
            <Select
              label="What is the rate linked to?"
              value={benchmark}
              onChange={setBenchmark}
              options={BENCHMARK_OPTIONS}
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
                  <Field label="Rate when the loan started (%)" value={startRate} error={at('startRate')} onChange={setStartRate} placeholder="8.55" />
                  <RateProblem parsed={pStart} onFix={setStartRate} />
                </div>
              ) : (
                <LFieldGrid min={200}>
                  <div>
                    <Field
                      label="Bank's benchmark rate then (%)"
                      value={startBench}
                      error={at('startBench')}
                      onChange={setStartBench}
                      placeholder="8.20"
                      info={<>The lender&apos;s RLLR / EBLR on the day the loan started, as shown in the sanction letter.</>}
                    />
                    <RateProblem parsed={pBench} onFix={setStartBench} />
                  </div>
                  <div>
                    <Field
                      label="Your spread (%)"
                      value={startSpread}
                      error={at('startSpread')}
                      onChange={setStartSpread}
                      placeholder="0.35"
                      info={<>The extra over the benchmark that applies to you, often called the spread, margin or credit risk premium.</>}
                    />
                    <RateProblem parsed={pSpread} onFix={setStartSpread} />
                  </div>
                </LFieldGrid>
              )}
            </div>
          </div>

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
                  hint="Counts the overcharge further back. Skip if unsure."
                />
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
      </div>
      {result && checked && result.findings.some((f) => f.claimable) && (
        <>
          <LenderRecord lender={checked.lender} />
          <ComplaintPanel request={checked} />
        </>
      )}
      {result && checked && <OfferPanel request={checked} />}
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
        <LVerdict tone={r.status === 'no_issue' ? 'pos' : 'accent'}>
          {r.status === 'no_issue'
            ? 'No missed rate cut.'
            : r.status === 'not_applicable'
              ? 'Your loan is on an old benchmark.'
              : claimable
                ? 'Your bank owes you a rate cut.'
                : 'Worth a conversation with your bank.'}
        </LVerdict>
        <LNote>{r.summary}</LNote>
        <LKpi
          items={[
            { l: 'YOU PAY', v: formatPct(r.current_rate, 2) },
            ...(r.expected_rate ? [{ l: 'SHOULD BE ABOUT', v: formatPct(r.expected_rate, 2), tone: L_T.positive }] : []),
            ...(claimable
              ? [
                  { l: 'AT STAKE, NEXT 12 MONTHS', v: inr(r.amount_at_stake_this_year), tone: L_T.negative },
                  { l: 'OVERCHARGED SO FAR', v: inr(r.claim_amount), s: 'what a complaint can ask back', tone: L_T.negative },
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
          ...(gap ? [{ k: 'gap', v: formatPct(gap.toString(), 2), tone: gap.gt(0) ? ('neg' as const) : undefined }] : []),
          ...(claimable
            ? [
                { k: 'at stake, next 12 months', v: inr(r.amount_at_stake_this_year) },
                { k: 'overcharged so far', v: inr(r.claim_amount), note: "at today's balance, whole months only: a cautious figure" },
              ]
            : []),
          { k: 'repo rate', v: formatAsOf(r.rates_as_of), note: r.rates_source },
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

function FindingCard({ f }: { f: LoanCheckFinding }) {
  const tag =
    f.kind === 'missed_rate_cut'
      ? 'Refund claim'
      : f.kind === 'pricing_gap'
        ? 'For information, not a refund claim'
        : 'A switch, not a refund claim';
  return (
    <div style={{ marginTop: 18 }}>
      <LStepSub>{tag}</LStepSub>
      <p style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 6px' }}>{f.headline}</p>
      <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>{f.detail}</p>
      {f.citations.map((c, i) => (
        <blockquote key={i} style={{ margin: '10px 0 0', padding: '6px 12px', borderLeft: `3px solid ${L_T.ruleSoft}`, fontSize: 12 }}>
          <div>{c.requirement}</div>
          <div style={{ fontSize: 11, marginTop: 4, color: L_T.muted }}>{c.rule}</div>
        </blockquote>
      ))}
      <p style={{ fontSize: 12, margin: '10px 0 0' }}>
        <strong>Next step:</strong> {f.next_step}
      </p>
    </div>
  );
}

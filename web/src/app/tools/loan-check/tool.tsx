'use client';

import { useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
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
  Stat,
  SubmitBar,
} from '@/components/ToolPrimitives';
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
  const homeLoan = useMemo(
    () =>
      profile.isLive
        ? (profile.user.loans ?? []).find((l) => l.loan_type === 'home_loan')
        : undefined,
    [profile.isLive, profile.user.loans],
  );

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

  const [result, setResult] = useState<LoanCheckResponse | null>(null);
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
      <Card>
        <p style={{ margin: 0 }}>
          Loan Check covers Indian floating-rate home loans for now. The US
          version (adjustable-rate mortgages and card billing errors) is on
          the way.
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <form
          onSubmit={check}
          noValidate
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          {homeLoan && (
            <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
              Filled from the home loan in your profile. Change anything that
              is out of date.
            </div>
          )}
          <BankCombobox
            label="Lender"
            value={lender}
            onChange={setLender}
            country="IN"
            hint="Used to compare with the rates it gives new borrowers."
          />
          <MonthYearPicker
            label="Month the loan started"
            value={loanStart}
            error={at('loanStart')}
            onChange={setLoanStart}
            minYear={1995}
            hint="If you later switched to a repo-linked rate, use the month of the switch."
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

          <fieldset
            style={{ gridColumn: '1 / -1', border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <legend className="muted" style={{ fontSize: 12, padding: 0, marginBottom: 6 }}>
              Starting rate
            </legend>
            <div
              role="radiogroup"
              aria-label="How do you know the starting rate?"
              style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}
            >
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="radio"
                  name="start-mode"
                  checked={startMode === 'headline'}
                  onChange={() => setStartMode('headline')}
                />
                One rate (e.g. 8.55%)
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="radio"
                  name="start-mode"
                  checked={startMode === 'split'}
                  onChange={() => setStartMode('split')}
                />
                Benchmark + spread (e.g. 8.20% + 0.35%)
              </label>
            </div>
            {startMode === 'headline' ? (
              <div style={{ maxWidth: 320 }}>
                <Field
                  label="Rate when the loan started (%)"
                  value={startRate}
                  error={at('startRate')}
                  onChange={setStartRate}
                  placeholder="8.55"
                />
                <RateProblem parsed={pStart} onFix={setStartRate} />
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                }}
              >
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
                {(startBench === '') !== (startSpread === '') && (
                  <span
                    role="status"
                    style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--accent)' }}
                  >
                    Still needed: {startBench ? 'your spread' : "the bank's benchmark rate then"}.
                  </span>
                )}
              </div>
            )}
          </fieldset>

          <div>
            <Field
              label="Rate you pay now (%)"
              value={currentRate}
              error={at('currentRate')}
              onChange={setCurrentRate}
              placeholder="8.90"
              hint="From your latest statement or the bank's app."
            />
            <RateProblem parsed={pCurrent} onFix={setCurrentRate} />
          </div>
          <Field
            label="Outstanding balance (₹)"
            value={outstanding}
            error={at('outstanding')}
            onChange={setOutstanding}
            placeholder="40,00,000"
          />
          <Field
            label="Months left"
            value={months}
            error={at('months')}
            onChange={setMonths}
            kind="integer"
            placeholder="200"
          />
          <Field
            label="EMI (₹, optional)"
            value={emi}
            error={at('emi')}
            onChange={setEmi}
            hint="Leave blank and we work it out."
          />
          <MonthYearPicker
            label="Month your rate last changed"
            value={lastReset}
            error={at('lastReset')}
            onChange={setLastReset}
            minYear={2019}
            optional
            hint="Lets us count the overcharge further back. Skip if unsure."
          />

          <SubmitBar busy={busy} error={err} label="Check my loan" />
          {!err && stillNeeded.length > 0 && (
            <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
              Still needed: {stillNeeded.join(', ')}.
            </div>
          )}
        </form>
      </Card>

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
    </div>
  );
}

function statusColor(status: LoanCheckResponse['status']): string {
  if (status === 'no_issue') return 'var(--positive)';
  return 'var(--accent)';
}

function LoanCheckResult({ r }: { r: LoanCheckResponse }) {
  const inr = (v: string) => formatCurrency(v, 'INR');
  const claimable = r.findings.some((f) => f.claimable);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <h2 style={{ fontSize: 20, margin: 0, color: statusColor(r.status) }}>
          {r.status === 'no_issue'
            ? 'No missed rate cut'
            : r.status === 'not_applicable'
              ? 'Old benchmark'
              : claimable
                ? 'Your bank owes you a rate cut'
                : 'Worth a conversation with your bank'}
        </h2>
        <p style={{ margin: '6px 0 14px', fontSize: 14 }}>{r.summary}</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
          }}
        >
          <Stat label="You pay" value={formatPct(r.current_rate, 2)} />
          {r.expected_rate && (
            <Stat
              label={
                <>
                  Should be about{' '}
                  <InfoTip>
                    Your starting rate moved by exactly as much as the RBI
                    repo rate has since, allowing the bank up to three months
                    to reset.
                  </InfoTip>
                </>
              }
              value={formatPct(r.expected_rate, 2)}
              color="var(--positive)"
            />
          )}
          {claimable && (
            <>
              <Stat
                label="At stake over the next 12 months"
                value={inr(r.amount_at_stake_this_year)}
                color="var(--negative)"
              />
              <Stat
                label={
                  <>
                    Overcharged so far{' '}
                    <InfoTip>
                      A cautious estimate: counted at today&apos;s balance
                      (lower than it was), whole months only. This is the
                      refund your complaint can ask for.
                    </InfoTip>
                  </>
                }
                value={inr(r.claim_amount)}
                color="var(--negative)"
              />
            </>
          )}
        </div>
        {r.stale_rates_warning && (
          <p role="note" style={{ fontSize: 12, color: 'var(--accent)', margin: '12px 0 0' }}>
            {r.stale_rates_warning}
          </p>
        )}
      </Card>

      {r.findings.map((f, i) => (
        <FindingCard key={i} f={f} />
      ))}

      {r.repo_changes_since_start.length > 0 && (
        <Card>
          <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>
            RBI repo rate changes since your loan started
          </h3>
          <div
            role="region"
            aria-label="RBI repo rate changes"
            tabIndex={0}
            style={{ overflowX: 'auto' }}
          >
            <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 320 }}>
              <thead>
                <tr>
                  <th scope="col" style={th}>Date</th>
                  <th scope="col" style={th}>From</th>
                  <th scope="col" style={th}>To</th>
                  <th scope="col" style={th}>Move</th>
                </tr>
              </thead>
              <tbody>
                {r.repo_changes_since_start.map((c) => {
                  const move = new Decimal(c.new_rate).minus(c.old_rate);
                  return (
                    <tr key={c.date}>
                      <td style={td}>
                        {new Date(c.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="num" style={td}>{formatPct(c.old_rate, 2)}</td>
                      <td className="num" style={td}>{formatPct(c.new_rate, 2)}</td>
                      <td
                        className="num"
                        style={{
                          ...td,
                          color: move.lt(0) ? 'var(--positive)' : 'var(--negative)',
                        }}
                      >
                        {move.lt(0) ? 'cut ' : 'hike '}
                        {formatPct(move.abs().toString(), 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 14 }}>How this was worked out</summary>
          <ul style={{ fontSize: 13, lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 18 }}>
            {r.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
            <li>
              RBI repo rate as of {formatAsOf(r.rates_as_of)}. Source: {r.rates_source}.
            </li>
          </ul>
        </details>
      </Card>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 12px 6px 0',
  borderBottom: '1px solid var(--border)',
  fontWeight: 600,
};
const td: React.CSSProperties = { padding: '6px 12px 6px 0' };

function FindingCard({ f }: { f: LoanCheckFinding }) {
  const tag =
    f.kind === 'missed_rate_cut'
      ? 'Refund claim'
      : f.kind === 'pricing_gap'
        ? 'Information, not a refund claim'
        : 'Switch, not a refund claim';
  return (
    <Card>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {tag}
      </div>
      <h3 style={{ fontSize: 17, margin: '4px 0 8px' }}>{f.headline}</h3>
      <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{f.detail}</p>
      {f.citations.map((c, i) => (
        <blockquote
          key={i}
          style={{
            margin: '12px 0 0',
            padding: '8px 12px',
            borderLeft: '3px solid var(--border)',
            fontSize: 13,
          }}
        >
          <div>{c.requirement}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {c.rule}
          </div>
        </blockquote>
      ))}
      <p style={{ fontSize: 14, margin: '12px 0 0' }}>
        <strong>Next step:</strong> {f.next_step}
      </p>
    </Card>
  );
}

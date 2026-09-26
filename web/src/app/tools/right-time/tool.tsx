'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  AddLoanAction,
  Field,
  InfoTip,
  Select,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import {
  api,
  formatCurrency,
  formatPct,
  type BorrowTimingResponse,
  type InstitutionPayload,
  type LoanType,
} from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
import { useFormErrors } from '@/lib/form-errors';
import { addLoanToProfile } from '@/lib/add-loan-to-profile';
import { userDefaultCurrency } from '@/lib/currency';

type Urgency = 'now' | '3m_ok' | '6m_ok';

const LOAN_TYPE_OPTIONS: { value: LoanType; label: string }[] = [
  { value: 'home_loan', label: 'Home loan' },
  { value: 'auto_loan', label: 'Auto loan' },
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'education_loan', label: 'Education loan' },
];

const TENURE_DEFAULT: Record<string, string> = {
  home_loan: '240',
  auto_loan: '60',
  personal_loan: '60',
  education_loan: '120',
};

const RATE_FIELD: Record<LoanType, keyof InstitutionPayload | null> = {
  home_loan: 'home_loan',
  auto_loan: 'auto_loan',
  personal_loan: 'personal_loan',
  education_loan: 'education_loan',
  credit_card: null,
  gold_loan: null,
  bnpl: null,
};


// The API's field names → this form's inputs, so a rejected value's
// message shows under the input it came from.
const FIELDS: Record<string, string> = {
  principal: 'principal',
  tenure_months: 'tenure',
  consensus_change_bps: 'changeBps',
  months_to_decision: 'monthsTo',
  current_rate: 'currentRateOverride',
  six_month_avg: 'sixMoOverride',
};

export function RightTimeTool() {
  const profile = useMemo(() => loadProfileClient(), []);
  const country = profile.user.country as 'IN' | 'US';

  const [loanType, setLoanType] = useState<LoanType>('home_loan');
  const [institutions, setInstitutions] = useState<InstitutionPayload[] | null>(null);
  const [bank, setBank] = useState<string>('');

  const [principal, setPrincipal] = useState('5000000');
  const [tenure, setTenure] = useState(TENURE_DEFAULT.home_loan);
  const [urgency, setUrgency] = useState<Urgency>('3m_ok');

  const [changeBps, setChangeBps] = useState('-50');
  const [monthsTo, setMonthsTo] = useState('3');

  // Allow override but derive from rate-card by default.
  const [currentRateOverride, setCurrentRateOverride] = useState('');
  const [sixMoOverride, setSixMoOverride] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [v, setV] = useState<BorrowTimingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setTenure(TENURE_DEFAULT[loanType] ?? '60');
    setV(null);
    setAdded(false);
  }, [loanType]);

  useEffect(() => {
    let cancelled = false;
    api.institutions(country)
      .then((data) => {
        if (!cancelled) {
          setInstitutions(data);
          // Pre-select the user's primary bank when it has a published rate
          // card for this loan type; otherwise leave empty so the form
          // shows the dropdown.
          const primary = profile.user.primary_bank;
          if (primary) {
            const match = data.find((i) => i.name.toLowerCase() === primary.toLowerCase());
            const field = RATE_FIELD[loanType];
            if (match && field && match[field]) {
              setBank(primary);
            }
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [country, loanType, profile.user.primary_bank]);

  const bankRange = useMemo(() => {
    if (!institutions || !bank) return null;
    const inst = institutions.find((i) => i.name.toLowerCase() === bank.toLowerCase());
    if (!inst) return null;
    const field = RATE_FIELD[loanType];
    if (!field) return null;
    const range = inst[field] as { low: string; high: string; median: string } | null;
    if (!range) return null;
    return range;
  }, [institutions, bank, loanType]);

  const currentRate = currentRateOverride || bankRange?.median || '';
  const sixMoAvg = sixMoOverride || currentRate;

  // Knowing whether the bank is one the user already has → drives the
  // AddLoanAction CTA later.
  const isExistingBank = useMemo(() => {
    const set = new Set<string>();
    if (profile.user.primary_bank) set.add(profile.user.primary_bank.toLowerCase());
    for (const b of profile.user.other_banks ?? []) set.add(b.toLowerCase());
    for (const l of profile.user.loans ?? []) {
      if (l.bank) set.add(l.bank.toLowerCase());
    }
    return bank ? set.has(bank.toLowerCase()) : false;
  }, [bank, profile.user]);

  const bankOptions = useMemo(() => {
    if (!institutions) return [];
    const field = RATE_FIELD[loanType];
    if (!field) return [];
    return institutions
      .filter((i) => (i[field] as unknown) != null)
      .map((i) => ({ value: i.name, label: i.name }));
  }, [institutions, loanType]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!currentRate) {
      setErr('Pick a bank with a published rate card, or enter a rate manually under Advanced.');
      return;
    }
    setBusy(true);
    clear();
    setAdded(false);
    try {
      setV(
        await api.rightTime({
          current_rate: currentRate,
          six_month_avg: sixMoAvg,
          consensus_change_bps: Number(changeBps),
          months_to_decision: Number(monthsTo),
          urgency,
          principal,
          tenure_months: Number(tenure),
        }),
      );
    } catch (e) {
      fail(e, FIELDS);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Select
            label="Loan type"
            value={loanType}
            onChange={(v) => setLoanType(v as LoanType)}
            options={LOAN_TYPE_OPTIONS}
          />
          <Select
            label="Bank (for the current quoted rate)"
            value={bank}
            onChange={setBank}
            options={[{ value: '', label: '— pick a bank —' }, ...bankOptions]}
            info={
              <>
                We pull the bank&apos;s published median rate. The actual
                offer depends on credit profile; use the advanced override if
                you have a real quote.
              </>
            }
          />
          {bankRange && (
            <div
              className="muted"
              style={{ gridColumn: '1 / -1', fontSize: 12, padding: '2px 0' }}
            >
              Current published range at <strong>{bank}</strong>:{' '}
              <span className="num" style={{ color: 'var(--ink)' }}>
                {formatPct(bankRange.low, 2)}–{formatPct(bankRange.high, 2)}
              </span>{' '}
              (median {formatPct(bankRange.median, 2)})
            </div>
          )}
          <Field label="Loan amount" value={principal} onChange={setPrincipal} error={at('principal')} />
          <Field
            label="Tenure (months)"
            value={tenure}
            error={at('tenure')}
            onChange={setTenure}
            kind="integer"
          />
          <Select
            label="How urgent is the borrow?"
            value={urgency}
            onChange={setUrgency}
            options={[
              { value: 'now' as Urgency, label: 'I need it now' },
              { value: '3m_ok' as Urgency, label: 'I can wait 3 months' },
              { value: '6m_ok' as Urgency, label: 'I can wait 6 months' },
            ]}
            info={<>If you can&apos;t wait, the answer is always &ldquo;borrow now&rdquo; — locking today&apos;s rate is the right call.</>}
          />
          <Field
            label="Consensus change at next decision (bps)"
            value={changeBps}
            error={at('changeBps')}
            onChange={setChangeBps}
            hint="−50 = 50bps cut expected; +25 = 25bps hike. 0 if unsure."
            info={
              <>
                Market consensus for the next central-bank move, in basis
                points (1bp = 0.01%). Bloomberg / CNBC publish street
                consensus before each MPC / FOMC meeting.
              </>
            }
          />
          <Field
            label="Months to next decision"
            value={monthsTo}
            error={at('monthsTo')}
            onChange={setMonthsTo}
            kind="integer"
            hint="RBI MPC: every 2 months. Fed FOMC: every ~6 weeks."
          />

          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 12,
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced (override rates manually)
            </button>
          </div>
          {showAdvanced && (
            <>
              <Field
                label="Override current rate (decimal)"
                value={currentRateOverride}
                error={at('currentRateOverride')}
                onChange={setCurrentRateOverride}
                hint={`leave blank to use ${bank || 'bank'} median`}
              />
              <Field
                label="Override 6-mo average rate (decimal)"
                value={sixMoOverride}
                error={at('sixMoOverride')}
                onChange={setSixMoOverride}
                hint="leave blank to use current rate (neutral)"
              />
            </>
          )}
          <SubmitBar busy={busy} error={err} label="What should I do?" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={v.verdict === 'wait' ? 'Wait' : 'Borrow now'}
            color={v.verdict === 'wait' ? 'var(--accent)' : 'var(--positive)'}
            detail={v.detail}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            <Stat label="Current rate" value={formatPct(v.current_rate, 2)} />
            <Stat label="6-mo avg" value={formatPct(v.six_month_avg, 2)} />
            <Stat
              label={
                <>
                  Est. savings if you wait{' '}
                  <InfoTip>
                    Principal × expected cut × tenure. Rough — assumes the
                    cut flows straight through to your loan rate, which most
                    floating loans honour at the next reset.
                  </InfoTip>
                </>
              }
              value={formatCurrency(v.estimated_savings, userDefaultCurrency(country))}
              color={v.verdict === 'wait' ? 'var(--positive)' : 'var(--muted)'}
            />
          </div>
          {v.verdict === 'borrow_now' && bank && currentRate && (
            <AddLoanAction
              added={added}
              onAdd={() => {
                // Derive EMI from the rate we used; cheap helper.
                const r = Number(currentRate) / 12;
                const n = Number(tenure);
                const p = Number(principal);
                const emi = r === 0 ? p / n : (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                addLoanToProfile({
                  loan_type: loanType,
                  bank,
                  outstanding: principal,
                  nominal_rate: String(currentRate),
                  tenure_months_remaining: Number(tenure),
                  scheduled_emi: emi.toFixed(2),
                });
                setAdded(true);
              }}
              label={`Add this ${loanType.replace('_', ' ')} at ${bank} to my profile${isExistingBank ? '' : ' (new bank)'}`}
            />
          )}
        </Card>
      )}
    </div>
  );
}

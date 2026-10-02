'use client';

import { useEffect, useMemo, useState } from 'react';
import { AddLoanAction, Field, Select, SubmitBar } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LStepSub, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import {
  api,
  formatCurrency,
  formatPct,
  type BorrowTimingResponse,
  type InstitutionPayload,
  type LoanType,
} from '@/lib/api';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { useFormErrors } from '@/lib/form-errors';
import { addLoanToProfile } from '@/lib/add-loan-to-profile';
import { userDefaultCurrency } from '@/lib/currency';
import { deriveMetrics } from '@/lib/derived';
import { LOAN_TYPE_NAME, loanName } from '@/lib/loan-types';

type Urgency = 'now' | '3m_ok' | '6m_ok';

const LOAN_TYPES: LoanType[] = ['home_loan', 'auto_loan', 'personal_loan', 'education_loan'];

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

const URGENCY: { value: Urgency; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: '3m_ok', label: 'Can wait 3 months' },
  { value: '6m_ok', label: 'Can wait 6 months' },
];

// One tap for the usual expectations; anything else is typed in.
const MOVES: { bps: string; label: string }[] = [
  { bps: '-50', label: 'Cut 0.5%' },
  { bps: '-25', label: 'Cut 0.25%' },
  { bps: '0', label: 'No view' },
  { bps: '25', label: 'Rise 0.25%' },
];

// The API's field names → this form's inputs, so a rejected value's
// message shows under the input it came from.
const FIELDS: Record<string, string> = {
  principal: 'principal',
  tenure_months: 'tenure',
  consensus_change_bps: 'changeBps',
  months_to_decision: 'monthsTo',
  current_rate: 'currentRateOverride',
};

export function RightTimeTool() {
  const profile = useStoredProfile();
  const country = profile.user.country as 'IN' | 'US';
  const currency = userDefaultCurrency(country);
  const council = country === 'IN' ? 'RBI MPC' : 'FOMC';

  const [loanType, setLoanType] = useState<LoanType>('home_loan');
  const [institutions, setInstitutions] = useState<InstitutionPayload[] | null>(null);
  const [bank, setBank] = useState<string>('');

  // Blank until the user says: a sample ₹50 lakh loan and a presumed
  // 50 bps cut gave "Wait, save ₹3,69,508" on the first click.
  const [principal, setPrincipal] = useState('');
  const [tenure, setTenure] = useState(TENURE_DEFAULT.home_loan);
  const [urgency, setUrgency] = useState<Urgency>('3m_ok');

  const [changeBps, setChangeBps] = useState('');
  // Filled from the published meeting calendar (the date is shown).
  const [monthsTo, setMonthsTo] = useState('');
  const [nextMeeting, setNextMeeting] = useState<string | null>(null);

  // The bank's published middle rate unless the user has a real quote.
  const [currentRateOverride, setCurrentRateOverride] = useState('');
  const [more, setMore] = useState(false);

  const [resultValue, setV] = useState<BorrowTimingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, failField, at } = useFormErrors();
  const [added, setAdded] = useState(false);

  // Months to the next RBI MPC / FOMC decision, from the calendar the
  // API keeps (rbi.org.in / federalreserve.gov).
  useEffect(() => {
    let cancelled = false;
    api.centralRates()
      .then((r) => {
        const next = r[country]?.next_meeting_date;
        const days = r[country]?.days_until_next;
        if (cancelled || !next || days == null) return;
        setNextMeeting(next);
        setMonthsTo((m) => (m === '' ? String(Math.max(1, Math.round(days / 30.4))) : m));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    setTenure(TENURE_DEFAULT[loanType] ?? '60');
    setV(null);
    setAdded(false);
  }, [loanType]);

  useEffect(() => {
    let cancelled = false;
    api.institutions(country)
      .then((data) => {
        if (cancelled) return;
        setInstitutions(data);
        // Start on the user's own bank when it publishes a rate for
        // this kind of loan.
        const primary = profile.user.primary_bank;
        const field = RATE_FIELD[loanType];
        if (primary && field) {
          const match = data.find((i) => i.name.toLowerCase() === primary.toLowerCase());
          if (match && match[field]) setBank(match.name);
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
    const field = RATE_FIELD[loanType];
    if (!inst || !field) return null;
    return (inst[field] as { low: string; high: string; median: string } | null) ?? null;
  }, [institutions, bank, loanType]);

  const currentRate = currentRateOverride || bankRange?.median || '';

  // Whether the bank is one the user already has: the add button says so.
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

  // What's left each month after costs and current payments, from the
  // saved profile: a new EMI has to fit in it before timing matters.
  // Unknown without a profile (or with a foreign loan missing its rate).
  const monthlyRoom = useMemo(() => {
    if (!profile.isLive) return null;
    const m = deriveMetrics(profile);
    return m.fxMissing.length > 0 ? null : m.surplus.toFixed(2);
  }, [profile]);

  const fingerprint = JSON.stringify([loanType,principal,tenure,bank,currentRate,changeBps,monthsTo,urgency,country,monthlyRoom,profile.user]);
  const [checked, setChecked] = useState('');
  const v = checked === fingerprint ? resultValue : null;
  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!currentRate) {
      setErr('Pick a bank, or type the rate you were quoted under + MORE.');
      return;
    }
    if (!(Number(principal) > 0)) {
      failField('principal', 'Enter how much you plan to borrow.');
      return;
    }
    if (changeBps.trim() === '' || !Number.isFinite(Number(changeBps))) {
      failField('changeBps', 'Pick what you expect, or type it: −25 for a cut, 0 for no view.');
      return;
    }
    if (!(Number(monthsTo) >= 1)) {
      failField('monthsTo', 'Enter the months until the next rate decision.');
      return;
    }
    setV(null);
    setBusy(true);
    clear();
    setAdded(false);
    try {
      setV(
        await api.rightTime({
          current_rate: currentRate,
          // Not part of the verdict: the engine only reports it back.
          six_month_avg: currentRate,
          consensus_change_bps: Number(changeBps),
          months_to_decision: Number(monthsTo),
          urgency,
          principal,
          tenure_months: Number(tenure),
          country,
          ...(monthlyRoom != null ? { monthly_room: monthlyRoom } : {}),
        }),
      );
      setChecked(fingerprint);
    } catch (e) {
      fail(e, FIELDS);
    } finally {
      setBusy(false);
    }
  }

  const money = (s: string) => formatCurrency(s, currency);
  const bps = Number(changeBps);
  const meetingDate = nextMeeting
    ? new Date(`${nextMeeting}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const theLoan = loanName({ bank: bank || null, loan_type: loanType });

  return (
    <LSteps>
      <LStep no="01" id="rt-in" title="The loan you'd take">
        <form onSubmit={check} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LChipRow label="What kind?">
            {LOAN_TYPES.map((t) => (
              <LChip key={t} on={loanType === t} onClick={() => setLoanType(t)}>
                {LOAN_TYPE_NAME[t]}
              </LChip>
            ))}
          </LChipRow>
          <div>
            <LFieldGrid min={200}>
              <Select
                label="Bank"
                value={bank}
                onChange={setBank}
                options={[{ value: '', label: 'Pick a bank' }, ...bankOptions]}
              />
              <Field label="How much" kind="money" currency={currency} value={principal} onChange={setPrincipal} error={at('principal')} />
              <Field label="For how many months" kind="integer" value={tenure} onChange={setTenure} error={at('tenure')} />
            </LFieldGrid>
            {bankRange && (
              <LNote style={{ margin: '8px 0 0' }}>
                {bank} lends at {formatPct(bankRange.low, 2)} to {formatPct(bankRange.high, 2)}, {formatPct(bankRange.median, 2)} in the
                middle. Your offer depends on your credit; type a real quote under + MORE.
              </LNote>
            )}
          </div>
          <LChipRow label="When do you need it?">
            {URGENCY.map((u) => (
              <LChip key={u.value} on={urgency === u.value} onClick={() => setUrgency(u.value)}>
                {u.label}
              </LChip>
            ))}
          </LChipRow>

          <div>
            <LStepSub right={meetingDate ? `NEXT ${council} · ${meetingDate.toUpperCase()}` : undefined}>Where rates are heading</LStepSub>
            <div style={{ margin: '10px 0 12px' }}>
              <LChipRow label={`What do you expect at the next ${council} decision?`}>
                {MOVES.map((m) => (
                  <LChip key={m.bps} on={changeBps.trim() !== '' && Number(changeBps) === Number(m.bps)} onClick={() => setChangeBps(m.bps)}>
                    {m.label}
                  </LChip>
                ))}
              </LChipRow>
            </div>
            <LFieldGrid min={200}>
              <Field
                label="Or type it (basis points)"
                value={changeBps}
                onChange={setChangeBps}
                error={at('changeBps')}
                hint="−25 is a 0.25% cut. Your view or a published forecast."
              />
              <Field
                label="Months to that decision"
                kind="integer"
                value={monthsTo}
                onChange={setMonthsTo}
                error={at('monthsTo')}
                hint={meetingDate ? 'From the published calendar' : `${council} meets every ${country === 'IN' ? '2 months' : '6 weeks or so'}`}
              />
            </LFieldGrid>
          </div>

          <div>
            <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
            {!more && <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>A rate you were quoted</span>}
            {more && (
              <div style={{ marginTop: 10, maxWidth: 360 }}>
                <Field
                  label="Rate you were quoted (%)"
                  kind="percent"
                  value={currentRateOverride}
                  onChange={setCurrentRateOverride}
                  error={at('currentRateOverride')}
                  hint={bank ? `Blank: ${bank}'s middle rate` : 'Blank: the bank’s middle rate'}
                />
              </div>
            )}
          </div>

          <SubmitBar busy={busy} error={err} label="What should I do?" />
        </form>
      </LStep>

      {v && (
        <>
          <LStep no="02" id="rt-out" title="The answer" answer>
            <LVerdict tone={v.verdict === 'cant_afford' ? 'neg' : v.verdict === 'wait' ? 'accent' : 'pos'}>
              {v.verdict === 'cant_afford'
                ? 'The EMI doesn’t fit yet.'
                : v.verdict === 'wait'
                  ? 'Wait for the cut.'
                  : 'Borrow now.'}
            </LVerdict>
            <LNote>{v.detail}</LNote>
            <LKpi
              items={[
                { l: "TODAY'S RATE", v: formatPct(v.current_rate, 2) },
                { l: 'EMI', v: money(v.monthly_payment), s: 'a month, at today’s rate' },
                ...(v.monthly_room != null
                  ? [{ l: 'ROOM EACH MONTH', v: money(v.monthly_room), s: 'after costs and payments', tone: Number(v.monthly_room) >= Number(v.monthly_payment) ? L_T.positive : L_T.negative }]
                  : []),
                { l: 'SAVED IF YOU WAIT', v: money(v.estimated_savings), s: 'over the whole term', tone: v.verdict === 'wait' ? L_T.positive : undefined },
              ]}
            />
            {(bps < 0 || v.monthly_room == null) && (
              <LNote style={{ margin: '12px 0 0' }}>
                {bps < 0 && 'If the cut doesn’t come, neither does the saving. '}
                {v.monthly_room == null && (
                  <>
                    Finish <a href="/onboarding" style={{ color: L_T.accent }}>setup</a> to check the EMI against your income and costs.
                  </>
                )}
              </LNote>
            )}
            {v.verdict === 'borrow_now' && v.monthly_room != null && bank && currentRate && (
              <AddLoanAction
                added={added}
                onAdd={() => {
                  if (added || checked !== fingerprint) return;
                  const saved = addLoanToProfile({
                    loan_type: loanType,
                    bank,
                    outstanding: principal,
                    nominal_rate: String(currentRate),
                    tenure_months_remaining: Number(tenure),
                    scheduled_emi: v.monthly_payment,
                  });
                  if (saved != null) setAdded(true);
                  else setErr('The loan could not be saved. Recheck it fits against your current profile.');
                }}
                label={`Add the ${theLoan} to my profile${isExistingBank ? '' : ' · new bank'}`}
              />
            )}
          </LStep>

          <LMathBlock
            rows={[
              { k: "today's rate", v: formatPct(v.current_rate, 2), note: currentRateOverride ? 'the rate you were quoted' : `${bank}'s middle rate` },
              { k: 'expected move', v: bps === 0 ? 'none' : `${bps > 0 ? '+' : '−'}${(Math.abs(bps) / 100).toFixed(2)}%`, note: `in ${monthsTo} month${Number(monthsTo) === 1 ? '' : 's'}` },
              { k: 'EMI today', v: money(v.monthly_payment), note: `${money(principal)} over ${tenure} months` },
              ...(v.monthly_room != null ? [{ k: 'room each month', v: money(v.monthly_room), note: 'income less costs and current payments' }] : []),
              {
                k: 'saved if you wait',
                v: money(v.estimated_savings),
                note: 'EMI today less EMI after the move, over the whole term',
                tone: v.verdict === 'wait' ? ('pos' as const) : undefined,
              },
            ]}
          />
        </>
      )}
    </LSteps>
  );
}

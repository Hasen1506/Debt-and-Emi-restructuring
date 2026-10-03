'use client';

import { useEffect, useMemo, useState } from 'react';
import { AddLoanAction, Field, Select, SubmitBar } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import { RateOdds, fmtDay } from '@/components/ledger/RateOdds';
import {
  api,
  formatCurrency,
  formatPct,
  type BorrowTimingResponse,
  type InstitutionPayload,
  type LoanType,
  type RateOddsResponse,
} from '@/lib/api';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { useFormErrors } from '@/lib/form-errors';
import { addLoanToProfile } from '@/lib/add-loan-to-profile';
import { userDefaultCurrency } from '@/lib/currency';
import { deriveMetrics } from '@/lib/derived';
import { LOAN_TYPE_NAME, loanName } from '@/lib/loan-types';
import { formatAsOf } from '@/lib/invest-vs-prepay';

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

// Most Indian home and education loans float with the repo rate (EBLR);
// car and personal loans, and US loans, are mostly fixed.
function floatsByDefault(country: 'IN' | 'US', t: LoanType): boolean {
  return country === 'IN' && (t === 'home_loan' || t === 'education_loan');
}

// The API's field names → this form's inputs, so a rejected value's
// message shows under the input it came from.
const FIELDS: Record<string, string> = {
  principal: 'principal',
  tenure_months: 'tenure',
  current_rate: 'currentRateOverride',
};

export function RightTimeTool() {
  const profile = useStoredProfile();
  const country = profile.user.country as 'IN' | 'US';
  const currency = userDefaultCurrency(country);
  const bankName = country === 'IN' ? 'RBI' : 'Fed';

  const [loanType, setLoanType] = useState<LoanType>('home_loan');
  const [institutions, setInstitutions] = useState<InstitutionPayload[] | null>(null);
  const [bank, setBank] = useState<string>('');

  // Blank until the user says: a sample ₹50 lakh loan gave an answer on
  // the first click.
  const [principal, setPrincipal] = useState('');
  const [tenure, setTenure] = useState(TENURE_DEFAULT.home_loan);
  const [urgency, setUrgency] = useState<Urgency>('3m_ok');
  const [floating, setFloating] = useState(floatsByDefault(country, 'home_loan'));

  // The market's odds for the coming decisions, shown before the answer.
  const [odds, setOdds] = useState<RateOddsResponse | null | 'loading'>('loading');

  // The bank's published middle rate unless the user has a real quote.
  const [currentRateOverride, setCurrentRateOverride] = useState('');
  const [more, setMore] = useState(false);

  const [resultValue, setV] = useState<BorrowTimingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, failField, at } = useFormErrors();
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOdds('loading');
    api.rateOdds(country)
      .then((r) => !cancelled && setOdds(r))
      .catch(() => !cancelled && setOdds(null));
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    setTenure(TENURE_DEFAULT[loanType] ?? '60');
    setFloating(floatsByDefault(country, loanType));
    setV(null);
    setAdded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanType, country]);

  useEffect(() => {
    let cancelled = false;
    // Only the banks whose advertised rates were checked (tier A).
    api.institutions(country, 'A')
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
  const bankNoted = useMemo(() => {
    const d = institutions?.find((i) => i.name.toLowerCase() === bank.toLowerCase())?.last_verified ?? '';
    return /^\d{4}-\d{2}-\d{2}/.test(d) ? formatAsOf(d.slice(0, 10)) : null;
  }, [institutions, bank]);

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

  const fingerprint = JSON.stringify([loanType,principal,tenure,bank,currentRate,floating,urgency,country,monthlyRoom,profile.user]);
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
    setV(null);
    setBusy(true);
    clear();
    setAdded(false);
    try {
      setV(
        await api.rightTime({
          current_rate: currentRate,
          // No expected move sent: the verdict goes on the market's odds.
          urgency,
          rate_type: floating ? 'floating' : 'fixed',
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
  const pct = (c: string | null | undefined) => `${Math.round(Number(c) * 100)}%`;
  const usMortgage = country === 'US' && loanType === 'home_loan' && !floating;
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
                {bank} advertised {formatPct(bankRange.low, 2)} to {formatPct(bankRange.high, 2)}
                {bankNoted ? ` (noted ${bankNoted})` : ''}, {formatPct(bankRange.median, 2)} in the middle. Banks change these and your
                offer depends on your credit: type a real quote under + MORE.
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

          <LChipRow label="Its rate">
            <LChip on={!floating} onClick={() => setFloating(false)}>
              Fixed
            </LChip>
            <LChip on={floating} onClick={() => setFloating(true)}>
              Floating
            </LChip>
          </LChipRow>
          {floating && (
            <LNote style={{ margin: '-8px 0 0' }}>
              A floating rate follows the {bankName} rate after you borrow, so timing matters less.
            </LNote>
          )}

          <RateOdds odds={odds} bank={bankName} />

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
                { l: "TODAY'S RATE", v: formatPct(v.current_rate, 2), s: v.rate_floats ? 'floating' : 'fixed' },
                { l: 'EMI', v: money(v.monthly_payment), s: 'a month, at today’s rate' },
                ...(v.monthly_room != null
                  ? [{ l: 'ROOM EACH MONTH', v: money(v.monthly_room), s: 'after costs and payments', tone: Number(v.monthly_room) >= Number(v.monthly_payment) ? L_T.positive : L_T.negative }]
                  : []),
                ...(v.cut_chance != null && v.wait_until
                  ? [{ l: 'CHANCE OF A CUT', v: pct(v.cut_chance), s: `by ${fmtDay(v.wait_until)}`, tone: Number(v.cut_chance) >= 0.5 ? L_T.positive : undefined }]
                  : []),
                ...(!v.rate_floats && v.urgency !== 'now'
                  ? [{ l: 'SAVED IF YOU WAIT', v: money(v.estimated_savings), s: 'on the odds, over the term', tone: v.verdict === 'wait' ? L_T.positive : undefined }]
                  : []),
              ]}
            />
            {(v.verdict === 'wait' || usMortgage || v.monthly_room == null) && (
              <LNote style={{ margin: '12px 0 0' }}>
                {v.verdict === 'wait' && v.saving_if_cut && (
                  <>
                    If the cut comes you save about {money(v.saving_if_cut)}. If rates rise instead, borrowing could cost more. Ask for a fresh quote after
                    the {bankName} decision.{' '}
                  </>
                )}
                {usMortgage &&
                  'A 30-year fixed rate follows 10-year Treasury yields, which already price in the cuts markets expect, so the real saving is usually smaller. '}
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
                    rate_type: v.rate_floats ? 'floating' : 'fixed',
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
              { k: "today's rate", v: formatPct(v.current_rate, 2), note: `${v.rate_floats ? 'floating' : 'fixed'}; ${currentRateOverride ? 'the rate you were quoted' : `${bank}'s middle rate`}` },
              ...(v.cut_chance != null && v.wait_until
                ? [
                    { k: 'chance of a cut', v: pct(v.cut_chance), note: `by the ${bankName} decision on ${fmtDay(v.wait_until)}, Polymarket` },
                    {
                      k: 'expected move',
                      v: v.consensus_change_bps === 0 ? 'none' : `${v.consensus_change_bps > 0 ? '+' : '−'}${(Math.abs(v.consensus_change_bps) / 100).toFixed(2)}%`,
                      note: 'each move times its chance',
                    },
                  ]
                : [{ k: 'market odds', v: 'none', note: 'judged on today’s rate' }]),
              { k: 'EMI today', v: money(v.monthly_payment), note: `${money(principal)} over ${tenure} months` },
              ...(v.monthly_room != null ? [{ k: 'room each month', v: money(v.monthly_room), note: 'income less costs and current payments' }] : []),
              ...(v.saving_if_cut && !v.rate_floats && v.urgency !== 'now'
                ? [{ k: 'saved if the cut comes', v: money(v.saving_if_cut), note: 'EMI today less EMI after the cut, over the whole term' }]
                : []),
              ...(!v.rate_floats && v.urgency !== 'now'
                ? [
                    {
                      k: 'saved if you wait',
                      v: money(v.estimated_savings),
                      note: 'on the odds: each move’s saving times its chance, rises counted against',
                      tone: v.verdict === 'wait' ? ('pos' as const) : undefined,
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
    </LSteps>
  );
}

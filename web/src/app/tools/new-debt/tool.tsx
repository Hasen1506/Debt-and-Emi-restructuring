'use client';

import { useEffect, useMemo, useState } from 'react';
import { AddLoanAction, Field, ScoreChip, SubmitBar } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LStepSub, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import {
  api,
  formatCurrency,
  formatPct,
  type InstitutionPayload,
  type LoanType,
  type NewDebtResponse,
  type ScoreImpactResponse,
} from '@/lib/api';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { useFormErrors } from '@/lib/form-errors';
import { addLoanToProfile } from '@/lib/add-loan-to-profile';
import { userDefaultCurrency } from '@/lib/currency';
import { deriveMetrics } from '@/lib/derived';
import { LOAN_TYPE_NAME, loanName } from '@/lib/loan-types';

const VERDICT: Record<NewDebtResponse['verdict'], { text: string; tone: 'pos' | 'accent' | 'neg' }> = {
  take: { text: 'Take the loan.', tone: 'pos' },
  pay_cash: { text: 'Pay cash.', tone: 'accent' },
  delay: { text: 'Wait: save up first.', tone: 'neg' },
  cant_afford: { text: 'The EMI doesn’t fit yet.', tone: 'neg' },
};

// Friction of going to a bank you don't already use is real but
// non-monetary: time for fresh KYC, possible minimum-balance requirement,
// FICO hard-inquiry hit (US) — and *sometimes* a small opening / processing
// fee, but plenty of IN zero-balance accounts (Kotak 811, IDFC FIRST, SBI
// BSBDA) and most US checking accounts are free. We surface this
// qualitatively rather than baking a fake rupee figure into the math.

const LOAN_TYPE_OPTIONS: { value: LoanType; label: string }[] = [
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'home_loan', label: 'Home loan' },
  { value: 'auto_loan', label: 'Car loan' },
  { value: 'education_loan', label: 'Education loan' },
  { value: 'credit_card', label: 'Shop EMI offer' },
];

const TENURE_DEFAULT_BY_TYPE: Record<string, string> = {
  personal_loan: '60',
  home_loan: '240',
  auto_loan: '60',
  education_loan: '120',
  credit_card: '6',
};

/** Pure EMI: P * r * (1+r)^n / ((1+r)^n - 1), with r = annualRate / 12. */
function computeEMI(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const pow = Math.pow(1 + r, months);
  return (principal * r * pow) / (pow - 1);
}

export function NewDebtTool() {
  const profile = useStoredProfile();
  const country = profile.user.country as 'IN' | 'US';
  // A hypothetical new loan is denominated in the user's residence currency —
  // no per-loan override available since the loan doesn't exist yet.
  const ccy = userDefaultCurrency(country);
  const fmt = (v: string | number) => formatCurrency(v, ccy);
  const [loanType, setLoanType] = useState<LoanType>('personal_loan');
  const [institutions, setInstitutions] = useState<InstitutionPayload[] | null>(null);
  const [instErr, setInstErr] = useState<string | null>(null);

  // Universal core: loan amount + tenure. For non-card types, list/cash
  // collapse to the same number (no negotiation discount). For credit-card,
  // list/cash diverge — that's the whole point of the foregone-discount
  // check.
  // The amounts start blank: a preloaded ₹3 lakh loan and an assumed 720
  // score could return "Take the EMI" on the first click, for a loan the
  // user never described.
  const [loanAmount, setLoanAmount] = useState('');
  const [tenure, setTenure] = useState(TENURE_DEFAULT_BY_TYPE.personal_loan);
  const [listPrice, setListPrice] = useState('');
  const [cashPrice, setCashPrice] = useState('');
  const [offerEmi, setOfferEmi] = useState('');

  const [selectedBank, setSelectedBank] = useState<string>('');
  const [fee, setFee] = useState('0');
  const savingsOnFile = profile.isLive && profile.user.savings_balance != null ? String(Math.round(Number(profile.user.savings_balance))) : '';
  const [savings, setSavings] = useState(savingsOnFile);
  const scoreOnFile = profile.isLive && profile.creditScore != null ? String(profile.creditScore) : '';
  const [more, setMore] = useState(false);
  // The profile's score, or blank: no score, no score-impact estimate.
  const [score, setScore] = useState(scoreOnFile);

  const [resultValue, setV] = useState<NewDebtResponse | null>(null);
  const [impact, setImpact] = useState<ScoreImpactResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, failField, at } = useFormErrors();
  const [added, setAdded] = useState(false);

  // Refresh sensible tenure default when the loan type changes.
  useEffect(() => {
    setTenure(TENURE_DEFAULT_BY_TYPE[loanType] ?? '60');
    setSelectedBank('');
    setV(null);
    setAdded(false);
  }, [loanType]);

  // Fetch institution rate cards on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .institutions(country)
      .then((data) => {
        if (!cancelled) setInstitutions(data);
      })
      .catch((e) => {
        if (!cancelled) setInstErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  const knownBanks = useMemo(() => {
    const set = new Set<string>();
    if (profile.user.primary_bank) set.add(profile.user.primary_bank.toLowerCase());
    for (const b of profile.user.other_banks ?? []) set.add(b.toLowerCase());
    for (const l of profile.user.loans ?? []) {
      if (l.bank) set.add(l.bank.toLowerCase());
    }
    return set;
  }, [profile.user]);

  const bankComparison = useMemo(() => {
    if (!institutions) return null;
    return rankBanksForLoanType(
      institutions,
      loanType,
      knownBanks,
      Number(loanAmount),
      Number(tenure),
    );
  }, [institutions, loanType, knownBanks, loanAmount, tenure]);

  // The "active" bank — selectedBank if set, else the cheapest existing-relationship
  // bank, else the cheapest overall. Drives the EMI used in the verdict call.
  const activeBank = useMemo(() => {
    if (!bankComparison) return null;
    if (selectedBank) {
      const all = [...bankComparison.existing, ...bankComparison.others];
      return all.find((r) => r.name === selectedBank) ?? null;
    }
    return bankComparison.existing[0] ?? bankComparison.others[0] ?? null;
  }, [bankComparison, selectedBank]);

  // What's left each month after costs and the payments already owed, from
  // the saved profile: the EMI has to fit in it. Unknown without a profile
  // (or with a foreign loan missing its exchange rate).
  const monthlyRoom = useMemo(() => {
    if (!profile.isLive) return null;
    const m = deriveMetrics(profile);
    return m.fxMissing.length > 0 ? null : m.surplus.toFixed(2);
  }, [profile]);

  const fingerprint = JSON.stringify([loanType,loanAmount,listPrice,cashPrice,offerEmi,tenure,selectedBank,activeBank?.median,fee,savings,score,monthlyRoom,country,profile.user]);
  const [checked, setChecked] = useState('');
  const v = checked === fingerprint ? resultValue : null;

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const card = loanType === 'credit_card';
    if (!card && !(Number(loanAmount) > 0)) {
      failField('loanAmount', 'Enter how much you want to borrow.');
      return;
    }
    if (card && !(Number(listPrice) > 0)) {
      failField('listPrice', 'Enter the price on the EMI offer.');
      return;
    }
    if (card && !(Number(cashPrice) > 0)) {
      failField('cashPrice', 'Enter what it costs if you pay in full (the same price if there is no discount).');
      return;
    }
    if (savings.trim() === '') {
      failField('savings', 'Enter your savings outside the emergency fund, 0 if none.');
      return;
    }
    if (card && (!(Number(offerEmi) > 0) || !Number.isFinite(Number(offerEmi)))) {
      failField('offerEmi', 'Enter the monthly payment on the offer.'); return;
    }
    if (card && Number(offerEmi)*Number(tenure) < Number(listPrice)-0.05) {
      failField('offerEmi','These payments don’t add up to the price on the offer. Check both.'); return;
    }
    setV(null);
    setBusy(true);
    clear();
    setImpact(null);
    setAdded(false);
    try {
      const isCard = card;
      const cashEq = isCard ? cashPrice : loanAmount;
      const list = isCard ? listPrice : loanAmount;
      const months = Number(tenure);
      // Derive monthly EMI from the chosen bank's median rate. If none
      // resolved, fall back to a typical-rate guess: 14% for personal/card,
      // 9% for home/auto.
      const rate = activeBank?.median ?? (isCard ? 0.36 : 0.14);
      const monthlyEmi = isCard ? Number(offerEmi) : computeEMI(Number(list), rate, months);
      const result = await api.newDebt({
        list_price: list,
        cash_price_elsewhere: cashEq,
        emi_offer_months: months,
        emi_offer_monthly_payment: monthlyEmi.toFixed(2),
        processing_fee: fee,
        user_savings_after_efund: savings,
        country,
        ...(monthlyRoom != null ? { monthly_room: monthlyRoom } : {}),
      });
      setV(result);
      setChecked(fingerprint);

      if (result.verdict === 'take' && score.trim() !== '' && Number(score) >= 300 && activeBank && !activeBank.isExisting) {
        const impactResult = await api.scoreImpact({
          action: 'new_account',
          current_score: Number(score),
          country,
        });
        setImpact(impactResult);
      }
    } catch (e) {
      // In loan mode the price fields are the loan amount.
      const price = loanType === 'credit_card' ? null : 'loanAmount';
      fail(e, {
        list_price: price ?? 'listPrice',
        cash_price_elsewhere: price ?? 'cashPrice',
        emi_offer_monthly_payment: price ?? 'offerEmi',
        emi_offer_months: 'tenure',
        processing_fee: 'fee',
        user_savings_after_efund: 'savings',
        current_score: 'score',
      });
    } finally {
      setBusy(false);
    }
  }

  const isCard = loanType === 'credit_card';
  const isNewBank = !!(activeBank && !activeBank.isExisting);
  const usedRate = isCard ? null : activeBank?.median ?? 0.14;

  return (
    <LSteps>
      <LStep no="01" id="nd-in" title="The loan">
        <form onSubmit={check} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LChipRow label="What kind?">
            {LOAN_TYPE_OPTIONS.map((o) => (
              <LChip key={o.value} on={loanType === o.value} onClick={() => setLoanType(o.value)}>
                {o.label}
              </LChip>
            ))}
          </LChipRow>
          {isCard ? (
            <div>
              <LFieldGrid min={200}>
                <Field label="Price on the EMI offer" kind="money" currency={ccy} value={listPrice} onChange={setListPrice} error={at('listPrice')} />
                <Field
                  label="Price if you pay in full"
                  kind="money"
                  currency={ccy}
                  value={cashPrice}
                  onChange={setCashPrice}
                  error={at('cashPrice')}
                  hint="Same as above if there's no cash discount"
                />
                <Field label="Monthly payment on the offer" kind="money" currency={ccy} value={offerEmi} onChange={setOfferEmi} error={at('offerEmi')} hint="With its charges" />
                <Field label="For how many months" kind="integer" value={tenure} onChange={setTenure} error={at('tenure')} />
              </LFieldGrid>
              <LNote style={{ margin: '8px 0 0' }}>
                A &ldquo;no-cost&rdquo; EMI often hides its cost in a higher price than you&apos;d pay in cash.
              </LNote>
            </div>
          ) : (
            <LFieldGrid min={200}>
              <Field label="How much" kind="money" currency={ccy} value={loanAmount} onChange={setLoanAmount} error={at('loanAmount')} />
              <Field label="For how many months" kind="integer" value={tenure} onChange={setTenure} error={at('tenure')} />
            </LFieldGrid>
          )}

          {!isCard && (
            <div>
              <LStepSub right="PUBLISHED RATES">Which bank</LStepSub>
              {instErr ? (
                <LNote style={{ margin: '8px 0 0', color: L_T.negative }}>Couldn&apos;t load bank rates: {instErr}</LNote>
              ) : bankComparison ? (
                <BankRateTable
                  comparison={bankComparison}
                  loanType={loanType}
                  selectedBank={activeBank?.name ?? ''}
                  onPick={setSelectedBank}
                  fmt={fmt}
                  showMoney={Number(loanAmount) > 0}
                />
              ) : (
                <LNote style={{ margin: '8px 0 0' }}>Loading bank rates…</LNote>
              )}
            </div>
          )}

          <div>
            <LStepSub>Your money</LStepSub>
            <div style={{ marginTop: 10 }}>
              <LFieldGrid min={200}>
                <Field
                  label="Savings outside your emergency fund"
                  kind="money"
                  currency={ccy}
                  value={savings}
                  onChange={setSavings}
                  error={at('savings')}
                  hint={savingsOnFile !== '' && savings === savingsOnFile ? 'From your profile' : 'If they cover the price, cash may be cheaper'}
                />
                <Field
                  label="Credit score (optional)"
                  kind="integer"
                  value={score}
                  onChange={setScore}
                  error={at('score')}
                  hint={scoreOnFile !== '' && score === scoreOnFile ? 'From your profile' : 'For the effect of opening a new account'}
                />
              </LFieldGrid>
            </div>
          </div>

          <div>
            <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
            {!more && (
              <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>
                {Number(fee) > 0 ? `Processing fee ${fmt(fee)}` : 'Processing fee'}
              </span>
            )}
            {more && (
              <div style={{ marginTop: 10, maxWidth: 360 }}>
                <Field label="Processing fee" kind="money" currency={ccy} value={fee} onChange={setFee} error={at('fee')} hint="Often 0–2% of the loan. 0 if you don't know." />
              </div>
            )}
          </div>

          <SubmitBar busy={busy} error={err} label="Check this loan" />
        </form>
      </LStep>

      {v && (
        <>
          <LStep no="02" id="nd-out" title="The answer" answer>
            <LVerdict tone={VERDICT[v.verdict].tone}>
              {isCard && v.verdict === 'take' ? 'Take the EMI offer.' : VERDICT[v.verdict].text}
            </LVerdict>
            <LNote>
              {v.detail}{' '}
              {isCard
                ? 'From the payment on the offer.'
                : activeBank
                  ? `At ${activeBank.name}'s middle rate of ${formatPct(String(activeBank.median), 2)}.`
                  : 'No published rate for this loan, so a typical 14% is used.'}
            </LNote>
            <LKpi
              items={[
                { l: 'IT REALLY COSTS', v: formatPct(v.effective_apr, 1), s: 'a year, fees included' },
                { l: 'EMI', v: fmt(v.monthly_emi), s: `a month for ${tenure} months` },
                {
                  l: 'MORE THAN CASH',
                  v: fmt(v.total_real_cost),
                  s: Number(v.foregone_discount) > 0 ? `${fmt(v.foregone_discount)} of it a lost discount` : 'interest and fees',
                  tone: Number(v.total_real_cost) > 0 ? L_T.negative : L_T.positive,
                },
                ...(!isCard && activeBank
                  ? [
                      {
                        l: 'BANK',
                        v: isNewBank ? 'New to you' : 'Already yours',
                        s: isNewBank ? 'new KYC and a credit check' : 'no new paperwork',
                        tone: isNewBank ? L_T.accent : L_T.positive,
                      },
                    ]
                  : []),
              ]}
            />
            {impact && (
              <div style={{ marginTop: 14 }}>
                <ScoreChip
                  deltaLow={impact.delta_low}
                  deltaHigh={impact.delta_high}
                  daysToRealise={impact.days_to_realise}
                  currentBand={impact.current_band}
                  projectedBandHigh={impact.projected_band_high}
                  source={impact.source}
                  rationale={impact.rationale}
                />
              </div>
            )}
            {v.verdict === 'take' && (activeBank || isCard) && (
              <AddLoanAction
                added={added}
                onAdd={() => {
                  if (added || checked !== fingerprint) return;
                  if (isCard && !Number.isFinite(offerRate(Number(listPrice), Number(offerEmi), Number(tenure)))) {
                    setErr('This offer works out above 100% a year, more than the profile can track. It can be compared here but not added.');
                    return;
                  }
                  const saved = addLoanToProfile({
                    loan_type: isCard ? 'bnpl' : loanType,
                    bank: isCard ? 'Quoted EMI offer' : activeBank!.name,
                    outstanding: isCard ? listPrice : loanAmount,
                    nominal_rate: isCard ? String(offerRate(Number(listPrice), Number(offerEmi), Number(tenure))) : String(activeBank!.median),
                    tenure_months_remaining: Number(tenure),
                    scheduled_emi: String(v.monthly_emi),
                    processing_fee_amortised: fee !== '0' ? fee : undefined,
                  });
                  if (saved != null) setAdded(true);
                  else setErr('The loan could not be saved. Recheck it fits against your current profile.');
                }}
                label={isCard ? 'Add this EMI offer to my profile' : `Add the ${loanName({ bank: activeBank?.name ?? null, loan_type: loanType })} to my profile`}
              />
            )}
            {isCard && v.verdict === 'take' && (
              <LNote style={{ margin: '10px 0 0' }}>It&apos;s kept as its own instalment loan, apart from any card balance.</LNote>
            )}
          </LStep>

          <LMathBlock
            rows={[
              { k: isCard ? 'price on the offer' : 'borrowed', v: fmt(v.list_price) },
              ...(isCard ? [{ k: 'price in cash', v: fmt(v.cash_price) }] : []),
              ...(usedRate != null ? [{ k: 'rate', v: formatPct(String(usedRate), 2), note: activeBank ? `${activeBank.name}, middle of its range` : 'typical, no published rate' }] : []),
              { k: 'EMI', v: fmt(v.monthly_emi), note: `× ${tenure} months = ${fmt((Number(v.monthly_emi) * Number(tenure)).toFixed(0))}` },
              ...(Number(v.processing_fee) > 0 ? [{ k: 'processing fee', v: fmt(v.processing_fee) }] : []),
              {
                k: 'more than cash',
                v: fmt(v.total_real_cost),
                note: 'EMIs + fee − price in cash',
                tone: Number(v.total_real_cost) > 0 ? ('neg' as const) : undefined,
              },
              { k: 'it really costs', v: formatPct(v.effective_apr, 1), note: 'the yearly rate that turns the cash price into these EMIs' },
              ...(monthlyRoom != null ? [{ k: 'room each month', v: fmt(monthlyRoom), note: 'income less costs and current payments' }] : []),
            ]}
          />
        </>
      )}
    </LSteps>
  );
}

interface BankComparisonRow {
  name: string;
  low: number;
  high: number;
  median: number;
  isExisting: boolean;
  estimatedEmi: number;
  totalInterest: number;       // tenure × EMI − principal
}

interface BankComparison {
  existing: BankComparisonRow[];
  others: BankComparisonRow[];
}

const RATE_FIELD_BY_LOAN_TYPE: Record<LoanType, keyof InstitutionPayload | null> = {
  home_loan: 'home_loan',
  auto_loan: 'auto_loan',
  personal_loan: 'personal_loan',
  education_loan: 'education_loan',
  credit_card: null,
  gold_loan: null,
  bnpl: null,
};

function rankBanksForLoanType(
  institutions: InstitutionPayload[],
  loanType: LoanType,
  knownBanks: Set<string>,
  loanAmount: number,
  tenureMonths: number,
): BankComparison {
  const field = RATE_FIELD_BY_LOAN_TYPE[loanType];
  const rows: BankComparisonRow[] = [];
  for (const inst of institutions) {
    let low: number, high: number;
    if (loanType === 'credit_card') {
      if (inst.credit_card_apr_low == null || inst.credit_card_apr_high == null) continue;
      low = Number(inst.credit_card_apr_low);
      high = Number(inst.credit_card_apr_high);
    } else if (field) {
      const range = inst[field] as { low: string; high: string; median: string } | null;
      if (!range) continue;
      low = Number(range.low);
      high = Number(range.high);
    } else {
      continue;
    }
    const median = (low + high) / 2;
    const isExisting = knownBanks.has(inst.name.toLowerCase());
    const principal = loanAmount > 0 ? loanAmount : 0;
    const emi = computeEMI(principal, median, tenureMonths);
    const totalPaid = emi * Math.max(tenureMonths, 0);
    const totalInterest = totalPaid - principal;
    rows.push({
      name: inst.name,
      low,
      high,
      median,
      isExisting,
      estimatedEmi: emi,
      totalInterest,
    });
  }
  // Sort by total interest paid over the tenure — the one number the user
  // actually compares between banks. Existing-relationship flag is shown
  // separately so the user can weigh friction on their own.
  rows.sort((a, b) => a.totalInterest - b.totalInterest);
  return {
    existing: rows.filter((r) => r.isExisting),
    others: rows.filter((r) => !r.isExisting),
  };
}

function BankRateTable({
  comparison,
  loanType,
  selectedBank,
  onPick,
  fmt,
  showMoney,
}: {
  comparison: BankComparison;
  loanType: LoanType;
  selectedBank: string;
  onPick: (b: string) => void;
  fmt: (v: string | number) => string;
  /** EMI and interest columns, once there's an amount to work them out on. */
  showMoney: boolean;
}) {
  const top = [...comparison.existing, ...comparison.others].slice(0, 8);
  if (top.length === 0) {
    return (
      <LNote style={{ margin: '8px 0 0' }}>
        No published rates for a {LOAN_TYPE_NAME[loanType]} yet, so a typical 14% is used.
      </LNote>
    );
  }
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontWeight: 700, fontSize: 10, letterSpacing: '0.12em', color: L_T.muted };
  const td: React.CSSProperties = { padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' };
  return (
    <>
      <div role="region" aria-label="Bank rates" tabIndex={0} style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${L_T.ink}` }}>
              <th scope="col" style={{ ...th, textAlign: 'left' }}>BANK</th>
              <th scope="col" style={th}>RATE</th>
              {showMoney && (
                <>
                  <th scope="col" style={th}>EMI</th>
                  <th scope="col" style={th}>INTEREST</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {top.map((row) => {
              const on = row.name === selectedBank;
              return (
                <tr key={row.name} style={{ borderTop: `1px dashed ${L_T.ruleSoft}`, background: on ? L_T.ruleSoft : undefined }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onPick(row.name)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: L_T.ink, fontWeight: on ? 700 : 400, textAlign: 'left' }}
                    >
                      {on ? '● ' : '○ '}
                      {row.name}
                    </button>
                    {row.isExisting && <span style={{ color: L_T.positive, fontSize: 10, letterSpacing: '0.1em', marginLeft: 6 }}>YOURS</span>}
                  </td>
                  <td style={td}>
                    {formatPct(String(row.low), 2)}–{formatPct(String(row.high), 2)}
                  </td>
                  {showMoney && (
                    <>
                      <td style={td}>{fmt(row.estimatedEmi.toFixed(0))}</td>
                      <td style={{ ...td, color: L_T.muted }}>{fmt(row.totalInterest.toFixed(0))}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LNote style={{ margin: '8px 0 0' }}>
        Cheapest first, at the middle of each range. Your offer depends on your credit.
      </LNote>
    </>
  );
}

/** Reducing rate for the financed sticker principal; cash-discount APR is advisory only. */
function offerRate(principal: number, payment: number, months: number): number {
  if (payment * months <= principal + 0.05) return 0;
  if(payment > computeEMI(principal,1,months)+0.01) return Infinity;
  let low = 0, high = 1;
  for (let i=0;i<80;i++) { const mid=(low+high)/2; if(computeEMI(principal,mid,months)>payment) high=mid; else low=mid; }
  return (low+high)/2;
}

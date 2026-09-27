'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  AddLoanAction,
  Field,
  InfoTip,
  ScoreChip,
  Select,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import {
  api,
  formatCurrency,
  formatPct,
  type InstitutionPayload,
  type LoanType,
  type NewDebtResponse,
  type ScoreImpactResponse,
} from '@/lib/api';
import { useStoredProfile } from '@/lib/use-profile';
import { useFormErrors } from '@/lib/form-errors';
import { addLoanToProfile } from '@/lib/add-loan-to-profile';
import { userDefaultCurrency } from '@/lib/currency';
import { deriveMetrics } from '@/lib/derived';
import { fitColumns } from '@/lib/grid';

const VERDICT_LABEL: Record<NewDebtResponse['verdict'], string> = {
  take: 'Take the EMI',
  pay_cash: 'Pay cash',
  delay: 'Delay',
  cant_afford: "Can't afford the EMI",
};
const VERDICT_COLOR: Record<NewDebtResponse['verdict'], string> = {
  take: 'var(--positive)',
  pay_cash: 'var(--accent)',
  delay: 'var(--negative)',
  cant_afford: 'var(--negative)',
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
  { value: 'auto_loan', label: 'Auto loan' },
  { value: 'education_loan', label: 'Education loan' },
  { value: 'credit_card', label: 'Credit card / no-cost EMI' },
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

  const [selectedBank, setSelectedBank] = useState<string>('');
  const [fee, setFee] = useState('0');
  const [savings, setSavings] = useState(profile.isLive ? profile.user.savings_balance ?? '' : '');
  // The profile's score, or blank: no score, no score-impact estimate.
  const [score, setScore] = useState(
    profile.isLive && profile.creditScore != null ? String(profile.creditScore) : '',
  );

  const [v, setV] = useState<NewDebtResponse | null>(null);
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
      failField('savings', 'Enter your savings outside the emergency fund (0 if none).');
      return;
    }
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
      const monthlyEmi = computeEMI(Number(cashEq), rate, months);
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
        emi_offer_monthly_payment: price ?? 'cashPrice',
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: fitColumns(2, 200) }}>
          <Select
            label="What kind of loan are you considering?"
            value={loanType}
            onChange={(v) => setLoanType(v as LoanType)}
            options={LOAN_TYPE_OPTIONS}
            info={
              <>
                We pull rate-card ranges from your existing banks first — same
                APR but no fresh KYC and (often) no new-account fee.
              </>
            }
          />
          {!isCard && (
            <>
              <Field
                label="Loan amount"
                value={loanAmount}
                error={at('loanAmount')}
                onChange={setLoanAmount}
                placeholder={country === 'IN' ? 'e.g. 300000' : 'e.g. 15000'}
                info={<>What you want to borrow, in your home currency.</>}
              />
              <Field
                label="Tenure (months)"
                value={tenure}
                error={at('tenure')}
                onChange={setTenure}
                kind="integer"
                hint="e.g. 60 = 5 years"
              />
            </>
          )}
          {isCard && (
            <>
              <Field
                label="Sticker / list price"
                value={listPrice}
                error={at('listPrice')}
                onChange={setListPrice}
                info={
                  <>
                    The price quoted on the &ldquo;no-cost EMI&rdquo; sticker.
                    Retailers often raise the sticker above the cash price to
                    fund the &ldquo;no cost&rdquo; — that gap is the hidden
                    cost.
                  </>
                }
              />
              <Field
                label="Cash price elsewhere"
                value={cashPrice}
                error={at('cashPrice')}
                onChange={setCashPrice}
                info={
                  <>
                    What you&apos;d pay if you walked in with cash (or used a
                    different retailer). If both are the same, the EMI is
                    genuinely free.
                  </>
                }
              />
              <Field
                label="EMI tenure (months)"
                value={tenure}
                error={at('tenure')}
                onChange={setTenure}
                kind="integer"
              />
            </>
          )}
        </div>
        {instErr && (
          <div
            className="muted"
            style={{ marginTop: 10, color: 'var(--negative)', fontSize: 12 }}
          >
            Couldn&apos;t load bank rate cards: {instErr}
          </div>
        )}
        {bankComparison && (
          <BankComparisonPanel
            comparison={bankComparison}
            loanType={loanType}
            hasProfile={profile.isLive}
            selectedBank={selectedBank}
            onPickBank={setSelectedBank}
            fmt={fmt}
          />
        )}
      </Card>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: fitColumns(2, 200) }}
        >
          <Field
            label="Processing fee at this bank"
            value={fee}
            error={at('fee')}
            onChange={setFee}
            hint="Usually 0–2% of loan amount; leave 0 if unknown"
          />
          <Field
            label="Your liquid savings (post emergency-fund)"
            value={savings}
            error={at('savings')}
            onChange={setSavings}
            info={
              <>
                Just a sanity check — if you have the cash sitting idle and
                the EMI&apos;s hidden cost is high, paying cash is cheaper.
                We don&apos;t touch your emergency fund here.
              </>
            }
          />
          <Field
            label="Your credit score (optional)"
            value={score}
            error={at('score')}
            onChange={setScore}
            hint="CIBIL/Experian (IN) or FICO (US). Leave blank if you don't know it: no score estimate is shown then."
            info={
              <>
                Used only if the verdict is &ldquo;take&rdquo;{' '}
                <em>and</em> the chosen bank isn&apos;t one of your existing
                relationships — then we estimate the FICO/CIBIL hit from a
                new account open.
              </>
            }
          />
          <SubmitBar busy={busy} error={err} label="Check this loan" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={VERDICT_LABEL[v.verdict]}
            color={VERDICT_COLOR[v.verdict]}
            detail={
              activeBank
                ? `${v.detail}  Based on ${activeBank.name}'s median rate ${formatPct(String(activeBank.median), 2)}.`
                : `${v.detail}  No bank rate card was found, so this uses a typical ${isCard ? '36%' : '14%'} rate. Pick a bank above to use its published rate.`
            }
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: fitColumns(4, 140),
              gap: 12,
              marginBottom: impact ? 12 : 0,
            }}
          >
            <Stat label="Effective APR" value={formatPct(v.effective_apr, 1)} />
            <Stat label="Monthly EMI" value={fmt(v.monthly_emi)} />
            <Stat
              label={
                <>
                  Foregone discount{' '}
                  <InfoTip>
                    For card / no-cost EMI: the gap between sticker and cash
                    price. Effectively the bank&apos;s fee built into the
                    sticker. Zero for vanilla loans.
                  </InfoTip>
                </>
              }
              value={fmt(v.foregone_discount)}
            />
            <Stat
              label={
                <>
                  New-bank friction{' '}
                  <InfoTip>
                    Going to a bank you don&apos;t already use has real
                    friction we don&apos;t turn into a single number — fresh
                    KYC, possible minimum-balance requirement, a FICO
                    hard-inquiry hit ({country === 'US' ? '~5 pts' : 'CIBIL/Experian ~10 pts'}),
                    and <em>sometimes</em> a small opening/processing fee.
                    Plenty of IN zero-balance accounts (Kotak 811, IDFC FIRST,
                    SBI BSBDA) and most US checking accounts are free, so we
                    don&apos;t pretend the cost is fixed.
                  </InfoTip>
                </>
              }
              value={isNewBank ? 'New bank' : 'Already yours'}
              color={isNewBank ? 'var(--accent)' : 'var(--positive)'}
            />
          </div>
          {impact && (
            <ScoreChip
              deltaLow={impact.delta_low}
              deltaHigh={impact.delta_high}
              daysToRealise={impact.days_to_realise}
              currentBand={impact.current_band}
              projectedBandHigh={impact.projected_band_high}
              source={impact.source}
              rationale={impact.rationale}
            />
          )}
          {v.verdict === 'take' && activeBank && (
            <AddLoanAction
              added={added}
              onAdd={() => {
                addLoanToProfile({
                  loan_type: loanType,
                  bank: activeBank.name,
                  outstanding: isCard ? cashPrice : loanAmount,
                  nominal_rate: String(activeBank.median),
                  tenure_months_remaining: Number(tenure),
                  scheduled_emi: String(v.monthly_emi),
                  processing_fee_amortised: fee !== '0' ? fee : undefined,
                });
                setAdded(true);
              }}
              label={`Add this ${loanType.replace('_', ' ')} at ${activeBank.name} to my profile`}
            />
          )}
        </Card>
      )}
    </div>
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
  rateFieldName: string;
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
    rateFieldName: loanType.replace('_', ' '),
  };
}

function BankComparisonPanel({
  comparison,
  loanType,
  hasProfile,
  selectedBank,
  onPickBank,
  fmt,
}: {
  comparison: BankComparison;
  loanType: LoanType;
  hasProfile: boolean;
  selectedBank: string;
  onPickBank: (b: string) => void;
  fmt: (v: string | number) => string;
}) {
  if (comparison.existing.length === 0 && comparison.others.length === 0) {
    return (
      <div
        className="muted"
        style={{ marginTop: 12, fontSize: 12, lineHeight: 1.55 }}
      >
        We don&apos;t have published rate-card data for {comparison.rateFieldName}{' '}
        in your country yet. The verdict below still works — it will assume a
        typical-rate guess.
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--soft-bg)',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div
        className="muted"
        style={{ fontSize: 11, marginBottom: 8 }}
      >
        Published rate-card snapshot. Your actual offer depends on credit
        profile, income, and bank discretion. Pick a row to lock the verdict
        to that bank.
        {!hasProfile && (
          <>
            {' '}Set up your profile to flag &ldquo;your bank&rdquo; rows.
          </>
        )}
      </div>
      <BankRateTable
        comparison={comparison}
        loanType={loanType}
        selectedBank={selectedBank}
        onPick={onPickBank}
        fmt={fmt}
      />
    </div>
  );
}

function BankRateTable({
  comparison,
  loanType,
  selectedBank,
  onPick,
  fmt,
}: {
  comparison: BankComparison;
  loanType: LoanType;
  selectedBank: string;
  onPick: (b: string) => void;
  fmt: (v: string | number) => string;
}) {
  const top = [...comparison.existing, ...comparison.others].slice(0, 8);
  if (top.length === 0) return null;
  const isInstallment = loanType !== 'credit_card';
  return (
    <div role="region" aria-label="Lender rates" tabIndex={0} style={{ overflowX: 'auto' }}>
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12,
        marginTop: 6,
      }}
    >
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>
            Bank
          </th>
          <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>
            Rate range
          </th>
          {isInstallment && (
            <>
              <th
                style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}
              >
                EMI (median)
              </th>
              <th
                style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}
              >
                Total interest
              </th>
            </>
          )}
          <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>
            Relationship?
          </th>
        </tr>
      </thead>
      <tbody>
        {top.map((row) => {
          const isSelected = row.name === selectedBank;
          return (
            <tr
              key={row.name}
              onClick={() => onPick(row.name)}
              style={{
                borderTop: '1px dashed var(--border)',
                cursor: 'pointer',
                background: isSelected ? 'var(--canvas)' : undefined,
              }}
            >
              <td style={{ padding: '6px 8px', fontWeight: isSelected ? 600 : 400 }}>
                {row.name}
              </td>
              <td
                style={{
                  padding: '6px 8px',
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {formatPct(String(row.low), 2)}–{formatPct(String(row.high), 2)}
              </td>
              {isInstallment && (
                <>
                  <td
                    style={{
                      padding: '6px 8px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {fmt(row.estimatedEmi.toFixed(0))}
                  </td>
                  <td
                    style={{
                      padding: '6px 8px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--muted)',
                    }}
                  >
                    {fmt(row.totalInterest.toFixed(0))}
                  </td>
                </>
              )}
              <td
                style={{
                  padding: '6px 8px',
                  textAlign: 'right',
                  color: row.isExisting ? 'var(--positive)' : 'var(--muted)',
                  fontWeight: row.isExisting ? 600 : 400,
                }}
              >
                {row.isExisting ? 'yes' : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

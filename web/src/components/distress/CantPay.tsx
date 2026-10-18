'use client';

/**
 * "I can't pay this month" (sprint L4; critique #3, add #2). Reached from
 * Home's "Feeling overwhelmed?" soft view. Reads the saved profile only;
 * nothing is sent anywhere and nothing is saved.
 *
 * 1. What to protect first, filled from the money the user says they have.
 * 2. What a missed payment costs (lib/distress-triage missedPaymentCost).
 * 3. A hardship-request letter, marked as a draft, with a self-check list.
 * 4. Rights with recovery agents, and settlement vs credit score, each
 *    with its RBI rule, date and link (TRIAGE_RULES).
 *
 * The longer-tenure what-if and "the gap becomes card debt" live on Plan
 * (sprint L2: TenureWhatIf.tsx, engine/tenure_whatif.py, engine/gap_debt.py);
 * this page links there instead of repeating them.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useStoredProfile } from '@/lib/use-profile';
import { deriveMetrics } from '@/lib/derived';
import { formatCurrencyWhole } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { loanLabel } from '@/lib/loan-types';
import {
  LShell,
  LSectionHeader,
  LBracket,
  LCardPaper,
  LField,
  L_T,
} from '@/components/ledger/primitives';
import {
  HARDSHIP_ASK_TEXT,
  LETTER_SELF_CHECK,
  US_COLLECTOR_RULE,
  US_ASK_TEXT,
  TRIAGE_RULES,
  TRIAGE_VERIFIED_ON,
  MAX_MONTHS_UNPAID,
  hardshipLetter,
  DRAFT_MARK,
  forSending,
  missedCostClosing,
  missedPaymentCost,
  protectOrder,
  readCharge,
  readMonthsUnpaid,
  type HardshipAsk,
  type TriageLine,
  type TriageRule,
} from '@/lib/distress-triage';
import { CantPayPublic } from './CantPayPublic';
import { AgentComplaintSection } from './AgentComplaint';
import { DraftLegalMarker } from '@/components/legal/DraftLegalMarker';
import { UsLettersLink } from './UsLettersLink';
import { emiOffTakeHome } from '@/lib/loan-status-core';

const num = (s: string) => {
  const n = Number(String(s).replace(/[,\s₹$]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** en-IN grouping for a typed amount ("80000" → "80,000"), left alone if it isn't a plain number (C-06). */
const groupIN = (s: string) => {
  const t = String(s).replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return s;
  const [int, frac] = t.split('.');
  return Number(int).toLocaleString('en-IN') + (frac ? `.${frac}` : '');
};

/** The ledger's underlined select (as Loan check's LENDER), not the OS grey box (C-07). */
const selectStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  color: L_T.ink,
  background: 'transparent',
  border: 'none',
  borderBottom: `2px solid ${L_T.ink}`,
  borderRadius: 0,
  padding: '6px 2px',
  minHeight: 32,
  maxWidth: '100%',
};
const captionStyle: CSSProperties = { fontSize: 11, letterSpacing: '0.12em', color: L_T.muted, display: 'block', marginBottom: 4 };

/** Owed-fix: this month's plan payment and its EMI/minimum per loan (by
 *  loan id, else position), in the user's currency, from Home's pay list. */
export interface CantPayPlanRow {
  key: string;
  amountUser: number;
  minimumUser: number;
  /** Already paid this month (user's currency), and the latest day ("9 Oct"). */
  paidUser: number;
  paidDay: string;
  /** What's owed now (lib/owed-now-core), user's currency. */
  owedNowUser: number;
}

export function CantPay({ planRows = [] }: { planRows?: CantPayPlanRow[] }) {
  const profile = useStoredProfile();
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const country = profile.user.country;
  const ccy = userDefaultCurrency(country);
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), ccy);
  const lines = useMemo(
    () =>
      m.loans
        // Round 3 (#21): an EMI taken from salary is gone before take-home
        // arrives, so it isn't in the money to share out (lib/derived does the same).
        .filter((l) => Number(l.outstanding) > 0 && emiOffTakeHome(l.loan))
        .map((l) => {
          const key = l.loan.id ?? String(l.index);
          const plan = planRows.find((r) => r.key === key);
          // Owed-fix: what's already paid this month and owed now, from the
          // plan's run (the page's server part), as Home shows them.
          const paid = plan?.paidUser ?? 0;
          const minimum = plan?.minimumUser ?? Number(m.toUserCcy(l.required, l.loan));
          return {
            key,
            label: loanLabel(l.loan),
            loan_type: l.loan.loan_type,
            // What's still due on the EMI or minimum after this month's payments.
            required: Math.max(0, minimum - paid),
            ratePct: Number(l.loan.nominal_rate || 0) * 100,
            floating: l.loan.rate_type === 'floating',
            bank: l.loan.bank ?? '',
            paid,
            paidDate: plan?.paidDay ?? '',
            planAmount: plan?.amountUser ?? null,
            toGo: plan ? Math.max(0, plan.amountUser - paid) : null,
            owedNow: plan?.owedNowUser ?? Number(m.toUserCcy(l.outstanding, l.loan)),
          };
        }),
    [m, planRows],
  );
  const due = lines.reduce((s, l) => s + l.required, 0);
  const paidSoFar = lines.reduce((s, l) => s + l.paid, 0);
  const planToGo = lines.every((l) => l.toGo != null) && lines.length > 0 ? lines.reduce((s, l) => s + (l.toGo ?? 0), 0) : null;
  const planTotal = planToGo != null ? lines.reduce((s, l) => s + (l.planAmount ?? 0), 0) : null;
  const paidLines = lines.filter((l) => l.paid > 0);
  // Take-home minus costs: what is left for loan payments before any EMI.
  // Less what's already been paid on loans this month (owed-fix).
  const leftBeforeEmis =
    num(profile.user.monthly_income) - num(profile.user.fixed_expenses) - num(profile.user.variable_expenses ?? '0') - paidSoFar;
  // B24: the amount is filled in visibly from the profile once it has loaded
  // (it used to start blank on first paint and still say COVERED), and the
  // user's own edit is never overwritten.
  const [availableText, setAvailableText] = useState('');
  const [availableTouched, setAvailableTouched] = useState(false);
  const fromProfile = profile.isLive && leftBeforeEmis > 0 ? groupIN(String(Math.round(leftBeforeEmis))) : '';
  useEffect(() => {
    if (!availableTouched) setAvailableText(fromProfile);
  }, [fromProfile, availableTouched]);
  const hasAvailable = availableText.trim() !== '';
  const available = num(availableText);
  const order = useMemo(() => protectOrder(lines, available), [lines, available]);
  const isIN = country === 'IN';

  // A17/B3: signed out (no saved profile) the page is public: the rules and
  // a blank letter, never the demo profile's loans.
  if (!profile.isLive) return <CantPayPublic />;

  return (
    <LShell>
      <div style={{ padding: '24px 0 48px', display: 'flex', flexDirection: 'column', gap: 28, width: '100%' }}>
        <section aria-labelledby="cp-head">
          <h1 id="cp-head" style={{ fontSize: 20, margin: 0, letterSpacing: '0.02em' }}>
            CAN&apos;T PAY EVERYTHING THIS MONTH?
          </h1>
          <p style={{ fontSize: 12, color: L_T.muted, lineHeight: 1.7, marginTop: 8 }}>
            One step at a time. First, what to keep paying. Then what a missed payment costs, a letter to your lender,
            and your rights. Nothing here is sent or saved.
          </p>
        </section>

        <section aria-labelledby="cp-protect" data-testid="cp-protect">
          <LSectionHeader step={1}>
            <span id="cp-protect">WHAT TO PROTECT FIRST</span>
          </LSectionHeader>
          {lines.length === 0 ? (
            <p style={{ fontSize: 12 }}>
              No loans on file. <LBracket href="/profile?step=loans">ADD YOUR LOANS →</LBracket>
            </p>
          ) : (
            <>
              <div style={{ maxWidth: 320 }}>
                <LField
                  label="Money you have for loan payments this month"
                  value={availableText}
                  onChange={(v) => { setAvailableTouched(true); setAvailableText(v); }}
                  onBlur={() => setAvailableText((v) => groupIN(v))}
                  inputMode="decimal"
                  prefix={ccy === 'INR' ? '₹' : '$'}
                  testId="cp-available"
                  hint={
                    (availableTouched || !fromProfile
                      ? `Your take-home minus spending${paidSoFar > 0 ? ', less what you’ve paid on loans this month,' : ''} is ${fc(leftBeforeEmis)}.`
                      : `Filled from your profile (take-home minus spending${paidSoFar > 0 ? `, less the ${fc(paidSoFar)} you’ve paid on loans this month` : ''}). Change it if this month is different.`) +
                    ` EMIs and minimums still due this month: ${fc(due)}.`
                  }
                />
              </div>
              <div data-testid="cp-still-to-pay" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 10 }}>
                {planToGo != null && planTotal != null ? (
                  <p style={{ margin: 0 }}>
                    <strong>Still to pay this month: {fc(planToGo)}</strong>
                    {paidSoFar > 0 ? ` (the plan’s ${fc(planTotal)} less ${fc(paidSoFar)} already paid)` : ''}, of which {fc(due)} is EMIs and minimums.
                  </p>
                ) : null}
                {paidLines.map((l) => (
                  <p key={l.key} data-testid="cp-paid-row" style={{ margin: 0, color: L_T.muted }}>
                    {l.label}: {fc(l.paid)} paid{l.paidDate ? ` ${l.paidDate}` : ''}
                    {l.required <= 0 ? (l.loan_type === 'credit_card' ? ', minimum covered' : ', EMI covered') : ''}; owes {formatCurrencyWhole(Math.round(l.owedNow), ccy)} now.
                  </p>
                ))}
              </div>
              <ol style={{ paddingLeft: 18, margin: '14px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {order.map((l) => (
                  <li key={l.key} data-testid="cp-protect-row" style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <strong>{l.label}</strong>: {fc(l.required)}
                    {l.loan_type === 'credit_card' ? ' (minimum due)' : ''} ·{' '}
                    {!hasAvailable ? (
                      <span style={{ color: L_T.muted }} data-testid="cp-protect-status">enter what you have above</span>
                    ) : (
                    <span data-testid="cp-protect-status" style={{ color: l.covered === 'full' ? L_T.positive : L_T.negative }}>
                      {l.covered === 'full'
                        ? 'COVERED'
                        : l.covered === 'part'
                          ? `PAY ${fc(l.pay)}, ${fc(l.short)} SHORT`
                          : `${fc(l.short)} SHORT`}
                    </span>
                    )}
                    <div style={{ color: L_T.muted, fontSize: 11 }}>{l.reason}</div>
                  </li>
                ))}
              </ol>
              {hasAvailable && available < due && !isIN && (
                <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.7, marginTop: 12 }}>
                  For anything short: call or write to the lender <em>before</em> the due date (letter below) and ask for its
                  hardship program. A payment that fails on autopay can add a returned-payment fee, so ask first. A longer term
                  lowers the payment: try it on <LBracket href="/plan#tenure-what-if">PLAN → LONGER TERM WHAT-IF</LBracket>.
                </p>
              )}
              {hasAvailable && available < due && isIN && (
                <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.7, marginTop: 12 }}>
                  For anything short: tell the lender <em>before</em> the due date (letter below). If the EMI is
                  auto-debited (NACH, a standing bank mandate), a failed debit adds the bank&apos;s return charge on top,
                  so ask the lender first. A longer tenure lowers the EMI: try it on{' '}
                  <LBracket href="/plan#tenure-what-if">PLAN → LONGER TENURE WHAT-IF</LBracket> (it shows when a month falls short), where
                  an unpaid gap is also counted as card-rate debt rather than ignored.
                </p>
              )}
            </>
          )}
        </section>

        {isIN && <MissCostSection lines={order} fc={fc} />}
        <LetterSection lines={order} name={profile.user.display_name ?? ''} fc={fc} country={isIN ? 'IN' : 'US'} step={isIN ? 3 : 2} />

        {!isIN && (
          <section aria-labelledby="cp-rights" data-testid="cp-rights">
            <LSectionHeader step={3}>
              <span id="cp-rights">YOUR RIGHTS WITH DEBT COLLECTORS</span>
            </LSectionHeader>
            <Rule r={US_COLLECTOR_RULE} />
            <UsLettersLink />
          </section>
        )}
        {isIN && (<>
        <AgentComplaintSection name={profile.user.display_name ?? ''} lines={order} />
        <section aria-labelledby="cp-rights" data-testid="cp-rights">
          <LSectionHeader step={4}>
            <span id="cp-rights">YOUR RIGHTS WITH RECOVERY AGENTS</span>
          </LSectionHeader>
          <Rule r={TRIAGE_RULES.recovery} />
          <Rule r={TRIAGE_RULES.recovery_2027} />
          <p style={{ fontSize: 11, color: L_T.muted, lineHeight: 1.7 }}>
            If an agent breaks these rules: write to the lender&apos;s grievance officer with dates and times. If it
            isn&apos;t fixed in 30 days, the RBI Ombudsman complaint route (cms.rbi.org.in) is free.
          </p>
        </section>

        <section aria-labelledby="cp-settle" data-testid="cp-settle">
          <LSectionHeader step={5}>
            <span id="cp-settle">SETTLEMENT VS YOUR CREDIT SCORE</span>
          </LSectionHeader>
          <Rule r={TRIAGE_RULES.settlement} />
          <Rule r={TRIAGE_RULES.restructuring} />
          <Rule r={TRIAGE_RULES.sma} />
          <p style={{ fontSize: 11, color: L_T.muted, lineHeight: 1.7 }}>
            Debt-settlement firms usually ask you to stop paying and save instead, then negotiate. That pushes every
            account into default first: late charges, recovery calls and credit-report damage while the savings build.
            RightDue earns nothing from lenders or settlement firms.
          </p>
        </section>
        </>)}

        <p style={{ fontSize: 10, color: L_T.muted }}>
          {isIN ? <>Rules checked against the RBI text on {TRIAGE_VERIFIED_ON}.</> : <>Collector rules from the CFPB&apos;s Regulation F, read 14 Oct 2026.</>} A calculator and a draft, not legal advice.
        </p>
      </div>
    </LShell>
  );
}

export function Rule({ r }: { r: TriageRule }) {
  return (
    <LCardPaper>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{r.title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.7, marginTop: 4 }}>{r.plain}</div>
      <div style={{ fontSize: 10, color: L_T.muted, marginTop: 6 }}>
        Source:{' '}
        <a href={r.url} target="_blank" rel="noreferrer" className="rd-cite" style={{ color: 'inherit' }}>
          {r.source}
        </a>
        {r.from > TRIAGE_VERIFIED_ON ? ` · in force from ${r.from}` : ''}
      </div>
    </LCardPaper>
  );
}

export type Line = TriageLine & { bank: string; floating: boolean };

/** Both loan pickers start on the same loan: the first one this month leaves short, else the first (C-07). */
function defaultKey(lines: Line[]): string {
  return (lines.find((l) => l.covered !== 'full') ?? lines[0])?.key ?? '';
}

function MissCostSection({ lines, fc }: { lines: Line[]; fc: (v: number) => string }) {
  const [key, setKey] = useState<string>('');
  const [months, setMonths] = useState('1');
  const [penal, setPenal] = useState('');
  const [bounce, setBounce] = useState('');
  const [autoDebit, setAutoDebit] = useState(true);
  const pick = lines.find((l) => l.key === (key || defaultKey(lines))) ?? lines[0];
  if (!pick) return null;
  const isCard = pick.loan_type === 'credit_card';
  const m = readMonthsUnpaid(months);
  const p = readCharge(penal);
  const b = readCharge(bounce);
  const valid = m.months !== null && !p.error && !b.error;
  const cost = missedPaymentCost({
    unpaid: pick.required,
    ratePct: pick.ratePct,
    months: m.months ?? 0,
    penalCharge: p.value,
    bounceCharge: b.value,
    autoDebit,
  });
  const n = m.months ?? 0;
  return (
    <section aria-labelledby="cp-cost" data-testid="cp-cost">
      <LSectionHeader step={2}>
        <span id="cp-cost">WHAT A MISSED PAYMENT COSTS</span>
      </LSectionHeader>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={captionStyle}>Loan to check</span>
        <select value={pick.key} onChange={(e) => setKey(e.target.value)} style={selectStyle} data-testid="cp-cost-loan">
          {lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <LField
          label="Months unpaid"
          value={months}
          onChange={setMonths}
          inputMode="numeric"
          error={m.error}
          hint={`0 to ${MAX_MONTHS_UNPAID}. One missed EMI each month.`}
          testId="cp-months"
        />
        <LField
          label={isCard ? 'Late payment fee (from your statement)' : 'Penal charge (from your KFS)'}
          value={penal}
          onChange={setPenal}
          inputMode="decimal"
          error={p.error}
          placeholder="check your KFS"
        />
        <LField
          label="Bounce / NACH return charge"
          value={bounce}
          onChange={setBounce}
          inputMode="decimal"
          error={b.error}
          placeholder="see bank's charges"
        />
      </div>
      <label className="l-check-row" style={{ fontSize: 12, marginTop: 6 }}>
        <input type="checkbox" checked={autoDebit} onChange={(e) => setAutoDebit(e.target.checked)} />
        <span>Paid by auto-debit (NACH / mandate)</span>
      </label>
      {valid && n === 0 ? (
        <p data-testid="cp-cost-total" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.8, marginTop: 10 }}>
          {missedCostClosing(0, fc(0))}
        </p>
      ) : valid ? (
        <div data-testid="cp-cost-total" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.8, marginTop: 10 }}>
          {n === 1
            ? `Interest on the unpaid ${fc(pick.required)} at the loan\u2019s own ${pick.ratePct.toFixed(2)}%: ${fc(cost.interest)}`
            : `${n} unpaid instalments of ${fc(pick.required)} (${fc(cost.arrears)} overdue by month ${n}). Interest on them at the loan\u2019s own ${pick.ratePct.toFixed(2)}%, each from its own due date: ${fc(cost.interest)}`}
          <br />
          {isCard ? 'Late fee' : 'Penal charge'}
          {n > 1 ? ` (${n} \u00d7 per missed instalment)` : ''}: {fc(cost.penal)}
          {cost.unknown.includes('penal') ? ' (not entered: check your KFS)' : ''}
          <br />
          Bounce charge{n > 1 && autoDebit ? ` (${n} failed debits)` : ''}: {fc(cost.bounce)}
          {cost.unknown.includes('bounce') ? ' (not entered: check the bank\u2019s schedule of charges)' : ''}
          <br />
          <strong>Adds about {fc(cost.total)}</strong>
          {missedCostClosing(n, fc(cost.total)).slice(`Adds about ${fc(cost.total)}`.length)}
        </div>
      ) : (
        <p data-testid="cp-cost-total" role="status" style={{ fontSize: 12, color: L_T.negative, marginTop: 10 }}>
          Fix the field above to see the cost.
        </p>
      )}
      <Rule r={isCard ? TRIAGE_RULES.card_past_due : TRIAGE_RULES.penal} />
      {isCard && <Rule r={TRIAGE_RULES.card_overlimit} />}
    </section>
  );
}

export function LetterSection({
  lines,
  name,
  fc,
  country = 'IN',
  step = 3,
  loanPicker,
}: {
  lines: Line[];
  name: string;
  fc: (v: number) => string;
  country?: 'IN' | 'US';
  step?: number;
  /** Public page: the user picks the kind of loan instead of a saved one. */
  loanPicker?: ReactNode;
}) {
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');
  const [canPayText, setCanPayText] = useState<string | null>(null);
  const [accountRef, setAccountRef] = useState('');
  const [lenderText, setLenderText] = useState<string | null>(null);
  const [nameText, setNameText] = useState(name);
  const [asks, setAsks] = useState<HardshipAsk[]>(['pause', 'longer_tenure']);
  const [edited, setEdited] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const pick = lines.find((l) => l.key === (key || defaultKey(lines))) ?? lines[0];
  if (!pick) return null;
  // C-06: start from what section 1 says this loan gets: the part paid when
  // it is short, its EMI when covered. The user can change it.
  const suggested = pick.covered === 'full' ? pick.required : pick.pay;
  const canPay = canPayText ?? (suggested > 0 ? groupIN(String(Math.round(suggested))) : '');
  const lender = lenderText ?? pick.bank;
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const canPayNum = num(canPay);
  const draft = hardshipLetter({
    name: nameText.trim(),
    lender: lender.trim(),
    loanLabel: pick.label,
    accountRef: accountRef.trim(),
    reason: reason.trim(),
    canPay: canPay.trim() === '' ? '' : /^[\d,.\s₹]+$/.test(canPay) ? fc(canPayNum) : canPay.trim(),
    asks,
    floating: pick.floating,
    dateText: today,
    country,
  });
  const letter = edited ?? draft;
  const subject = `Request for hardship relief on my ${pick.label}${accountRef.trim() ? `, account ${accountRef.trim()}` : ''}`;
  const toggle = (a: HardshipAsk) => setAsks((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as Navigator).share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(forSending(letter));
      setSaid('Letter copied. Paste it into an email or the lender\u2019s service form.');
    } catch {
      setSaid('Couldn\u2019t copy here. Select the letter and copy it by hand.');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: subject, text: forSending(letter) });
    } catch {
      /* cancelled */
    }
  };
  const download = () => {
    const blob = new Blob([forSending(letter)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hardship-letter.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaid('Saved as hardship-letter.txt.');
  };
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(forSending(letter))}`;
  return (
    <section aria-labelledby="cp-letter" data-testid="cp-letter">
      <LSectionHeader step={step}>
        <span id="cp-letter">ASK YOUR LENDER FOR HELP (LETTER)</span>
      </LSectionHeader>
      <DraftLegalMarker id="letter-hardship" />
      <p style={{ ...captionStyle, letterSpacing: 0, fontFamily: 'inherit' }} data-testid="letter-caution">{DRAFT_MARK}</p>
      {loanPicker ?? (
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={captionStyle}>Loan for the letter</span>
        <select value={pick.key} onChange={(e) => { setKey(e.target.value); setLenderText(null); setCanPayText(null); }} style={selectStyle} data-testid="cp-letter-loan">
          {lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <LField label="Lender" value={lender} onChange={setLenderText} placeholder={country === 'US' ? 'e.g. Chase' : 'e.g. HDFC Bank'} />
        <LField label="Your name" value={nameText} onChange={setNameText} placeholder="as on the loan" />
        <LField label="Reason (short and true)" value={reason} onChange={setReason} />
        <LField
          label="You can pay a month"
          value={canPay}
          onChange={setCanPayText}
          onBlur={() => setCanPayText(groupIN(canPay))}
          inputMode="decimal"
          prefix={country === 'US' ? '$' : '₹'}
          placeholder=""
          testId="cp-canpay"
        />
        <LField label="Loan account number" value={accountRef} onChange={setAccountRef} />
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: '8px 0', fontSize: 12 }}>
        <legend style={{ fontSize: 11, letterSpacing: '0.12em', color: L_T.muted }}>What to ask for</legend>
        {(Object.keys(HARDSHIP_ASK_TEXT) as HardshipAsk[]).map((a) => (
          <label key={a} className="l-check-row">
            <input type="checkbox" checked={asks.includes(a)} onChange={() => toggle(a)} />
            <span>{(country === 'US' ? US_ASK_TEXT : HARDSHIP_ASK_TEXT)[a]}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="cp-letter-text" style={captionStyle}>
        The letter (you can edit it here)
      </label>
      <textarea
        id="cp-letter-text"
        data-testid="cp-letter-text"
        value={letter}
        onChange={(e) => setEdited(e.target.value)}
        rows={18}
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, padding: 10, border: `1px solid ${L_T.ink}`, borderRadius: 0, boxSizing: 'border-box' }}
      />
      {edited !== null && edited !== draft && (
        <p style={{ fontSize: 11, color: L_T.muted, margin: '4px 0 0' }}>
          You have edited the letter, so the fields above no longer change it.{' '}
          <LBracket onClick={() => setEdited(null)}>RESET TO DRAFT</LBracket>
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }} data-testid="cp-letter-actions">
        <LBracket accent onClick={copy}>COPY LETTER</LBracket>
        <LBracket href={mailto}>EMAIL IT</LBracket>
        {canShare && <LBracket onClick={share}>SHARE</LBracket>}
        <LBracket onClick={download}>DOWNLOAD .TXT</LBracket>
      </div>
      <p role="status" aria-live="polite" data-testid="cp-letter-said" style={{ fontSize: 11, color: L_T.positive, minHeight: 16, margin: '6px 0 0' }}>
        {said}
      </p>
      <div style={{ fontSize: 12, marginTop: 8 }}>
        <strong>Before you send it:</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {LETTER_SELF_CHECK.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

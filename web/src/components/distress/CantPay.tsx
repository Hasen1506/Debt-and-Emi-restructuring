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
import { useMemo, useState } from 'react';
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
  TRIAGE_RULES,
  TRIAGE_VERIFIED_ON,
  hardshipLetter,
  missedPaymentCost,
  protectOrder,
  type HardshipAsk,
  type TriageRule,
} from '@/lib/distress-triage';

const num = (s: string) => {
  const n = Number(String(s).replace(/[,\s₹$]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function CantPay() {
  const profile = useStoredProfile();
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const country = profile.user.country;
  const ccy = userDefaultCurrency(country);
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), ccy);

  const lines = useMemo(
    () =>
      m.loans
        .filter((l) => Number(l.outstanding) > 0)
        .map((l) => ({
          key: l.loan.id ?? String(l.index),
          label: loanLabel(l.loan),
          loan_type: l.loan.loan_type,
          required: Number(m.toUserCcy(l.required, l.loan)),
          ratePct: Number(l.loan.nominal_rate || 0) * 100,
          floating: l.loan.rate_type === 'floating',
          bank: l.loan.bank ?? '',
        })),
    [m],
  );
  const due = lines.reduce((s, l) => s + l.required, 0);
  // Take-home minus costs: what is left for loan payments before any EMI.
  const leftBeforeEmis =
    num(profile.user.monthly_income) - num(profile.user.fixed_expenses) - num(profile.user.variable_expenses ?? '0');
  const [availableText, setAvailableText] = useState(String(Math.max(0, Math.round(leftBeforeEmis))));
  const available = num(availableText);
  const order = useMemo(() => protectOrder(lines, available), [lines, available]);

  if (country !== 'IN') {
    return (
      <LShell>
        <div style={{ padding: '32px 0', maxWidth: 640 }}>
          <LSectionHeader>CAN&apos;T PAY THIS MONTH?</LSectionHeader>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            The rules on this page are India&apos;s (RBI). US rules on late payments and debt collectors are different
            and aren&apos;t covered here yet. Call your lender before the due date and ask what hardship options it has.
          </p>
          <LBracket href="/plan">SEE YOUR PLAN →</LBracket>
        </div>
      </LShell>
    );
  }

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
                  onChange={setAvailableText}
                  type="number"
                  prefix={ccy === 'INR' ? '₹' : '$'}
                  hint={`Your take-home minus spending is ${fc(leftBeforeEmis)}. Due this month: ${fc(due)}.`}
                />
              </div>
              <ol style={{ paddingLeft: 18, margin: '14px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {order.map((l) => (
                  <li key={l.key} data-testid="cp-protect-row" style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <strong>{l.label}</strong>: {fc(l.required)}
                    {l.loan_type === 'credit_card' ? ' (minimum due)' : ''} ·{' '}
                    <span style={{ color: l.covered === 'full' ? L_T.positive : L_T.negative }}>
                      {l.covered === 'full'
                        ? 'COVERED'
                        : l.covered === 'part'
                          ? `PAY ${fc(l.pay)}, ${fc(l.short)} SHORT`
                          : `${fc(l.short)} SHORT`}
                    </span>
                    <div style={{ color: L_T.muted, fontSize: 11 }}>{l.reason}</div>
                  </li>
                ))}
              </ol>
              {available < due && (
                <p style={{ fontSize: 11, color: L_T.muted, lineHeight: 1.7, marginTop: 12 }}>
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

        <MissCostSection lines={order} fc={fc} />
        <LetterSection lines={lines} name={profile.user.display_name ?? ''} />

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

        <p style={{ fontSize: 10, color: L_T.muted }}>
          Rules checked against the RBI text on {TRIAGE_VERIFIED_ON}. A calculator and a draft, not legal advice.
        </p>
      </div>
    </LShell>
  );
}

function Rule({ r }: { r: TriageRule }) {
  return (
    <LCardPaper>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{r.title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.7, marginTop: 4 }}>{r.plain}</div>
      <div style={{ fontSize: 10, color: L_T.muted, marginTop: 6 }}>
        Source:{' '}
        <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
          {r.source}
        </a>
        {r.from > TRIAGE_VERIFIED_ON ? ` · in force from ${r.from}` : ''}
      </div>
    </LCardPaper>
  );
}

type Line = ReturnType<typeof protectOrder>[number];

function MissCostSection({ lines, fc }: { lines: Line[]; fc: (v: number) => string }) {
  const [key, setKey] = useState<string>('');
  const [months, setMonths] = useState('1');
  const [penal, setPenal] = useState('');
  const [bounce, setBounce] = useState('');
  const [autoDebit, setAutoDebit] = useState(true);
  const pick = lines.find((l) => l.key === key) ?? lines[lines.length - 1];
  if (!pick) return null;
  const isCard = pick.loan_type === 'credit_card';
  const cost = missedPaymentCost({
    unpaid: pick.required,
    ratePct: pick.ratePct,
    months: num(months),
    penalCharge: penal.trim() === '' ? null : num(penal),
    bounceCharge: bounce.trim() === '' ? null : num(bounce),
    autoDebit,
  });
  return (
    <section aria-labelledby="cp-cost" data-testid="cp-cost">
      <LSectionHeader step={2}>
        <span id="cp-cost">WHAT A MISSED PAYMENT COSTS</span>
      </LSectionHeader>
      <label style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        Loan{' '}
        <select value={pick.key} onChange={(e) => setKey(e.target.value)} aria-label="Loan to check">
          {lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <LField label="Months unpaid" value={months} onChange={setMonths} type="number" />
        <LField
          label={isCard ? 'Late payment fee (from your statement)' : 'Penal charge (from your KFS)'}
          value={penal}
          onChange={setPenal}
          type="number"
          placeholder="check your KFS"
        />
        <LField
          label="Bounce / NACH return charge"
          value={bounce}
          onChange={setBounce}
          type="number"
          placeholder="bank's schedule of charges"
        />
      </div>
      <label style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
        <input type="checkbox" checked={autoDebit} onChange={(e) => setAutoDebit(e.target.checked)} /> Paid by auto-debit
        (NACH / mandate)
      </label>
      <div data-testid="cp-cost-total" style={{ fontSize: 12, lineHeight: 1.8, marginTop: 10 }}>
        Interest on the unpaid {fc(pick.required)} at the loan&apos;s own {pick.ratePct.toFixed(2)}%: {fc(cost.interest)}
        <br />
        {isCard ? 'Late fee' : 'Penal charge'}: {fc(cost.penal)}
        {cost.unknown.includes('penal') ? ' (not entered: check your KFS)' : ''}
        <br />
        Bounce charge: {fc(cost.bounce)}
        {cost.unknown.includes('bounce') ? ' (not entered: check the bank\u2019s schedule of charges)' : ''}
        <br />
        <strong>Adds about {fc(cost.total)}</strong>, plus a missed payment on your credit report.
      </div>
      <Rule r={isCard ? TRIAGE_RULES.card_past_due : TRIAGE_RULES.penal} />
      {isCard && <Rule r={TRIAGE_RULES.card_overlimit} />}
    </section>
  );
}

function LetterSection({
  lines,
  name,
}: {
  lines: Array<{ key: string; label: string; floating: boolean; bank: string }>;
  name: string;
}) {
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');
  const [canPay, setCanPay] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const [asks, setAsks] = useState<HardshipAsk[]>(['pause', 'longer_tenure']);
  const pick = lines.find((l) => l.key === key) ?? lines[0];
  if (!pick) return null;
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const letter = hardshipLetter({
    name,
    lender: pick.bank,
    loanLabel: pick.label,
    accountRef,
    reason,
    canPay,
    asks,
    floating: pick.floating,
    dateText: today,
  });
  const toggle = (a: HardshipAsk) => setAsks((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  return (
    <section aria-labelledby="cp-letter" data-testid="cp-letter">
      <LSectionHeader step={3}>
        <span id="cp-letter">ASK YOUR LENDER FOR HELP (LETTER)</span>
      </LSectionHeader>
      <label style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        Loan{' '}
        <select value={pick.key} onChange={(e) => setKey(e.target.value)} aria-label="Loan for the letter">
          {lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <LField label="Reason (short and true)" value={reason} onChange={setReason} />
        <LField label="You can pay a month" value={canPay} onChange={setCanPay} />
        <LField label="Loan account number" value={accountRef} onChange={setAccountRef} />
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: '8px 0', fontSize: 11 }}>
        <legend>What to ask for</legend>
        {(Object.keys(HARDSHIP_ASK_TEXT) as HardshipAsk[]).map((a) => (
          <label key={a} style={{ display: 'block' }}>
            <input type="checkbox" checked={asks.includes(a)} onChange={() => toggle(a)} /> {HARDSHIP_ASK_TEXT[a]}
          </label>
        ))}
      </fieldset>
      <textarea
        readOnly
        aria-label="Hardship letter draft"
        value={letter}
        rows={18}
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 11, padding: 10 }}
      />
      <div style={{ fontSize: 11, marginTop: 8 }}>
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

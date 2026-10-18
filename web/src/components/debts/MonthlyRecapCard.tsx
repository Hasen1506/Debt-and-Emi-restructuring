'use client';

/**
 * Monthly recap card — the user confirms (or overrides) last month's
 * income, expenses, and EMIs. Phase 2 of the cash module.
 *
 * Collapsed-by-default: closed state is a single tappable headline.
 * Opening reveals the editable defaults (income / expenses / EMIs paid /
 * interest earned / optional note). On confirm:
 *   • A MonthlyConfirmation is logged to localStorage + synced to server.
 *   • The primary cash account's balance is bumped by netDelta
 *     (income − expenses − emis + interest).
 *
 * Reads/writes localStorage and the profile cookie via existing
 * `saveProfileClient`. Renders nothing pre-hydration (avoids SSR/CSR
 * mismatch) and nothing when there are no pending months.
 */

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { dec } from '@/lib/safe-decimal';
import { recapNet } from '@/lib/cash-allocation';
import { commitCashChange } from '@/lib/commit-cash-change';
import { addActivityEntry, readActivityClient, extraPrincipal } from '@/lib/activity';
import { rollBalancesForward } from '@/lib/roll-forward';
import { countryMonthKey } from '@/lib/today';
import { applyActivityDeltas, activityDeltas } from '@/lib/activity-cookie';
import { explainMinPayment } from '@/lib/min-payment';
import { loanToUser } from '@/lib/currency';
import type { CashAccountPayload, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { currencySymbol, userDefaultCurrency } from '@/lib/currency';
import { loadProfileClient } from '@/lib/user-store';
import {
  ensureStarted,
  monthLabel,
  pendingMonths,
  readCashEventsClient,
  type CashEventsSlice,
  type MonthlyConfirmation,
  type PaymentSource,
} from '@/lib/cash-events';


export function MonthlyRecapCard({ user }: { user: UserPayload }) {
  const [slice, setSlice] = useState<CashEventsSlice>({ confirmations: [] });
  const [ready, setReady] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  // Collapsed by default — the closed state is just the headline + a
  // chevron. Reduces page-rhythm clunkiness on /debts.
  const [isOpen, setIsOpen] = useState(false);
  const [error,setError] = useState('');
  const [chosenAccount,setChosenAccount] = useState('');

  useEffect(() => {
    let next = readCashEventsClient();
    // Only start tracking once the user has actually populated cash_accounts.
    // Otherwise there's nothing meaningful to confirm against. Picking the
    // primary account at startup-time lets us stamp it on the slice so
    // future confirmations keep landing on the same account even if the
    // user later reorders or renames.
    if (user.cash_accounts && user.cash_accounts.length > 0) {
      const candidate =
        user.cash_accounts.find((a) => a.kind === 'checking' && (!a.currency || a.currency === userDefaultCurrency(user.country))) ??
        user.cash_accounts.find((a) => a.kind !== 'fd' && (!a.currency || a.currency === userDefaultCurrency(user.country)));
      next = ensureStarted(next, candidate?.name);
    }
    setSlice(next);
    setReady(true);
  }, [user.cash_accounts,user.country]);

  const pending = useMemo(() => pendingMonths(slice), [slice]);

  // Resolve the primary account: prefer the one stamped on the slice
  // (set at ensureStarted time). Fall back to live picking only for
  // legacy slices that pre-date the stamp.
  const primaryAccount: CashAccountPayload | null = useMemo(() => {
    const accounts = (user.cash_accounts ?? []).filter(a => a.kind !== 'fd' && (!a.currency || a.currency === userDefaultCurrency(user.country)));
    if (accounts.length === 0) return null;
    if (chosenAccount) { const selected=accounts.find(a=>a.name===chosenAccount); if(selected) return selected; }
    if (slice.primaryAccountName) {
      const stamped = accounts.find((a) => a.name === slice.primaryAccountName);
      if (stamped) return stamped;
      // Stamp pointed at an account that no longer exists (user deleted it).
      // Fall through to the live picker.
    }
    return accounts.find((a) => a.kind === 'checking') ?? accounts[0];
  }, [user.cash_accounts, user.country, slice.primaryAccountName, chosenAccount]);

  if (!ready) return null;
  if (!primaryAccount) return null;
  if (pending.length === 0) return null;

  const currency = userDefaultCurrency(user.country);

  // Defaults for the inputs.
  const defaultIncome = user.monthly_income ?? '0';
  const defaultExpenses = dec(user.fixed_expenses)
    .add(dec(user.variable_expenses))
    .toFixed(2);
  const defaultEmis = (user.loans ?? []).filter(l => Number(l.outstanding)>0)
    .reduce(
      (sum, l) => {
        const payment = l.loan_type === 'credit_card' ? explainMinPayment(l,user.country)?.estimated ?? l.scheduled_emi : l.scheduled_emi;
        const converted = loanToUser(Number(payment || 0),l,user.country,user.fx_to_user_currency);
        return sum.add(converted ?? 0);
      },
      new Decimal(0),
    )
    .toFixed(2);

  function handleConfirm(
    monthKey: string,
    income: string,
    expenses: string,
    emis: string,
    interest: string,
    note: string | undefined,
    overridden: boolean,
    paymentSource: PaymentSource,
    targetLoanId?: string,
    fundingAccountName?: string,
  ): void {
    setError('');
    try {
      const cash = readCashEventsClient();
      if (cash.confirmations.some(c=>c.monthKey===monthKey)) {setSlice(cash);return;}
      if (!pendingMonths(cash).includes(monthKey)) throw new Error('This is not a complete, pending month. Refresh the recap before saving.');
      const stored = loadProfileClient();
      let entries = readActivityClient();
      const current = applyActivityDeltas(rollBalancesForward(stored.user.loans,countryMonthKey(stored.user.country)).loans,activityDeltas(entries,stored.user.loans,stored.user.country),countryMonthKey(stored.user.country)).loans;
      if (current.some(l=>loanToUser(1,l,stored.user.country,stored.user.fx_to_user_currency)==null)) throw new Error('Save every loan exchange rate before confirming a month.');
      const scheduledD = dec(defaultEmis);
      const emisD = new Decimal(emis);
      const excess = Decimal.max(0,emisD.minus(scheduledD));
      const netDelta = recapNet(income,expenses,emis,interest,defaultEmis,paymentSource);
      const accounts = (stored.user.cash_accounts ?? []).map(a=>({...a}));
      const primaryIndex = accounts.findIndex(a=>a.name===primaryAccount!.name);
      if (primaryIndex<0) throw new Error('The selected cash account no longer exists.');
      if (accounts[primaryIndex].kind === 'fd' || (accounts[primaryIndex].currency && accounts[primaryIndex].currency !== currency)) throw new Error('Choose a liquid account in your residence currency.');
      if (new Set(accounts.map(a=>a.name)).size !== accounts.length) throw new Error('Give each cash account a distinct name in Setup before confirming.');
      if (new Decimal(accounts[primaryIndex].balance).plus(netDelta).lt(0)) throw new Error('This month would overdraw the selected cash account. Enter the actual income, expenses or funding source.');
      accounts[primaryIndex].balance = new Decimal(accounts[primaryIndex].balance).plus(netDelta).toFixed(2);
      let ef = new Decimal(stored.user.efund_balance ?? 0);
      if(excess.gt(0)) {
        const live = current.map((l,i)=>({l,i})).filter(({l})=>Number(l.outstanding)>0);
        const target = targetLoanId ? live.find(({l,i})=>(l.id ?? String(i))===targetLoanId) : live.length===1 ? live[0] : undefined;
        if(!target) throw new Error('Choose the loan that received the additional payment.');
        const fx=loanToUser(1,target.l,stored.user.country,stored.user.fx_to_user_currency)!;
        const principal=excess.div(fx);
        if(principal.gt(target.l.outstanding)) throw new Error('Extra principal exceeds this loan balance. Split the payment between the loans that received it.');
        if(paymentSource==='savings_drawdown') {
          const funding=accounts.findIndex(a=>a.name===fundingAccountName && a.kind!=='fd' && (!a.currency || a.currency===currency));
          if(funding<0) throw new Error('Choose the liquid account that funded the extra payment.');
          if(new Decimal(accounts[funding].balance).lt(excess)) throw new Error('That account cannot cover the extra payment.');
          accounts[funding].balance=new Decimal(accounts[funding].balance).minus(excess).toFixed(2);
        } else if(paymentSource==='ef_drawdown') {
          if(ef.lt(excess)) throw new Error('The emergency fund cannot cover that payment.');
          ef=ef.minus(excess);
        }
        entries=addActivityEntry(entries,{loanIndex:target.i,loanId:target.l.id,kind:'paid_extra',date:monthKey+'-01',
          scheduledEmi:'0',amount:principal.toFixed(2),source:'monthly-recap',note:`${monthLabel(monthKey)} additional principal, ${paymentSource}`},stored.user.loans);
      }
      const totalCash=accounts.reduce((sum,a)=> {
        const fx=!a.currency || a.currency===currency ? 1 : Number(stored.user.fx_to_user_currency?.[a.currency]);
        if(!(fx>0)) throw new Error('Save every cash account exchange rate before confirming.');
        return sum.plus(new Decimal(a.balance).mul(fx));
      },new Decimal(0));
      const confirmation: MonthlyConfirmation={monthKey,income,expenses,emisPaid:emis,interestEarned:interest,
        netDelta:netDelta.toFixed(2),primaryAccountName:primaryAccount!.name,confirmedAt:new Date().toISOString(),
        source:overridden?'override':'confirmed',note,paymentSource,excessPaid:excess.toFixed(2)};
      const next={...cash,primaryAccountName:primaryAccount!.name,confirmations:[...cash.confirmations,confirmation]};
      commitCashChange(stored,{...stored.user,cash_accounts:accounts,savings_balance:totalCash.toFixed(2),efund_balance:ef.toFixed(2)},entries,next);
      setSlice(next);
      setExpandedMonth(null);
    } catch(e) {setError((e as Error).message);}
  }

  // Show oldest pending first — that's what the user would naturally
  // confirm next. UI emphasises the single nearest action.
  const focusMonth = expandedMonth ?? pending[0];

  const headline =
    pending.length === 1
      ? `Confirm ${monthLabel(pending[0])}`
      : `${pending.length} months pending — start with ${monthLabel(pending[0])}`;
  const chevron = isOpen ? '▾' : '▸';

  // One-tap confirm with stated defaults — for the common case where the
  // user hasn't deviated from their stated income / expenses / EMI. Lives
  // alongside the expand-to-edit path so a user who wants to override can
  // still do so. `interest=0`, `note=''`, `paymentSource='surplus'` — the
  // sensible defaults the form would render anyway.
  function quickConfirm() {
    handleConfirm(
      focusMonth,
      defaultIncome,
      defaultExpenses,
      defaultEmis,
      '0',
      undefined,
      false,
      'surplus',
    );
  }

  // Layout body (the editable form) shared across all 3 skins.
  const body = (
    <>
      <label>Cash account for this recap
        <select aria-label="Cash account for this recap" value={primaryAccount.name} onChange={e=>setChosenAccount(e.target.value)}>
          {(user.cash_accounts ?? []).filter(a=>a.kind!=='fd' && (!a.currency || a.currency===currency)).map(a=><option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
      </label>
      <ConfirmForm
        monthKey={focusMonth}
        currencyLabel={currency}
        defaultIncome={defaultIncome}
        defaultExpenses={defaultExpenses}
        defaultEmis={defaultEmis}
        user={user}
        onConfirm={handleConfirm}
      />
      {pending.length > 1 && (
        <div
          style={{ marginTop: 10, fontSize: 12 }}
          className="muted"
        >
          Other pending:{' '}
          {pending
            .filter((m) => m !== focusMonth)
            .slice(0, 6)
            .map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setExpandedMonth(m)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  marginRight: 6,
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {monthLabel(m)}
              </button>
            ))}
          {pending.length > 7 && <span>+ {pending.length - 7} more</span>}
        </div>
      )}
      <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
        Defaults come from your stated income / expenses / EMI. Edit any
        field if reality differed. Confirming bumps{' '}
        <strong>{primaryAccount.name}</strong>'s balance by the net.
      </div>
    </>
  );

  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
        borderLeft: '3px solid var(--accent)',
        paddingLeft: 12,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 11,
            color: 'var(--accent)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontFamily: 'inherit',
            flex: 1,
          }}
        >
          {chevron} MONTHLY RECAP · {headline}
        </button>
        {!isOpen && (
          <button
            type="button"
            onClick={quickConfirm}
            style={{
              background: 'var(--accent)',
              color: 'var(--canvas)',
              border: 'none',
              padding: '4px 10px',
              fontFamily: 'inherit',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">[</span>Use defaults<span aria-hidden="true">]</span>
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {isOpen && <div style={{ marginTop: 8 }}>{body}</div>}
    </div>
  );
}

// ─── Embedded form ─────────────────────────────────────────────────────────

function ConfirmForm({
  monthKey,
  currencyLabel,
  defaultIncome,
  defaultExpenses,
  defaultEmis,
  user,
  onConfirm,
}: {
  monthKey: string;
  currencyLabel: 'INR' | 'USD';
  defaultIncome: string;
  defaultExpenses: string;
  defaultEmis: string;
  user: UserPayload;
  onConfirm: (
    monthKey: string,
    income: string,
    expenses: string,
    emis: string,
    interest: string,
    note: string | undefined,
    overridden: boolean,
    paymentSource: PaymentSource,
    targetLoanId?: string,
    fundingAccountName?: string,
  ) => void;
}) {
  const [income, setIncome] = useState(defaultIncome);
  const [expenses, setExpenses] = useState(defaultExpenses);
  const [emis, setEmis] = useState(defaultEmis);
  const [interest, setInterest] = useState('0');
  const [note, setNote] = useState('');
  const [paymentSource, setPaymentSource] = useState<PaymentSource>('surplus');
  const [targetLoanId,setTargetLoanId]=useState('');
  const [fundingAccount,setFundingAccount]=useState('');

  // Reset when month changes (user clicked a different pending month).
  useEffect(() => {
    setIncome(defaultIncome);
    setExpenses(defaultExpenses);
    setEmis(defaultEmis);
    setInterest('0');
    setNote('');
    setPaymentSource('surplus');
  }, [monthKey, defaultIncome, defaultExpenses, defaultEmis]);

  const overridden =
    income !== defaultIncome ||
    expenses !== defaultExpenses ||
    emis !== defaultEmis ||
    dec(interest).gt(0) ||
    note.trim() !== '' ||
    paymentSource !== 'surplus';

  const excessAmount = Decimal.max(
    0,
    dec(emis).sub(dec(defaultEmis)),
  );
  const hasExcess = excessAmount.gt(0);

  let net = new Decimal(0);
  let valid = true;
  try { net=recapNet(income,expenses,emis,interest,defaultEmis,paymentSource); } catch {valid=false;}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <SmallField
          label={`Income (${currencySymbol(currencyLabel)})`}
          value={income}
          onChange={setIncome}
        />
        <SmallField
          label="Expenses"
          value={expenses}
          onChange={setExpenses}
        />
        <SmallField
          label="EMIs paid (excluding extra already logged in Activity)"
          value={emis}
          onChange={setEmis}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <SmallField
          label="Interest earned"
          value={interest}
          onChange={setInterest}
        />
        <SmallField
          label="Note (optional)"
          value={note}
          onChange={setNote}
          isText
        />
      </div>
      {hasExcess && <>
        <label>Loan receiving additional payment
          <select aria-label="Loan receiving additional payment" value={targetLoanId} onChange={e=>setTargetLoanId(e.target.value)}>
            <option value="">Choose a loan (automatic when only one is active)</option>
            {user.loans.map((l,i)=>Number(l.outstanding)>0 && <option key={l.id ?? i} value={l.id ?? String(i)}>{l.bank} · {l.loan_type}</option>)}
          </select>
        </label>
        {paymentSource==='savings_drawdown' && <label>Account funding the extra payment
          <select aria-label="Account funding the extra payment" value={fundingAccount} onChange={e=>setFundingAccount(e.target.value)}>
            <option value="">Choose an account</option>
            {(user.cash_accounts ?? []).filter(a=>a.kind!=='fd' && (!a.currency || a.currency===currencyLabel)).map(a=><option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </label>}
      </>}
      {hasExcess && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--muted-ink, var(--muted))' }}>
            You paid{' '}
            <strong>
              {currencySymbol(currencyLabel)}
              {excessAmount.toFixed(0)}
            </strong>{' '}
            above the scheduled EMI. Where did that extra come from?
          </span>
          <select
            aria-label="Extra payment funding source"
            value={paymentSource}
            onChange={(e) => setPaymentSource(e.target.value as PaymentSource)}
            style={{
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--canvas)',
              color: 'var(--ink)',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            <option value="surplus">Surplus (cut back on spending)</option>
            <option value="savings_drawdown">Idle savings drawdown</option>
            <option value="ef_drawdown">Emergency fund drawdown</option>
            <option value="one_off">One-off / windfall (bonus, gift)</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {paymentSource === 'surplus' &&
              'Default — primary cash account absorbs the hit.'}
            {paymentSource === 'savings_drawdown' &&
              'Idle savings balance shrinks by the excess.'}
            {paymentSource === 'ef_drawdown' &&
              'Emergency fund balance shrinks by the excess. We’ll flag if EF dips below target.'}
            {paymentSource === 'one_off' &&
              'No tracked balance changes — external windfall paid down debt.'}
          </span>
        </div>
      )}
      {!valid && <p role="alert">Enter finite, non-negative amounts in every money field.</p>}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
          fontSize: 13,
        }}
      >
        <div>
          Net change:{' '}
          <strong
            style={{
              color:
                net.gt(0)
                  ? 'var(--positive)'
                  : net.lt(0)
                    ? 'var(--negative)'
                    : 'var(--ink)',
            }}
          >
            {net.gte(0) ? '+' : ''}
            {formatCurrency(net.toFixed(2), currencyLabel)}
          </strong>
        </div>
        <button
          type="button"
          disabled={!valid}
          onClick={() =>
            onConfirm(
              monthKey,
              income,
              expenses,
              emis,
              interest,
              note,
              overridden,
              paymentSource,
              targetLoanId,
              fundingAccount,
            )
          }
          style={{
            background: 'var(--accent)',
            color: 'var(--canvas)',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {overridden ? 'Save override' : `Confirm ${monthLabel(monthKey)}`}
        </button>
      </div>
    </div>
  );
}

function SmallField({
  label,
  value,
  onChange,
  isText,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isText?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--muted-ink)' }}>{label}</span>
      <input
        type={isText ? 'text' : 'number'}
        inputMode={isText ? undefined : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '5px 8px',
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          fontSize: 12,
          fontFamily: 'inherit',
          width: '100%',
        }}
      />
    </label>
  );
}

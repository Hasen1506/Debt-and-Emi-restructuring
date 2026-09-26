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
import type { CashAccountPayload, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { currencySymbol, userDefaultCurrency } from '@/lib/currency';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import {
  appendConfirmation,
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

  useEffect(() => {
    let next = readCashEventsClient();
    // Only start tracking once the user has actually populated cash_accounts.
    // Otherwise there's nothing meaningful to confirm against. Picking the
    // primary account at startup-time lets us stamp it on the slice so
    // future confirmations keep landing on the same account even if the
    // user later reorders or renames.
    if (user.cash_accounts && user.cash_accounts.length > 0) {
      const candidate =
        user.cash_accounts.find((a) => a.kind !== 'checking') ??
        user.cash_accounts[0];
      next = ensureStarted(next, candidate?.name);
    }
    setSlice(next);
    setReady(true);
  }, [user.cash_accounts]);

  const pending = useMemo(() => pendingMonths(slice), [slice]);

  // Resolve the primary account: prefer the one stamped on the slice
  // (set at ensureStarted time). Fall back to live picking only for
  // legacy slices that pre-date the stamp.
  const primaryAccount: CashAccountPayload | null = useMemo(() => {
    const accounts = user.cash_accounts ?? [];
    if (accounts.length === 0) return null;
    if (slice.primaryAccountName) {
      const stamped = accounts.find((a) => a.name === slice.primaryAccountName);
      if (stamped) return stamped;
      // Stamp pointed at an account that no longer exists (user deleted it).
      // Fall through to the live picker.
    }
    return accounts.find((a) => a.kind !== 'checking') ?? accounts[0];
  }, [user.cash_accounts, slice.primaryAccountName]);

  if (!ready) return null;
  if (!primaryAccount) return null;
  if (pending.length === 0) return null;

  const currency = userDefaultCurrency(user.country);

  // Defaults for the inputs.
  const defaultIncome = user.monthly_income ?? '0';
  const defaultExpenses = new Decimal(user.fixed_expenses ?? '0')
    .add(new Decimal(user.variable_expenses ?? '0'))
    .toFixed(2);
  const defaultEmis = (user.loans ?? [])
    .reduce(
      (sum, l) =>
        l.loan_type === 'credit_card'
          ? sum.add(new Decimal(l.scheduled_emi || 0))
          : sum.add(new Decimal(l.scheduled_emi || 0)),
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
  ): void {
    // Excess prepayment = anything above the scheduled minimum EMI for the
    // month. That excess is what we attribute to the chosen payment source;
    // the scheduled portion is always treated as regular cash flow.
    const scheduledD = new Decimal(defaultEmis || 0);
    const emisD = new Decimal(emis || 0);
    const excess = Decimal.max(0, emisD.sub(scheduledD));

    // Cash-account net delta:
    //   • surplus  → income − expenses − emis + interest (full EMI counts)
    //   • non-surplus → income − expenses − scheduled + interest (excess
    //     comes from the tagged bucket instead of the primary account)
    const emisChargedToPrimary = paymentSource === 'surplus' ? emisD : scheduledD;
    const netDelta = new Decimal(income || 0)
      .sub(new Decimal(expenses || 0))
      .sub(emisChargedToPrimary)
      .add(new Decimal(interest || 0));

    const confirmation: MonthlyConfirmation = {
      monthKey,
      income: new Decimal(income || 0).toFixed(2),
      expenses: new Decimal(expenses || 0).toFixed(2),
      emisPaid: emisD.toFixed(2),
      interestEarned: new Decimal(interest || 0).toFixed(2),
      netDelta: netDelta.toFixed(2),
      primaryAccountName: primaryAccount!.name,
      confirmedAt: new Date().toISOString(),
      source: overridden ? 'override' : 'confirmed',
      note: note?.trim() ? note.trim() : undefined,
      paymentSource,
      excessPaid: excess.toFixed(2),
    };

    setSlice((cur) => appendConfirmation(cur, confirmation));

    // Mutate the primary account's balance by netDelta. Profile is the
    // truth for current balance — events are audit. Floor at 0 so a
    // catastrophic month doesn't go negative and confuse downstream math.
    const stored = loadProfileClient();
    const accounts = stored.user.cash_accounts ?? [];
    let nextAccounts = accounts.map((a) =>
      a.name === primaryAccount!.name
        ? {
            ...a,
            balance: Decimal.max(
              0,
              new Decimal(a.balance || 0).add(netDelta),
            ).toFixed(2),
          }
        : a,
    );
    let newEfund = new Decimal(stored.user.efund_balance || 0);

    if (excess.gt(0)) {
      if (paymentSource === 'savings_drawdown') {
        // Draw from the highest-APY non-checking account first (the one the
        // advisor would have flagged anyway). Floor at zero per-account, but
        // don't cascade — if the chosen account can't cover the excess we
        // accept the partial drawdown rather than touch unrelated accounts.
        const drawableIdx = nextAccounts
          .map((a, i) => ({ a, i }))
          .filter((x) => x.a.kind !== 'checking' && Number(x.a.balance || 0) > 0)
          .sort((x, y) => Number(y.a.apy || 0) - Number(x.a.apy || 0))[0]?.i;
        if (drawableIdx != null) {
          const cur = new Decimal(nextAccounts[drawableIdx].balance || 0);
          nextAccounts = nextAccounts.map((a, i) =>
            i === drawableIdx
              ? { ...a, balance: Decimal.max(0, cur.sub(excess)).toFixed(2) }
              : a,
          );
        }
      } else if (paymentSource === 'ef_drawdown') {
        newEfund = Decimal.max(0, newEfund.sub(excess));
      }
      // 'one_off' leaves balances alone — windfall paid debt, no tracked
      // bucket should shrink.
    }

    // `savings_balance` is intentionally NOT rewritten here. It's a legacy
    // aggregate that users may have entered independently of cash_accounts
    // (pre-Phase 1 profiles, or accounts they don't break out per-row);
    // silently sweeping it to the cash-accounts sum would clobber that
    // standalone value.
    saveProfileClient({
      user: {
        ...stored.user,
        cash_accounts: nextAccounts,
        efund_balance: newEfund.toFixed(2),
      },
      marginalRate: stored.marginalRate,
      creditScore: stored.creditScore,
    });
    setExpandedMonth(null);
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
      <ConfirmForm
        monthKey={focusMonth}
        currencyLabel={currency}
        defaultIncome={defaultIncome}
        defaultExpenses={defaultExpenses}
        defaultEmis={defaultEmis}
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
          {chevron} $ MONTHLY RECAP · {headline}
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
            [Use defaults]
          </button>
        )}
      </div>
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
  onConfirm,
}: {
  monthKey: string;
  currencyLabel: 'INR' | 'USD';
  defaultIncome: string;
  defaultExpenses: string;
  defaultEmis: string;
  onConfirm: (
    monthKey: string,
    income: string,
    expenses: string,
    emis: string,
    interest: string,
    note: string | undefined,
    overridden: boolean,
    paymentSource: PaymentSource,
  ) => void;
}) {
  const [income, setIncome] = useState(defaultIncome);
  const [expenses, setExpenses] = useState(defaultExpenses);
  const [emis, setEmis] = useState(defaultEmis);
  const [interest, setInterest] = useState('0');
  const [note, setNote] = useState('');
  const [paymentSource, setPaymentSource] = useState<PaymentSource>('surplus');

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
    new Decimal(interest || 0).gt(0) ||
    note.trim() !== '' ||
    paymentSource !== 'surplus';

  const excessAmount = Decimal.max(
    0,
    new Decimal(emis || 0).sub(new Decimal(defaultEmis || 0)),
  );
  const hasExcess = excessAmount.gt(0);

  const net = new Decimal(income || 0)
    .sub(new Decimal(expenses || 0))
    .sub(new Decimal(emis || 0))
    .add(new Decimal(interest || 0));

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
          label="EMIs paid"
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

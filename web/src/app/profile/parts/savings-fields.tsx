'use client';

// Split out of app/profile/ProfileClient.tsx by scripts/split-profile-client.cjs
// (Audit 80 E15). Moved verbatim; edit here, not in ProfileClient.

import { useEffect, useState } from 'react';
import { DEFAULT_EF_SPLIT, efMonthsToFill, readEfSplitClient } from '@/lib/ef-split';
import { BankCombobox } from '@/components/ToolPrimitives';
import type { CashAccountPayload, Country, LoanPayload } from '@/lib/api';
import { loanToUser } from '@/lib/currency';
import { formatCurrency } from '@/lib/api';

export function EfLiquidityWarning({
  efundBalance,
  cashAccounts,
  currency,
}: {
  efundBalance: string;
  cashAccounts: CashAccountPayload[];
  currency: 'INR' | 'USD';
}) {
  const ef = Number(efundBalance || 0);
  if (ef <= 0) return null;
  // Truly same-day-withdrawable: savings + HYSA. FD is locked-in (premature
  // break costs penalty); checking is operational float not EF; "other" is
  // user-tagged and ambiguous — don't auto-count.
  const liquid = cashAccounts
    .filter((a) => a.kind === 'savings' || a.kind === 'hysa')
    .reduce((s, a) => s + Number(a.balance || 0), 0);
  if (cashAccounts.length === 0 || liquid >= ef) return null;
  const gap = ef - liquid;
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--soft-bg, rgba(220, 130, 0, 0.06))',
        border: '1px solid var(--warning)',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ color: 'var(--warning)' }}>
        Heads up — EF exceeds your liquid balance.
      </strong>{' '}
      You've earmarked {formatCurrency(String(ef), currency)} as EF, but only{' '}
      {formatCurrency(String(liquid), currency)} sits in savings/HYSA accounts
      where you can withdraw same-day. The other{' '}
      <strong>{formatCurrency(String(gap), currency)}</strong> is in FDs or
      other illiquid spots and shouldn't count toward EF. Either lower the EF
      number or add the missing liquid balance as a savings account above.
    </div>
  );
}

export function EfTierPicker({
  monthlyExpenses,
  variableExpenses,
  efundBalance,
  currency,
  currentTarget,
  onPick,
  monthlyIncome,
  loans,
  country,
  fxRates,
  ownMonths = 6,
}: {
  /** The user's own months of cover (Profile → Assumptions, roadmap PR D). */
  ownMonths?: number;
  monthlyExpenses: string;
  variableExpenses: string;
  efundBalance: string;
  currency: 'INR' | 'USD';
  currentTarget: string;
  onPick: (next: string) => void;
  monthlyIncome: string;
  loans: LoanPayload[];
  country: Country;
  fxRates: Record<string, string>;
}) {
  // Read after mount: the cookie isn't there on the server.
  const [efSplit, setEfSplit] = useState(DEFAULT_EF_SPLIT);
  useEffect(() => setEfSplit(readEfSplitClient()), []);
  const totalMonthlyExpenses =
    Number(monthlyExpenses || 0) + Number(variableExpenses || 0);
  if (totalMonthlyExpenses <= 0) {
    return (
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Enter your monthly spending (Income and spending) to see tier recommendations.
      </div>
    );
  }

  const income = Number(monthlyIncome || 0);
  // Each EMI in the user's currency (an NRI's ₹20,000 is about $240).
  const emiSum = loans.reduce(
    (s, l) => s + (loanToUser(Number(l.scheduled_emi || 0), l, country, fxRates) ?? 0),
    0,
  );
  const surplus = Math.max(0, income - totalMonthlyExpenses - emiSum);
  const balance = Number(efundBalance || 0);

  const tiers = [
    { id: 'lean' as const, label: 'Lean', months: 3, descr: '3 months of expenses' },
    { id: 'std' as const, label: 'Standard', months: 6, descr: '6 months of expenses' },
    { id: 'cons' as const, label: 'Conservative', months: 9, descr: '9 months — high risk or dependents' },
    ...(ownMonths !== 3 && ownMonths !== 6 && ownMonths !== 9
      ? [{ id: 'own' as const, label: 'Yours', months: ownMonths, descr: `${ownMonths} months, as set in Assumptions` }]
      : []),
  ];

  const currentNum = Number(currentTarget || 0);
  const isPicked = (months: number) =>
    Math.abs(currentNum - totalMonthlyExpenses * months) < 1;

  // Months to fill at the user's own EF share of surplus (Plan's slider,
  // lib/ef-split). This used to be a fixed 30% whatever the slider said.
  const monthsToFill = (months: number) =>
    efMonthsToFill(totalMonthlyExpenses * months, balance, surplus, efSplit);

  return (
    <div
      style={{
        marginTop: 4,
        padding: 12,
        background: 'var(--canvas)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
      }}
    >
      <div
        className="muted"
        style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}
      >
        Tier shortcuts — sets <strong style={{ color: 'var(--ink)' }}>EF target</strong>{' '}
        to N × your stated monthly expenses
        {' ('}
        {formatCurrency(String(totalMonthlyExpenses), currency)}/mo
        {'). '}
        At {Math.round(Number(efSplit) * 100)}% of your surplus per month (your
        Plan setting), the time-to-fill estimate is shown beside each option.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tiers.map((t) => {
          const target = totalMonthlyExpenses * t.months;
          const fill = monthsToFill(t.months);
          const picked = isPicked(t.months);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(String(target))}
              style={{
                flex: '1 1 0',
                minWidth: 140,
                padding: '8px 10px',
                background: picked ? 'var(--accent)' : 'transparent',
                color: picked ? 'var(--canvas)' : 'var(--ink)',
                border: `1px solid ${picked ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {t.label} · {t.months} months
              </div>
              <div style={{ opacity: 0.8 }}>{t.descr}</div>
              <div style={{ marginTop: 4, fontSize: 11 }}>
                Target: {formatCurrency(String(target), currency)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>
                {fill === 0
                  ? 'Already met — no waterfall delay'
                  : fill === Infinity
                    ? 'No surplus to top up yet'
                    : `~${fill} month${fill === 1 ? '' : 's'} to fill`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OtherBanksField({
  country,
  primaryBank,
  value,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  country: Country;
  primaryBank: string;
  value: string[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            marginBottom: 4,
          }}
        >
          Other banks &amp; cards you already use
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Add any bank where you hold a savings, current, NRE/NRO account,
          credit card, or debit card — anything beyond your primary bank,
          loan or no loan. Tools &rsaquo; New-debt and refinance suggestions
          prefer lenders you already have a relationship with: no fresh KYC,
          and often no opening fee or minimum balance.
        </div>
      </div>
      {value.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {value.map((b) => (
            <span
              key={b}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'var(--soft-bg)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              {b}
              <button
                type="button"
                onClick={() => onRemove(b)}
                aria-label={`Remove ${b}`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <BankCombobox
            label=""
            value={draft}
            onChange={onDraftChange}
            country={country}
          />
        </div>
        <button
          type="button"
          onClick={() => onAdd(draft)}
          disabled={
            !draft.trim() || draft.trim() === primaryBank || value.includes(draft.trim())
          }
          style={{
            padding: '8px 14px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
            fontSize: 13,
            opacity:
              !draft.trim() || draft.trim() === primaryBank || value.includes(draft.trim())
                ? 0.4
                : 1,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import type { UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { getCountryToday, MONTH_NAMES } from '@/lib/today';
import {
  ThemedContainer,
  ThemedDetail,
  ThemedLabel,
} from '@/components/themed/Themed';
import type { ThemeName } from '@/lib/theme';
import {
  readMonthlySpendClient,
  spentForMonth,
} from '@/lib/monthly-spend';

/**
 * Budget-for-the-month card. Sits above the plan body so a returning
 * user sees their planned spend envelope before the projections. Reads
 * `fixed_expenses + variable_expenses` from the saved profile — the
 * same number the engine uses to compute surplus, so the figure
 * matches the rest of the page.
 *
 * The "Update actuals" link deep-links to /insights#activity-ledger
 * where users log real payment events (the activity-ledger surface
 * is the closest thing we have to an actuals tracker).
 */
export function BudgetMonthCard({
  user,
  variant,
}: {
  user: UserPayload;
  variant: ThemeName;
}) {
  const fixed = new Decimal(user.fixed_expenses || 0);
  const variable = new Decimal(user.variable_expenses || 0);
  const budget = fixed.add(variable);
  if (budget.lte(0)) return null;

  const today = getCountryToday(user.country);
  const monthName = MONTH_NAMES[today.getMonth()];
  const year = today.getFullYear();
  const currentMonthIso = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const ccy = userDefaultCurrency(user.country);
  const upper = variant === 'ledger';
  const monthLabel = `${monthName} ${year}`;

  // Logged spend for the current month — null until either the user
  // logs an entry on /insights or the localStorage hydrate completes.
  // Showing null gracefully keeps the SSR HTML identical to first paint.
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    setSpent(spentForMonth(readMonthlySpendClient(), currentMonthIso));
    function onStorage(e: StorageEvent) {
      if (e.key === 'finoptima_monthly_spend') {
        setSpent(spentForMonth(readMonthlySpendClient(), currentMonthIso));
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [currentMonthIso]);

  const variance = spent !== null ? spent - Number(budget.toString()) : null;
  const overBudget = variance !== null && variance > 0;

  return (
    <ThemedContainer variant={variant} style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <ThemedLabel variant={variant}>
            {upper
              ? `BUDGET · ${monthLabel.toUpperCase()}`
              : `Budget · ${monthLabel}`}
          </ThemedLabel>
          <div
            style={{
              fontSize: variant === 'editorial' ? 32 : 24,
              fontWeight: variant === 'editorial' ? 400 : 600,
              fontFamily:
                variant === 'editorial'
                  ? 'var(--font-display)'
                  : variant === 'ledger'
                    ? 'var(--font-mono)'
                    : 'var(--font-sans)',
              marginTop: 4,
            }}
          >
            {formatCurrency(budget.toString(), ccy)}
          </div>
          <ThemedDetail variant={variant}>
            {upper
              ? `FIXED ${formatCurrency(fixed.toString(), ccy)} · VARIABLE ${formatCurrency(variable.toString(), ccy)}`
              : `Fixed ${formatCurrency(fixed.toString(), ccy)} · variable ${formatCurrency(variable.toString(), ccy)}`}
          </ThemedDetail>
          {spent !== null && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: 'var(--muted)',
                fontFamily:
                  variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
              }}
            >
              {upper ? 'LOGGED' : 'Logged'}{' '}
              <strong style={{ color: 'var(--ink)' }}>
                {formatCurrency(spent.toString(), ccy)}
              </strong>
              {variance !== null && Math.abs(variance) >= 1 && (
                <>
                  {' '}·{' '}
                  <span
                    style={{
                      color: overBudget ? 'var(--negative)' : 'var(--positive)',
                      fontWeight: 600,
                    }}
                  >
                    {overBudget ? '+' : '−'}
                    {formatCurrency(Math.abs(variance).toString(), ccy)}{' '}
                    {overBudget ? 'over' : 'under'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <a
          href="/insights#activity-ledger"
          style={{
            color: 'var(--accent)',
            textDecoration: 'none',
            fontSize: 12,
            fontFamily:
              variant === 'ledger' ? 'var(--font-mono)' : 'var(--font-sans)',
            whiteSpace: 'nowrap',
            borderBottom:
              variant === 'editorial' ? '1px solid var(--accent)' : 'none',
            paddingBottom: variant === 'editorial' ? 1 : 0,
          }}
        >
          {upper ? '[UPDATE ACTUALS →]' : 'Update actuals →'}
        </a>
      </div>
    </ThemedContainer>
  );
}

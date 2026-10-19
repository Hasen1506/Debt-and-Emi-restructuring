/**
 * Banner shown on /plan when activity-ledger deltas have been applied
 * to the projection. Surfaces what the engine actually used so the
 * user can verify the trajectory reflects their reported history.
 *
 * The ledger variant is the same closeable note as the other confirmations.
 * Inline and aside keep PanelShell.
 */
'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, type Country, type LoanPayload } from '@/lib/api';
import { LBracket, lNotice } from '@/components/ledger/primitives';
import { loanCurrency } from '@/lib/currency';
import { LOAN_TYPE_SHORT } from '@/lib/loan-types';
import { PanelShell } from '@/components/themed/PanelShell';
import type { ActivityImpact } from './PlanData';

export function ActivityImpactBanner({
  impact,
  loans,
  country,
  variant,
}: {
  impact: ActivityImpact;
  loans: LoanPayload[];
  country: Country;
  variant: 'ledger' | 'inline' | 'aside';
}) {
  const noticeKey = `rd_activity_notice:${impact.entryCount}:${impact.totalBump}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { setDismissed(window.sessionStorage.getItem(noticeKey) === '1'); } catch { setDismissed(false); }
  }, [noticeKey]);
  const headline =
    impact.entryCount === 1
      ? '1 logged payment is reflected in your plan'
      : `${impact.entryCount} logged payments are reflected in your plan`;

  const lines = impact.perLoanBumps
    .map((b) => {
      const loan = loans[b.loanIndex];
      if (!loan) return null;
      const bank = loan.bank || 'Unnamed lender';
      const tag = LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type;
      const events = b.entryCount === 1 ? 'event' : 'events';
      const ccy = loanCurrency(loan, country);
      return {
        key: b.loanIndex,
        label: `${bank} · ${tag}`,
        detail: `${Number(b.totalBump) > 0 ? '+' : ''}${formatCurrency(b.totalBump, ccy)} · ${b.entryCount} ${events}`,
      };
    })
    .filter((l): l is { key: number; label: string; detail: string } => l !== null);

  // Aggregate the headline bump per-currency so hybrid users don't see
  // a meaningless ₹+$ sum.
  const bumpsByCcy = impact.perLoanBumps.reduce<Record<string, number>>(
    (acc, b) => {
      const loan = loans[b.loanIndex];
      if (!loan) return acc;
      const ccy = loanCurrency(loan, country);
      acc[ccy] = (acc[ccy] ?? 0) + Number(b.totalBump);
      return acc;
    },
    {},
  );
  const ccyOrder = Object.keys(bumpsByCcy).sort((a, b) => {
    const def = country === 'US' ? 'USD' : 'INR';
    if (a === def) return -1;
    if (b === def) return 1;
    return a.localeCompare(b);
  });
  const totalBumpDisplay = ccyOrder
    .map((c) => formatCurrency(bumpsByCcy[c], c))
    .join(' + ');

  if (variant === 'ledger') {
    if (dismissed) return null;
    return (
      <section role="status" aria-label="Logged payments in this plan" data-testid="activity-impact" style={{ ...lNotice('accent'), flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <strong>
            {headline}. Balances moved {totalBumpDisplay}.
          </strong>
          <LBracket
            onClick={() => {
              try { window.sessionStorage.setItem(noticeKey, '1'); } catch { /* private mode */ }
              setDismissed(true);
            }}
            label="Dismiss the logged-payments note"
          >
            DISMISS
          </LBracket>
        </div>
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--muted)' }}>
            The plan starts from your balances after what you&apos;ve logged: a
            missed or short payment adds what&apos;s overdue (and its fee), an
            extra payment takes it off. Change an entry in{' '}
            <a href="/activity" style={{ color: 'var(--ink)' }}>
              Activity
            </a>{' '}
            and the plan follows.
          </span>
        </div>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            marginTop: 4,
          }}
        >
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td style={{ padding: '4px 0', color: 'var(--ink)', width: '60%' }}>
                  → {l.label}
                </td>
                <td
                  style={{
                    padding: '4px 0',
                    textAlign: 'right',
                    color: 'var(--negative)',
                    fontWeight: 700,
                  }}
                >
                  {l.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <PanelShell variant="inline" tone="negative" eyebrow={headline}>
        <div className="muted" style={{ marginBottom: 8 }}>
          Your loan balances were bumped by <strong>{Number(impact.totalBump) > 0 ? '+' : ''}{totalBumpDisplay}</strong>{' '}
          (unpaid amounts and penalties up, extra payments down) before this projection was computed.
          Edit your <a href="/activity">activity ledger</a> to refresh.
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
          }}
        >
          {lines.map((l) => (
            <li
              key={l.key}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <span>{l.label}</span>
              <span className="num" style={{ color: 'var(--negative)', fontWeight: 600 }}>
                {l.detail}
              </span>
            </li>
          ))}
        </ul>
      </PanelShell>
    );
  }

  // aside (editorial) — bookended block, italic prose body
  return (
    <PanelShell variant="aside" eyebrow="From your activity ledger" bookend>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.65,
          margin: 0,
          fontStyle: 'italic',
          color: 'var(--ink)',
        }}
      >
        Before drawing the trajectory above, we honoured your record:{' '}
        <strong>{headline.toLowerCase()}</strong>. Your loan balances were
        lifted by <strong>{totalBumpDisplay}</strong> — unpaid principal
        and accrued penalty — so what you see below reflects the path forward
        from a real present, not the optimistic one.{' '}
        <a href="/activity" style={{ color: 'var(--accent)' }}>
          Edit the ledger →
        </a>
      </p>
    </PanelShell>
  );
}

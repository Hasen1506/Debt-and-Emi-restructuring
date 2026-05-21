'use client';

/**
 * Compact recent-activity summary for /plan. Sits between the schedule
 * (what you should pay) and the WhatIf sandbox (what if you did X).
 * Shows the last 5 logged events with a one-tap delete to revert, and
 * a link to /insights for the full activity ledger.
 *
 * Reading from localStorage means it stays in sync with the full
 * ledger on /insights — same source of truth, two surfaces.
 */

import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import type { UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  readActivityClient,
  writeActivityClient,
  type ActivityEntry,
} from '@/lib/activity';
import { InfoTip } from '@/components/ToolPrimitives';
import { loanCurrency } from '@/lib/currency';
import { syncActivityCookieClient } from '@/lib/activity-cookie';

const KIND_LABEL: Record<ActivityEntry['kind'], string> = {
  paid_full: 'Paid in full',
  paid_partial: 'Paid partial',
  missed: 'Missed',
  paid_extra: 'Paid extra',
  closed: 'Closed',
};

const KIND_COLOR: Record<ActivityEntry['kind'], string> = {
  paid_full: 'var(--positive)',
  paid_partial: 'var(--accent)',
  missed: 'var(--negative)',
  paid_extra: 'var(--positive)',
  closed: 'var(--positive)',
};

export function RecentActivitySummary({ user }: { user: UserPayload }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEntries(readActivityClient());
    setReady(true);
  }, []);

  if (!ready) return null;

  // Newest first; cap to 5.
  const recent = entries.slice(0, 5);

  function handleRevert(id: string) {
    const next = entries.filter((e) => e.id !== id);
    writeActivityClient(next);
    setEntries(next);
    // Recompute the activity-deltas cookie so /plan picks up the
    // change on the next nav. Best-effort — failures don't block UI.
    try {
      syncActivityCookieClient(next, user.loans, user.country);
    } catch {
      /* noop */
    }
  }

  return (
    <div
      style={{
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Recent activity
          <InfoTip>
            <strong>What this is.</strong> Every payment you've logged —
            paid, partial, missed, or extra — newest first. The schedule
            above shows what you <em>should</em> pay; this section shows
            what you <em>actually</em> did.
            <div style={{ marginTop: 8 }}>
              <strong>Revert.</strong> Click the × on any entry to remove
              it. The /plan trajectory recomputes immediately — partial /
              missed entries push your debt-free month out, so reverting
              an incorrect entry pulls it back in.
            </div>
            <div style={{ marginTop: 8 }}>
              For the full log + add new entry, see{' '}
              <a href="/insights" style={{ color: 'var(--accent)' }}>
                Insights
              </a>
              .
            </div>
          </InfoTip>
        </div>
        <a
          href="/insights"
          style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
        >
          Log a payment →
        </a>
      </div>

      {recent.length === 0 ? (
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Nothing logged yet. Once you start recording payments, your{' '}
          <strong>real</strong> trajectory (not the optimistic one from
          onboarding) shows up here and on the chart above.{' '}
          <a href="/insights" style={{ color: 'var(--accent)' }}>
            Start a log
          </a>
          .
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12,
          }}
        >
          {recent.map((e) => {
            const loan = user.loans[e.loanIndex];
            const bank = loan?.bank || `Loan #${e.loanIndex + 1}`;
            const cur = loan ? loanCurrency(loan, user.country) : 'INR';
            const amount = new Decimal(e.amount || 0);
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {e.date}
                  </span>
                  <span
                    style={{
                      color: KIND_COLOR[e.kind],
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  >
                    {KIND_LABEL[e.kind]}
                  </span>
                  <span>
                    {bank}
                    {amount.gt(0) && (
                      <>
                        {' '}
                        ·{' '}
                        <strong>
                          {formatCurrency(amount.toFixed(2), cur)}
                        </strong>
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevert(e.id)}
                  aria-label="Revert this entry"
                  title="Revert"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--muted-ink)',
                    width: 22,
                    height: 22,
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {entries.length > recent.length && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {entries.length - recent.length} more in{' '}
          <a href="/insights" style={{ color: 'var(--accent)' }}>
            Insights
          </a>
          .
        </div>
      )}
    </div>
  );
}

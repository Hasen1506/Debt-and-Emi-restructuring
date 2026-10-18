'use client';

/**
 * Audit 80+ A1 and A5 cards: "where we disagree with a plain calculator,
 * worth ₹X" and "₹X a month short: 3 ways to close it". Presentational: the
 * figures and sentences come from the engine (lib/insights).
 */
import type { ReactNode } from 'react';
import { L_T, LSectionHeader, lStrip } from '@/components/ledger/primitives';
import type { Disagreements, GapHeadlineData } from '@/lib/insights';

type Money = (v: number | string) => string;

export function DisagreementCard({ data, money, compact = false }: { data: Disagreements; money: Money; compact?: boolean }) {
  const total = Number(data.total_over_plan);
  return (
    <section aria-labelledby="disagree-h" data-testid="disagree-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <LSectionHeader>
        <span id="disagree-h">Where we disagree with a plain calculator</span>
      </LSectionHeader>
      {data.items.length === 0 ? (
        <p data-testid="disagree-zero" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
          {data.zero_line}
        </p>
      ) : (
        <div style={{ padding: '12px 14px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip('positive') }}>
          {total > 0 && (
            <p style={{ margin: '0 0 8px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: L_T.muted }}>WORTH</span>
              <strong data-testid="disagree-total" style={{ fontSize: 17, color: L_T.ink, fontVariantNumeric: 'tabular-nums' }}>
                {money(total)}
              </strong>
              <span style={{ fontSize: 11, color: L_T.muted }}>to you, on your own numbers</span>
            </p>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.items.map((d, i) => (
              <li key={`${d.kind}-${i}`} style={{ fontSize: 12, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                {d.headline}
                {!compact && <span style={{ display: 'block', fontSize: 11, color: L_T.muted }}>{d.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function GapHeadline({
  data,
  money,
  closedLabel,
  extra,
}: {
  data: GapHeadlineData;
  money: Money;
  /** The date if the gap closes, demoted under the ways (A5). */
  closedLabel?: string | null;
  extra?: ReactNode;
}) {
  const gap = Number(data.gap);
  return (
    <section
      role="alert"
      aria-labelledby="gap-h"
      data-testid="gap-headline"
      style={{ border: `2px solid ${L_T.negative}`, padding: '12px 14px', background: L_T.paper, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h2 id="gap-h" style={{ margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', fontSize: 12 }}>
        <strong data-testid="gap-amount" style={{ fontSize: 17, color: L_T.negative, fontVariantNumeric: 'tabular-nums' }}>
          {money(gap)}
        </strong>
        <span>a month short: {data.ways.length === 1 ? 'one way' : `${data.ways.length} ways`} to close it</span>
      </h2>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.ways.map((w) => (
          <li key={w.kind} data-testid={`gap-way-${w.kind}`} style={{ fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            <strong>{w.headline}</strong>
            <span style={{ display: 'block', fontSize: 11, color: L_T.muted }}>
              {w.closes_all ? 'Closes all of it. ' : `Closes ${money(w.closes)} of the ${money(gap)}. `}
              {w.detail}
              {w.extra_cost && Number(w.extra_cost) > 0 ? ` The extra months cost about ${money(w.extra_cost)} in interest.` : ''}
            </span>
          </li>
        ))}
      </ol>
      <p data-testid="gap-conditional-date" style={{ margin: 0, fontSize: 11, color: L_T.muted, lineHeight: 1.5 }}>
        {closedLabel
          ? `If you close the gap, you'd be debt-free by ${closedLabel}. Until then the plan borrows the gap at card rates.`
          : 'Until the gap closes there is no debt-free date: the plan borrows the gap at card rates.'}
      </p>
      {extra}
    </section>
  );
}

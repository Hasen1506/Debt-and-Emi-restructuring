'use client';

/**
 * Editable slider on /plan: when there's an EF gap (balance < target),
 * what fraction of monthly surplus goes to EF top-up vs debt prepayment?
 *
 * Hidden entirely when efund_target is unset or already met — there's no
 * waterfall to configure in that case.
 *
 * Default 0.3 (30% EF / 70% debt) matches the pre-slider hardcoded value.
 * 0.0 disables the waterfall entirely (100% surplus → debt); 1.0 routes
 * all surplus to EF until target is hit, then flips to debt.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { writeEfSplitClient } from '@/lib/ef-split';
import { readDecisionsClient, recordDecision } from '@/lib/decisions';
import { InfoTip } from '@/components/ToolPrimitives';

export function EfSplitSlider({
  active,
  hasGap,
  ccySym,
  variant = 'inline',
}: {
  active: string;
  hasGap: boolean;
  ccySym: string;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(active);

  if (!hasGap) return null;

  const pct = Math.round(Number(local) * 100);
  const debtPct = 100 - pct;

  function commit(next: string) {
    const prev = local;
    setLocal(next);
    writeEfSplitClient(next);
    recordDecision(readDecisionsClient(), {
      kind: 'ef_split_change',
      label: `Set EF split to ${Math.round(Number(next) * 100)}%`,
      snapshot: { efSplit: prev },
      result: { efSplit: next },
      impactDeltaMonths: null,
    });
    startTransition(() => router.refresh());
  }

  const explainer = (
    <InfoTip>
      <strong>How the split works.</strong> Each month with an EF gap, the
      engine divides your surplus:
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)' }}>
        ef_topup[m] = surplus[m] × <em>split</em>
        <br />
        debt_extra[m] = surplus[m] × (1 − <em>split</em>)
      </div>
      <div style={{ marginTop: 8 }}>
        EF balance grows by <code>ef_topup[m]</code> until it hits the
        target ({ccySym}efund_target); from then on the split is ignored
        and 100% of surplus goes to debt regardless of this slider.
      </div>
      <div style={{ marginTop: 8 }}>
        Engine path: <code>engine/simulation.py:177-183</code> +{' '}
        <code>ef_top_up_rate</code> parameter.
      </div>
    </InfoTip>
  );

  if (variant === 'ledger') {
    return (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--muted)',
        }}
      >
        <span>EF / DEBT SPLIT {explainer}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          onChange={(e) =>
            commit((Number(e.target.value) / 100).toFixed(2))
          }
          disabled={pending}
          style={{ width: 140 }}
        />
        <span style={{ color: 'var(--ink)' }}>
          {pct}% EF · {debtPct}% DEBT
        </span>
        {pending && <span>recomputing…</span>}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          EF / debt split {explainer}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          onChange={(e) =>
            commit((Number(e.target.value) / 100).toFixed(2))
          }
          disabled={pending}
          style={{ width: 200 }}
        />
        <span style={{ fontWeight: 600 }}>
          {pct}% EF · {debtPct}% debt
        </span>
      </div>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}>
        {pending
          ? 'Recomputing schedule…'
          : `Each month's surplus gets ${pct}% routed to your emergency fund (until the target is hit) and ${debtPct}% to debt prepayment. Slide to 0% if you'd rather skip EF top-up and crush debt; 100% to fill EF first.`}
      </span>
    </div>
  );
}

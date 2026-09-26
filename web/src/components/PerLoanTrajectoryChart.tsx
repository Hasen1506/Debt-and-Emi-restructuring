'use client';

/**
 * Per-loan trajectory chart — one line per loan, colour-coded.
 *
 * Reads `balancesByLoanIndex` from each TrajectoryPoint. Lines fall to
 * zero as loans clear; the avalanche order becomes visually obvious
 * (high-effective-APR loans collapse first).
 *
 * Hidden gracefully when only one loan exists — the existing total
 * chart already shows that single curve.
 */

import { ParentSize } from '@visx/responsive';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { curveMonotoneX } from '@visx/curve';
import { tokens } from '@/styles/tokens';
import type { TrajectoryPoint } from '@/lib/mock-data';

interface LoanLegendEntry {
  /** 0-based index into the original user.loans list (matches trajectory keys). */
  index: number;
  label: string;
  effectiveRatePct?: number;
}

export function PerLoanTrajectoryChart({
  data,
  loans,
  currency,
}: {
  data: TrajectoryPoint[];
  loans: LoanLegendEntry[];
  currency?: 'INR' | 'USD';
}) {
  if (loans.length < 2) return null;
  return (
    <ParentSize>
      {({ width, height }) => (
        <Chart
          width={width}
          height={height}
          data={data}
          loans={loans}
          currency={currency}
        />
      )}
    </ParentSize>
  );
}

function Chart({
  width,
  height,
  data,
  loans,
  currency,
}: {
  width: number;
  height: number;
  data: TrajectoryPoint[];
  loans: LoanLegendEntry[];
  currency?: 'INR' | 'USD';
}) {
  const margin = { top: 12, right: 16, bottom: 32, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (innerW <= 0 || innerH <= 0) return null;

  // For each loan, build a balance series across months.
  const series = loans.map((l) => ({
    ...l,
    values: data.map((d) => d.balancesByLoanIndex?.[String(l.index)] ?? 0),
  }));

  const xScale = scaleLinear<number>({
    domain: [0, data.length - 1],
    range: [0, innerW],
  });
  const allValues = series.flatMap((s) => s.values);
  const maxY = Math.max(1, ...allValues);
  const yScale = scaleLinear<number>({
    domain: [0, maxY * 1.05],
    range: [innerH, 0],
    nice: true,
  });

  const formatY = (v: number | { valueOf(): number }) => {
    const n = typeof v === 'number' ? v : v.valueOf();
    if (currency === 'USD') {
      if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
      return `$${n.toFixed(0)}`;
    }
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
    if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
    return `₹${n.toFixed(0)}`;
  };

  return (
    <svg width={width} height={height}>
      <Group left={margin.left} top={margin.top}>
        <GridRows
          scale={yScale}
          width={innerW}
          stroke={tokens.color.muted}
          strokeOpacity={0.2}
          numTicks={5}
        />
        {series.map((s, i) => (
          <LinePath
            key={s.index}
            data={s.values}
            x={(_, idx) => xScale(idx)}
            y={(v) => yScale(v)}
            stroke={LOAN_PALETTE[i % LOAN_PALETTE.length]}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
        ))}
        <AxisBottom
          top={innerH}
          scale={xScale}
          numTicks={6}
          tickFormat={(v) => `m${(typeof v === 'number' ? v : v.valueOf()) + 1}`}
          stroke={tokens.color.muted}
          tickStroke={tokens.color.muted}
          tickLabelProps={() => ({
            fill: tokens.color.muted,
            fontSize: 11,
            textAnchor: 'middle',
          })}
        />
        <AxisLeft
          scale={yScale}
          numTicks={5}
          tickFormat={formatY}
          stroke={tokens.color.muted}
          tickStroke={tokens.color.muted}
          tickLabelProps={() => ({
            fill: tokens.color.muted,
            fontSize: 11,
            textAnchor: 'end',
            dx: -4,
            dy: 4,
          })}
        />
      </Group>
    </svg>
  );
}

/** Stable colour palette — distinct enough at-a-glance even with 5-6 loans. */
const LOAN_PALETTE = [
  '#d62728', // red — typically the highest-rate (card)
  '#ff7f0e', // orange
  '#1f77b4', // blue
  '#2ca02c', // green
  '#9467bd', // purple
  '#8c564b', // brown
  '#e377c2', // pink
];

// ─── Legend component ─────────────────────────────────────────────────────

export function PerLoanLegend({ loans }: { loans: LoanLegendEntry[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 8,
        fontSize: 12,
      }}
    >
      {loans.map((l, i) => (
        <div
          key={l.index}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 3,
              background: LOAN_PALETTE[i % LOAN_PALETTE.length],
              borderRadius: 1,
            }}
          />
          <span>
            {l.label}
            {l.effectiveRatePct != null && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}
                · {l.effectiveRatePct.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

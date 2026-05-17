'use client';

import { ParentSize } from '@visx/responsive';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath, AreaClosed } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { curveMonotoneX } from '@visx/curve';
import { tokens } from '@/styles/tokens';
import type { TrajectoryPoint } from '@/lib/mock-data';

/**
 * Plot the avalanche vs. minimums trajectory.
 *
 * For single-currency users the default behaviour is unchanged — the
 * scalar `avalanche` / `minimums` fields on each point drive both lines.
 * Pass `currency` to chart that currency's series only — the y-axis
 * formatter switches between ₹ (INR, lakh-suffixed) and $ (USD, K-suffixed)
 * to match the values shown.
 */
export function DebtTrajectoryChart({
  data,
  currency,
}: {
  data: TrajectoryPoint[];
  currency?: 'INR' | 'USD';
}) {
  return (
    <ParentSize>
      {({ width, height }) => (
        <Chart width={width} height={height} data={data} currency={currency} />
      )}
    </ParentSize>
  );
}

function Chart({
  width,
  height,
  data,
  currency,
}: {
  width: number;
  height: number;
  data: TrajectoryPoint[];
  currency?: 'INR' | 'USD';
}) {
  const margin = { top: 12, right: 16, bottom: 32, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (innerW <= 0 || innerH <= 0) return null;

  // When a currency is supplied, draw only that currency's per-ccy series.
  // Falling back to the scalar fields preserves single-currency behaviour
  // for older callers that don't pass `currency`.
  const aSeries = currency
    ? data.map((d) => d.avalancheByCcy?.[currency] ?? 0)
    : data.map((d) => d.avalanche);
  const mSeries = currency
    ? data.map((d) => d.minimumsByCcy?.[currency] ?? 0)
    : data.map((d) => d.minimums);

  const xScale = scaleLinear<number>({
    domain: [0, data.length - 1],
    range: [0, innerW],
  });
  const maxY = Math.max(...aSeries, ...mSeries);
  const yScale = scaleLinear<number>({
    domain: [0, maxY * 1.05],
    range: [innerH, 0],
    nice: true,
  });

  const formatY = (v: number | { valueOf(): number }) => {
    const n = typeof v === 'number' ? v : v.valueOf();
    if (currency === 'USD') {
      if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
      return `$${n.toFixed(0)}`;
    }
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${(n / 1000).toFixed(0)}k`;
  };

  return (
    <svg width={width} height={height}>
      <Group left={margin.left} top={margin.top}>
        <GridRows
          scale={yScale}
          width={innerW}
          stroke={tokens.chart.grid}
          numTicks={5}
        />
        {/* Minimums-only path — muted, dashed-feel via lower opacity */}
        <AreaClosed<number>
          data={mSeries}
          x={(_, i) => xScale(i)}
          y={(v) => yScale(v)}
          yScale={yScale}
          fill={tokens.chart.tertiary}
          fillOpacity={0.08}
          curve={curveMonotoneX}
        />
        <LinePath<number>
          data={mSeries}
          x={(_, i) => xScale(i)}
          y={(v) => yScale(v)}
          stroke={tokens.chart.tertiary}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          curve={curveMonotoneX}
        />
        {/* Avalanche path — accent, solid */}
        <AreaClosed<number>
          data={aSeries}
          x={(_, i) => xScale(i)}
          y={(v) => yScale(v)}
          yScale={yScale}
          fill={tokens.chart.primary}
          fillOpacity={0.12}
          curve={curveMonotoneX}
        />
        <LinePath<number>
          data={aSeries}
          x={(_, i) => xScale(i)}
          y={(v) => yScale(v)}
          stroke={tokens.chart.primary}
          strokeWidth={2.5}
          curve={curveMonotoneX}
        />
        <AxisLeft
          scale={yScale}
          numTicks={5}
          tickFormat={formatY}
          stroke={tokens.chart.axis}
          tickStroke={tokens.chart.axis}
          tickLabelProps={() => ({
            fill: tokens.chart.text,
            fontSize: 11,
            fontFamily: tokens.font.mono,
            textAnchor: 'end',
            dx: '-0.25em',
            dy: '0.33em',
          })}
        />
        <AxisBottom
          top={innerH}
          scale={xScale}
          numTicks={6}
          stroke={tokens.chart.axis}
          tickStroke={tokens.chart.axis}
          tickFormat={(v) => `m${(typeof v === 'number' ? v : v.valueOf()) + 1}`}
          tickLabelProps={() => ({
            fill: tokens.chart.text,
            fontSize: 11,
            fontFamily: tokens.font.mono,
            textAnchor: 'middle',
          })}
        />
      </Group>
    </svg>
  );
}

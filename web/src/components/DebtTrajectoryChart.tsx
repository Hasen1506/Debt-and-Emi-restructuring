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

export function DebtTrajectoryChart({ data }: { data: TrajectoryPoint[] }) {
  return (
    <ParentSize>
      {({ width, height }) => (
        <Chart width={width} height={height} data={data} />
      )}
    </ParentSize>
  );
}

function Chart({
  width,
  height,
  data,
}: {
  width: number;
  height: number;
  data: TrajectoryPoint[];
}) {
  const margin = { top: 12, right: 16, bottom: 32, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (innerW <= 0 || innerH <= 0) return null;

  const xScale = scaleLinear<number>({
    domain: [0, data.length - 1],
    range: [0, innerW],
  });
  const maxY = Math.max(...data.map((d) => Math.max(d.avalanche, d.minimums)));
  const yScale = scaleLinear<number>({
    domain: [0, maxY * 1.05],
    range: [innerH, 0],
    nice: true,
  });

  const formatY = (v: number | { valueOf(): number }) => {
    const n = typeof v === 'number' ? v : v.valueOf();
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
        <AreaClosed<TrajectoryPoint>
          data={data}
          x={(d) => xScale(d.month)}
          y={(d) => yScale(d.minimums)}
          yScale={yScale}
          fill={tokens.chart.tertiary}
          fillOpacity={0.08}
          curve={curveMonotoneX}
        />
        <LinePath<TrajectoryPoint>
          data={data}
          x={(d) => xScale(d.month)}
          y={(d) => yScale(d.minimums)}
          stroke={tokens.chart.tertiary}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          curve={curveMonotoneX}
        />
        {/* Avalanche path — accent, solid */}
        <AreaClosed<TrajectoryPoint>
          data={data}
          x={(d) => xScale(d.month)}
          y={(d) => yScale(d.avalanche)}
          yScale={yScale}
          fill={tokens.chart.primary}
          fillOpacity={0.12}
          curve={curveMonotoneX}
        />
        <LinePath<TrajectoryPoint>
          data={data}
          x={(d) => xScale(d.month)}
          y={(d) => yScale(d.avalanche)}
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
          tickFormat={(v) => `m${v}`}
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

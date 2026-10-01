'use client';

/**
 * LTrajectory: SVG line chart with grid + minimums dashed + avalanche
 * solid + accent square marker on the clear month. (The debts table that
 * shared this file became Home's open positions in R2.)
 */

import { useEffect, useState } from 'react';
import { L_T, L_MONO } from './primitives';

// ─── LTrajectory ────────────────────────────────────────────────────────
export interface LTrajPoint {
  // 0..1 normalised positions
  t: number;
  av: number;
  min: number;
}

/**
 * Plan vs minimums, drawn at the container's real pixel width so the
 * labels stay readable on a phone (a fixed 800-wide viewBox shrank to
 * ~80 px tall with 3 px text at 390 px).
 *
 * `clear` marks the month the plan line reaches zero. It used to sit on
 * the last point of the chart, which is where the *minimums* line ends,
 * so "JUL 2029 · CLEAR" was drawn at 2046.
 */
export function LTrajectory({
  points,
  clear,
  axisLabels,
  yLabels,
  title,
}: {
  points: LTrajPoint[];
  clear?: { t: number; label: string };
  axisLabels?: Array<{ t: number; l: string }>;
  yLabels?: Array<{ y: number; l: string }>;
  /** Spoken summary of the chart for screen readers. */
  title?: string;
}) {
  const [w, ref] = useWidth(800);
  const narrow = w < 480;
  const h = narrow ? 180 : 200;
  const left = narrow ? 58 : 76;
  const right = 12;
  const toX = (t: number) => left + t * (w - left - right);
  const toY = (v: number) => h - 26 - v * (h - 44);
  const path = (key: 'av' | 'min') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p[key]).toFixed(1)}`)
      .join(' ');
  const ys = yLabels ?? [];
  // Keep first, middle and last date on a phone; all five otherwise.
  const xs = (axisLabels ?? []).filter(
    (_, i, all) => !narrow || i === 0 || i === all.length - 1 || i === Math.floor(all.length / 2),
  );
  const clearX = clear ? toX(clear.t) : 0;
  return (
    <div ref={ref} style={{ border: `2px solid ${L_T.ink}`, padding: '8px 0 4px', background: L_T.paper }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={title}
        style={{ display: 'block' }}
      >
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={left}
            x2={w - right}
            y1={toY(g)}
            y2={toY(g)}
            stroke={L_T.faint}
            strokeWidth={0.6}
            strokeDasharray="2 3"
          />
        ))}
        <line x1={left} x2={w - right} y1={toY(0)} y2={toY(0)} stroke={L_T.ink} strokeWidth={1} />
        {ys.map((g, i) => (
          <text
            key={i}
            x={left - 6}
            y={toY(g.y) + 3}
            fontFamily={L_MONO}
            fontSize="10"
            fill={L_T.muted}
            textAnchor="end"
          >
            {g.l}
          </text>
        ))}
        <path d={path('min')} stroke={L_T.muted} strokeWidth="1.2" fill="none" strokeDasharray="4 3" />
        <path d={path('av')} stroke={L_T.ink} strokeWidth="2" fill="none" />
        {clear && (
          <>
            <line
              x1={clearX}
              x2={clearX}
              y1={toY(1)}
              y2={toY(0)}
              stroke={L_T.accent}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <rect x={clearX - 4} y={toY(0) - 4} width="8" height="8" fill={L_T.accent} />
            <text
              x={clear.t > 0.6 ? clearX - 8 : clearX + 8}
              y={toY(0.12)}
              fontFamily={L_MONO}
              fontSize="10"
              fill={L_T.accent}
              fontWeight="700"
              textAnchor={clear.t > 0.6 ? 'end' : 'start'}
            >
              {clear.label}
            </text>
          </>
        )}
        {xs.map((d, i) => (
          <text
            key={i}
            x={toX(d.t)}
            y={h - 8}
            fontFamily={L_MONO}
            fontSize="10"
            fill={L_T.muted}
            textAnchor={d.t === 0 ? 'start' : d.t === 1 ? 'end' : 'middle'}
          >
            {d.l}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** Width of an element in CSS pixels, `fallback` until it has been measured. */
function useWidth(fallback: number): [number, (el: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(fallback);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [width, setEl];
}

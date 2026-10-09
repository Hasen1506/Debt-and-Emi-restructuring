'use client';

/**
 * LTrajectory: the plan's total debt over time (solid line over a shaded
 * area), paying only the minimums (dashed), and a marker where each loan
 * clears. (The debts table that shared this file became Home's open
 * positions in R2.)
 */

import { useWidth } from '@/lib/use-width';
import { L_T, L_MONO } from './primitives';

// ─── LTrajectory ────────────────────────────────────────────────────────
export interface LTrajPoint {
  // 0..1 normalised positions
  t: number;
  av: number;
  min: number;
}

export interface LTrajMilestone {
  /** 0..1 along the x-axis, and the plan's balance there (0..1). */
  t: number;
  v: number;
  label: string;
}

/** A paper-coloured outline, so a label stays legible over a line. */
const HALO = { stroke: L_T.paper, strokeWidth: 3, paintOrder: 'stroke' } as const;

/** Monospace glyph width at the label size, for keeping labels apart. */
const CHAR_W = 5.9;

/**
 * Plan vs minimums, drawn at the container's real pixel width so the
 * labels stay readable on a phone (a fixed 800-wide viewBox shrank to
 * ~80 px tall with 3 px text at 390 px).
 *
 * Milestone labels sit above their marker; one that would overlap the
 * label before it moves up a row, or below the line when the top is full.
 */
export function LTrajectory({
  points,
  milestones = [],
  axisLabels,
  yLabels,
  title,
  minimumsNote,
}: {
  points: LTrajPoint[];
  milestones?: LTrajMilestone[];
  axisLabels?: Array<{ t: number; l: string }>;
  yLabels?: Array<{ y: number; l: string }>;
  /** Spoken summary of the chart for screen readers. */
  title?: string;
  /** Shown at the right end of the dashed line when it runs past the
   *  chart ("MINIMUMS: CLEAR DEC 43 →"). */
  minimumsNote?: string;
}) {
  const [w, ref] = useWidth(800);
  const narrow = w < 480;
  const h = narrow ? 220 : 260;
  const left = narrow ? 58 : 76;
  const right = 14;
  const top = 34;
  const bottom = 26;
  const toX = (t: number) => left + t * (w - left - right);
  const toY = (v: number) => h - bottom - v * (h - top - bottom);
  const path = (key: 'av' | 'min') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p[key]).toFixed(1)}`)
      .join(' ');
  const last = points[points.length - 1];
  const area =
    points.length > 1
      ? `${path('av')} L${toX(last.t).toFixed(1)},${toY(0).toFixed(1)} L${toX(points[0].t).toFixed(1)},${toY(0).toFixed(1)} Z`
      : '';
  const ys = yLabels ?? [];
  // Keep first, middle and last date on a phone; all five otherwise.
  const xs = (axisLabels ?? []).filter(
    (_, i, all) => !narrow || i === 0 || i === all.length - 1 || i === Math.floor(all.length / 2),
  );

  // Place each label: anchored to stay inside the chart, raised a row
  // while it overlaps one already placed. Near the top (loans that clear
  // early, while the balance is still high) there's no room above, so it
  // drops below the line instead of stacking on the labels there.
  // The axis title (OUTSTANDING, top left) counts as placed: a label for a
  // loan that clears early used to sit on top of it.
  const placed: Array<{ x0: number; x1: number; y: number }> = [{ x0: 8, x1: 8 + 'OUTSTANDING'.length * CHAR_W, y: 12 }];
  const labels = milestones.map((m) => {
    const x = toX(m.t);
    const markY = toY(m.v);
    const width = m.label.length * CHAR_W;
    const anchor = x - width / 2 < left ? 'start' : x + width / 2 > w - right ? 'end' : 'middle';
    const x0 = anchor === 'start' ? x - 4 : anchor === 'end' ? x - width + 4 : x - width / 2;
    const x1 = x0 + width;
    const free = (y: number) => !placed.some((p) => Math.abs(p.y - y) < 12 && x0 < p.x1 + 8 && x1 > p.x0 - 8);
    const above = Array.from({ length: 8 }, (_, k) => markY - 12 - k * 13).filter((y) => y >= 12);
    const below = Array.from({ length: 8 }, (_, k) => markY + 18 + k * 13).filter((y) => y <= toY(0) - 6);
    const y = [...above, ...below].find(free) ?? above[0] ?? 12;
    placed.push({ x0, x1, y });
    return { x, y, anchor, raised: y < markY - 12 || y > markY + 18, label: m.label, markY };
  });

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
        <text x={8} y={12} fontFamily={L_MONO} fontSize="9" fill={L_T.muted} letterSpacing="0.12em">
          OUTSTANDING
        </text>
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
        {area && <path d={area} fill={L_T.highlight} opacity="0.55" />}
        <path d={path('min')} stroke={L_T.muted} strokeWidth="1.4" fill="none" strokeDasharray="5 4" />
        <path d={path('av')} stroke={L_T.ink} strokeWidth="2.2" fill="none" />
        <line x1={left} x2={w - right} y1={toY(0)} y2={toY(0)} stroke={L_T.ink} strokeWidth={1.2} />
        {minimumsNote && last && (
          <text
            x={w - right}
            y={Math.max(top - 4, toY(last.min) - 6)}
            fontFamily={L_MONO}
            fontSize="9.5"
            fill={L_T.muted}
            textAnchor="end"
            {...HALO}
          >
            {minimumsNote}
          </text>
        )}
        {/* Lines and markers first, every label after: a later loan's
            dashed line no longer runs through an earlier loan's label. */}
        {labels.map((m, i) => (
          <g key={i}>
            <line
              x1={m.x}
              x2={m.x}
              y1={m.markY}
              y2={toY(0)}
              stroke={L_T.accent}
              strokeWidth={0.8}
              strokeDasharray="2 2"
            />
            {m.raised && (
              <line
                x1={m.x}
                x2={m.x}
                y1={m.y < m.markY ? m.y + 3 : m.y - 10}
                y2={m.y < m.markY ? m.markY - 5 : m.markY + 5}
                stroke={L_T.accent}
                strokeWidth={0.6}
              />
            )}
            <rect x={m.x - 4} y={m.markY - 4} width="8" height="8" fill={L_T.accent} />
          </g>
        ))}
        {labels.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={m.y}
            fontFamily={L_MONO}
            fontSize="9.5"
            fontWeight="700"
            fill={L_T.accent}
            textAnchor={m.anchor}
            {...HALO}
          >
            {m.label}
          </text>
        ))}
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

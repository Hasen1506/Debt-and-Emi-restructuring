'use client';

/**
 * LTrajectory: the plan's total debt over time (solid line over a shaded
 * area), paying only the minimums (dashed), and a marker where each loan
 * clears. (The debts table that shared this file became Home's open
 * positions in R2.)
 */

import { useWidth } from '@/lib/use-width';
import { L_T, L_MONO } from './primitives';

/** A label's text box (baseline y): about 10 px above it, 3 below. */
interface Box { x0: number; x1: number; y0: number; y1: number }
const boxAt = (x0: number, x1: number, y: number): Box => ({ x0, x1, y0: y - 10, y1: y + 3 });
const overlaps = (a: Box, b: Box, pad = 4) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + 1 && a.y1 > b.y0 - 1;
/** A vertical segment (a leader) crossing a box. */
const crosses = (x: number, ya: number, yb: number, b: Box) =>
  x >= b.x0 - 2 && x <= b.x1 + 2 && Math.max(ya, yb) >= b.y0 && Math.min(ya, yb) <= b.y1;

/**
 * Live re-test 2 NEW-6: every label's place on the Plan chart, collision
 * free. The minimums note is placed first, clear of both lines (it used to
 * sit on the dashed line at 390 px). Each milestone label then avoids both
 * lines, every placed label and the note, every marker's dotted drop line,
 * and every raised leader; its own raised leader must not run through a
 * placed label either (the personal-loan leader crossed "CARD · Jan 2027").
 * Pure, so web/tests can check it at any width.
 */
export function layoutTrajectoryLabels(args: {
  points: LTrajPoint[];
  milestones: LTrajMilestone[];
  minimumsNote?: string;
  w: number;
  left: number;
  right: number;
  top: number;
  toX: (t: number) => number;
  toY: (v: number) => number;
}) {
  const { points, milestones, minimumsNote, w, left, right, top, toX, toY } = args;
  const last = points[points.length - 1];
  const lineYAt = (key: 'av' | 'min', x: number): number | null => {
    for (let i = 1; i < points.length; i++) {
      const xa = toX(points[i - 1].t);
      const xb = toX(points[i].t);
      if (x >= Math.min(xa, xb) && x <= Math.max(xa, xb)) {
        const f = xb === xa ? 0 : (x - xa) / (xb - xa);
        return toY(points[i - 1][key] + f * (points[i][key] - points[i - 1][key]));
      }
    }
    return null;
  };
  const clearOfLines = (b: Box) => {
    for (let sx = b.x0 - 2; sx <= b.x1 + 2; sx += 2) {
      for (const key of ['av', 'min'] as const) {
        const ly = lineYAt(key, sx);
        if (ly !== null && ly >= b.y0 - 1 && ly <= b.y1 + 1) return false;
      }
    }
    return true;
  };
  // The axis title (OUTSTANDING, top left) counts as placed.
  const boxes: Box[] = [boxAt(8, 8 + 'OUTSTANDING'.length * CHAR_W, 12)];
  const leaders: Array<{ x: number; ya: number; yb: number }> = [];
  // Every marker's dotted drop line, from the marker down to the axis.
  milestones.forEach((m) => leaders.push({ x: toX(m.t), ya: toY(m.v) - 4, yb: toY(0) }));
  const axisY = toY(0);

  let note: { x: number; y: number } | null = null;
  if (minimumsNote && last) {
    const nw = minimumsNote.length * CHAR_W;
    const x1 = w - right;
    const end = toY(last.min);
    const ys = [end - 6, end - 19, end - 32, end - 45, end + 16, end + 29, end + 42, top - 4, top + 9]
      .filter((y) => y >= 12 && y <= axisY - 4);
    const free = (y: number) => {
      const b = boxAt(x1 - nw, x1, y);
      return clearOfLines(b) && !boxes.some((o) => overlaps(o, b)) && !leaders.some((l) => crosses(l.x, l.ya, l.yb, b));
    };
    const y = ys.find(free) ?? ys.find((y) => clearOfLines(boxAt(x1 - nw, x1, y))) ?? Math.max(top - 4, end - 6);
    note = { x: x1, y };
    boxes.push(boxAt(x1 - nw, x1, y));
  }

  const labels = milestones.map((m, mi) => {
    const x = toX(m.t);
    const markY = toY(m.v);
    const width = m.label.length * CHAR_W;
    const natural: 'start' | 'end' | 'middle' = x - width / 2 < left ? 'start' : x + width / 2 > w - right ? 'end' : 'middle';
    // The box is the glyphs getBBox will report: text starts at x, ends at
    // x, or is centred on x. A 4px inset here let a start-anchored label's
    // real right edge land on the minimums note.
    const span = (a: 'start' | 'end' | 'middle') => {
      const x0 = a === 'start' ? x : a === 'end' ? x - width : x - width / 2;
      return { x0, x1: x0 + width };
    };
    // The natural anchor first; then hang the label right or left of its
    // marker, while it stays inside the chart (a narrow chart has little room).
    const anchors = ([natural, 'start', 'end', 'middle'] as const).filter(
      (a, i, all) => all.indexOf(a) === i && (a === natural || (span(a).x0 >= 4 && span(a).x1 <= w - 2)),
    );
    const leaderFor = (y: number) => (y < markY ? { ya: y + 3, yb: markY - 5 } : { ya: y - 10, yb: markY + 5 });
    const isRaised = (y: number) => y < markY - 12 || y > markY + 18;
    const ok = (a: 'start' | 'end' | 'middle', y: number, strict: boolean) => {
      const { x0, x1 } = span(a);
      const b = boxAt(x0, x1, y);
      if (boxes.some((o) => overlaps(o, b))) return false;
      if (!strict) return true;
      if (!clearOfLines(b)) return false;
      if (leaders.some((l, j) => j !== mi && crosses(l.x, l.ya, l.yb, b))) return false;
      if (isRaised(y)) {
        const own = leaderFor(y);
        if (boxes.some((o) => crosses(x, own.ya, own.yb, o))) return false;
      }
      return true;
    };
    const above = Array.from({ length: 16 }, (_, k) => markY - 12 - k * 13).filter((y) => y >= 12);
    const below = Array.from({ length: 16 }, (_, k) => markY + 18 + k * 13).filter((y) => y <= axisY - 6);
    const candidates = [...above, ...below];
    const pick = (strict: boolean) => {
      for (const a of anchors) for (const c of candidates) if (ok(a, c, strict)) return { a, y: c };
      return null;
    };
    let chosen = pick(true) ?? pick(false);
    if (!chosen) {
      // Every preferred row is taken. Keep looking before dropping the label
      // on top of one already placed (the phone chart's last resort did).
      for (const a of anchors) {
        for (let y = 12; y <= axisY - 6; y += 8) {
          const { x0, x1 } = span(a);
          if (!boxes.some((o) => overlaps(o, boxAt(x0, x1, y), 2))) {
            chosen = { a, y };
            break;
          }
        }
        if (chosen) break;
      }
    }
    if (!chosen) chosen = { a: natural, y: above[0] ?? 12 };
    const anchor = chosen.a;
    const y = chosen.y;
    const { x0, x1 } = span(anchor);
    boxes.push(boxAt(x0, x1, y));
    const raised = isRaised(y);
    if (raised) {
      const own = leaderFor(y);
      leaders.push({ x, ya: own.ya, yb: own.yb });
    }
    return { x, y, anchor: anchor as 'start' | 'end' | 'middle', raised, label: m.label, markY, x0, x1 };
  });
  return { note, labels };
}

// ─── LTrajectory ────────────────────────────────────────────────────────
export interface LTrajPoint {
  // 0..1 normalised positions
  t: number;
  av: number;
  min: number;
  /** Exact balance at this point, same words as the schedule cell. */
  tip?: string;
  /** Schedule month (0 is owed now) and the whole-currency balance plotted. */
  month?: number;
  balance?: number;
}

export interface LTrajMilestone {
  /** 0..1 along the x-axis, and the plan's balance there (0..1). */
  t: number;
  v: number;
  label: string;
}

/** A paper-coloured outline, so a label stays legible over a line. */
const HALO = { stroke: L_T.paper, strokeWidth: 3, paintOrder: 'stroke' } as const;

/** Collision width at 9.5px IBM Plex Mono. The face advances 5.7px; the
 *  extra room is so a box covers the browser's getBBox, which is a hair
 *  wider than the advance, and still clears the label beside it. */
const CHAR_W = 6.6;

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
  // Whole-rupee axis labels ("₹35,80,000") need more room than a compact scale.
  const yWidth = Math.max(0, ...(yLabels ?? []).map((g) => g.l.length));
  const left = Math.max(narrow ? 64 : 84, Math.ceil(yWidth * 6.2) + 12);
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

  const { note, labels } = layoutTrajectoryLabels({ points, milestones, minimumsNote, w, left, right, top, toX, toY });

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
        {points.map((p, i) =>
          p.tip ? (
            <circle key={`tip-${i}`} cx={toX(p.t)} cy={toY(p.av)} r={7} fill="transparent" data-month={p.month} data-balance={p.balance}>
              <title>{p.tip}</title>
            </circle>
          ) : null,
        )}
        <line x1={left} x2={w - right} y1={toY(0)} y2={toY(0)} stroke={L_T.ink} strokeWidth={1.2} />
        {minimumsNote && note && (
          <text
            x={note.x}
            y={note.y}
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

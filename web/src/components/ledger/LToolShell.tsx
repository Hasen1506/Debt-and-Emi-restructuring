'use client';

/**
 * Ledger tool skeleton — spec §4.9 "Tool-screen pattern".
 *
 * Every tool ships the same three blocks, in this order:
 *   1. CLI header — `$ <TOOL_TAG> · <TOOL_NAME> · <DATE>`
 *   2. Hero question — single 20–24px caps line (the exact question the
 *      tool answers, e.g. "DOES THE RATE HIKE BREAK YOUR PLAN?")
 *   3. `$ INPUT` card — 1px ink border, holds the user-tunable knobs.
 *      Always includes a date field (`AS OF · {today}` by default) so
 *      every run is timestamped for the decision log.
 *   4. `$ VERDICT` card — 2px ink border (heavier than INPUT), accent
 *      eyebrow, a choice of allocation-bar OR signature-visual, a
 *      4-cell KPI strip and an action row of brackets.
 *   5. `$ THE MATH` block — `LMathBlock` primitive, MANDATORY.
 *      "If a tool has no formula, the tool does not ship."
 *
 * The Windfall worked example in the prototype is §4.9.1 — the
 * *reference implementation*, not the template. Every other tool body
 * in `/tools/<id>` must follow the same skeleton.
 */

import type { CSSProperties, ReactNode } from 'react';
import { LCardSoft, LCardHard, LMathBlock, L_T, L_MONO, lGridColumns } from './primitives';

// ─── Header: CLI line + hero question ──────────────────────────────────
export function LToolHeader({
  tag,
  name,
  date,
  question,
}: {
  /** Section tag from `lib/tools` (`8a`, `8b`, `FX`, …). Not shown: spec
   *  numbering meant nothing to users. */
  tag: string;
  /** Tool name in ALL CAPS, e.g. WINDFALL ROUTER. */
  name: string;
  /** Date label — e.g. `MAY 24, 2026`. */
  date: string;
  /** The single 20–24px caps line — the question the tool answers. */
  question: string;
}) {
  return (
    <section style={{ fontFamily: L_MONO }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: L_T.muted,
          marginBottom: 14,
        }}
      >
        $ {name.toUpperCase()} · {date.toUpperCase()}
      </div>
      <h1
        style={{
          fontFamily: L_MONO,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.005em',
          lineHeight: 1.25,
          color: L_T.ink,
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        {question}
      </h1>
    </section>
  );
}

// ─── $ INPUT card ───────────────────────────────────────────────────────
export function LToolInput({
  title = 'INPUT',
  asOf,
  children,
  style,
}: {
  /** Title without the leading `$ ` — primitive adds it. */
  title?: string;
  /** Date label — e.g. `MAY 24, 2026`. Renders as `AS OF · <date>` at the
   *  bottom of the card. Pass `null` to suppress (rare — spec says every
   *  tool's INPUT card carries a date stamp). */
  asOf?: string | null;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <LCardSoft style={{ fontFamily: L_MONO, ...style }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: L_T.muted,
          marginBottom: 12,
        }}
      >
        $ {title.toUpperCase()}
      </div>
      {children}
      {asOf !== null && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: `1px dashed ${L_T.faint}`,
            fontSize: 10,
            letterSpacing: '0.18em',
            color: L_T.muted,
          }}
        >
          AS OF · {(asOf ?? new Date().toDateString()).toUpperCase()}
        </div>
      )}
    </LCardSoft>
  );
}

// ─── $ VERDICT card ─────────────────────────────────────────────────────
export function LToolVerdict({
  eyebrow,
  headline,
  visual,
  kpi,
  actions,
  style,
}: {
  /** Accent eyebrow above the headline — e.g. "WHERE TO ROUTE IT". */
  eyebrow: string;
  /** Two-to-three line bold caps headline — the verdict itself. */
  headline: string;
  /** Either an allocation bar (`LAllocationBar`) or a tool-specific
   *  signature visual (mini trajectory, break-even line, etc.). Render
   *  either, but always render *one* — the spec mandates a visual. */
  visual?: ReactNode;
  /** 4-cell KPI strip. Optional values get `—`. */
  kpi?: Array<{
    l: string;
    v: string;
    s?: string;
    tone?: 'pos' | 'neg' | 'accent';
  }>;
  /** Action row — brackets, buttons. The spec asks for at least one
   *  action so the user can apply / explore / dismiss the verdict. */
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <LCardHard style={{ fontFamily: L_MONO, ...style }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.2em',
          color: L_T.accent,
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        $ VERDICT · {eyebrow.toUpperCase()}
      </div>
      <h2
        style={{
          fontFamily: L_MONO,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.005em',
          lineHeight: 1.25,
          textTransform: 'uppercase',
          color: L_T.ink,
          margin: '0 0 14px',
        }}
      >
        {headline}
      </h2>
      {visual && <div style={{ marginBottom: 16 }}>{visual}</div>}
      {kpi && kpi.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: lGridColumns(Math.min(kpi.length, 4), 140),
            gap: 1,
            background: L_T.ink,
            border: `1px solid ${L_T.ink}`,
            margin: '0 0 14px',
          }}
        >
          {kpi.slice(0, 4).map((c, i) => {
            const tone =
              c.tone === 'pos'
                ? L_T.positive
                : c.tone === 'neg'
                  ? L_T.negative
                  : c.tone === 'accent'
                    ? L_T.accent
                    : L_T.ink;
            return (
              <div
                key={i}
                style={{ background: L_T.bg, padding: '10px 12px' }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.18em',
                    color: L_T.muted,
                    marginBottom: 4,
                  }}
                >
                  {c.l.toUpperCase()}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: tone }}>
                  {c.v}
                </div>
                {c.s && (
                  <div
                    style={{
                      fontSize: 10,
                      color: L_T.muted,
                      marginTop: 3,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {c.s}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {actions && (
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingTop: 6,
          }}
        >
          {actions}
        </div>
      )}
    </LCardHard>
  );
}

// ─── Allocation bar — single 26px stacked horizontal bar ───────────────
/**
 * Use this when the verdict is "how does X split". For Windfall §4.9.1
 * the segments are PREPAY · EF · INVEST · KEEP; for other tools they're
 * the tool-specific allocation. Segments without an explicit `tone` get
 * the muted neutral; the recommended bucket should be passed `accent`.
 */
export function LAllocationBar({
  segments,
}: {
  segments: Array<{
    label: string;
    pct: number;
    tone?: 'accent' | 'pos' | 'neg' | 'muted';
  }>;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.pct), 0) || 1;
  return (
    <div style={{ fontFamily: L_MONO }}>
      <div
        style={{
          display: 'flex',
          height: 26,
          border: `1px solid ${L_T.ink}`,
          overflow: 'hidden',
        }}
      >
        {segments.map((seg, i) => {
          const bg =
            seg.tone === 'accent'
              ? L_T.accent
              : seg.tone === 'pos'
                ? L_T.positive
                : seg.tone === 'neg'
                  ? L_T.negative
                  : L_T.ruleSoft;
          const color =
            seg.tone === 'accent' || seg.tone === 'pos' || seg.tone === 'neg'
              ? L_T.paper
              : L_T.ink;
          return (
            <div
              key={i}
              style={{
                flexGrow: Math.max(0.0001, seg.pct),
                background: bg,
                color,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.08em',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRight:
                  i < segments.length - 1 ? `1px solid ${L_T.ink}` : undefined,
              }}
            >
              {seg.pct / total > 0.08
                ? `${seg.label} ${Math.round((seg.pct / total) * 100)}%`
                : ''}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginTop: 6,
          fontSize: 9,
          letterSpacing: '0.1em',
          color: L_T.muted,
          flexWrap: 'wrap',
        }}
      >
        {segments.map((seg, i) => (
          <span key={i}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                background:
                  seg.tone === 'accent'
                    ? L_T.accent
                    : seg.tone === 'pos'
                      ? L_T.positive
                      : seg.tone === 'neg'
                        ? L_T.negative
                        : L_T.ruleSoft,
                marginRight: 6,
                verticalAlign: 'middle',
                border: `1px solid ${L_T.ink}`,
              }}
            />
            {seg.label.toUpperCase()} · {Math.round((seg.pct / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── $ THE MATH — re-export with the §4.9 default title ────────────────
/**
 * Thin pass-through to LMathBlock with the spec's default title ("THE
 * MATH"). Tools should `import { LToolMath } from '@/components/ledger/
 * LToolShell'` so the §4.9 vocabulary stays visible at the call site.
 *
 * "If a tool has no formula, the tool does not ship." — spec §4.9.
 */
export function LToolMath({
  rows,
}: {
  rows: Array<{
    k: string;
    v: string;
    note?: string;
    tone?: 'pos' | 'neg';
  }>;
}) {
  return <LMathBlock title="THE MATH" rows={rows} />;
}

// ─── LToolShell wrapper — sets up the column gap + font for any tool ───
export function LToolShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '4px 0 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: L_MONO,
      }}
    >
      {children}
    </div>
  );
}

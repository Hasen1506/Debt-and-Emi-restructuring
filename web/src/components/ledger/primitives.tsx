'use client';

/**
 * Ledger primitives — "The Statement" visual language.
 *
 * Mirrors the contracts in design/ledger-v2/ledger-skin-home.jsx / ledger-skin-rest.jsx (archived, see docs/ARCHIVE.md) at
 * repo root. Every Ledger* screen composes from this file; no screen
 * should re-implement its own borders, mastheads, or KPI grids.
 *
 * Hard rules baked into the primitives:
 *  - border-radius: 0 everywhere
 *  - IBM Plex Mono / JetBrains Mono only
 *  - tabular numbers (tnum) on the shell so every number aligns
 *  - palette is fixed in L_T; if you reach for a colour outside it,
 *    you are off-system
 */

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { fitColumns } from '@/lib/grid';

export const L_T = {
  // UX2 #23: CSS variables (styles/globals.css), so dark mode is one switch
  // of the tokens. Light values: bg #fbfaf3, paper #fff, ink #0a0a0a, muted
  // #5e5e58, accent #ab4f30 (4.5:1 as text on bg and under white text),
  // positive #137a3a, negative #b91c1c, highlight #fff3a3.
  bg: 'var(--canvas)',
  paper: 'var(--card)',
  ink: 'var(--ink)',
  inkSoft: 'var(--ink-soft)',
  muted: 'var(--muted)',
  faint: 'var(--soft)',
  rule: 'var(--border)',
  ruleSoft: 'var(--rule-soft)',
  accent: 'var(--accent)',
  accentInk: 'var(--accent-ink)',
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  highlight: 'var(--highlight)',
  highlightSoft: 'var(--highlight-soft)',
} as const;

export const L_MONO = "'IBM Plex Mono', 'RD Mono Fallback', 'JetBrains Mono', ui-monospace, monospace";

// ─── LRule ──────────────────────────────────────────────────────────────
export function LRule({
  char = '─',
  length = 200,
  weight = 700,
  color,
}: {
  char?: string;
  length?: number;
  weight?: number;
  color?: string;
}) {
  return (
    <div
      aria-hidden
      style={{
        whiteSpace: 'pre',
        overflow: 'hidden',
        fontFamily: L_MONO,
        color: color ?? L_T.ink,
        fontWeight: weight,
        fontSize: 'var(--fs-label)',
        lineHeight: 1,
      }}
    >
      {char.repeat(length)}
    </div>
  );
}

// ─── LBracket ───────────────────────────────────────────────────────────
export function LBracket({
  children,
  active,
  accent,
  href,
  onClick,
  as,
  disabled,
  style,
  current,
  label,
  prefetch,
}: {
  children: ReactNode;
  /** Spoken name when the bracket text alone is ambiguous ("EDIT" × 5). */
  label?: string;
  prefetch?: boolean;
  active?: boolean;
  /** The link to the page being shown (nav). */
  current?: boolean;
  accent?: boolean;
  href?: string;
  onClick?: () => void;
  as?: 'span' | 'a' | 'button';
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    fontFamily: L_MONO,
    fontSize: 13,
    letterSpacing: '0.08em',
    color: accent ? L_T.accent : active ? L_T.ink : L_T.muted,
    fontWeight: active ? 700 : 500,
    textDecoration: active ? 'underline' : 'none',
    textUnderlineOffset: 4,
    textDecorationColor: L_T.accent,
    textDecorationThickness: 2,
    cursor: href || onClick ? 'pointer' : 'default',
    background: 'transparent',
    border: 'none',
    padding: 0,
    ...style,
  };
  // Audit 80+ E13: the brackets are drawn, not spoken ("left bracket …
  // right bracket" in screen readers): aria-hidden keeps them out of the
  // accessible name, which is the words alone.
  const inner = (
    <>
      <span aria-hidden="true">[</span>
      {children}
      <span aria-hidden="true">]</span>
    </>
  );
  if (href) {
    if (href.startsWith('/') && !href.startsWith('//')) return (
      <Link href={href} prefetch={prefetch} className="l-hit" style={base} aria-current={current ? 'page' : undefined} aria-label={label}>
        {inner}
      </Link>
    );
    return (
      <a href={href} className="l-hit" style={base} aria-current={current ? 'page' : undefined} aria-label={label}>
        {inner}
      </a>
    );
  }
  if (onClick || as === 'button') {
    return (
      <button type="button" className="l-hit" onClick={onClick} disabled={disabled} style={base} aria-label={label}>
        {inner}
      </button>
    );
  }
  return <span style={base}>{inner}</span>;
}

// ─── LShell ─────────────────────────────────────────────────────────────
export function LShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        background: L_T.bg,
        color: L_T.ink,
        // Audit 80+ B5: body text in IBM Plex Sans at 16px; figures, labels
        // and tables set the mono themselves.
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        lineHeight: 1.55,
        fontFeatureSettings: '"tnum"',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}

// ─── LSectionHeader ─────────────────────────────────────────────────────
// Bold ink title over a 2px rule (design rev 3), so sections stand apart
// from the muted labels inside them. `step` adds a numbered "01 /" lead
// for screens that read as a sequence (input → result → the math).
/** E10: holds the place of text that changes once the browser has read
 *  Activity, as big as the longest of `ghosts` (drawn by CSS, so it is never
 *  read out or matched as page text; styles/globals.css .rd-ghost). */
export function Reserve({ ghosts, children, block }: { ghosts: string[]; children: ReactNode; block?: boolean }) {
  return (
    <span style={{ display: block ? 'grid' : 'inline-grid' }}>
      <span style={{ gridArea: '1 / 1' }}>{children}</span>
      {ghosts.map((g) => <span key={g} aria-hidden="true" className="rd-ghost" data-ghost={g} />)}
    </span>
  );
}

export function LSectionHeader({
  children,
  right,
  step,
}: {
  children: ReactNode;
  right?: ReactNode;
  step?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: `2px solid ${L_T.ink}`,
        fontSize: 14,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.1em',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <h2
        style={{
          margin: 0,
          font: 'inherit',
          color: L_T.ink,
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {step !== undefined && (
          <span style={{ color: L_T.accent }}>{String(step).padStart(2, '0')} / </span>
        )}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** The button for recording a payment (MARK PAID, OTHER AMOUNT): big
 *  enough to read and hit, the same on Home and Activity. */
export function lPayBtn(solid: boolean): CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 'var(--fs-label)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '8px 14px',
    minHeight: 36,
    cursor: 'pointer',
    border: `1px solid ${L_T.ink}`,
    background: solid ? L_T.ink : 'transparent',
    color: solid ? L_T.bg : L_T.ink,
  };
}

// ─── Accent strip ───────────────────────────────────────────────────────
// Flags one row ("highest rate", "engine pick") with a 3px left strip
// instead of a yellow background. Put it on the row's first cell.
export function lStrip(tone: 'accent' | 'negative' | 'positive' | 'ink' = 'accent'): CSSProperties {
  const c =
    tone === 'negative' ? L_T.negative : tone === 'positive' ? L_T.positive : tone === 'ink' ? L_T.ink : L_T.accent;
  return { boxShadow: `inset 3px 0 0 ${c}` };
}

// ─── LExpandRow ─────────────────────────────────────────────────────────
// The panel that opens under a table row.
export function LExpandRow({
  children,
  accent,
  id,
}: {
  children: ReactNode;
  accent?: boolean;
  id?: string;
}) {
  return (
    <tr id={id}>
      <td
        colSpan={99}
        style={{
          background: accent ? '#faf6f0' : L_T.paper,
          padding: '12px 14px',
          borderBottom: `1px dashed ${L_T.ruleSoft}`,
          ...(accent ? lStrip('accent') : null),
        }}
      >
        {children}
      </td>
    </tr>
  );
}

// ─── LAllocationBar ─────────────────────────────────────────────────────
// One stacked bar; every segment keeps a visible label (cut short, never
// hidden) and the full label + amount in its tooltip and accessible name.
export interface LAllocSegment {
  id: string;
  label: string;
  value: number;
  amount: string;
  color: string;
  /** Text colour on the segment; white unless the fill is light. */
  ink?: string;
}

export function LAllocationBar({
  segments,
  height = 28,
  label = 'Where the money goes',
  legend,
}: {
  segments: LAllocSegment[];
  height?: number;
  label?: string;
  /** A key under the bar (name, amount, share) instead of names cut to
   *  fit inside the segments. */
  legend?: boolean;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  const bar = (
    <div
      role="img"
      aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.amount}`).join(', ')}`}
      style={{ display: 'flex', height, border: `1px solid ${L_T.ink}`, background: L_T.paper }}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s, i, arr) => {
          const share = s.value / total;
          const maxChars = Math.max(2, Math.floor(share * 95));
          const shown = s.label.length > maxChars ? `${s.label.slice(0, maxChars).trim()}…` : s.label;
          return (
            <div
              key={s.id}
              title={`${s.label}: ${s.amount}`}
              style={{
                flex: share,
                minWidth: 6,
                background: s.color,
                color: s.ink ?? 'var(--card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                letterSpacing: '0.06em',
                borderRight: i < arr.length - 1 ? `1px solid ${L_T.ink}` : 'none',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                padding: '0 4px',
              }}
            >
              {!legend && share >= 0.04 ? shown : ''}
            </div>
          );
        })}
    </div>
  );
  if (!legend) return bar;
  return (
    <div>
      {bar}
      <ul aria-hidden="true" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 'var(--fs-dense)' }}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <li key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, background: s.color, border: `1px solid ${L_T.ink}`, flex: 'none' }} />
              <span>{s.label}</span>
              <span style={{ color: L_T.muted, fontVariantNumeric: 'tabular-nums' }}>
                {s.amount} · {Math.round((s.value / total) * 100)}%
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

// ─── LProgressBar ───────────────────────────────────────────────────────
// [█████░░░░░] 48% — block characters, so it prints and copies as text.
export function LProgressBar({
  pct,
  width = 20,
  tone,
}: {
  pct: number;
  width?: number;
  tone?: 'pos' | 'neg';
}) {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  const color = tone === 'pos' ? L_T.positive : tone === 'neg' ? L_T.negative : L_T.ink;
  return (
    <span
      role="img"
      aria-label={`${Math.round(p)}%`}
      style={{ fontFamily: L_MONO, fontSize: 'var(--fs-small)', letterSpacing: 0, color, whiteSpace: 'pre' }}
    >
      <span aria-hidden="true">
        [{'█'.repeat(filled)}
        <span style={{ color: L_T.faint }}>{'░'.repeat(width - filled)}</span>]{' '}
      </span>
      {Math.round(p)}%
    </span>
  );
}

// ─── LCli ───────────────────────────────────────────────────────────────
// The "$ KEY=VALUE · KEY=VALUE" header line that replaces a heavy heading.
export function LCli({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 'var(--fs-label)',
        letterSpacing: '0.18em',
        color: L_T.muted,
        marginBottom: 6,
        fontFamily: L_MONO,
      }}
    >
      {children}
    </div>
  );
}

// ─── LKpi ───────────────────────────────────────────────────────────────
export interface LKpiItem {
  l: string;
  v: ReactNode;
  s?: ReactNode;
  tone?: string;
}

/** Up to `n` equal columns, dropping to fewer when a column would be
 *  narrower than `minPx` (a 4-up strip on a phone gave 84 px cells, and
 *  "₹1,05,000/MO" pushed the page sideways). */
export function lGridColumns(n: number, minPx: number): string {
  return fitColumns(n, minPx, 1);
}

export function LKpi({
  items,
  cols,
  mobile,
  label,
}: {
  items: LKpiItem[];
  cols?: number;
  mobile?: boolean;
  /** Names the figures as a group (audit 80+ E13: a term list a screen
   *  reader can move through, not one run of text). */
  label?: string;
}) {
  const n = cols ?? (mobile ? 2 : items.length);
  return (
    <dl
      aria-label={label}
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: lGridColumns(n, 140),
        // Rules drawn by the cells, not an ink background showing through
        // gaps: a short last row (5 figures in 2 columns) left a black block.
        borderTop: `1px solid ${L_T.ink}`,
        borderLeft: `1px solid ${L_T.ink}`,
      }}
    >
      {items.map((m, i) => (
        <div key={i} style={{ background: L_T.bg, padding: '10px 14px', borderRight: `1px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
          <dt
            style={{
              fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
              color: L_T.muted,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {m.l}
          </dt>
          <dd
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: mobile ? 18 : 'var(--fs-figure)',
              fontWeight: 700,
              color: m.tone ?? L_T.ink,
              letterSpacing: '-0.01em',
              overflowWrap: 'anywhere',
            }}
          >
            {m.v}
          </dd>
          {m.s !== undefined && m.s !== null && m.s !== '' && (
            <dd style={{ margin: '4px 0 0', fontSize: 'var(--fs-small)', color: L_T.muted }}>{m.s}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

// ─── LField ─────────────────────────────────────────────────────────────
/** A labelled ledger field. The caption is a real <label for> (UX50 C-01:
 *  a <div> caption left screen readers announcing "edit text, 80000").
 *  `type="number"` renders a text input with a numeric keypad (C-06: no
 *  spinner, no wheel-scroll changing the value); `inputMode` overrides. */
export function LField({
  label,
  value,
  hint,
  prefix,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  inputMode,
  error,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  prefix?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: 'text' | 'number';
  inputMode?: 'text' | 'decimal' | 'numeric';
  /** Shown under the field and tied to it with aria-describedby / aria-invalid. */
  error?: string | null;
  testId?: string;
}) {
  const id = useId();
  const editable = typeof onChange === 'function';
  const mode = inputMode ?? (type === 'number' ? 'decimal' : undefined);
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const described = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label
        htmlFor={editable ? id : undefined}
        style={{
          display: 'block',
          fontSize: 'var(--fs-small)',
          fontWeight: 600,
          color: L_T.inkSoft,
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <div
        style={{
          borderBottom: `2px solid ${error ? L_T.negative : L_T.ink}`,
          padding: '6px 2px',
          fontSize: 'var(--fs-body)',
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'transparent',
        }}
      >
        {prefix && <span style={{ color: L_T.muted }} aria-hidden="true">{prefix}</span>}
        {editable ? (
          <input
            id={id}
            type="text"
            inputMode={mode}
            value={value}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={described}
            data-testid={testId}
            onChange={(e) => onChange!(e.target.value)}
            onBlur={onBlur}
            className="l-field-input"
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 28,
              border: 'none',
              padding: 0,
              fontFamily: L_MONO,
              fontWeight: 600,
              color: L_T.ink,
              background: 'transparent',
            }}
          />
        ) : (
          <span>{value}</span>
        )}
      </div>
      {error && (
        <div id={errId} role="alert" style={{ fontSize: 'var(--fs-small)', color: L_T.negative, marginTop: 4 }}>
          {error}
        </div>
      )}
      {hint && (
        <div
          id={hintId}
          style={{
            fontSize: 'var(--fs-small)',
            color: L_T.muted,
            marginTop: 4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ─── LCardHard / LCardSoft / LCardPaper ─────────────────────────────────
export function LCardHard({
  children,
  mobile,
  style,
}: {
  children: ReactNode;
  mobile?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        border: `2px solid ${L_T.ink}`,
        padding: mobile ? '14px 16px' : '18px 22px',
        background: L_T.bg,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function LCardSoft({
  children,
  mobile,
  style,
}: {
  children: ReactNode;
  mobile?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        border: `1px solid ${L_T.ink}`,
        padding: mobile ? '12px 14px' : '14px 18px',
        background: L_T.bg,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function LCardPaper({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        border: `1px solid ${L_T.faint}`,
        padding: '14px 18px',
        background: L_T.paper,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

// ─── LSlider — command-line style ──────────────────────────────────────
export function LSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  outcomes,
  ariaLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange?: (v: number) => void;
  format: (v: number) => string;
  outcomes: Array<{ label: string; value: string; tone?: 'pos' | 'neg' }>;
  /** What a screen reader calls the slider; the visible label is terminal-speak. */
  ariaLabel?: string;
}) {
  const fill = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
          fontSize: 'var(--fs-small)',
          gap: 8,
        }}
      >
        <span style={{ color: L_T.muted }}>{label} =</span>
        <span style={{ color: L_T.ink, fontWeight: 700 }}>{format(value)}</span>
      </div>
      <div
        style={{
          position: 'relative',
          height: 6,
          background: L_T.ruleSoft,
          margin: '8px 0',
        }}
      >
        <div
          style={{
            position: 'absolute',
            height: '100%',
            width: `${fill}%`,
            background: L_T.ink,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${fill}%`,
            width: 12,
            height: 12,
            background: L_T.accent,
            transform: 'translate(-50%, -50%)',
          }}
        />
        {onChange && (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={ariaLabel ?? label.replace(/^SET /, '').replace(/_/g, ' ').toLowerCase()}
            aria-valuetext={format(value)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 18, fontSize: 'var(--fs-small)', color: L_T.muted, flexWrap: 'wrap' }}>
        {outcomes.map((o, i) => (
          <span key={i}>
            → {o.label}{' '}
            <span
              style={{
                color: o.tone === 'pos' ? L_T.positive : o.tone === 'neg' ? L_T.negative : L_T.ink,
                fontWeight: 700,
              }}
            >
              {o.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── LButton — solid ink primary button ────────────────────────────────
export function LButton({
  children,
  onClick,
  href,
  full,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  full?: boolean;
  /** Greyed out and inert (e.g. while saving). */
  disabled?: boolean;
}) {
  const base: CSSProperties = {
    opacity: disabled ? 0.55 : 1,
    padding: '10px 20px',
    background: L_T.ink,
    color: L_T.bg,
    border: 'none',
    fontFamily: L_MONO,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center',
    width: full ? '100%' : undefined,
  };
  if (href) {
    return (
      <a href={href} style={base}>
        <span aria-hidden="true">[ </span>
        {children}
        <span aria-hidden="true"> ]</span>
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={disabled || undefined}
      style={{ ...base, cursor: disabled ? 'progress' : 'pointer' }}
    >
      <span aria-hidden="true">[ </span>
      {children}
      <span aria-hidden="true"> ]</span>
    </button>
  );
}

// ─── LFooter — the calm-view toggle under Home ──────────────────────────
export type LTone = 'CALM' | 'OVERWHELMED';

const FOOTER_TONE_COOKIE = 'rightdue_ledger_tone';

export function readLedgerTone(): LTone {
  if (typeof document === 'undefined') return 'CALM';
  const m = document.cookie.match(/rightdue_ledger_tone=([^;]+)/);
  return m && m[1] === 'OVERWHELMED' ? 'OVERWHELMED' : 'CALM';
}

function writeTone(t: LTone) {
  document.cookie = `${FOOTER_TONE_COOKIE}=${t}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function LFooter({ mobile }: { mobile?: boolean }) {
  // The calm view is a Home view; elsewhere the toggle would change nothing.
  // (A SIMPLE / DETAILED switch sat here too until R2 made Home one layout.)
  const onHome = (usePathname() || '/') === '/';
  const [tone, setTone] = useState<LTone>('CALM');
  useEffect(() => {
    setTone(readLedgerTone());
  }, []);
  function toggleTone() {
    const next: LTone = tone === 'OVERWHELMED' ? 'CALM' : 'OVERWHELMED';
    writeTone(next);
    setTone(next);
    // Reload so the page re-renders the view; cookie-driven so SSR sees it.
    window.location.reload();
  }
  if (!onHome) return null;
  // Audit 80+ E13: a <div>, not a second <footer> landmark (the site footer
  // is the page's one contentinfo).
  return (
    <div
      style={{
        borderTop: `1px solid ${L_T.ink}`,
        padding: mobile ? '8px 18px' : '10px 32px',
        display: 'flex',
        justifyContent: 'flex-start',
        fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
        letterSpacing: '0.14em',
        color: L_T.muted,
        background: L_T.bg,
      }}
    >
      <LBracket accent onClick={toggleTone}>
        {tone === 'OVERWHELMED' ? '← BACK TO THE FULL VIEW' : 'FEELING OVERWHELMED? ONE STEP AT A TIME'}
      </LBracket>
    </div>
  );
}

// ─── LMathBlock — the trust-contract code block at the end of tools ────
export function LMathBlock({
  title = 'THE MATH',
  rows,
}: {
  title?: string;
  rows: Array<{ k: string; v: string; note?: string; tone?: 'pos' | 'neg' }>;
}) {
  return (
    <LCardPaper>
      <div
        style={{
          fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
          letterSpacing: '0.18em',
          color: L_T.muted,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 'var(--fs-dense)', color: L_T.ink, lineHeight: 1.8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 8 }}>
            <span style={{ minWidth: 'min(180px, 45%)' }}>{r.k}</span>
            <span>
            = <span
              style={{
                color: r.tone === 'pos' ? L_T.positive : r.tone === 'neg' ? L_T.negative : L_T.ink,
                fontWeight: r.tone ? 700 : 500,
              }}
            >
              {r.v}
            </span>
            </span>
            {r.note && <span style={{ color: L_T.muted }}>({r.note})</span>}
          </div>
        ))}
      </div>
    </LCardPaper>
  );
}

// ─── LChip / LChipRow ───────────────────────────────────────────────────
/** A pressable choice (aria-pressed); LChipRow groups them under a label. */
export function LChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-small)',
        padding: '7px 12px',
        border: `1px solid ${on ? L_T.ink : L_T.ruleSoft}`,
        background: on ? L_T.ink : L_T.paper,
        color: on ? L_T.bg : L_T.ink,
        fontWeight: on ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function LChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 'var(--fs-dense)', color: L_T.muted }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

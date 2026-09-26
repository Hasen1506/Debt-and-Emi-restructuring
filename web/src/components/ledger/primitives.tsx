'use client';

/**
 * Ledger primitives — "The Statement" visual language.
 *
 * Mirrors the contracts in ledger-skin-home.jsx / ledger-skin-rest.jsx at
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

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { fitColumns } from '@/lib/grid';

export const L_T = {
  bg: '#fbfaf3',
  paper: '#ffffff',
  ink: '#0a0a0a',
  inkSoft: '#2a2a26',
  muted: '#5e5e58',
  faint: '#a8a8a3',
  rule: '#0a0a0a',
  ruleSoft: '#d8d6cd',
  accent: '#ab4f30',       // 4.5:1 as text on bg and under white text (was #c96442)
  accentInk: '#8b3a1f',
  positive: '#137a3a',     // 4.5:1 on the highlight rows too (was #15803d)
  negative: '#b91c1c',
  highlight: '#fff3a3',
  highlightSoft: '#fff8d3',
} as const;

export const L_MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";

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
        fontSize: 11,
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
  style,
}: {
  children: ReactNode;
  active?: boolean;
  accent?: boolean;
  href?: string;
  onClick?: () => void;
  as?: 'span' | 'a' | 'button';
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    fontFamily: L_MONO,
    fontSize: 10,
    letterSpacing: '0.14em',
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
  const inner = <>[{children}]</>;
  if (href) {
    return (
      <a href={href} style={base}>
        {inner}
      </a>
    );
  }
  if (onClick || as === 'button') {
    return (
      <button type="button" onClick={onClick} style={base}>
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
        fontFamily: L_MONO,
        fontSize: 12,
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
export function LSectionHeader({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 6,
        fontSize: 11,
        letterSpacing: '0.18em',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <h2 style={{ margin: 0, font: 'inherit', color: L_T.muted, fontWeight: 600 }}>
        <span aria-hidden="true">$ </span>
        {children}
      </h2>
      {right}
    </div>
  );
}

// ─── LCli ───────────────────────────────────────────────────────────────
// The "$ KEY=VALUE · KEY=VALUE" header line that replaces a heavy heading.
export function LCli({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: '0.18em',
        color: L_T.muted,
        marginBottom: 6,
        fontFamily: L_MONO,
      }}
    >
      $ {children}
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
}: {
  items: LKpiItem[];
  cols?: number;
  mobile?: boolean;
}) {
  const n = cols ?? (mobile ? 2 : items.length);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: lGridColumns(n, 140),
        gap: 1,
        background: L_T.ink,
        padding: 1,
      }}
    >
      {items.map((m, i) => (
        <div key={i} style={{ background: L_T.bg, padding: '10px 14px' }}>
          <div
            style={{
              fontSize: 10,
              color: L_T.muted,
              letterSpacing: '0.12em',
              marginBottom: 4,
            }}
          >
            {m.l}
          </div>
          <div
            style={{
              fontSize: mobile ? 15 : 17,
              fontWeight: 700,
              color: m.tone ?? L_T.ink,
              letterSpacing: '-0.01em',
              overflowWrap: 'anywhere',
            }}
          >
            {m.v}
          </div>
          {m.s !== undefined && m.s !== null && m.s !== '' && (
            <div style={{ fontSize: 10, color: L_T.muted, marginTop: 4 }}>{m.s}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── LField ─────────────────────────────────────────────────────────────
export function LField({
  label,
  value,
  hint,
  prefix,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  hint?: string;
  prefix?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  const editable = typeof onChange === 'function';
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.14em',
          color: L_T.muted,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          borderBottom: `2px solid ${L_T.ink}`,
          padding: '6px 2px',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'transparent',
        }}
      >
        {prefix && <span style={{ color: L_T.muted }}>{prefix}</span>}
        {editable ? (
          <input
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange!(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              padding: 0,
              fontFamily: L_MONO,
              fontSize: 13,
              fontWeight: 600,
              color: L_T.ink,
              background: 'transparent',
            }}
          />
        ) : (
          <span>{value}</span>
        )}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 9,
            color: L_T.muted,
            marginTop: 4,
            letterSpacing: '0.08em',
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
          fontSize: 11,
          gap: 8,
        }}
      >
        <span style={{ color: L_T.muted }}>$ {label} =</span>
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
      <div style={{ display: 'flex', gap: 18, fontSize: 11, color: L_T.muted, flexWrap: 'wrap' }}>
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
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  full?: boolean;
}) {
  const base: CSSProperties = {
    padding: '10px 20px',
    background: L_T.ink,
    color: L_T.bg,
    border: 'none',
    fontFamily: L_MONO,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.14em',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center',
    width: full ? '100%' : undefined,
  };
  if (href) {
    return (
      <a href={href} style={base}>
        [ {children} ]
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} style={base}>
      [ {children} ]
    </button>
  );
}

// ─── LFooter — bottom bar with Simple/Detailed + Overwhelmed toggles ───
export type LMode = 'SIMPLE' | 'DETAILED';
export type LTone = 'CALM' | 'OVERWHELMED';

const FOOTER_MODE_COOKIE = 'finoptima_ledger_mode';
const FOOTER_TONE_COOKIE = 'finoptima_ledger_tone';

export function readLedgerMode(): LMode {
  if (typeof document === 'undefined') return 'SIMPLE';
  const m = document.cookie.match(/finoptima_ledger_mode=([^;]+)/);
  return m && m[1] === 'DETAILED' ? 'DETAILED' : 'SIMPLE';
}

export function readLedgerTone(): LTone {
  if (typeof document === 'undefined') return 'CALM';
  const m = document.cookie.match(/finoptima_ledger_tone=([^;]+)/);
  return m && m[1] === 'OVERWHELMED' ? 'OVERWHELMED' : 'CALM';
}

function writeMode(m: LMode) {
  document.cookie = `${FOOTER_MODE_COOKIE}=${m}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
function writeTone(t: LTone) {
  document.cookie = `${FOOTER_TONE_COOKIE}=${t}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function LFooter({ mobile }: { mobile?: boolean }) {
  const [mode, setMode] = useState<LMode>('SIMPLE');
  const [tone, setTone] = useState<LTone>('CALM');
  useEffect(() => {
    setMode(readLedgerMode());
    setTone(readLedgerTone());
  }, []);
  function toggleMode(next: LMode) {
    writeMode(next);
    setMode(next);
    // Reload so the page re-renders the variant; cookie-driven so SSR
    // sees the new mode on the next paint without flicker.
    window.location.reload();
  }
  function toggleTone() {
    const next: LTone = tone === 'OVERWHELMED' ? 'CALM' : 'OVERWHELMED';
    writeTone(next);
    setTone(next);
    window.location.reload();
  }
  return (
    <footer
      style={{
        borderTop: `1px solid ${L_T.ink}`,
        padding: mobile ? '8px 18px' : '10px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        letterSpacing: '0.14em',
        color: L_T.muted,
        flexWrap: 'wrap',
        gap: 8,
        background: L_T.bg,
      }}
    >
      <LBracket accent onClick={toggleTone}>
        {tone === 'OVERWHELMED' ? '← BACK TO CALM' : 'FEELING OVERWHELMED?'}
      </LBracket>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <LBracket active={mode === 'SIMPLE'} onClick={() => toggleMode('SIMPLE')}>
          SIMPLE
        </LBracket>
        <LBracket active={mode === 'DETAILED'} onClick={() => toggleMode('DETAILED')}>
          DETAILED
        </LBracket>
      </span>
    </footer>
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
          fontSize: 11,
          letterSpacing: '0.18em',
          color: L_T.muted,
          marginBottom: 8,
        }}
      >
        $ {title}
      </div>
      <div style={{ fontSize: 12, color: L_T.ink, lineHeight: 1.8 }}>
        {rows.map((r, i) => (
          <div key={i}>
            {r.k.padEnd(18)} = <span
              style={{
                color: r.tone === 'pos' ? L_T.positive : r.tone === 'neg' ? L_T.negative : L_T.ink,
                fontWeight: r.tone ? 700 : 500,
              }}
            >
              {r.v}
            </span>
            {r.note && <span style={{ color: L_T.muted }}>  ({r.note})</span>}
          </div>
        ))}
      </div>
    </LCardPaper>
  );
}

'use client';

/**
 * The numbered layout every tool page shares (REDESIGN R5.5):
 * 01 · the inputs (a bordered box) → 02 · the answer (a 2px box with an
 * accent number) → THE MATH (LMathBlock). Windfall set the pattern; this
 * file holds its pieces so the other tools read the same.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { announce } from '@/lib/announce';
import { L_T } from './primitives';

/** A step's numbered header: `01 HOW MUCH`, the answer's number filled. */
export function LStepHead({ no, id, accent, children }: { no: string; id: string; accent?: boolean; children: ReactNode }) {
  return (
    <h2
      id={id}
      style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px', paddingBottom: 8, borderBottom: `2px solid ${L_T.ink}`, font: 'inherit' }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: accent ? L_T.paper : L_T.ink,
          background: accent ? L_T.accent : 'transparent',
          border: `1.5px solid ${accent ? L_T.accent : L_T.ink}`,
          padding: '2px 7px',
        }}
      >
        {no}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{children}</span>
    </h2>
  );
}

/** A group heading inside a step, with an optional note on the right. */
export function LStepSub({ right, children }: { right?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
        flexWrap: 'wrap',
        paddingBottom: 5,
        marginBottom: 4,
        borderBottom: `1px solid ${L_T.faint}`,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{children}</span>
      {right && <span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.12em' }}>{right}</span>}
    </div>
  );
}

/** One numbered step. `answer` gives the 2px border and the filled number. */
export function LStep({
  no,
  id,
  title,
  answer,
  children,
  style,
}: {
  no: string;
  id: string;
  title: ReactNode;
  answer?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      aria-labelledby={id}
      style={{ border: `${answer ? 2 : 1}px solid ${L_T.ink}`, padding: 'clamp(14px, 2.5vw, 22px)', minWidth: 0, ...style }}
    >
      <LStepHead no={no} id={id} accent={answer}>
        {title}
      </LStepHead>
      {children}
    </section>
  );
}

/** Fields side by side, one per row on a phone. */
export function LFieldGrid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`,
        gap: 14,
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  );
}

/** The answer in one sentence, coloured by what it means. */
export function LVerdict({ tone, children }: { tone?: 'pos' | 'neg' | 'accent' | null; children: ReactNode }) {
  const color = tone === 'pos' ? L_T.positive : tone === 'neg' ? L_T.negative : tone === 'accent' ? L_T.accent : L_T.ink;
  // The verdict is read out when it appears or changes (lib/announce): a
  // role="status" that mounts with its text in it is never spoken.
  const ref = useRef<HTMLParagraphElement>(null);
  const said = useRef('');
  useEffect(() => {
    const text = ref.current?.textContent ?? '';
    if (text && text !== said.current) {
      said.current = text;
      announce(text);
    }
  });
  return (
    <p ref={ref} style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, lineHeight: 1.4, color }}>
      {children}
    </p>
  );
}

/** A muted line under a verdict or a field group. */
export function LNote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.6, color: L_T.muted, ...style }}>{children}</p>;
}

/** The page's column of steps. */
export function LSteps({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>{children}</div>;
}

'use client';

/**
 * The payoff order in the masthead (audit 80+ B20; replaces the persona
 * medallion and its three unlabelled bars, UX50 B-21 / grill #78).
 *
 * A text segmented control, "Payoff order: Cheapest · Smallest · Mine",
 * as a radio group: each choice is labelled for sighted users, the one in
 * use is marked, and arrow keys move between them. Switching writes the
 * cookie and refreshes, so Home and Plan redraw in the new order, the same
 * as the switch on Plan. What each order does is one tap away on Plan
 * ("Compare them with your numbers").
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { OfflineStrategyNote, useStrategyRefresh } from '@/components/useStrategyRefresh';
import { STRATEGIES, STRATEGY_SHORT, writeStrategyClient, type StrategyName } from '@/lib/strategy';
import { L_MONO, L_T } from '@/components/ledger/primitives';

/** The words on each segment: short enough for one row at 390. */
export const PAYOFF_SEGMENT: Record<StrategyName, string> = {
  avalanche: 'Cheapest',
  snowball: 'Smallest',
  rules: 'Mine',
};

/** The order shown left to right. */
const ORDER: StrategyName[] = (['avalanche', 'snowball', 'rules'] as StrategyName[]).filter((s) => STRATEGIES.includes(s));

/** "Credit card first, then Personal loan". */
function orderText(names: string[]): string {
  if (names.length === 1) return `all three pay your ${names[0]}`;
  return `all three pay ${names[0]} first, then ${names.slice(1).join(', then ')}`;
}

export function PayoffOrderSwitch({
  strategy,
  sameOrder = null,
}: {
  strategy: StrategyName;
  /** The loans in the one order all three strategies agree on, or null. */
  sameOrder?: string[] | null;
}) {
  const { pending, offline, refresh } = useStrategyRefresh();
  const [current, setCurrent] = useState(strategy);
  useEffect(() => setCurrent(strategy), [strategy]);
  const [note, setNote] = useState(false);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(false), 7000);
    return () => clearTimeout(t);
  }, [note]);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function pick(s: StrategyName) {
    if (s === current) return;
    if (sameOrder) setNote(true);
    setCurrent(s);
    writeStrategyClient(s);
    refresh();
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, s: StrategyName) {
    const i = ORDER.indexOf(s);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = ORDER[(i + step + ORDER.length) % ORDER.length];
    refs.current[next]?.focus();
    pick(next);
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: L_MONO }}>
      <span id="rd-payoff-order-label" style={{ fontSize: 'var(--fs-label)', letterSpacing: '0.1em', textTransform: 'uppercase', color: L_T.muted }}>
        Payoff order
      </span>
      <span
        role="radiogroup"
        aria-labelledby="rd-payoff-order-label"
        aria-busy={pending || undefined}
        style={{ display: 'inline-flex', border: `1px solid ${L_T.ink}`, background: L_T.paper, opacity: pending ? 0.6 : 1 }}
      >
        {ORDER.map((s, i) => {
          const on = s === current;
          return (
            <button
              key={s}
              ref={(el) => {
                refs.current[s] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={STRATEGY_SHORT[s]}
              onClick={() => pick(s)}
              onKeyDown={(e) => onKey(e, s)}
              className="rd-payoff-seg"
              style={{
                fontFamily: L_MONO,
                fontSize: 'var(--fs-body)',
                fontWeight: on ? 700 : 500,
                padding: '4px 10px',
                minHeight: 30,
                border: 'none',
                borderLeft: i === 0 ? 'none' : `1px solid ${L_T.ruleSoft}`,
                background: on ? L_T.ink : 'transparent',
                color: on ? L_T.bg : L_T.ink,
                cursor: 'pointer',
              }}
            >
              {PAYOFF_SEGMENT[s]}
            </button>
          );
        })}
      </span>
      {/* A toast, so the header never changes height when it shows. */}
      <span role="status" aria-live="polite">
        {note && sameOrder && (
          <span
            style={{
              position: 'fixed',
              right: 16,
              top: 72,
              zIndex: 30,
              maxWidth: 'min(360px, calc(100vw - 32px))',
              padding: '8px 10px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-small)',
              lineHeight: 1.5,
              color: L_T.ink,
              background: L_T.highlightSoft,
              border: `1px solid ${L_T.ink}`,
              boxShadow: `3px 3px 0 ${L_T.ink}`,
            }}
          >
            Same starting order: {orderText(sameOrder)} today. Later payments and interest can differ.
          </span>
        )}
      </span>
      <OfflineStrategyNote
        show={offline}
        style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 40, maxWidth: 420, padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.negative}` }}
      />
    </span>
  );
}

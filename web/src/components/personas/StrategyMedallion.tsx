'use client';

/**
 * The payoff strategy in the masthead (REDESIGN R6.2, Direction D): the
 * persona's medallion, its name, and three pips.
 *
 * - A pip switches to that strategy in one click.
 * - The medallion opens the three side by side with what each does.
 *
 * Switching writes the cookie and refreshes, so Home and Plan redraw in
 * the new order, the same as the switch on Plan.
 */
import { useEffect, useRef, useState } from 'react';
import { OfflineStrategyNote, useStrategyRefresh } from '@/components/useStrategyRefresh';
import { STRATEGIES, writeStrategyClient, type StrategyName } from '@/lib/strategy';
import { L_MONO, L_T } from '@/components/ledger/primitives';
import { PERSONA, PersonaMedallion } from './Persona';

/** Under the medallion, kept on screen: on a phone it isn't at the right
 *  edge, and a right-aligned box ran off the left. */
function place(el: HTMLElement, max: number) {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const width = Math.min(max, vw - 32);
  return { top: r.bottom + 6, left: Math.min(Math.max(16, r.right - width), vw - 16 - width), width };
}

/** "Credit card first, then Personal loan". */
function orderText(names: string[]): string {
  if (names.length === 1) return `all three pay your ${names[0]}`;
  return `all three pay ${names[0]} first, then ${names.slice(1).join(', then ')}`;
}

export function StrategyMedallion({
  strategy,
  sameOrder = null,
}: {
  strategy: StrategyName;
  /** The loans in the one order all three strategies agree on, or null. */
  sameOrder?: string[] | null;
}) {
  // R6B-9: offline, the choice is saved and the refresh waits for the connection.
  const { pending, offline, refresh } = useStrategyRefresh();
  // Shown at once; the refresh brings the server's copy back in line.
  const [current, setCurrent] = useState(strategy);
  useEffect(() => setCurrent(strategy), [strategy]);
  // Where the menu sits (see place()).
  const [open, setOpen] = useState<{ top: number; left: number; width: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  function toggle() {
    if (open || !box.current) return setOpen(null);
    setOpen(place(box.current, 320));
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const scrolled = () => setOpen(null);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', scrolled);
    };
  }, [open]);

  // Describe the starting order without promising identical outcomes.
  const [note, setNote] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);

  function pick(s: StrategyName) {
    setOpen(null);
    if (s === current) return;
    if (sameOrder && box.current) setNote(place(box.current, 300));
    setCurrent(s);
    writeStrategyClient(s);
    refresh();
  }

  const p = PERSONA[current];
  return (
    <div ref={box} style={{ display: 'inline-flex', alignItems: 'stretch', fontFamily: L_MONO }}>
      <button
        type="button"
        aria-expanded={open != null}
        aria-haspopup="true"
        aria-label={`Payoff order: ${p.name}, ${p.tag.toLowerCase()}. Change it`}
        onClick={toggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: 3,
          paddingRight: 8,
          background: L_T.paper,
          border: `1px solid ${L_T.ink}`,
          borderRight: 'none',
          cursor: 'pointer',
          font: 'inherit',
          color: L_T.ink,
          opacity: pending ? 0.6 : 1,
        }}
      >
        <PersonaMedallion strategy={current} size={34} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          {/* Says what the switch is: "Avalanche" alone told no one it
              sets the order debts are paid off in. */}
          <small style={{ fontSize: 9, letterSpacing: '0.12em', color: L_T.muted }}>PAYOFF ORDER</small>
          <b style={{ fontSize: 11, letterSpacing: '0.08em' }}>{p.name.toUpperCase()}</b>
          <small style={{ fontSize: 9, letterSpacing: '0.1em', color: L_T.muted }}>{p.tag}</small>
        </span>
      </button>
      <span
        role="group"
        aria-label="Switch strategy"
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 2,
          padding: '0 4px',
          background: L_T.paper,
          border: `1px solid ${L_T.ink}`,
          borderLeft: `1px solid ${L_T.ruleSoft}`,
        }}
      >
        {STRATEGIES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === current}
            aria-label={`Switch to ${PERSONA[s].name}`}
            title={PERSONA[s].name}
            onClick={() => pick(s)}
            style={{ minWidth: 24, minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0 }}
          >
            <span style={{ display: 'block', width: 14, height: 4, background: s === current ? L_T.accent : L_T.ruleSoft }} />
          </button>
        ))}
      </span>

      <div role="status" aria-live="polite">
        {note && sameOrder && !open && (
          <span
            style={{
              position: 'fixed',
              top: note.top,
              left: note.left,
              zIndex: 30,
              width: note.width,
              padding: '8px 10px',
              fontSize: 12,
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
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Payoff strategy"
          style={{
            position: 'fixed',
            top: open.top,
            left: open.left,
            zIndex: 30,
            width: open.width,
            background: L_T.bg,
            border: `1.5px solid ${L_T.ink}`,
            boxShadow: `4px 4px 0 ${L_T.ink}`,
          }}
        >
          <div style={{ padding: '8px 12px', fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, borderBottom: `1px solid ${L_T.ruleSoft}` }}>
            WHICH DEBT GETS THE EXTRA FIRST
          </div>
          {sameOrder && (
            <p style={{ margin: 0, padding: '8px 12px', fontSize: 12, lineHeight: 1.5, color: L_T.ink, background: L_T.highlightSoft, borderBottom: `1px solid ${L_T.ruleSoft}` }}>
              With today&apos;s balances and rates, {orderText(sameOrder)}. Later balances, rate changes and new loans can change the order, date and interest.
            </p>
          )}
          {STRATEGIES.map((s) => {
            const on = s === current;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => pick(s)}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: on ? L_T.highlightSoft : 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${L_T.ruleSoft}`,
                  cursor: 'pointer',
                  font: 'inherit',
                  color: L_T.ink,
                }}
              >
                <PersonaMedallion strategy={s} size={32} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 12, letterSpacing: '0.06em' }}>
                    {PERSONA[s].name.toUpperCase()} · {PERSONA[s].tag}
                    {on && <span style={{ color: L_T.accent }}> · IN USE</span>}
                  </b>
                  <span style={{ display: 'block', fontSize: 11, lineHeight: 1.45, color: L_T.muted }}>{PERSONA[s].rule}</span>
                </span>
              </button>
            );
          })}
          <a href="/profile#strategy" style={{ display: 'block', padding: '8px 12px', fontSize: 10, letterSpacing: '0.14em', color: L_T.accent }}>
            COMPARE THEM WITH YOUR NUMBERS →
          </a>
        </div>
      )}
      {/* A toast: the masthead row has no room for a sentence. */}
      <OfflineStrategyNote
        show={offline}
        style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 40, maxWidth: 420, padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.negative}` }}
      />
    </div>
  );
}

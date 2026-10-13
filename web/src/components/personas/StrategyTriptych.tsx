'use client';

/**
 * The three payoff orders side by side at the bottom of Profile (REDESIGN
 * R6.3): each persona's scene, its rule, and what it comes to on the
 * user's own debts. A card switches to that order, the same as the
 * masthead's medallion.
 */
import { useEffect, useState } from 'react';
import { OfflineStrategyNote, useStrategyRefresh } from '@/components/useStrategyRefresh';
import { STRATEGIES, writeStrategyClient, type StrategyName } from '@/lib/strategy';
import { L_MONO, L_T } from '@/components/ledger/primitives';
import { PERSONA, PersonaScene } from './Persona';

/** One order's numbers, written out by the server. */
export interface StrategyFigures {
  date: string;
  interest: string;
  /** Interest against Avalanche's, signed; '—' on Avalanche itself. */
  vsAvalanche: string;
}

export function StrategyTriptych({
  active,
  figures,
  note,
}: {
  active: StrategyName;
  /** Absent when the orders couldn't be worked out; the cards still switch. */
  figures?: Record<StrategyName, StrategyFigures>;
  note?: string;
}) {
  // R6B-9: offline, the choice is saved and the refresh waits for the connection.
  const { pending, offline, refresh } = useStrategyRefresh();
  const [current, setCurrent] = useState(active);
  useEffect(() => setCurrent(active), [active]);

  function pick(s: StrategyName) {
    if (s === current) return;
    setCurrent(s);
    writeStrategyClient(s);
    refresh();
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, color: L_T.muted, lineHeight: 1.55 }}>
        Every order pays all the minimums. They differ in which debt gets the extra first.
      </p>
      <OfflineStrategyNote show={offline} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          opacity: pending ? 0.6 : 1,
        }}
      >
        {STRATEGIES.map((s) => {
          const on = s === current;
          const p = PERSONA[s];
          const f = figures?.[s];
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => pick(s)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: 0,
                textAlign: 'left',
                background: L_T.paper,
                border: `1px solid ${L_T.ink}`,
                outline: on ? `2px solid ${L_T.accent}` : 'none',
                outlineOffset: -1,
                cursor: on ? 'default' : 'pointer',
                font: 'inherit',
                color: L_T.ink,
              }}
            >
              <span style={{ display: 'block', width: '100%', aspectRatio: '2 / 1', borderBottom: `1px solid ${L_T.ink}` }}>
                <PersonaScene strategy={s} height="100%" />
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  gap: 8,
                  padding: '10px 12px 12px',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: L_MONO }}>
                  <b style={{ fontSize: 12, letterSpacing: '0.08em' }}>{p.name.toUpperCase()}</b>
                  <small style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted }}>{p.tag}</small>
                  <small
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      color: on ? L_T.accent : L_T.muted,
                    }}
                  >
                    {on ? 'IN USE' : 'USE THIS'}
                  </small>
                </span>
                {/* Takes the slack, so the figures line up across the cards. */}
                <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: L_T.inkSoft }}>{p.rule}</span>
                {f && (
                  <span style={{ display: 'grid', fontFamily: L_MONO, fontSize: 12 }}>
                    <Figure label="DEBT-FREE" value={f.date} />
                    <Figure label="INTEREST" value={f.interest} />
                    <Figure label="VS AVALANCHE" value={f.vsAvalanche} />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {note && <p style={{ margin: 0, fontSize: 13, color: L_T.muted, lineHeight: 1.55 }}>{note}</p>}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        padding: '5px 0',
        borderTop: `1px dashed ${L_T.ruleSoft}`,
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

/** Holds the space while the three runs come back. */
export function StrategyCompareLoading() {
  return (
    <p role="status" style={{ margin: 0, minHeight: 280, color: L_T.muted }}>
      Working out each order on your numbers…
    </p>
  );
}

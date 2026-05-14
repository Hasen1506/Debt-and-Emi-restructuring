'use client';

/**
 * Ledger Plan · monthly schedule.
 *
 * Renders the trajectory (avalanche vs minimums) as a dense per-month table
 * in the statement aesthetic. Long horizons (up to 240 months) would blow
 * out page height, so the component has three states:
 *   1. Collapsed — first 12 months only, footer offers expand.
 *   2. Expanded — full schedule inside a fixed-height scroll region with
 *      a sticky table header. Page scroll stays put.
 *   3. CSV export — always available, dumps the whole schedule.
 */

import { useMemo, useState } from 'react';
import { formatINR } from '@/lib/api';
import type { TrajectoryPoint } from '@/lib/mock-data';

const VISIBLE_DEFAULT = 12;
const SCROLL_HEIGHT = 360;

function monthLabel(monthIndex: number, start: Date): string {
  const d = new Date(start.getFullYear(), start.getMonth() + monthIndex, 1);
  return d
    .toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    .toUpperCase()
    .replace(' ', " '");
}

function toCSV(rows: TrajectoryPoint[]): string {
  const header = 'month,date,avalanche_balance,minimums_balance,delta\n';
  const start = new Date();
  const body = rows
    .map((r) => {
      const d = new Date(start.getFullYear(), start.getMonth() + r.month, 1);
      const date = d.toISOString().slice(0, 7);
      const delta = r.minimums - r.avalanche;
      return `${r.month},${date},${Math.round(r.avalanche)},${Math.round(r.minimums)},${Math.round(delta)}`;
    })
    .join('\n');
  return header + body + '\n';
}

function downloadCSV(rows: TrajectoryPoint[]) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finoptima-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LedgerScheduleTable({ data }: { data: TrajectoryPoint[] }) {
  const [expanded, setExpanded] = useState(false);
  const start = useMemo(() => new Date(), []);

  // Trim trailing rows where both series have cleared — no signal past that.
  const rows = useMemo(() => {
    let lastSignal = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].avalanche > 1 || data[i].minimums > 1) lastSignal = i;
    }
    return data.slice(0, lastSignal + 1);
  }, [data]);

  const total = rows.length;
  const visible = expanded ? rows : rows.slice(0, VISIBLE_DEFAULT);
  const remaining = Math.max(0, total - VISIBLE_DEFAULT);
  const canExpand = remaining > 0;

  return (
    <section>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.18em',
          marginBottom: 6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>
          $ SCHEDULE · {expanded ? `ALL ${total}` : `MONTHS 1-${Math.min(VISIBLE_DEFAULT, total)}`} OF {total}
        </span>
        <span style={{ display: 'inline-flex', gap: 14 }}>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {expanded ? '[COLLAPSE]' : `[EXPAND +${remaining}]`}
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadCSV(rows)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.12em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            [EXPORT CSV]
          </button>
        </span>
      </div>

      <div
        style={{
          border: '1px solid var(--ink)',
          background: 'var(--card)',
          maxHeight: expanded ? SCROLL_HEIGHT : undefined,
          overflowY: expanded ? 'auto' : 'visible',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--ink)',
                background: 'var(--card)',
                position: expanded ? 'sticky' : 'static',
                top: 0,
                zIndex: 1,
              }}
            >
              {['MO', 'DATE', 'AVALANCHE', 'MIN-ONLY', 'Δ AHEAD'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: i > 1 ? 'right' : 'left',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    fontSize: 10,
                    color: 'var(--muted)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const delta = r.minimums - r.avalanche;
              const cleared = r.avalanche <= 1;
              return (
                <tr
                  key={r.month}
                  style={{
                    borderBottom: '1px dashed var(--dash)',
                    opacity: cleared ? 0.65 : 1,
                  }}
                >
                  <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>
                    {String(r.month).padStart(3, '0')}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>
                    {monthLabel(r.month, start)}
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      fontWeight: cleared ? 400 : 600,
                    }}
                  >
                    {cleared ? 'CLEARED' : formatINR(r.avalanche)}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }}>
                    {r.minimums <= 1 ? 'CLEARED' : formatINR(r.minimums)}
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      color: delta > 0 ? 'var(--positive)' : 'var(--muted)',
                      fontWeight: delta > 0 ? 600 : 400,
                    }}
                  >
                    {delta > 0 ? formatINR(delta) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!expanded && canExpand && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.12em',
            marginTop: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          + {remaining} MORE MONTHS · [EXPAND] FOR FULL SCHEDULE
        </div>
      )}
    </section>
  );
}

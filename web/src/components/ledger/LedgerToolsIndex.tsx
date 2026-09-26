'use client';

/**
 * Ledger Tools index — single-table list per prototype §4.8.
 *
 * Columns: § · TOOL · QUESTION · WHAT IT DOES · [OPEN →].
 * Rows have dashed dividers; the §id and [OPEN →] cells are in accent.
 */

import {
  LShell,
  LCli,
  LBracket,
  LRule,
  L_T,
  L_MONO,
} from './primitives';
import type { ToolMeta } from '@/lib/tools';

export function LedgerToolsIndex({ tools }: { tools: ToolMeta[] }) {
  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          fontFamily: L_MONO,
        }}
      >
        <section>
          <LCli>TOOLS · {tools.length} · ONE QUESTION EACH</LCli>
          <LRule length={300} />
        </section>

        <section>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
              fontFamily: L_MONO,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${L_T.ink}` }}>
                {['§', 'TOOL', 'QUESTION', 'WHAT IT DOES', ''].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontWeight: 700,
                      fontSize: 9,
                      color: L_T.muted,
                      letterSpacing: '0.1em',
                    }}
                  >
                    {h || <span className="sr-only">Open</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td
                    style={{
                      padding: '14px 10px',
                      color: L_T.accent,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                    }}
                  >
                    §{t.tag}
                  </td>
                  <td style={{ padding: '14px 10px', fontWeight: 700 }}>
                    {t.name.toUpperCase()}
                  </td>
                  <td style={{ padding: '14px 10px' }}>{t.question}</td>
                  <td style={{ padding: '14px 10px', color: L_T.muted, fontSize: 11 }}>
                    {t.sub}
                  </td>
                  <td style={{ padding: '14px 10px', textAlign: 'right' }}>
                    <LBracket accent href={t.href}>
                      OPEN →
                    </LBracket>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </LShell>
  );
}

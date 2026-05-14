/**
 * Ledger Insights — system log of events that touched the plan.
 *
 * Tabular log (DATE / KIND / SUBJECT / IMPACT) with monospace dates and
 * coloured impact column. Newest first. Below it: a CALENDAR table of
 * upcoming events with dates left-aligned, deltas right-aligned.
 */

interface LogRow {
  date: string;
  kind: 'RATE' | 'EDU' | 'MILESTONE' | 'POLICY';
  subject: string;
  impact: string;
  delta: string;
  tone: string;
}

const LOG: LogRow[] = [
  {
    date: '2026-04-07',
    kind: 'RATE',
    subject: 'RBI HELD REPO @ 5.25%',
    impact: 'FLOAT RATE UNCHANGED',
    delta: '±0 bps',
    tone: 'var(--ink)',
  },
  {
    date: '2026-04-02',
    kind: 'MILESTONE',
    subject: 'HDFC HOME · PRINCIPAL CROSSOVER',
    impact: 'PRINCIPAL > REMAINING',
    delta: '+0%',
    tone: 'var(--positive)',
  },
  {
    date: '2026-03-28',
    kind: 'EDU',
    subject: '"NO-COST EMI" EXPLAINED',
    impact: 'REAL APR 14-18%',
    delta: 'INFO',
    tone: 'var(--muted)',
  },
  {
    date: '2026-03-14',
    kind: 'EDU',
    subject: 'EFFECTIVE VS NOMINAL RATE',
    impact: 'CARD GAP +6.48 pp',
    delta: 'INFO',
    tone: 'var(--muted)',
  },
  {
    date: '2026-02-28',
    kind: 'POLICY',
    subject: 'GST ON CARD INTEREST · 18%',
    impact: 'EFFECTIVE APR +6.48 pp',
    delta: '+648 bps',
    tone: 'var(--negative)',
  },
];

const CALENDAR = [
  { when: '2026-05-15', what: 'ICICI · STATEMENT CLOSE', delta: 'PAY ₹18,500' },
  { when: '2026-06-01', what: 'SAL CREDIT · ALLOC TO ICICI', delta: '+₹18,500' },
  { when: '2026-07-01', what: 'HDFC · RATE RESET WINDOW', delta: '−45 bps?' },
  { when: '2026-08-15', what: 'QUARTERLY · /plan RECOMPUTE', delta: 'CHECK' },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.18em',
        marginBottom: 6,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </div>
  );
}

export function LedgerInsights() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <section>
        <SectionLabel>$ INSIGHTS · EVENT LOG · {LOG.length} ENTRIES</SectionLabel>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr
              style={{
                borderTop: '2px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
              }}
            >
              {['DATE', 'KIND', 'SUBJECT', 'IMPACT', 'Δ'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: i > 2 ? 'left' : 'left',
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
            {LOG.map((r) => (
              <tr
                key={r.date}
                style={{ borderBottom: '1px dashed var(--dash)' }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                  {r.date}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    fontWeight: 700,
                    color: 'var(--ink)',
                  }}
                >
                  [{r.kind}]
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                  {r.subject}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                  {r.impact}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: r.tone,
                    fontWeight: 700,
                  }}
                >
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <SectionLabel>$ CALENDAR · UPCOMING</SectionLabel>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr
              style={{
                borderTop: '2px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
              }}
            >
              {['DATE', 'EVENT', 'EXPECTED'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: i === 2 ? 'right' : 'left',
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
            {CALENDAR.map((c) => (
              <tr
                key={c.when}
                style={{ borderBottom: '1px dashed var(--dash)' }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                  {c.when}
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                  {c.what}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                  }}
                >
                  {c.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <SectionLabel>$ READING · CONTEXT</SectionLabel>
        <div
          style={{
            border: '1px solid var(--ink)',
            padding: '14px 16px',
            background: 'var(--card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div>
            <span style={{ fontWeight: 700 }}>NOTE</span>{' '}
            <span style={{ color: 'var(--muted)' }}>
              · Insights do not change the plan automatically. The engine
              recomputes only on /plan, /tools/recompute, or after an
              onboarding edit.
            </span>
          </div>
          <div>
            <span style={{ fontWeight: 700 }}>FILE</span>{' '}
            <span style={{ color: 'var(--muted)' }}>
              · /var/log/finoptima/insights · last rotation 01 APR 2026
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

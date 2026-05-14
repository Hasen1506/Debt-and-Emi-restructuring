/**
 * Ledger Home — bank-statement dashboard.
 *
 * Five-column KPI grid with hard black grout (1px gutters revealing the
 * ink colour underneath), then a tabular debts list with monospace
 * columns, dashed row separators, and a TOTAL footer. Mirrors DHome from
 * direction-d.jsx.
 */

const KPIS = [
  { l: 'OUTSTANDING', v: '₹41,80,000', s: '−₹2,40,000 MTD', tone: 'var(--ink)' },
  { l: 'DEBT-FREE', v: 'AUG 2027', s: '17 MO · −14 VS MIN', tone: 'var(--positive)' },
  { l: 'EFFECTIVE APR', v: '11.94%', s: 'WEIGHTED', tone: 'var(--ink)' },
  { l: 'SURPLUS', v: '₹1,05,000/MO', s: 'NET ALLOC', tone: 'var(--positive)' },
  { l: 'NEXT ACTION', v: 'PAY ₹18,500', s: '→ ICICI · DUE 1 JUN', tone: 'var(--accent)' },
] as const;

const POSITIONS = [
  { p: '01', l: 'ICICI', t: 'CARD', r: '36.00%', e: '42.48%', o: '₹1,00,000', emi: '—', tn: '—', nx: 'PAY ₹18,500', tone: 'var(--negative)', hl: true },
  { p: '02', l: 'SBI', t: 'PERS LOAN', r: '13.00%', e: '13.00%', o: '₹80,000', emi: '₹2,400', tn: '36 mo', nx: 'AUTO', tone: 'var(--ink)', hl: false },
  { p: '03', l: 'HDFC', t: 'HOME · FLT', r: '8.50%', e: '8.50%', o: '₹40,00,000', emi: '₹35,200', tn: '240 mo', nx: 'AUTO · RESET 47d', tone: 'var(--ink)', hl: false },
] as const;

const TOOLS = [
  { token: 'WINDFALL', sub: 'BONUS / REFUND / GIFT', href: '/tools/windfall' },
  { token: 'RECOMPUTE', sub: 'PAID EXTRA → REPRICE', href: '/tools/recompute' },
  { token: 'NEW-DEBT', sub: 'PRE-BORROW CHECK', href: '/tools/new-debt' },
  { token: 'LIQUIDATE', sub: 'SELL ASSET → CLEAR DEBT', href: '/tools/liquidate' },
  { token: 'CASH-YIELD', sub: 'IDLE CASH AUDIT', href: '/tools/cash-yield' },
  { token: 'RIGHT-TIME', sub: 'BORROW NOW Y/N', href: '/tools/right-time' },
  { token: 'NRI-PREPAY', sub: 'FX-ADJUSTED DECISION', href: '/tools/nri-prepay' },
] as const;

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

export function LedgerHome() {
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
        <SectionLabel>$ STATUS</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {KPIS.map((m) => (
            <div
              key={m.l}
              style={{ background: 'var(--canvas)', padding: '10px 12px' }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  letterSpacing: '0.12em',
                  marginBottom: 4,
                }}
              >
                {m.l}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: m.tone,
                  letterSpacing: '-0.01em',
                }}
              >
                {m.v}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                {m.s}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
          }}
        >
          <span>$ OPEN POSITIONS · {POSITIONS.length}</span>
          <a
            href="/debts"
            style={{ color: 'var(--ink)', textDecoration: 'none' }}
          >
            [+] ADD DEBT
          </a>
        </div>
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
              {['#', 'LENDER', 'TYPE', 'RATE', 'EFFECTIVE', 'OUTSTANDING', 'EMI', 'TENURE', 'NEXT'].map(
                (h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: i > 2 ? 'right' : 'left',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      fontSize: 10,
                      color: 'var(--muted)',
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {POSITIONS.map((r) => (
              <tr
                key={r.p}
                style={{
                  borderBottom: '1px dashed var(--dash)',
                  background: r.hl ? '#fff3a3' : 'transparent',
                }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{r.p}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.l}</td>
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{r.t}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.r}</td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: r.tone,
                    fontWeight: r.hl ? 700 : 400,
                  }}
                >
                  {r.e}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                  {r.o}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.emi}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--muted)' }}>
                  {r.tn}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: r.tone,
                    fontWeight: r.hl ? 700 : 400,
                  }}
                >
                  {r.nx}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--ink)' }}>
              <td colSpan={5} style={{ padding: '10px 12px', fontWeight: 700 }}>
                TOTAL
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                ₹41,80,000
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                ₹37,600/mo
              </td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <SectionLabel>$ DECISION · MAY 2026</SectionLabel>
        <div
          style={{
            border: '1px solid var(--ink)',
            padding: '14px 16px',
            background: 'var(--card)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              letterSpacing: '0.12em',
              marginBottom: 6,
            }}
          >
            ALLOCATE SURPLUS →
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            PAY ₹18,500 TO ICICI / CARD-1138
          </div>
          <div
            style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}
          >
            CLEARS BALANCE BY 02 JUN · SAVES ₹31,400 · UNLOCKS AVALANCHE STEP 02
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>$ TOOLS</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {TOOLS.map((t) => (
            <a
              key={t.token}
              href={t.href}
              style={{
                background: 'var(--canvas)',
                padding: '10px 12px',
                textDecoration: 'none',
                color: 'var(--ink)',
                display: 'block',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>[{t.token}]</div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  marginTop: 4,
                  letterSpacing: '0.06em',
                }}
              >
                {t.sub}
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Ledger Debts — open positions in a single dense table.
 *
 * Two sections: header KPI strip (TOTAL / BLENDED APR / EMI BURDEN) and a
 * tabular DEBTS table mirroring the OPEN POSITIONS table on Ledger Home
 * but extended (resets, next payment, last payment, account number stub).
 */

const POSITIONS = [
  {
    p: '01',
    lender: 'ICICI',
    kind: 'CARD',
    acct: '**** 1138',
    rate: '36.00%',
    eff: '42.48%',
    bal: '₹1,00,000',
    emi: '—',
    tenure: '—',
    nextEvt: 'PAY ₹18,500 · 01 JUN',
    lastEvt: 'PAID ₹4,500 · 02 MAY',
    tone: 'var(--negative)',
    hl: true,
  },
  {
    p: '02',
    lender: 'SBI',
    kind: 'PERS LOAN',
    acct: 'PL-049283',
    rate: '13.00%',
    eff: '13.00%',
    bal: '₹80,000',
    emi: '₹2,400',
    tenure: '36 mo',
    nextEvt: 'AUTO · 28 MAY',
    lastEvt: 'PAID ₹2,400 · 28 APR',
    tone: 'var(--ink)',
    hl: false,
  },
  {
    p: '03',
    lender: 'HDFC',
    kind: 'HOME · FLT',
    acct: 'HL-2018-3344',
    rate: '8.50%',
    eff: '8.50%',
    bal: '₹40,00,000',
    emi: '₹35,200',
    tenure: '240 mo',
    nextEvt: 'AUTO · RESET 47d',
    lastEvt: 'PAID ₹35,200 · 02 MAY',
    tone: 'var(--ink)',
    hl: false,
  },
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

export function LedgerDebts() {
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
        <SectionLabel>$ DEBTS · {POSITIONS.length} OPEN</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {[
            { l: 'TOTAL OUTSTANDING', v: '₹41,80,000', s: '+0.2% vs APR' },
            { l: 'BLENDED EFFECTIVE APR', v: '11.94%', s: 'WEIGHTED BY BALANCE' },
            { l: 'EMI BURDEN', v: '₹37,600/MO', s: '23% OF GROSS INCOME' },
          ].map((m) => (
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
              <div style={{ fontSize: 18, fontWeight: 700 }}>{m.v}</div>
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
          <span>$ POSITIONS · DETAIL</span>
          <a
            href="/onboarding"
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
              {['#', 'LENDER', 'KIND', 'ACCOUNT', 'RATE', 'EFFECTIVE', 'OUTSTANDING', 'EMI', 'TENURE'].map(
                (h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: i > 3 ? 'right' : 'left',
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
                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.lender}</td>
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{r.kind}</td>
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{r.acct}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.rate}</td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: r.tone,
                    fontWeight: r.hl ? 700 : 400,
                  }}
                >
                  {r.eff}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                  {r.bal}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.emi}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--muted)' }}>
                  {r.tenure}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--ink)' }}>
              <td colSpan={6} style={{ padding: '10px 12px', fontWeight: 700 }}>
                TOTAL
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                ₹41,80,000
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                ₹37,600/mo
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <SectionLabel>$ ACTIVITY · LAST 30D</SectionLabel>
        <div
          style={{
            border: '1px solid var(--ink)',
            padding: '12px 16px',
            background: 'var(--card)',
          }}
        >
          {POSITIONS.map((r, i) => (
            <div
              key={r.p}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 1fr 1fr',
                gap: 12,
                padding: '8px 0',
                borderBottom:
                  i === POSITIONS.length - 1 ? 'none' : '1px dashed var(--dash)',
              }}
            >
              <div style={{ color: 'var(--muted)' }}>{r.p}</div>
              <div style={{ fontWeight: 700 }}>{r.lender}</div>
              <div style={{ color: 'var(--muted)' }}>← {r.lastEvt}</div>
              <div
                style={{
                  textAlign: 'right',
                  color: r.hl ? 'var(--accent)' : 'var(--ink)',
                  fontWeight: r.hl ? 700 : 400,
                }}
              >
                → {r.nextEvt}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Editorial Debts — "The Register".
 *
 * Reads as the inventory page of the same letter: each debt gets a short
 * serif paragraph with its name, the engine-blessed effective rate, and a
 * single line of consequence. Marginalia on the right surfaces the
 * "loudest" debt for context.
 */

const DEBTS = [
  {
    name: 'HDFC Home Loan',
    tag: 'Mortgage · floating',
    nominal: '8.50%',
    effective: '8.50%',
    balance: '₹40,00,000',
    tenure: '240 months remaining',
    note: 'Cheap money. Let it run; resets every six months on the repo rate.',
    accent: false,
  },
  {
    name: 'ICICI Credit Card',
    tag: 'Revolving · the loudest',
    nominal: '36.00%',
    effective: '42.48%',
    balance: '₹1,00,000',
    tenure: 'no fixed end',
    note: 'GST on interest pushes this past 42% effective. Clear it before anything else, or — better — transfer to HDFC at 16% for 9 months.',
    accent: true,
  },
  {
    name: 'SBI Personal Loan',
    tag: 'Term · fixed rate',
    nominal: '13.00%',
    effective: '13.00%',
    balance: '₹80,000',
    tenure: '36 months remaining',
    note: 'Steady. The avalanche reaches this one once the card is clear, then it goes quickly.',
    accent: false,
  },
] as const;

export function EditorialDebts() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 240px',
        gap: 48,
        paddingTop: 16,
      }}
    >
      <article style={{ maxWidth: 720 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--soft)',
            marginBottom: 12,
          }}
        >
          The register · three open accounts
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 44,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          What you owe,
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            and to whom.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 620,
          }}
        >
          A line item is more honest than a stack of cards. Total outstanding{' '}
          <strong>₹41,80,000</strong> — most of it a house, a sliver of which
          is on fire.
        </p>

        <div
          style={{
            marginTop: 36,
            paddingTop: 24,
            borderTop: '1px solid var(--border)',
          }}
        >
          {DEBTS.map((d, i) => (
            <div
              key={d.name}
              style={{
                paddingBottom: 24,
                marginBottom: 24,
                borderBottom:
                  i === DEBTS.length - 1
                    ? 'none'
                    : '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 18,
                  alignItems: 'baseline',
                  marginBottom: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 22,
                      fontWeight: 500,
                      color: d.accent ? 'var(--accent)' : 'var(--ink)',
                    }}
                  >
                    {d.name}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 11,
                      color: 'var(--soft)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginTop: 4,
                    }}
                  >
                    {d.tag} · {d.tenure}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    fontWeight: 500,
                    textAlign: 'right',
                  }}
                >
                  {d.balance}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 24,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginBottom: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  Nominal{' '}
                  <span
                    className="num"
                    style={{ color: 'var(--ink)', marginLeft: 4 }}
                  >
                    {d.nominal}
                  </span>
                </span>
                <span>
                  Effective{' '}
                  <span
                    className="num"
                    style={{
                      color: d.accent ? 'var(--accent)' : 'var(--ink)',
                      marginLeft: 4,
                      fontWeight: d.accent ? 600 : 400,
                    }}
                  >
                    {d.effective}
                  </span>
                </span>
              </div>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: 'var(--ink)',
                  fontStyle: 'italic',
                }}
              >
                {d.note}
              </p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <a
            href="/onboarding"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--accent)',
              borderBottom: '1px solid var(--accent)',
              paddingBottom: 2,
              textDecoration: 'none',
            }}
          >
            Add a debt to the register →
          </a>
        </div>
      </article>

      <aside
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          color: 'var(--soft)',
          lineHeight: 1.6,
          paddingTop: 36,
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            marginBottom: 14,
            fontSize: 10,
          }}
        >
          Tally
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--ink)',
              lineHeight: 1.1,
            }}
          >
            ₹41,80,000
          </div>
          <div style={{ marginTop: 4 }}>total outstanding</div>
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--ink)',
              lineHeight: 1.1,
            }}
          >
            11.94%
          </div>
          <div style={{ marginTop: 4 }}>
            blended effective rate, weighted by balance
          </div>
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--accent)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              color: 'var(--accent)',
              fontStyle: 'italic',
              marginBottom: 6,
            }}
          >
            The loudest line
          </div>
          <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
            The ICICI card sits at 2% of the balance but generates a
            disproportionate share of the interest. That's the one to chase.
          </div>
        </div>
      </aside>
    </div>
  );
}

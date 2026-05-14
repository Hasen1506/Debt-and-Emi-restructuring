/**
 * Editorial Insights — "The Archive".
 *
 * Reads as the back-page section of the same publication. Each insight is
 * a dated dispatch — rate-change letters, educational pieces, calendar
 * cross-references. Newest first, with hairline rules between.
 */

interface Dispatch {
  date: string;
  kind: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
}

const DISPATCHES: Dispatch[] = [
  {
    date: '07 April 2026',
    kind: 'From the central bank',
    title: 'RBI held repo at 5.25%',
    body: 'Your floating home loan was last reset on 1 January 2026 at 8.5%, six months before the next reset. No change is expected — the spread to repo is unchanged and the lender has nothing to recover. Read this as a quiet quarter; allocate the surplus to the card without flinching.',
    cta: { label: 'See how it flows through your plan', href: '/plan' },
  },
  {
    date: '02 April 2026',
    kind: 'A milestone',
    title: 'Your home loan crossed the halfway mark',
    body: 'Principal paid since 2018 now exceeds the principal remaining. Mathematically uninteresting, emotionally significant. From here, every EMI sends more rupees to principal than to interest — the curve finally bends in your favour.',
  },
  {
    date: '28 March 2026',
    kind: 'A note on language',
    title: 'Why "no-cost EMI" rarely is',
    body: 'The retailer bakes the cost into either a foregone discount or a processing fee. The real APR is usually 14 to 18 percent. If you must split a purchase, prefer the upfront discount and pay the card down faster — the math almost always favours that path.',
  },
  {
    date: '14 March 2026',
    kind: 'Educational',
    title: 'Effective rate, not nominal',
    body: 'Banks quote in nominal. The engine quotes in effective. The gap is widest on credit cards (36% nominal becomes 42.48% effective once GST joins) and narrowest on home loans, where the two roughly match. Always read the effective number when comparing.',
    cta: { label: 'Tools for those comparisons', href: '/tools' },
  },
];

export function EditorialInsights() {
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
          The archive · dispatches, in order
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
          What we've noticed,
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            and what to make of it.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 580,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          Rate notes, milestones, and small lessons. None of these change
          your plan on their own — they're context for the decisions you're
          already making.
        </p>

        <div
          style={{
            marginTop: 40,
            paddingTop: 24,
            borderTop: '1px solid var(--border)',
          }}
        >
          {DISPATCHES.map((d, i) => (
            <div
              key={d.date}
              style={{
                paddingBottom: 28,
                marginBottom: 28,
                borderBottom:
                  i === DISPATCHES.length - 1
                    ? 'none'
                    : '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 18,
                  marginBottom: 10,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  color: 'var(--soft)',
                }}
              >
                <span>{d.kind}</span>
                <span>{d.date}</span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 26,
                  fontWeight: 500,
                  lineHeight: 1.15,
                  letterSpacing: '-0.01em',
                  marginBottom: 12,
                }}
              >
                {d.title}
              </div>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 16,
                  lineHeight: 1.65,
                }}
              >
                {d.body}
              </p>
              {d.cta && (
                <div style={{ marginTop: 14 }}>
                  <a
                    href={d.cta.href}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13,
                      color: 'var(--accent)',
                      borderBottom: '1px solid var(--accent)',
                      paddingBottom: 2,
                      textDecoration: 'none',
                    }}
                  >
                    {d.cta.label} →
                  </a>
                </div>
              )}
            </div>
          ))}
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
          On the calendar
        </div>
        {[
          { when: '15 May', what: 'ICICI card statement closes — pay before this date.' },
          { when: '01 Jun', what: 'Salary credit — first ₹18,500 of surplus goes to the card.' },
          { when: '01 Jul', what: 'HDFC home-loan reset window opens.' },
          { when: '15 Aug', what: 'Quarterly check-in — re-run /plan with updated income.' },
        ].map((c) => (
          <div
            key={c.when}
            style={{
              marginBottom: 18,
              borderLeft: '2px solid var(--border)',
              paddingLeft: 12,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: 'var(--ink)',
                marginBottom: 4,
                fontSize: 10,
                letterSpacing: '0.05em',
              }}
            >
              {c.when}
            </div>
            <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
              {c.what}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

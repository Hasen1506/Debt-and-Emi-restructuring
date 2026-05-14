'use client';

/**
 * Editorial Home — "The Letter".
 *
 * Frames the home screen as a weekly letter from the advisor. Big serif
 * headline, prose paragraphs explaining the move and why, three numbers
 * pulled out, three underlined actions, marginalia on the right with
 * "also worth knowing" notes. Mirrors direction-a.jsx from the handoff.
 */

import { useState } from 'react';

const MARGINALIA = [
  { date: 'Apr 7', txt: 'RBI held repo at 5.25%. Your floating home loan is unaffected at its next reset.' },
  { date: 'Apr 2', txt: 'Your HDFC home loan crossed the halfway mark — principal paid since 2018 now exceeds remaining.' },
  { date: 'Mar 28', txt: '"No-cost EMI" rarely is. The real APR is usually 14–18%.' },
] as const;

const MAIN_ACTIONS = [
  { label: 'Show me the math', href: '/plan' },
  { label: 'What if I disagree?', href: '/tools/windfall' },
  { label: 'See alternatives', href: '/debts' },
] as const;

const MORE_ACTIONS = [
  { label: 'A bonus arrived', href: '/tools/windfall' },
  { label: 'I paid extra this month', href: '/tools/recompute' },
  { label: 'I want to borrow more', href: '/tools/new-debt' },
  { label: 'I want to sell an asset', href: '/tools/liquidate' },
  { label: 'Cash sitting idle', href: '/tools/cash-yield' },
  { label: 'Is it the right time?', href: '/tools/right-time' },
  { label: 'NRI prepay vs invest', href: '/tools/nri-prepay' },
] as const;

export function EditorialHome() {
  const [showMore, setShowMore] = useState(false);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 240px',
        gap: 48,
        paddingTop: 16,
      }}
    >
      <article style={{ maxWidth: 640 }}>
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
          This week's letter
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 56,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Hasen — pay the card,
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            then breathe.
          </em>
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            lineHeight: 1.65,
            marginTop: 28,
          }}
        >
          Your ICICI card is the loudest debt you own. Nominal 36% becomes
          <strong> 42.48% </strong> once GST is folded in, and at a balance of
          ₹1 lakh it adds about <strong>₹3,540 every month</strong> in pure
          friction. Until it's clear, every other move loses to this one.
        </p>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            lineHeight: 1.65,
            marginTop: 12,
          }}
        >
          So the move this month is simple: send <strong>₹18,500</strong> to
          the card on the next salary credit. You'll save roughly
          <strong style={{ color: 'var(--positive)' }}> ₹31,400 </strong>
          in interest over the next year if you stay the course.
        </p>

        <div
          style={{
            marginTop: 36,
            padding: '20px 0',
            borderTop: '1px solid var(--border)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 10,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--soft)',
              marginBottom: 14,
            }}
          >
            The decision, in numbers
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 24,
            }}
          >
            {[
              { v: '₹18,500', l: 'pay this month', c: 'var(--ink)' },
              { v: '₹31,400', l: 'saved over 12 months', c: 'var(--positive)' },
              { v: 'Aug 2027', l: 'debt-free, at this pace', c: 'var(--ink)' },
            ].map((s) => (
              <div key={s.l}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 28,
                    fontWeight: 500,
                    color: s.c,
                    lineHeight: 1,
                  }}
                >
                  {s.v}
                </div>
                <div
                  className="muted"
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    marginTop: 8,
                    letterSpacing: '0.04em',
                  }}
                >
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            lineHeight: 1.6,
            marginTop: 28,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          If a bonus, refund, or windfall arrives this month, write back —
          we'll decide together where it should go.
        </p>

        <div
          style={{
            marginTop: 32,
            display: 'flex',
            gap: 18,
            flexWrap: 'wrap',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
          }}
        >
          {MAIN_ACTIONS.map((a, i) => (
            <a
              key={a.href}
              href={a.href}
              style={{
                color: i === 0 ? 'var(--accent)' : 'var(--muted)',
                borderBottom: `1px solid ${
                  i === 0 ? 'var(--accent)' : 'var(--muted)'
                }`,
                paddingBottom: 2,
                textDecoration: 'none',
              }}
            >
              {a.label} {i === 0 ? '→' : ''}
            </a>
          ))}
        </div>

        <div style={{ marginTop: 28 }}>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {showMore ? '— less' : 'Other situations · write back'}
          </button>
          {showMore && (
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                fontStyle: 'italic',
              }}
            >
              {MORE_ACTIONS.map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  style={{
                    color: 'var(--ink)',
                    textDecoration: 'none',
                    borderBottom: '1px dotted var(--border)',
                    paddingBottom: 4,
                  }}
                >
                  {a.label} →
                </a>
              ))}
            </div>
          )}
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
          Also worth knowing
        </div>
        {MARGINALIA.map((n) => (
          <div
            key={n.date}
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
              {n.date}
            </div>
            <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
              {n.txt}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

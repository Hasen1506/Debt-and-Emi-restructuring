/**
 * Bracket-transition alerts on /plan.
 *
 * Shown when the user has provided gross income AND their hike trajectory
 * causes a slab transition within the simulation horizon. One row per
 * transition (most plans see 0-3 transitions over 20 years).
 *
 * The point is to warn users that real take-home growth slows when they
 * cross a slab — a 10% hike that moves you from 20% to 30% bracket is
 * effectively a 7% post-tax raise on that incremental income.
 *
 * Renders nothing when:
 *   • no transitions (user already at top slab, no gross income provided,
 *     hike rate is 0, etc.) — caller doesn't need to gate.
 *
 * Three layout variants mirror the Plan themes (ledger / inline / aside).
 */
import { formatCurrency, type Country } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';
import type { BracketTransition } from '@/lib/bracket-transitions';
import { describeBracket } from '@/lib/tax-brackets';

export function BracketTransitionAlert({
  transitions,
  country,
  displayCurrency,
  variant,
}: {
  transitions: BracketTransition[];
  country: Country;
  displayCurrency: CurrencyCode;
  variant: 'ledger' | 'inline' | 'aside';
}) {
  if (transitions.length === 0) return null;

  const lines = transitions.map((t) => ({
    year: t.year,
    from: describeBracket(t.from, country),
    to: describeBracket(t.to, country),
    income: formatCurrency(t.incomeAtTransition.toFixed(0), displayCurrency),
    fromPct: (t.from.marginalRate * 100).toFixed(0),
    toPct: (t.to.marginalRate * 100).toFixed(0),
  }));

  const caveat =
    'Bracket transitions slow your real take-home growth — a hike that crosses a slab effectively gives you less post-tax raise on the incremental income.';

  if (variant === 'ledger') {
    return (
      <section style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          $ BRACKET · TRANSITIONS DURING HORIZON
        </div>
        <div
          style={{
            border: '1px dashed var(--warning, #c97800)',
            padding: '10px 12px',
            background: 'var(--card)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              → Year {l.year}: <strong>{l.fromPct}% → {l.toPct}%</strong> ·
              income ≈ {l.income}
            </div>
          ))}
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11 }}>
            {caveat}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        style={{
          background: 'var(--card)',
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--warning, #c97800)',
          fontSize: 13,
          lineHeight: 1.55,
          marginTop: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Tax bracket transitions on your hike trajectory
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12,
          }}
        >
          {lines.map((l, i) => (
            <li
              key={i}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <span>
                <strong>Year {l.year}</strong> — {l.fromPct}% → {l.toPct}% bracket
              </span>
              <span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                {l.income}
              </span>
            </li>
          ))}
        </ul>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          {caveat}
        </div>
      </div>
    );
  }

  // aside (editorial)
  return (
    <div
      style={{
        marginTop: 28,
        paddingTop: 20,
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-display)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft)',
          marginBottom: 10,
        }}
      >
        Tax bracket transitions
      </div>
      <div style={{ fontSize: 14, fontFamily: 'var(--font-sans)', lineHeight: 1.7 }}>
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              paddingBottom: 6,
            }}
          >
            <span>
              <strong>Year {l.year}</strong> — {l.fromPct}% → {l.toPct}% slab
            </span>
            <span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              {l.income}
            </span>
          </div>
        ))}
        <p
          style={{
            marginTop: 12,
            fontStyle: 'italic',
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {caveat}
        </p>
      </div>
    </div>
  );
}

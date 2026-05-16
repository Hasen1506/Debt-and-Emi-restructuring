'use client';

/**
 * Editorial Home — "The Letter".
 *
 * Weekly-letter framing built dynamically from the user's saved profile.
 * Headline + opening paragraph adapt to the loan profile:
 *   • Loud card (eff > 30%)  →  "Pay the card, then breathe."
 *   • Other loud line        →  "Knock out the [bank] line."
 *   • Only mortgage          →  "Let the mortgage run."
 *   • No loans               →  "Nothing to chase right now."
 *
 * Three-stat block uses honest numbers (surplus, loudest effective APR,
 * spread vs nominal) — no fabricated "saved over 12 months" or
 * "debt-free by..." which would need simulation we don't run here.
 *
 * Marginalia mixes a derived insight (tax-shield / cheapest-line note) with
 * two evergreen principles.
 */

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanType } from '@/lib/api';
import { formatINR } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { buildHeadline, buildMarginalia } from '@/lib/letter';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'auto loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL line',
};

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

const D24 = new Decimal('0.24');

export function EditorialHome({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const [showMore, setShowMore] = useState(false);
  const headline = buildHeadline(m.loudest);
  const marginalia = useMemo(
    () => buildMarginalia(m.loans, m.blendedEffective, profile.user),
    [m.loans, m.blendedEffective, profile.user],
  );

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
          {headline.prefix}
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            {headline.accent}
          </em>
        </h1>

        {m.loans.length === 0 ? (
          <EmptyLetter />
        ) : (
          <BodyLetter metrics={m} />
        )}

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
        {marginalia.map((n, i) => (
          <div
            key={`${n.date}-${i}`}
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

function EmptyLetter() {
  return (
    <p
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        lineHeight: 1.65,
        marginTop: 28,
      }}
    >
      You haven't added any debts yet. Once you{' '}
      <a
        href="/onboarding"
        style={{ color: 'var(--accent)', borderBottom: '1px solid var(--accent)' }}
      >
        walk through setup
      </a>
      , the letter starts writing itself — with your actual rates, your actual
      balances, and the move that gets you to debt-free fastest.
    </p>
  );
}

function BodyLetter({ metrics }: { metrics: ReturnType<typeof deriveMetrics> }) {
  const loudest = metrics.loudest!;
  const spread = loudest.effective.sub(loudest.nominal);
  const bigSpread = spread.gt(new Decimal('0.03'));
  const surplusPositive = metrics.surplus.gt(0);
  const loudestIsCard = loudest.loan.loan_type === 'credit_card';
  const loudestKind = LOAN_TYPE_LABEL[loudest.loan.loan_type];
  const lender = loudest.loan.bank || 'your highest-rate lender';

  return (
    <>
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          lineHeight: 1.65,
          marginTop: 28,
        }}
      >
        {bigSpread ? (
          <>
            Your <strong>{lender}</strong> {loudestKind} is the loudest debt you
            own. Nominal {fmt(loudest.nominal)} becomes{' '}
            <strong>{fmt(loudest.effective)}</strong>{' '}
            {loudestIsCard ? 'once GST is folded in' : 'once fees + GST are folded in'}
            , and at a balance of <strong>{formatINR(loudest.outstanding)}</strong>{' '}
            that's the line generating the most friction. Until it's closer to
            clear, every other move loses to this one.
          </>
        ) : (
          <>
            Your <strong>{lender}</strong> {loudestKind} is currently your
            highest-effective line at <strong>{fmt(loudest.effective)}</strong>.
            With a balance of <strong>{formatINR(loudest.outstanding)}</strong>,
            it's the one to chase first — but the spread vs nominal is modest,
            so there's no fire.
          </>
        )}
      </p>

      {surplusPositive ? (
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            lineHeight: 1.65,
            marginTop: 12,
          }}
        >
          So the move this month: route the{' '}
          <strong>{formatINR(metrics.surplus)}</strong>{' '}
          <abbr title="Surplus = income − fixed expenses − scheduled EMIs. The cash left over each month to deploy against debt above the minimums.">
            surplus
          </abbr>{' '}
          toward this line on the next salary credit. The{' '}
          <a
            href="/plan"
            style={{ color: 'var(--accent)', borderBottom: '1px solid var(--accent)' }}
          >
            full schedule
          </a>{' '}
          shows how much interest that saves over the run.
        </p>
      ) : (
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            lineHeight: 1.65,
            marginTop: 12,
          }}
        >
          But the{' '}
          <abbr title="Surplus = income − fixed expenses − scheduled EMIs. The cash left over each month to deploy against debt above the minimums.">
            surplus
          </abbr>{' '}
          is currently <strong>{formatINR(metrics.surplus)}</strong>
          /month — there&apos;s nothing to allocate until you trim fixed expenses or
          re-negotiate an EMI. Until then, prepayment isn&apos;t the right move; not
          falling behind is.
        </p>
      )}

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
            {
              v: surplusPositive ? formatINR(metrics.surplus) : '—',
              l: surplusPositive ? 'surplus this month' : 'no surplus to allocate',
              c: surplusPositive ? 'var(--ink)' : 'var(--muted)',
            },
            {
              v: fmt(loudest.effective),
              l: `${loudestKind} effective APR`,
              c: loudest.effective.gt(D24) ? 'var(--negative)' : 'var(--ink)',
            },
            {
              v: spread.gt(0) ? `+${fmt(spread)}` : '—',
              l: 'spread vs nominal',
              c: spread.gt(new Decimal('0.05')) ? 'var(--negative)' : 'var(--ink)',
            },
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
        If a bonus, refund, or windfall arrives this month, write back — we'll
        decide together where it should go.
      </p>
    </>
  );
}

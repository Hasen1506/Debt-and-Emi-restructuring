'use client';

/**
 * Invest-vs-prepay simple comparison card on /plan.
 *
 * Sits between the trajectory chart and the restructuring opportunities.
 * Answers "should I dump the surplus into the priority loan, or park it
 * in something safe?" with country-appropriate after-tax benchmarks.
 *
 * Scope: fixed-return safe vehicles only. Variable-return (equity, MF)
 * lives in `/tools/invest-vs-prepay` — this card has a deep-link to
 * that tool for users whose loan rate is borderline.
 *
 * Hides itself if the user has no loans with positive outstanding (the
 * "park money safely" question is the entire scope of the linked tool;
 * here we anchor against an actual loan).
 */

import Decimal from 'decimal.js';
import type { PlanData } from './PlanData';
import { computeBreakdown } from '@/lib/effective-apr';
import {
  compareToLoan,
  pct,
  safeBenchmarks,
  type ComparisonResult,
  type SafeVehicle,
} from '@/lib/invest-vs-prepay';
import { InfoTip } from '@/components/ToolPrimitives';

type Variant = 'existing' | 'ledger' | 'editorial';

interface Props {
  plan: PlanData;
  variant: Variant;
}

export function InvestVsPrepayCard({ plan, variant }: Props) {
  const loansWithBalance = plan.user.loans.filter(
    (l) => Number(l.outstanding || 0) > 0,
  );
  if (loansWithBalance.length === 0) return null;

  // Find the top-priority loan = highest effective APR among loans with
  // positive outstanding. Mirrors the avalanche selection logic.
  const taxRegime = plan.user.country === 'IN' ? plan.user.tax_regime : undefined;
  const ranked = loansWithBalance
    .map((loan) => ({
      loan,
      breakdown: computeBreakdown(loan, plan.marginalRate, plan.user.country, taxRegime),
    }))
    .sort((a, b) => b.breakdown.effective.cmp(a.breakdown.effective));

  const top = ranked[0];
  const vehicles = safeBenchmarks(plan.user.country, plan.marginalRate);
  const result = compareToLoan(top.breakdown.effective, vehicles);

  const tip = (
    <>
      <strong>What this asks.</strong> Should your next surplus rupee go
      into the priority loan (saving its effective rate), or into a safe
      vehicle (earning some rate after tax)?
      <div style={{ marginTop: 8 }}>
        <strong>How we compare.</strong> Loan rate is your *certain* return
        (you save exactly that rate). Vehicle rate is *expected* and may
        fall. We pick the best after-tax vehicle for your country and
        marginal slab, then show the gap.
      </div>
      <div style={{ marginTop: 8 }}>
        <strong>Variable-return options</strong> (equity, mutual funds) need
        probability modeling — see the deep-dive tool linked below.
      </div>
    </>
  );

  if (variant === 'ledger') {
    return <LedgerLayout plan={plan} top={top} result={result} vehicles={vehicles} tip={tip} />;
  }
  if (variant === 'editorial') {
    return <EditorialLayout plan={plan} top={top} result={result} vehicles={vehicles} tip={tip} />;
  }
  return <CardLayout plan={plan} top={top} result={result} vehicles={vehicles} tip={tip} />;
}

interface LayoutProps {
  plan: PlanData;
  top: { loan: PlanData['user']['loans'][number]; breakdown: ReturnType<typeof computeBreakdown> };
  result: ComparisonResult;
  vehicles: SafeVehicle[];
  tip: React.ReactNode;
}

function VerdictBadge({ verdict }: { verdict: ComparisonResult['verdict'] }) {
  const map = {
    prepay: { label: 'Prepay', color: 'var(--positive)' },
    invest_safe: { label: 'Invest instead', color: 'var(--accent)' },
    too_close: { label: 'Too close', color: 'var(--muted-ink)' },
  } as const;
  const m = map[verdict];
  return (
    <span
      style={{
        padding: '3px 8px',
        borderRadius: 4,
        border: `1px solid ${m.color}`,
        color: m.color,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      {m.label}
    </span>
  );
}

function CardLayout({ plan, top, result, vehicles, tip }: LayoutProps) {
  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--border)',
        background: 'var(--card)',
        borderRadius: 8,
        borderLeft: '3px solid var(--accent)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Prepay or invest the surplus?
          <InfoTip>{tip}</InfoTip>
        </div>
        <VerdictBadge verdict={result.verdict} />
      </div>

      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Comparing the priority loan&apos;s effective rate against your country&apos;s safe vehicles, after tax.
      </div>

      <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.6 }}>
        <strong>{top.loan.bank}</strong> {top.loan.loan_type.replace('_', ' ')}{' '}
        — effective <strong>{pct(top.breakdown.effective)}</strong>{' '}
        <span className="muted">(certain saving if you prepay)</span>
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {vehicles.map((v) => (
          <div
            key={v.key}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 500, minWidth: 200 }}>{v.name}</span>
            <span className="num">
              {pct(v.preTaxEffective)} →{' '}
              <strong>{pct(v.afterTaxEffective)}</strong>
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {v.note}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '8px 12px',
          background: 'var(--soft-bg)',
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        {result.explanation}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        Variable-return options (equity, MF) involve probability and
        drawdowns →{' '}
        <a href="/tools/invest-vs-prepay" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          deeper analysis
        </a>
        {plan.user.country === 'IN' && (
          <> · Tax-free bond yields shown are typical secondary-market quotes</>
        )}
      </div>
    </div>
  );
}

function LedgerLayout({ plan, top, result, vehicles, tip }: LayoutProps) {
  return (
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          $ PREPAY · VS · INVEST
          <InfoTip>{tip}</InfoTip>
        </span>
        <VerdictBadge verdict={result.verdict} />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.7,
          borderTop: '2px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          padding: '10px 0',
        }}
      >
        <div>
          <span style={{ color: 'var(--muted)' }}>PRIORITY LOAN: </span>
          <strong>{top.loan.bank.toUpperCase()}</strong>{' '}
          {top.loan.loan_type.toUpperCase().replace('_', ' ')} ·{' '}
          EFF <strong>{pct(top.breakdown.effective)}</strong>{' '}
          <span style={{ color: 'var(--muted)' }}>CERTAIN SAVING</span>
        </div>
        {vehicles.map((v) => (
          <div key={v.key}>
            <span style={{ color: 'var(--muted)' }}>VS </span>
            {v.name.toUpperCase()} ·{' '}
            {pct(v.preTaxEffective)} → <strong>{pct(v.afterTaxEffective)}</strong>{' '}
            <span style={{ color: 'var(--muted)' }}>AFTER TAX</span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--muted)',
          lineHeight: 1.6,
        }}
      >
        {result.explanation}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
        VARIABLE-RETURN OPTIONS →{' '}
        <a href="/tools/invest-vs-prepay" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          /TOOLS/INVEST-VS-PREPAY
        </a>
      </div>
    </section>
  );
}

function EditorialLayout({ plan, top, result, vehicles, tip }: LayoutProps) {
  return (
    <div
      style={{
        margin: '32px 0',
        paddingLeft: 18,
        borderLeft: '3px solid var(--accent)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft)',
          marginBottom: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        Prepay, or invest?
        <InfoTip>{tip}</InfoTip>
        <VerdictBadge verdict={result.verdict} />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        <strong>{top.loan.bank}</strong>{' '}
        {top.loan.loan_type.replace('_', ' ')} effective{' '}
        <strong>{pct(top.breakdown.effective)}</strong>. {result.explanation}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          lineHeight: 1.65,
          color: 'var(--muted)',
        }}
      >
        After-tax safe yields ·{' '}
        {vehicles.map((v, i) => (
          <span key={v.key}>
            {i > 0 && ' · '}
            {v.name} <strong style={{ color: 'var(--ink)' }}>{pct(v.afterTaxEffective)}</strong>
          </span>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
        Variable returns →{' '}
        <a href="/tools/invest-vs-prepay" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          deeper analysis
        </a>
      </div>
    </div>
  );
}

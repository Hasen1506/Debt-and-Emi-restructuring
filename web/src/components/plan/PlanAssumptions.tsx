'use client';

/**
 * Plan's assumptions (REDESIGN R3.1): one row of chips, each saying what
 * the plan assumes (payoff order, pay rises, rising costs, tax refunds,
 * emergency fund share, rupee drift). A chip opens its control below the
 * row; changing it re-runs the plan. This is the one place they're edited:
 * Home's context line links here. Chips that can't change anything for
 * this profile (no tax saving, no gap in the emergency fund, one currency)
 * aren't shown.
 */
import { useState } from 'react';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole } from '@/lib/api';
import { MONTH_NAMES, FY_ANCHOR_MONTH, monthIndexToCountryLabel } from '@/lib/today';
import { STRATEGY_LABEL } from '@/lib/strategy';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { StrategySwitcher } from '@/components/StrategySwitcher';
import { HikeToggle } from '@/components/HikeToggle';
import { TaxReinvestToggle } from '@/components/TaxReinvestToggle';
import { InflationToggle } from '@/components/InflationToggle';
import { EfSplitSlider } from '@/components/EfSplitSlider';
import { FxDriftToggle } from '@/components/FxDriftToggle';

// FilingStatusUS: 'single' | 'mfj' | 'hoh' (same as Home's context line).
const FILING: Record<string, string> = { single: 'SINGLE', mfj: 'JOINTLY', hoh: 'HEAD OF HOUSEHOLD' };

type ChipKey = 'order' | 'hike' | 'inflation' | 'tax' | 'ef' | 'fx';

interface Chip {
  key: ChipKey;
  label: string;
  value: string;
  /** What the chip is about, in one sentence, above its control. */
  about: string;
  control: React.ReactNode;
}

export function PlanAssumptions({ plan }: { plan: PlanData }) {
  const [open, setOpen] = useState<ChipKey | null>(null);
  const u = plan.user;
  const configured = plan.configuredUser;
  const ccy = plan.displayCurrency;
  const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;

  const hikeRate = Number(configured.annual_hike_rate ?? '0');
  const hikeMonth = MONTH_NAMES[Math.max(0, Math.min(11, (configured.hike_effective_month ?? FY_ANCHOR_MONTH[u.country]) - 1))];
  const phased = (configured.hike_schedule ?? []).some(([f, t, r]) => f > 0 && t > f && Number(r) > 0);
  const hasHike = hikeRate > 0 || phased;
  const hikePct = pct(hikeRate, hikeRate > 0 && hikeRate < 0.01 ? 2 : 0);
  const inflRate = Number(u.inflation_rate ?? '0');
  const taxSaving = plan.taxReinvestProjection.reduce((s, e) => s + Number(e.amount), 0);
  const efGap = Number(u.efund_target || 0) > 0 && Number(u.efund_balance || 0) < Number(u.efund_target || 0);
  const efPct = Math.round(Number(plan.efSplit) * 100);
  const twoCurrencies = plan.currenciesInPlay.length > 1;

  const chips: Chip[] = [
    {
      key: 'order',
      label: 'PAYOFF ORDER',
      value: STRATEGY_LABEL[plan.strategy].toUpperCase(),
      about: 'Which loan gets the money left after EMIs and minimums.',
      control: (
        <StrategySwitcher active={plan.strategy} variant="ledger" compare={plan.strategyCompare} country={u.country} />
      ),
    },
    {
      key: 'hike',
      label: 'PAY RISES',
      value:
        !hasHike
          ? 'NONE SET'
          : plan.hikeModeling === 'on'
            ? phased
              ? `PHASED · ${hikeMonth.slice(0, 3).toUpperCase()}`
              : `+${hikePct} A YEAR · ${hikeMonth.slice(0, 3).toUpperCase()}`
            : 'IGNORED',
      about:
        !hasHike
          ? 'No pay rise is set, so the plan keeps your take-home flat.'
          : 'Whether your take-home grows each year. The rise and its month are set in Profile.',
      // With no rise set there's nothing to include: only the way to add one.
      control: (
        <>
          {hasHike && (
            <HikeToggle
              active={plan.hikeModeling}
              hikeRatePct={hikePct}
              hikeMonthLabel={hikeMonth}
              hikePhases={configured.hike_schedule}
              variant="ledger"
            />
          )}
          <div style={{ marginTop: hasHike ? 8 : 0 }}>
            <LBracket href="/profile?step=income">{hasHike ? 'CHANGE THE RISE' : 'ADD A PAY RISE'} IN PROFILE →</LBracket>
          </div>
        </>
      ),
    },
    {
      key: 'inflation',
      label: 'RISING COSTS',
      value: inflRate <= 0 ? 'NONE SET' : plan.inflationModeling === 'on' ? `+${pct(inflRate, 1)} A YEAR` : 'IGNORED',
      about:
        inflRate <= 0
          ? 'No rate for rising prices is set, so the plan keeps your spending flat.'
          : 'Whether your monthly spending grows with prices each year. Rising costs leave less for debt later on.',
      // Profile saves a country default (4.6% / 2.5%); only an older profile has none.
      control:
        inflRate > 0 ? (
          <InflationToggle active={plan.inflationModeling} inflationRatePct={pct(inflRate, 1)} variant="ledger" />
        ) : null,
    },
  ];
  if (taxSaving > 0) {
    chips.push({
      key: 'tax',
      label: 'TAX REFUNDS',
      value: plan.taxReinvest === 'on' ? 'PAY DEBT' : 'KEPT',
      about: 'The tax your loans save comes back once a year. Put it on the dearest loan, or keep it as cash.',
      control: (
        <TaxReinvestToggle
          active={plan.taxReinvest}
          totalProjectedSaving={formatCurrencyWhole(taxSaving.toFixed(0), ccy)}
          variant="ledger"
        />
      ),
    });
  }
  if (efGap) {
    chips.push({
      key: 'ef',
      label: 'EMERGENCY FUND',
      value: `${efPct}% OF SPARE CASH`,
      about: 'Your emergency fund is below its target. This share of the spare cash goes to it until it is full; the rest pays debt.',
      control: <EfSplitSlider active={plan.efSplit} hasGap ccySym={u.country === 'IN' ? '₹' : '$'} variant="ledger" />,
    });
  }
  if (twoCurrencies) {
    chips.push({
      key: 'fx',
      label: 'RUPEE',
      value: plan.fxDrift === 'on' ? 'WEAKENS 2.5% A YEAR' : 'HELD AT TODAY’S RATE',
      about: 'Your rupee loans counted in dollars: at today’s rate throughout, or with the rupee losing 2.5% a year.',
      control: <FxDriftToggle active={plan.fxDrift} driftLabel="INR +2.5%/yr (CPI differential)" variant="ledger" />,
    });
  }

  const gross = Number(u.income_type === 'salaried' ? u.annual_gross_salary : u.annual_business_income);
  const facts = [
    `PLAN FROM ${monthIndexToCountryLabel(1, u.country).toUpperCase()}`,
    u.country === 'IN'
      ? `${u.tax_regime === 'old' ? 'OLD' : 'NEW'} TAX REGIME`
      : `FILING ${FILING[u.filing_status ?? 'single'] ?? 'SINGLE'}`,
    `TAX BRACKET ${Math.round(Number(plan.marginalRate || 0) * 100)}%${gross > 0 ? '' : ' (ESTIMATED)'}`,
  ];
  const current = chips.find((c) => c.key === open);

  return (
    <section aria-label="What the plan assumes">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: 11,
          letterSpacing: '0.12em',
          color: L_T.muted,
          marginBottom: 8,
        }}
      >
        <span>
          <span aria-hidden="true">$ </span>
          {facts.join(' · ')}
          {!plan.profileIsLive && ' · DEMO'}
          {!plan.live && ' · OFFLINE'}
        </span>
        <LBracket href="/profile">EDIT IN PROFILE →</LBracket>
      </div>
      <div role="group" aria-label="Assumptions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chips.map((c) => {
          const isOpen = open === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-expanded={isOpen}
              aria-controls="plan-assumption"
              onClick={() => setOpen(isOpen ? null : c.key)}
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                letterSpacing: '0.1em',
                padding: '6px 10px',
                minHeight: 30,
                cursor: 'pointer',
                background: isOpen ? L_T.ink : 'transparent',
                color: isOpen ? L_T.bg : L_T.muted,
                border: `1px solid ${isOpen ? L_T.ink : L_T.muted}`,
                textAlign: 'left',
              }}
            >
              {c.label} ·{' '}
              <strong style={{ color: isOpen ? L_T.bg : L_T.ink }}>{c.value}</strong>{' '}
              <span aria-hidden="true">{isOpen ? '↑' : '↓'}</span>
            </button>
          );
        })}
      </div>
      <div id="plan-assumption" role="region" aria-label={current ? current.label.toLowerCase() : 'assumption'} hidden={!current}>
        {current && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              borderLeft: `2px solid ${L_T.accent}`,
              background: L_T.paper,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: '0 0 8px', color: L_T.ink }}>{current.about}</p>
            {current.control}
          </div>
        )}
      </div>
    </section>
  );
}

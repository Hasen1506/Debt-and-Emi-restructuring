'use client';

/**
 * Home — "what do I pay this month?" (REDESIGN R2).
 *
 * Top to bottom: one context line (the plan's settings; they're changed on
 * Plan), this month's cash flow (take-home − costs = left), the status
 * figures, this month's payments, and the open loans. "Feeling
 * overwhelmed?" in the footer swaps all of it for one step.
 *
 * Figures from the saved profile (deriveMetrics) render at once; the plan's
 * date and payments are streamed in by the page.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrencyWhole } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { cashFlowForMonth, deriveMetrics, type DerivedMetrics } from '@/lib/derived';
import { projectionGaps } from '@/lib/loan-gaps';
import { userDefaultCurrency } from '@/lib/currency';
import { MONTH_NAMES, getCountryToday, monthIndexToCountryLabel } from '@/lib/today';
import type { StrategyName } from '@/lib/strategy';
import {
  LShell,
  LSectionHeader,
  LCli,
  LKpi,
  LBracket,
  LRule,
  L_T,
  LButton,
  lGridColumns,
  readLedgerTone,
  type LTone,
} from '@/components/ledger/primitives';
import { OpenPositions } from './OpenPositions';
import { useOwedNow } from '@/lib/owed-now';
import { ToolStrip } from '@/components/goals/ToolsList';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';

/** The plan's debt-free date and caption, streamed in by the page. */
export interface DebtFreeSlot {
  v: ReactNode;
  s: ReactNode;
}

interface HomeProps {
  profile: StoredProfile;
  strategy: StrategyName;
  debtFree?: DebtFreeSlot;
  /** This month's payments to tick off, streamed in by the page. */
  register?: ReactNode;
  /** Cheaper rates for these loans, streamed in by the page. */
  cheaper?: ReactNode;
  /** The calm view's one step, streamed in by the page. */
  oneStep?: ReactNode;
}

export function LedgerHome(props: HomeProps) {
  const [tone, setTone] = useState<LTone>('CALM');
  useEffect(() => {
    setTone(readLedgerTone());
  }, []);
  if (tone === 'OVERWHELMED') return <LedgerHomeSoft profile={props.profile} oneStep={props.oneStep} />;
  return <LedgerHomeFull {...props} />;
}

function LedgerHomeFull({ profile, debtFree, register, cheaper }: HomeProps) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrencyWhole(v, ccy);
  // Owed now: after the EMIs already marked paid this month (lib/owed-now).
  const owedRows = useOwedNow(profile.user.loans, profile.user.country).rows;

  if (m.loans.length === 0) return <EmptyState paidOff={(profile.user.loans?.length ?? 0) > 0} />;

  // A loan with no rate or EMI on file: no rates until it's added.
  const gaps = projectionGaps(profile.user);
  const fxMissing = m.fxMissing.length > 0;
  const totalNow = m.loans.reduce((s, d) => s.add(m.toUserCcy(owedRows[d.index]?.owed ?? d.outstanding, d.loan)), m.totalOutstanding.mul(0));

  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <ContextLine profile={profile} />
        <CashFlow profile={profile} m={m} />

        <section aria-labelledby="home-status">
          <LSectionHeader>
            <span id="home-status">Status</span>
          </LSectionHeader>
          <LKpi
            cols={4}
            items={[
              // With no exchange rate the ₹ and $ can't be added up.
              fxMissing
                ? { l: 'OUTSTANDING', v: '—', s: 'ADD THE EXCHANGE RATE' }
                : { l: 'OUTSTANDING', v: fc(totalNow.toFixed(0)), s: `${m.loans.length} OPEN` },
              debtFree
                ? { l: 'DEBT-FREE', v: debtFree.v, s: debtFree.s, tone: L_T.positive }
                : { l: 'DEBT-FREE', v: 'SEE PLAN →', s: 'DATE + MONTHLY SCHEDULE', tone: L_T.muted },
              fxMissing
                ? { l: 'INTEREST', v: '—', s: 'NEEDS THE EXCHANGE RATE' }
                : {
                    l: 'INTEREST',
                    v: `${fc(m.monthlyInterest.toFixed(0))}/MO`,
                    s: 'CHARGED THIS MONTH',
                    tone: L_T.negative,
                  },
              gaps.length > 0
                ? { l: 'EFFECTIVE RATE', v: '—', s: 'ADD YOUR LOAN DETAILS' }
                : { l: 'EFFECTIVE RATE', v: fmtPct(m.blendedEffective), s: 'AVERAGE · AFTER FEES + TAX' },
            ]}
          />
        </section>

        {register}
        {cheaper}

        <OpenPositions profile={profile} m={m} />

        <ToolStrip user={profile.user} title="Something came up?" />
      </div>
    </LShell>
  );
}

const FILING: Record<string, string> = { single: 'SINGLE', mfj: 'JOINTLY', hoh: 'HEAD OF HOUSEHOLD' };

/** The settings the plan ran with, on one line. They're changed on Plan
 *  (the assumption chips) and in Profile, not here. */
function ContextLine({ profile }: { profile: StoredProfile }) {
  const u = profile.user;
  const gross = Number(u.income_type === 'salaried' ? u.annual_gross_salary : u.annual_business_income);
  const parts = [
    `PLAN FROM ${monthIndexToCountryLabel(1, u.country).toUpperCase()}`,
    u.country === 'IN'
      ? `${u.tax_regime === 'old' ? 'OLD' : 'NEW'} TAX REGIME`
      : `FILING ${FILING[u.filing_status ?? 'single'] ?? 'SINGLE'}`,
    // Worked out from take-home until gross pay is entered in Profile.
    `TAX BRACKET ${Math.round(Number(profile.marginalRate || 0) * 100)}%${gross > 0 ? '' : ' (ESTIMATED)'}`,
    // The payoff order isn't repeated here: the masthead shows it and switches it.
  ];
  return (
    <section
      aria-label="Plan settings"
      style={{
        fontSize: 11,
        letterSpacing: '0.12em',
        color: L_T.muted,
        borderTop: `1px dashed ${L_T.ruleSoft}`,
        borderBottom: `1px dashed ${L_T.ruleSoft}`,
        padding: '8px 0',
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'baseline',
      }}
    >
      <span>
        {parts.join(' · ')}
      </span>
      <LBracket href="/plan">CHANGE ON PLAN →</LBracket>
    </section>
  );
}

/** Take-home − costs = left: the three numbers the month's plan comes from. */
function CashFlow({ profile, m }: { profile: StoredProfile; m: DerivedMetrics }) {
  const u = profile.user;
  const fc = (v: number) => formatCurrencyWhole(Math.round(Math.abs(v)), userDefaultCurrency(u.country));
  const today = getCountryToday(u.country);
  const income = Number(u.monthly_income || 0);
  const spend = Number(u.fixed_expenses || 0) + Number(u.variable_expenses || 0);
  const current = cashFlowForMonth(profile, m);
  const debts = Number(current.emiBurden.toFixed(0));
  const left = Number(current.surplus.toFixed(0));
  const streams = u.income_streams?.length ?? 0;
  // ₹ and $ minimums can't be added without the rate.
  const noFx = m.fxMissing.length > 0;
  const cells = [
    {
      label: 'TAKE-HOME',
      sign: '+',
      value: fc(income),
      tone: L_T.ink,
      note: streams > 0 ? `From ${streams} income sources, after tax` : 'A month, after tax',
    },
    {
      label: 'COSTS',
      sign: '−',
      value: noFx ? '—' : fc(spend + debts),
      tone: L_T.ink,
      note: noFx
        ? 'Add the exchange rate in Profile'
        : `Spending ${fc(spend)} + EMIs and card minimums ${fc(debts)}`,
    },
    {
      label: left < 0 ? 'SHORT' : 'LEFT',
      sign: '=',
      value: noFx ? '—' : fc(left),
      tone: noFx ? L_T.ink : left > 0 ? L_T.positive : left < 0 ? L_T.negative : L_T.ink,
      note: noFx
        ? 'Needs the exchange rate'
        : left > 0
          ? 'For extra payments and savings'
          : left < 0
            ? 'Costs and minimums are more than income'
            : 'Nothing spare this month',
    },
  ];
  return (
    <section aria-labelledby="home-cash">
      <LSectionHeader>
        <span id="home-cash">
          Cash flow · {MONTH_NAMES[today.getMonth()]} {today.getFullYear()}
        </span>
      </LSectionHeader>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: lGridColumns(3, 200),
          gap: 1,
          background: L_T.ink,
          padding: 1,
        }}
      >
        {cells.map((c) => (
          <div key={c.label} style={{ background: L_T.paper, padding: '14px 18px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', color: L_T.muted, fontWeight: 600, marginBottom: 6 }}>
              {c.label}
            </div>
            <div
              style={{
                fontSize: 'clamp(22px, 4.2vw, 30px)',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: c.tone,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.1,
                overflowWrap: 'anywhere',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: '0.6em', marginRight: 4 }}>
                {c.sign}
              </span>
              {c.value}
            </div>
            <div style={{ fontSize: 11, color: L_T.muted, marginTop: 8, lineHeight: 1.5 }}>{c.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── OVERWHELMED — soft view ───────────────────────────────────────────
function LedgerHomeSoft({ profile, oneStep }: { profile: StoredProfile; oneStep?: ReactNode }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrencyWhole(v, ccy);
  if (m.loans.length === 0) return <EmptyState paidOff={(profile.user.loans?.length ?? 0) > 0} />;
  const loudest = m.loudest!;
  const gaps = projectionGaps(profile.user);
  const amount = m.surplus.gt(0) ? Math.round(Number(m.surplus.toString())) : 0;
  const lender = (loudest.loan.bank || 'your highest-rate lender').toUpperCase();

  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '60px 32px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: '100%',
            border: `2px solid ${L_T.ink}`,
            padding: '32px 28px',
            background: L_T.paper,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              color: L_T.muted,
              marginBottom: 16,
            }}
          >
            ┌── SOFT VIEW · ONE STEP ──┐
          </div>
          <div
            style={{
              fontSize: 13,
              color: L_T.muted,
              marginBottom: 22,
              lineHeight: 1.7,
            }}
          >
            TAKE A BREATH. YOU&apos;RE GOING TO BE OKAY.
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              lineHeight: 1.35,
              letterSpacing: '-0.01em',
            }}
          >
            {oneStep
              ? oneStep
              : amount > 0
                ? `PAY ${fc(Math.min(amount, Number(m.toUserCcy(loudest.outstanding, loudest.loan))))} TO YOUR ${lender} ${LOAN_TYPE_NAME[loudest.loan.loan_type].toUpperCase()}.`
                : `KEEP CURRENT EMIS RUNNING.`}
          </div>
          <div style={{ fontSize: 12, color: L_T.muted, marginTop: 18, lineHeight: 1.7 }}>
            THE SINGLE MOST USEFUL THING YOU CAN DO RIGHT NOW.
            <br />
            NOTHING ELSE NEEDS TO BE DECIDED TODAY.
          </div>
          <div style={{ marginTop: 24 }}>
            <LButton href={gaps.length > 0 ? '/profile?step=loans' : '/activity#activity-ledger'} full>
              I&apos;LL DO THIS
            </LButton>
          </div>
          <div
            style={{
              fontSize: 10,
              color: L_T.muted,
              letterSpacing: '0.14em',
              textAlign: 'center',
              marginTop: 14,
            }}
          >
            OR · <LBracket href="/plan">SEE THE FULL STATEMENT</LBracket>
          </div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              color: L_T.muted,
              marginTop: 20,
              textAlign: 'right',
            }}
          >
            └────────────────────────┘
          </div>
        </div>
        <div
          style={{
            maxWidth: 480,
            fontSize: 11,
            color: L_T.muted,
            textAlign: 'center',
            lineHeight: 1.7,
            letterSpacing: '0.04em',
          }}
        >
          TOTALS, TRAJECTORIES, AND THE OTHER DEBTS ARE HIDDEN ON PURPOSE.
          <br />
          THEY&apos;LL STILL BE HERE WHEN YOU&apos;RE READY.
        </div>
      </div>
    </LShell>
  );
}

function EmptyState({ paidOff }: { paidOff: boolean }) {
  // paidOff: loans are on file but every balance is 0.
  return (
    <LShell>
      <div style={{ padding: '40px 0' }}>
        <LCli>{paidOff ? 'STATUS · DEBT-FREE' : 'STATUS · NO DEBTS ON FILE'}</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          {paidOff ? (
            <>
              Every loan on file is paid off. Put the old EMIs to work:{' '}
              <LBracket href="/goals">GOALS →</LBracket>{' '}
              <LBracket href="/portfolio">PORTFOLIO →</LBracket>{' '}
              <LBracket href="/profile?step=loans">ADD A LOAN →</LBracket>
            </>
          ) : (
            <>
              No loans or cards on file. Plan ahead:{' '}
              <LBracket href="/goals">GOALS →</LBracket>{' '}
              <LBracket href="/tools/purchase">A BIG PURCHASE →</LBracket>{' '}
              <LBracket href="/portfolio">PORTFOLIO →</LBracket>{' '}
              <LBracket href="/profile?step=loans">ADD A LOAN →</LBracket>
            </>
          )}
        </div>
      </div>
    </LShell>
  );
}

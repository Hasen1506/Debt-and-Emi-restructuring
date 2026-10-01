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
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { deriveMetrics, type DerivedMetrics } from '@/lib/derived';
import { projectionGaps } from '@/lib/loan-gaps';
import { userDefaultCurrency } from '@/lib/currency';
import { MONTH_NAMES, getCountryToday, monthIndexToCountryLabel } from '@/lib/today';
import { STRATEGY_LABEL, type StrategyName } from '@/lib/strategy';
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
import { LDebtsTable } from '@/components/ledger/LDebtsTable';

/** The plan's debt-free date and caption, streamed in by the page. */
export interface DebtFreeSlot {
  v: ReactNode;
  s: ReactNode;
}

/** This month's move from the plan's first month, streamed in by the page. */
export interface MoveSlot {
  headline: ReactNode;
  detail: ReactNode;
  /** One step only, for the calm view. */
  oneStep: ReactNode;
}

interface HomeProps {
  profile: StoredProfile;
  strategy: StrategyName;
  debtFree?: DebtFreeSlot;
  move?: MoveSlot;
}

export function LedgerHome(props: HomeProps) {
  const [tone, setTone] = useState<LTone>('CALM');
  useEffect(() => {
    setTone(readLedgerTone());
  }, []);
  if (tone === 'OVERWHELMED') return <LedgerHomeSoft profile={props.profile} move={props.move} />;
  return <LedgerHomeFull {...props} />;
}

function LedgerHomeFull({ profile, strategy, debtFree, move }: HomeProps) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);

  if (m.loans.length === 0) return <EmptyState paidOff={(profile.user.loans?.length ?? 0) > 0} />;

  const loudest = m.loudest!;
  // A loan with no rate or EMI on file: no rates or "pay this" until it's added.
  const gaps = projectionGaps(profile.user);
  const loudestBank = (loudest.loan.bank || 'YOUR LOUDEST').toUpperCase();
  const loudestProduct = loudest.loan.loan_type.replace('_', ' ').toUpperCase();
  // The extra this month is the surplus, never more than the balance. With
  // no surplus there is nothing extra to pay: it used to fall back to the
  // whole balance ("PAY ₹30,00,000 EXTRA") for someone already over budget.
  const hasSurplus = m.surplus.gt(0);
  // In the user's currency: an NRI's ₹ balance is converted before it's
  // compared with a $ surplus.
  const extra = hasSurplus
    ? Decimal.min(m.surplus, m.toUserCcy(loudest.outstanding, loudest.loan))
    : new Decimal(0);
  const extraRounded = Math.round(Number(extra.toString()));
  // Interest the extra avoids over a year at this loan's effective rate
  // (not the whole balance's interest, which is what it showed before).
  const annualSaving = Math.round(Number(extra.times(loudest.effective).toString()));
  const fxMissing = m.fxMissing.length > 0;

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
        <ContextLine profile={profile} strategy={strategy} />
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
                : { l: 'OUTSTANDING', v: fc(m.totalOutstanding.toFixed(0)), s: `${m.loans.length} OPEN` },
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

        <section style={{ border: `2px solid ${L_T.ink}`, padding: '18px 22px' }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              color: L_T.accent,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            $ THIS MONTH · DO THIS
          </div>
          <div
            style={{
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
              marginBottom: 6,
            }}
          >
            {move
              ? move.headline
              : hasSurplus
                ? `PAY ${fc(extraRounded)} EXTRA → ${loudestBank} ${loudestProduct}`
                : m.surplus.lt(0)
                  ? `SHORT ${fc(Math.round(Math.abs(Number(m.surplus.toString()))))}/MO · COSTS + MINIMUM PAYMENTS ARE MORE THAN INCOME`
                  : 'PAY THE MINIMUMS · NOTHING SPARE THIS MONTH'}
          </div>
          <div style={{ fontSize: 12, color: L_T.muted, marginBottom: 14 }}>
            {move
              ? move.detail
              : hasSurplus
                ? `HIGHEST EFFECTIVE RATE · ${fmtPct(loudest.effective)} · AVOIDS ~${fc(annualSaving)} INTEREST A YEAR`
                : 'CUT COSTS OR ASK THE BANK FOR A LOWER PAYMENT · NO EXTRA PAYMENTS UNTIL THE GAP CLOSES'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {gaps.length > 0 ? (
              <LBracket active href="/profile?step=loans">
                ADD THE DETAILS
              </LBracket>
            ) : hasSurplus && (
              <LBracket active href="/activity#activity-ledger">
                I PAID THIS
              </LBracket>
            )}
            <LBracket href="/plan">WHY? SEE THE PLAN →</LBracket>
          </div>
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/profile?step=loans">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · {m.loans.length}
          </LSectionHeader>
          <LDebtsTable
            loans={m.loans}
            country={profile.user.country}
            totalOutstanding={m.totalOutstanding}
            totalEmi={m.emiBurden}
            spare={m.surplus.gt(0)}
            fx={profile.user.fx_to_user_currency}
          />
        </section>
      </div>
    </LShell>
  );
}

const FILING: Record<string, string> = { single: 'SINGLE', mfj: 'JOINTLY', hoh: 'HEAD OF HOUSEHOLD' };

/** The settings the plan ran with, on one line. They're changed on Plan
 *  (the assumption chips) and in Profile, not here. */
function ContextLine({ profile, strategy }: { profile: StoredProfile; strategy: StrategyName }) {
  const u = profile.user;
  const gross = Number(u.income_type === 'salaried' ? u.annual_gross_salary : u.annual_business_income);
  const parts = [
    `PLAN FROM ${monthIndexToCountryLabel(1, u.country).toUpperCase()}`,
    u.country === 'IN'
      ? `${u.tax_regime === 'old' ? 'OLD' : 'NEW'} TAX REGIME`
      : `FILING ${FILING[u.filing_status ?? 'single'] ?? 'SINGLE'}`,
    // Worked out from take-home until gross pay is entered in Profile.
    `TAX BRACKET ${Math.round(Number(profile.marginalRate || 0) * 100)}%${gross > 0 ? '' : ' (ESTIMATED)'}`,
    `${STRATEGY_LABEL[strategy].toUpperCase()} ORDER`,
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
        <span aria-hidden="true">$ </span>
        {parts.join(' · ')}
      </span>
      <LBracket href="/plan">CHANGE ON PLAN →</LBracket>
    </section>
  );
}

/** Take-home − costs = left: the three numbers the month's plan comes from. */
function CashFlow({ profile, m }: { profile: StoredProfile; m: DerivedMetrics }) {
  const u = profile.user;
  const fc = (v: number) => formatCurrency(Math.round(Math.abs(v)), userDefaultCurrency(u.country));
  const today = getCountryToday(u.country);
  const income = Number(u.monthly_income || 0);
  const spend = Number(u.fixed_expenses || 0) + Number(u.variable_expenses || 0);
  const debts = Number(m.emiBurden.toFixed(0));
  const left = Number(m.surplus.toFixed(0));
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
function LedgerHomeSoft({ profile, move }: { profile: StoredProfile; move?: MoveSlot }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);
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
            {move
              ? move.oneStep
              : amount > 0
                ? `PAY ${fc(Math.min(amount, Number(m.toUserCcy(loudest.outstanding, loudest.loan))))} TO YOUR ${lender} ${loudest.loan.loan_type
                    .replace('_', ' ')
                    .toUpperCase()}.`
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

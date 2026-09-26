'use client';

/**
 * Ledger Home — "The daily statement".
 *
 * Three view modes (toggled from the global LFooter):
 *   SIMPLE   · CALM         → STATUS / ACTION / OPEN POSITIONS / TOOLS
 *   DETAILED · CALM         → adds the next loan to target and an insight
 *   ANY      · OVERWHELMED  → soft view: one card, one sentence, one button
 *
 * Data: all numbers derive from the saved profile (deriveMetrics). The
 * debt-free date needs the simulation, so the home page links to /plan
 * for it rather than showing an empty placeholder.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { projectionGaps } from '@/lib/loan-gaps';
import { userDefaultCurrency } from '@/lib/currency';
import { TOOLS } from '@/lib/tools';
import {
  LShell,
  LSectionHeader,
  LCli,
  LKpi,
  LBracket,
  LRule,
  L_T,
  L_MONO,
  LButton,
  lGridColumns,
  readLedgerMode,
  readLedgerTone,
  type LMode,
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
  debtFree?: DebtFreeSlot;
  move?: MoveSlot;
}

export function LedgerHome({ profile, debtFree, move }: HomeProps) {
  const [mode, setMode] = useState<LMode>('SIMPLE');
  const [tone, setTone] = useState<LTone>('CALM');
  useEffect(() => {
    setMode(readLedgerMode());
    setTone(readLedgerTone());
  }, []);

  if (tone === 'OVERWHELMED') return <LedgerHomeSoft profile={profile} move={move} />;
  if (mode === 'DETAILED') return <LedgerHomeDetailed profile={profile} debtFree={debtFree} />;
  return <LedgerHomeSimple profile={profile} debtFree={debtFree} move={move} />;
}

// ─── SIMPLE × CALM ─────────────────────────────────────────────────────
function LedgerHomeSimple({ profile, debtFree, move }: HomeProps) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);

  if (m.loans.length === 0) return <EmptyState paidOff={(profile.user.loans?.length ?? 0) > 0} />;

  const loudest = m.loudest!;
  // A loan with no rate or EMI on file: no rates or "pay this" until it's added.
  const gaps = projectionGaps(profile.user.loans);
  const loudestBank = (loudest.loan.bank || 'YOUR LOUDEST').toUpperCase();
  const loudestProduct = loudest.loan.loan_type.replace('_', ' ').toUpperCase();
  const surplusTone =
    m.surplus.gt(0) ? L_T.positive : m.surplus.lt(0) ? L_T.negative : L_T.ink;
  // The extra this month is the surplus, never more than the balance. With
  // no surplus there is nothing extra to pay: it used to fall back to the
  // whole balance ("PAY ₹30,00,000 EXTRA") for someone already over budget.
  const hasSurplus = m.surplus.gt(0);
  const extra = hasSurplus
    ? Decimal.min(m.surplus, loudest.outstanding)
    : new Decimal(0);
  const extraRounded = Math.round(Number(extra.toString()));
  // Interest the extra avoids over a year at this loan's effective rate
  // (not the whole balance's interest, which is what it showed before).
  const annualSaving = Math.round(Number(extra.times(loudest.effective).toString()));

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
        <section>
          <LSectionHeader>STATUS</LSectionHeader>
          <LKpi
            cols={4}
            items={[
              { l: 'OUTSTANDING', v: fc(m.totalOutstanding.toString()), s: `${m.loans.length} OPEN` },
              debtFree
                ? { l: 'DEBT-FREE', v: debtFree.v, s: debtFree.s, tone: L_T.positive }
                : { l: 'DEBT-FREE', v: 'SEE PLAN →', s: 'DATE + MONTHLY SCHEDULE', tone: L_T.muted },
              gaps.length > 0
                ? { l: 'EFFECTIVE RATE', v: '—', s: 'ADD YOUR LOAN DETAILS' }
                : { l: 'EFFECTIVE RATE', v: fmtPct(m.blendedEffective), s: 'AVERAGE · AFTER FEES + TAX' },
              {
                l: 'SURPLUS',
                v: `${fc(m.surplus.toString())}/MO`,
                s: m.surplus.gt(0) ? 'AFTER COSTS + MINIMUMS' : m.surplus.lt(0) ? 'SHORT EACH MONTH' : 'NOTHING SPARE',
                tone: surplusTone,
              },
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
              <LBracket active href="/onboarding?step=loans">
                ADD THE DETAILS
              </LBracket>
            ) : hasSurplus && (
              <LBracket active href="/insights#activity-ledger">
                I PAID THIS
              </LBracket>
            )}
            <LBracket href="/plan">WHY? SEE THE PLAN →</LBracket>
          </div>
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/onboarding">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · {m.loans.length}
          </LSectionHeader>
          <LDebtsTable
            loans={m.loans}
            country={profile.user.country}
            totalOutstanding={m.totalOutstanding}
            totalEmi={m.emiBurden}
            spare={m.surplus.gt(0)}
          />
        </section>

        <section>
          <LSectionHeader>TOOLS · {TOOLS.length}</LSectionHeader>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: lGridColumns(Math.min(TOOLS.length, 5), 150),
              gap: 1,
              background: L_T.ink,
              padding: 1,
            }}
          >
            {TOOLS.map((t) => (
              <a
                key={t.id}
                href={t.href}
                style={{
                  background: L_T.bg,
                  padding: '12px 10px',
                  textDecoration: 'none',
                  color: L_T.ink,
                  fontFamily: L_MONO,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: L_T.accent,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                  }}
                >
                  §{t.tag}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                  {t.name.toUpperCase()}
                </div>
                <div style={{ fontSize: 10, color: L_T.muted, marginTop: 4, lineHeight: 1.4 }}>
                  {t.question}
                </div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </LShell>
  );
}

// ─── DETAILED × CALM ───────────────────────────────────────────────────
function LedgerHomeDetailed({ profile, debtFree }: { profile: StoredProfile; debtFree?: DebtFreeSlot }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);
  if (m.loans.length === 0) return <EmptyState paidOff={(profile.user.loans?.length ?? 0) > 0} />;
  const loudest = m.loudest!;
  const gaps = projectionGaps(profile.user.loans);

  return (
    <LShell>
      <div style={{ flex: 1, padding: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <LSectionHeader>STATUS</LSectionHeader>
          <LKpi
            cols={4}
            items={[
              debtFree
                ? { l: 'DEBT-FREE', v: debtFree.v, s: debtFree.s, tone: L_T.positive }
                : { l: 'DEBT-FREE', v: 'SEE PLAN →', s: 'DATE + MONTHLY SCHEDULE', tone: L_T.muted },
              {
                l: 'OUTSTANDING',
                v: fc(m.totalOutstanding.toString()),
                s: `${m.loans.length} OPEN`,
              },
              gaps.length > 0
                ? { l: 'EFFECTIVE RATE', v: '—', s: 'ADD YOUR LOAN DETAILS' }
                : {
                    l: 'EFFECTIVE RATE',
                    v: fmtPct(m.blendedEffective),
                    s: 'AVERAGE · AFTER FEES + TAX',
                  },
              gaps.length > 0
                ? { l: 'NEXT', v: 'ADD DETAILS', s: 'RATE OR EMI MISSING', tone: L_T.accent }
                : {
                    l: 'NEXT',
                    v: `${(loudest.loan.bank || '—').toUpperCase()}`,
                    s: `${fmtPct(loudest.effective)} EFFECTIVE`,
                    tone: L_T.accent,
                  },
            ]}
          />
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/onboarding">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · {m.loans.length}
          </LSectionHeader>
          <LDebtsTable
            loans={m.loans}
            country={profile.user.country}
            totalOutstanding={m.totalOutstanding}
            totalEmi={m.emiBurden}
            spare={m.surplus.gt(0)}
          />
        </section>

        {gaps.length === 0 && (
        <section style={{ border: `1px solid ${L_T.ink}`, padding: '12px 16px' }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              color: L_T.muted,
              marginBottom: 6,
            }}
          >
            $ INSIGHT · {(loudest.loan.bank || '—').toUpperCase()}
          </div>
          <div style={{ fontSize: 12, color: L_T.ink }}>
            Effective rate on {loudest.loan.bank || 'this loan'} ={' '}
            <span style={{ color: L_T.accent, fontWeight: 700 }}>{fmtPct(loudest.effective)}</span>{' '}
            once fees and any tax saving are counted.{' '}
            <LBracket href="/debts">see the breakdown →</LBracket>
          </div>
        </section>
        )}
      </div>
    </LShell>
  );
}

// ─── OVERWHELMED — soft view ───────────────────────────────────────────
function LedgerHomeSoft({ profile, move }: HomeProps) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);
  if (m.loans.length === 0) return <EmptyState paidOff={(profile.user.loans?.length ?? 0) > 0} />;
  const loudest = m.loudest!;
  const gaps = projectionGaps(profile.user.loans);
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
                ? `PAY ${fc(Math.min(amount, Number(loudest.loan.outstanding)))} TO YOUR ${lender} ${loudest.loan.loan_type
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
            <LButton href={gaps.length > 0 ? '/onboarding?step=loans' : '/insights#activity-ledger'} full>
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
              <LBracket href="/onboarding?step=loans">ADD A LOAN →</LBracket>
            </>
          ) : (
            <>
              No loans or cards on file. Plan ahead:{' '}
              <LBracket href="/goals">GOALS →</LBracket>{' '}
              <LBracket href="/tools/purchase">A BIG PURCHASE →</LBracket>{' '}
              <LBracket href="/portfolio">PORTFOLIO →</LBracket>{' '}
              <LBracket href="/onboarding?step=loans">ADD A LOAN →</LBracket>
            </>
          )}
        </div>
      </div>
    </LShell>
  );
}

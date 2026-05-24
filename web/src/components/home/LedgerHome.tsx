'use client';

/**
 * Ledger Home — "The daily statement".
 *
 * Three view modes (toggled from the global LFooter):
 *   SIMPLE   · CALM         → STATUS / ACTION / OPEN POSITIONS / TOOLS
 *   DETAILED · CALM         → adds confidence band, trajectory, sensitivity, insight
 *   ANY      · OVERWHELMED  → soft view: one card, one sentence, one button
 *
 * Data: all numbers derive from the saved profile (deriveMetrics). The
 * DEBT-FREE / TRAJECTORY visuals link to /plan for the engine-true
 * numbers — they can't be computed from the profile alone.
 */

import { useEffect, useMemo, useState } from 'react';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
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
  readLedgerMode,
  readLedgerTone,
  type LMode,
  type LTone,
} from '@/components/ledger/primitives';
import { LDebtsTable } from '@/components/ledger/LDebtsTable';

export function LedgerHome({ profile }: { profile: StoredProfile }) {
  const [mode, setMode] = useState<LMode>('SIMPLE');
  const [tone, setTone] = useState<LTone>('CALM');
  useEffect(() => {
    setMode(readLedgerMode());
    setTone(readLedgerTone());
  }, []);

  if (tone === 'OVERWHELMED') return <LedgerHomeSoft profile={profile} />;
  if (mode === 'DETAILED') return <LedgerHomeDetailed profile={profile} />;
  return <LedgerHomeSimple profile={profile} />;
}

// ─── SIMPLE × CALM ─────────────────────────────────────────────────────
function LedgerHomeSimple({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);

  if (m.loans.length === 0) return <EmptyState />;

  const loudest = m.loudest!;
  const loudestBank = (loudest.loan.bank || 'YOUR LOUDEST').toUpperCase();
  const loudestProduct = loudest.loan.loan_type.replace('_', ' ').toUpperCase();
  const surplusTone =
    m.surplus.gt(0) ? L_T.positive : m.surplus.lt(0) ? L_T.negative : L_T.ink;
  const extraSuggestion = m.surplus.gt(0) ? m.surplus : loudest.outstanding;
  const extraRounded = Math.round(Number(extraSuggestion.toString()));
  // Rough annual saving = balance × effective × 1yr if we cleared it today.
  // Honest upper bound — actual saving depends on the schedule, which
  // /plan computes. Good enough for a headline.
  const annualSaving = Math.round(
    Number(loudest.outstanding.toString()) * Number(loudest.effective.toString()),
  );

  return (
    <LShell>
      <main
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
            cols={5}
            items={[
              { l: 'OUTSTANDING', v: fc(m.totalOutstanding.toString()), s: `${m.loans.length} OPEN` },
              { l: 'DEBT-FREE', v: '→ SEE /PLAN', s: 'NEEDS SIMULATION', tone: L_T.muted },
              { l: 'EFFECTIVE APR', v: fmtPct(m.blendedEffective), s: 'WEIGHTED' },
              {
                l: 'SURPLUS',
                v: `${fc(m.surplus.toString())}/MO`,
                s: m.surplus.gt(0) ? 'NET ALLOC' : 'OVER BUDGET',
                tone: surplusTone,
              },
              {
                l: 'NEXT ACTION',
                v: m.surplus.gt(0) ? `PAY ${fc(extraRounded)}` : `→ ${loudestBank}`,
                s: `→ ${loudestBank} · ${fmtPct(loudest.effective)} APR`,
                tone: L_T.accent,
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
            PAY {fc(extraRounded)} EXTRA → {loudestBank} {loudestProduct}
          </div>
          <div style={{ fontSize: 12, color: L_T.muted, marginBottom: 14 }}>
            HIGHEST EFFECTIVE APR · {fmtPct(loudest.effective)} · SAVES ~{fc(annualSaving)} INT/YR
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <LBracket active href="/insights#activity-ledger">
              I PAID THIS
            </LBracket>
            <LBracket href="/plan">WHY?</LBracket>
            <LBracket href="/plan">SHOW MATH ↓</LBracket>
          </div>
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/onboarding">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · {m.loans.length}
          </LSectionHeader>
          <LDebtsTable loans={m.loans} country={profile.user.country} />
        </section>

        <section>
          <LSectionHeader>TOOLS · {TOOLS.length}</LSectionHeader>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(TOOLS.length, 7)}, 1fr)`,
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
      </main>
    </LShell>
  );
}

// ─── DETAILED × CALM ───────────────────────────────────────────────────
function LedgerHomeDetailed({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);
  if (m.loans.length === 0) return <EmptyState />;
  const loudest = m.loudest!;

  return (
    <LShell>
      <main style={{ flex: 1, padding: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <LSectionHeader
            right={
              <span style={{ color: L_T.muted, letterSpacing: '0.1em' }}>
                ★★★★☆ · SIMULATION ON /PLAN
              </span>
            }
          >
            STATUS · CONFIDENCE BAND
          </LSectionHeader>
          <LKpi
            cols={5}
            items={[
              { l: 'CLEAR · CENTRAL', v: '→ SEE /PLAN', s: 'P50', tone: L_T.muted },
              { l: 'CLEAR · BAND', v: '—', s: 'P10 → P90', tone: L_T.muted },
              {
                l: 'OUTSTANDING',
                v: fc(m.totalOutstanding.toString()),
                s: `${m.loans.length} OPEN`,
              },
              {
                l: 'EFFECTIVE APR',
                v: fmtPct(m.blendedEffective),
                s: 'WEIGHTED · POST-TAX',
              },
              {
                l: 'NEXT',
                v: `${(loudest.loan.bank || '—').toUpperCase()}`,
                s: `${fmtPct(loudest.effective)} APR`,
                tone: L_T.accent,
              },
            ]}
          />
        </section>

        <section>
          <LSectionHeader
            right={
              <>
                <LBracket>CSV</LBracket> <LBracket>PRINT</LBracket>
              </>
            }
          >
            TRAJECTORY · {profile.user.loans.length} OPEN
          </LSectionHeader>
          <div
            style={{
              border: `2px solid ${L_T.ink}`,
              padding: 24,
              background: L_T.paper,
              textAlign: 'center',
              color: L_T.muted,
              fontSize: 11,
              letterSpacing: '0.12em',
            }}
          >
            FULL TRAJECTORY LIVES ON <LBracket href="/plan">/PLAN</LBracket> — NEEDS THE
            SIMULATION ENGINE
          </div>
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/onboarding">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · {m.loans.length}
          </LSectionHeader>
          <LDebtsTable loans={m.loans} country={profile.user.country} showShield />
        </section>

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
            Real {(loudest.loan.bank || 'lender').toLowerCase()} rate ={' '}
            <span style={{ color: L_T.accent, fontWeight: 700 }}>{fmtPct(loudest.effective)}</span>{' '}
            after fees / shield are folded in.{' '}
            <LBracket href="/plan">show formula ↓</LBracket>
          </div>
        </section>
      </main>
    </LShell>
  );
}

// ─── OVERWHELMED — soft view ───────────────────────────────────────────
function LedgerHomeSoft({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: number | string) => formatCurrency(v, ccy);
  if (m.loans.length === 0) return <EmptyState />;
  const loudest = m.loudest!;
  const amount = m.surplus.gt(0) ? Math.round(Number(m.surplus.toString())) : 0;
  const lender = (loudest.loan.bank || 'your highest-rate lender').toUpperCase();

  return (
    <LShell>
      <main
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
            {amount > 0
              ? `PAY ${fc(amount)} TO YOUR ${lender} ${loudest.loan.loan_type
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
            <LButton href="/insights#activity-ledger" full>
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
      </main>
    </LShell>
  );
}

function EmptyState() {
  return (
    <LShell>
      <main style={{ padding: '40px 0' }}>
        <LCli>STATUS · NO DEBTS ON FILE</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          Run setup to add your debts: <LBracket href="/onboarding">SETUP →</LBracket>
        </div>
      </main>
    </LShell>
  );
}

'use client';

/**
 * Ledger Plan — the printed amortisation statement.
 *
 * Sections (matches the prototype, top to bottom):
 *   1. CLI summary line
 *   2. 4-cell KPI: CLEAR DATE / TOTAL INTEREST / MONTHS SAVED / OUTLAY
 *   3. TRAJECTORY · TOTAL DEBT OVER TIME  (LTrajectory)
 *   4. RESTRUCTURE · LAYER 1 (opportunities table)
 *   5. AMORTISATION · NEXT 12 MO  (dense table)
 *   6. SENSITIVITY · LIVE ENGINE  (command-line sliders)
 *
 * Modeling toggles + tax + bracket + budget + next-action + waterfall +
 * what-if + activity banner — all the prior LedgerPlan extras — live in
 * LEDGER_MISSING.md as a separate v2 pass.
 */

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { PlanData } from './PlanData';
import { formatCurrency, formatPct } from '@/lib/api';
import { monthIndexToCountryLabel, MONTH_NAMES, getCountryToday } from '@/lib/today';
import {
  LShell,
  LSectionHeader,
  LCli,
  LKpi,
  LBracket,
  LSlider,
  LCardHard,
  L_T,
  L_MONO,
} from '@/components/ledger/primitives';
import { LTrajectory, type LTrajPoint } from '@/components/ledger/LDebtsTable';

export function LedgerPlan({ plan }: { plan: PlanData }) {
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrency(v, ccy);
  const marginalPct = (Number(plan.marginalRate) * 100).toFixed(0);
  const strategyUp = plan.strategy.toUpperCase();
  const interestSaved =
    Number(plan.baselineInterest) - Number(plan.totalInterest);
  const horizon = plan.trajectory.length;
  const clearLabel = plan.debtFreeMonth
    ? monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()
    : 'NOT IN LIFETIME';
  const monthlyOutlay =
    plan.user.loans.reduce((s, l) => s + Number(l.scheduled_emi || 0), 0) +
    Math.max(0, plan.surplus);

  // ─── trajectory adapter ─────────────────────────────────────────────
  const trajPoints: LTrajPoint[] = useMemo(() => {
    if (plan.trajectory.length === 0) return [];
    const maxBal = Math.max(
      ...plan.trajectory.map((p) => Math.max(p.avalanche, p.minimums)),
    );
    const maxMonth = plan.trajectory[plan.trajectory.length - 1].month || 1;
    return plan.trajectory.map((p) => ({
      t: p.month / maxMonth,
      av: maxBal > 0 ? p.avalanche / maxBal : 0,
      min: maxBal > 0 ? p.minimums / maxBal : 0,
    }));
  }, [plan.trajectory]);

  const today = getCountryToday(plan.user.country);
  const xLabels = useMemo(() => {
    if (plan.trajectory.length === 0) return [];
    const maxMonth = plan.trajectory[plan.trajectory.length - 1].month || 1;
    return [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const m = Math.round(f * maxMonth);
      const d = new Date(today.getFullYear(), today.getMonth() + m, 1);
      return `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${String(d.getFullYear()).slice(-2)}`;
    });
  }, [plan.trajectory, today]);

  const yLabels = useMemo(() => {
    if (plan.trajectory.length === 0) return [];
    const maxBal = Math.max(
      ...plan.trajectory.map((p) => Math.max(p.avalanche, p.minimums)),
    );
    return [
      { y: 1, l: fc(maxBal) },
      { y: 0.5, l: fc(maxBal / 2) },
      { y: 0, l: fc(0) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.trajectory, ccy]);

  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontFamily: L_MONO,
        }}
      >
        {/* 1. CLI line + 2. KPI strip */}
        <section>
          <LCli>
            PLAN · STRATEGY={strategyUp} · HORIZON={horizon}MO · MARGINAL={marginalPct}%
            {!plan.profileIsLive && ' · DEMO'}
            {!plan.live && ' · OFFLINE'}
          </LCli>
          <LKpi
            cols={4}
            items={[
              {
                l: 'CLEAR DATE',
                v: clearLabel,
                s: plan.debtFreeMonth
                  ? `MONTH ${plan.debtFreeMonth} ON ${strategyUp}`
                  : 'RAISE SURPLUS OR CUT SPEND TO CLEAR',
              },
              {
                l: 'TOTAL INTEREST',
                v: fc(plan.totalInterest),
                s: `VS ${fc(plan.baselineInterest)} BASELINE`,
                tone: L_T.positive,
              },
              {
                l: 'MONTHS SAVED',
                v: String(plan.monthsSaved),
                s: 'VS MINIMUMS BASELINE',
                tone: L_T.accent,
              },
              {
                l: 'MONTHLY OUTLAY',
                v: `${fc(monthlyOutlay)}/MO`,
                s: 'SCHEDULED + ALLOC',
              },
            ]}
          />
        </section>

        {/* 3. Trajectory */}
        <section>
          <LSectionHeader
            right={
              <>
                <LBracket>CSV</LBracket> <LBracket>PRINT</LBracket>
              </>
            }
          >
            TRAJECTORY · TOTAL DEBT OVER TIME
          </LSectionHeader>
          {trajPoints.length > 0 ? (
            <>
              <LTrajectory
                points={trajPoints}
                clearLabel={
                  plan.debtFreeMonth
                    ? `${monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country)
                        .toUpperCase()
                        .replace(/(\w+)\s/, (s) => s.slice(0, 3) + ' ')} · CLEAR`
                    : undefined
                }
                axisLabels={xLabels}
                yLabels={yLabels}
              />
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  fontSize: 10,
                  color: L_T.muted,
                  marginTop: 8,
                  letterSpacing: '0.1em',
                }}
              >
                <span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: 2,
                      background: L_T.ink,
                      verticalAlign: 'middle',
                      marginRight: 6,
                    }}
                  />
                  {strategyUp}
                </span>
                <span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      borderTop: `2px dashed ${L_T.muted}`,
                      verticalAlign: 'middle',
                      marginRight: 6,
                    }}
                  />
                  MINIMUMS
                </span>
              </div>
            </>
          ) : (
            <div style={{ padding: 18, fontSize: 12, color: L_T.muted }}>
              $ NO TRAJECTORY · simulation returned no points.
            </div>
          )}
        </section>

        {/* 4. Restructure */}
        {plan.opportunities.length > 0 && (
          <section>
            <LSectionHeader
              right={
                <span style={{ color: L_T.positive, fontWeight: 700 }}>
                  SAVES {fc(plan.totalAnnualSaving)}/YR
                </span>
              }
            >
              RESTRUCTURE · LAYER 1 (RE-PRICE BEFORE ACCELERATE)
            </LSectionHeader>
            <RestructureTable plan={plan} fc={fc} />
          </section>
        )}

        {/* 5. Amortisation */}
        <AmortisationSection plan={plan} fc={fc} horizon={horizon} />

        {/* 6. Sensitivity */}
        <section>
          <SensitivityCard plan={plan} fc={fc} />
        </section>
      </div>
    </LShell>
  );
}

// ─── Restructure table ──────────────────────────────────────────────────
function RestructureTable({
  plan,
  fc,
}: {
  plan: PlanData;
  fc: (v: string | number) => string;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
          {['KIND', 'FROM', 'TO', 'Δ RATE', 'BREAKEVEN', 'SAVES/Y', 'STATUS'].map((h, i) => (
            <th
              key={i}
              style={{
                padding: '8px 12px',
                textAlign: i > 2 ? 'right' : 'left',
                fontWeight: 700,
                letterSpacing: '0.08em',
                fontSize: 10,
                color: L_T.muted,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {plan.opportunities.map((o, i) => {
          const dRate = (Number(o.current_rate) - Number(o.target_rate)) * 100;
          return (
            <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
              <td
                style={{
                  padding: '12px 12px',
                  fontWeight: 700,
                  color: L_T.accent,
                }}
              >
                {o.kind.replace('_', ' ').toUpperCase()}
              </td>
              <td style={{ padding: '12px 12px' }}>{formatPct(o.current_rate)}</td>
              <td style={{ padding: '12px 12px' }}>{formatPct(o.target_rate)}</td>
              <td
                style={{
                  padding: '12px 12px',
                  textAlign: 'right',
                  color: dRate > 0 ? L_T.positive : L_T.negative,
                }}
              >
                {dRate > 0 ? '−' : '+'}
                {Math.abs(dRate).toFixed(2)}pp
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right' }}>—</td>
              <td
                style={{
                  padding: '12px 12px',
                  textAlign: 'right',
                  color: L_T.positive,
                  fontWeight: 700,
                }}
              >
                {fc(o.estimated_annual_saving)}
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                <LBracket>EXPLORE</LBracket>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Amortisation §4.4 ──────────────────────────────────────────────────
// Spec: default state is COLLAPSED — only event-bearing rows render, each
// with a yellow wash. The bracket flips `[↓ EXPAND ALL N]` ↔ `[↑ COLLAPSE]`.
// Glyphs: ⊕ rate reset · ⊙ annual review · ★ debt cleared / windfall.
function AmortisationSection({
  plan,
  fc,
  horizon,
}: {
  plan: PlanData;
  fc: (v: string | number) => string;
  horizon: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const today = getCountryToday(plan.user.country);
  const loanCols = plan.user.loans.slice(0, 4);

  // Build all rows once with derived event + numbers, then filter at render
  // time depending on collapse state. Keeps event-detection logic in one
  // place and lets us count rows for the header label.
  const trajByMonth = new Map<number, number>(
    plan.trajectory.map((p) => [p.month, p.avalanche]),
  );
  const scheduledTotal = plan.user.loans.reduce(
    (s, l) => s + Number(l.scheduled_emi || 0),
    0,
  );
  // ⊕ rate reset + ⊙ salary reset glyphs are gated on threading
  // `lifecycle_events` into PlanData — see LEDGER_MISSING §G.1 follow-up.
  // For now we surface ★ cleared (from trajectory) and ⊙ annual review
  // (every 12th month), which both derive purely from plan data.

  type Row = {
    mo: number;
    date: string;
    perLoan: Record<number, string>;
    extra: number;
    interest: number;
    principal: number;
    balance: number;
    event: string;
  };

  const rows: Row[] = plan.monthlyPayments.map((row) => {
    const d = new Date(
      today.getFullYear(),
      today.getMonth() + row.month,
      1,
    );
    const date = `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${String(d.getFullYear()).slice(-2)}`;
    const bal = trajByMonth.get(row.month) ?? 0;
    const prevBal =
      trajByMonth.get(row.month - 1) ?? trajByMonth.get(row.month) ?? bal;
    const drop = prevBal - bal;
    const perLoan = row.perLoan ?? {};
    const totalPay = Object.values(perLoan).reduce(
      (s, v) => s + Number(v),
      0,
    );
    const interest = Math.max(0, totalPay - drop);
    const principal = Math.max(0, drop);
    const extra = Math.max(0, totalPay - scheduledTotal);
    // Event resolution — pick the loudest event for this month.
    let event = '';
    const balancesNow = plan.trajectory.find(
      (p) => p.month === row.month,
    )?.balancesByLoanIndex;
    const balancesPrev = plan.trajectory.find(
      (p) => p.month === row.month - 1,
    )?.balancesByLoanIndex;
    if (balancesNow && balancesPrev) {
      for (const [idxStr, n] of Object.entries(balancesNow)) {
        const prev = Number(balancesPrev[idxStr] ?? 0);
        if (prev > 0 && Number(n) <= 0.01) {
          const lender = plan.user.loans[Number(idxStr)]?.bank ?? 'LOAN';
          event = `★ ${lender.toUpperCase()} CLEARED`;
          break;
        }
      }
    }
    if (!event && row.month > 1 && row.month % 12 === 0) {
      event = `⊙ ANNUAL REVIEW`;
    }
    return {
      mo: row.month,
      date,
      perLoan,
      extra,
      interest,
      principal,
      balance: bal,
      event,
    };
  });

  const eventRows = rows.filter((r) => r.event);
  const visibleRows = expanded ? rows : eventRows;
  const totalCount = rows.length || horizon;

  return (
    <section>
      <LSectionHeader
        right={
          <>
            <LBracket>CSV</LBracket> <LBracket>PRINT</LBracket>{' '}
            <LBracket onClick={() => setExpanded((v) => !v)}>
              {expanded ? '↑ COLLAPSE' : `↓ EXPAND ALL ${totalCount}`}
            </LBracket>
          </>
        }
      >
        AMORTISATION ·{' '}
        {expanded
          ? `${totalCount} MO`
          : `${eventRows.length} EVENT${eventRows.length === 1 ? '' : 'S'} · EXPAND FOR ${totalCount} MO`}
      </LSectionHeader>
      {visibleRows.length === 0 ? (
        <div style={{ padding: '14px 0', fontSize: 11, color: L_T.muted }}>
          $ NO EVENTS · the next {totalCount} months hold steady. Expand to
          inspect every row.
        </div>
      ) : (
        <div
          role="region"
          aria-label="Month-by-month schedule"
          tabIndex={0}
          style={{
            overflowX: 'auto',
            maxHeight: expanded ? 460 : undefined,
            overflowY: expanded ? 'auto' : undefined,
            borderBottom: expanded ? `1px solid ${L_T.faint}` : undefined,
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
              minWidth: 760,
            }}
          >
            <thead>
              <tr
                style={{
                  borderTop: `2px solid ${L_T.ink}`,
                  borderBottom: `1px solid ${L_T.ink}`,
                  background: L_T.bg,
                  position: expanded ? 'sticky' : undefined,
                  top: 0,
                  zIndex: 1,
                }}
              >
                {[
                  'MO',
                  'DATE',
                  ...loanCols.map((l) =>
                    (l.bank || '—').slice(0, 8).toUpperCase(),
                  ),
                  'EXTRA',
                  'INT PAID',
                  'PRIN',
                  'BALANCE',
                  'EVENT',
                ].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '6px 10px',
                      textAlign: i < 2 ? 'left' : 'right',
                      fontWeight: 700,
                      fontSize: 9,
                      color: L_T.muted,
                      letterSpacing: '0.06em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => {
                const highlight = !!r.event;
                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: `1px dashed ${L_T.faint}`,
                      background: highlight ? L_T.highlight : 'transparent',
                    }}
                  >
                    <td style={{ padding: '6px 10px' }}>
                      {String(r.mo).padStart(2, '0')}
                    </td>
                    <td style={{ padding: '6px 10px' }}>{r.date}</td>
                    {loanCols.map((_, idx) => (
                      <td
                        key={idx}
                        style={{ padding: '6px 10px', textAlign: 'right' }}
                      >
                        {r.perLoan[idx]
                          ? fc(Number(r.perLoan[idx]).toFixed(0))
                          : '—'}
                      </td>
                    ))}
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        color: L_T.accent,
                        fontWeight: 700,
                      }}
                    >
                      {r.extra > 0 ? fc(r.extra.toFixed(0)) : '—'}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        color: L_T.negative,
                      }}
                    >
                      {fc(r.interest.toFixed(0))}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        color: L_T.positive,
                      }}
                    >
                      {fc(r.principal.toFixed(0))}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        fontWeight: 700,
                      }}
                    >
                      {fc(r.balance.toFixed(0))}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {r.event}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Sensitivity ────────────────────────────────────────────────────────
function SensitivityCard({
  plan,
  fc,
}: {
  plan: PlanData;
  fc: (v: string | number) => string;
}) {
  // Local-only sliders — no engine round-trip. Outcomes are linear
  // approximations of the engine deltas; the headline number anchors to
  // plan.monthsSaved + plan.totalInterest. Matches the prototype's
  // "live engine" feel without paying for a real recompute on drag.
  const [surplusDelta, setSurplusDelta] = useState(15000);
  const [rateShockBps, setRateShockBps] = useState(0);
  const [lumpSum, setLumpSum] = useState(0);

  const surplusMoSaved = Math.round(
    (surplusDelta / Math.max(1, plan.surplus + 1000)) * plan.monthsSaved * 0.3,
  );
  const surplusIntSaved = Math.round(
    surplusMoSaved *
      Number(plan.totalInterest) /
      Math.max(1, plan.trajectory.length),
  );
  const rateExtra = Math.round(
    (rateShockBps / 100) *
      plan.user.loans.reduce((s, l) => s + Number(l.outstanding), 0) *
      0.5,
  );
  const rateMo = Math.round(rateShockBps / 50);
  const lumpMoSaved = Math.round(
    (lumpSum / Math.max(1, plan.user.loans.reduce((s, l) => s + Number(l.outstanding), 0))) *
      plan.trajectory.length *
      0.5,
  );
  const lumpIntSaved = Math.round(
    lumpSum * Number(plan.user.loans[0]?.nominal_rate ?? 0.1) * 2,
  );

  return (
    <LCardHard>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: L_T.muted,
          marginBottom: 12,
        }}
      >
        $ SENSITIVITY · LIVE ENGINE
      </div>
      <LSlider
        label="SET SURPLUS_DELTA"
        ariaLabel="Extra paid each month"
        value={surplusDelta}
        min={0}
        max={50000}
        step={500}
        onChange={setSurplusDelta}
        format={(v) => `+${fc(v)}/mo`}
        outcomes={[
          {
            label: 'DEBT-FREE',
            value: `−${surplusMoSaved} MO`,
            tone: 'pos',
          },
          {
            label: 'INTEREST',
            value: `−${fc(surplusIntSaved)}`,
            tone: 'pos',
          },
        ]}
      />
      <div style={{ borderTop: `1px dashed ${L_T.faint}` }}>
        <LSlider
          label="SET RATE_SHOCK"
        ariaLabel="Interest rate rise"
          value={rateShockBps}
          min={0}
          max={300}
          step={25}
          onChange={setRateShockBps}
          format={(v) => `+${v} bps`}
          outcomes={[
            { label: 'DEBT-FREE', value: `+${rateMo} MO`, tone: 'neg' },
            { label: 'INTEREST', value: `+${fc(rateExtra)}`, tone: 'neg' },
          ]}
        />
      </div>
      <div style={{ borderTop: `1px dashed ${L_T.faint}` }}>
        <LSlider
          label="SET LUMP_SUM"
        ariaLabel="One-off payment"
          value={lumpSum}
          min={0}
          max={500000}
          step={5000}
          onChange={setLumpSum}
          format={(v) =>
            v > 0
              ? `${fc(v)} → ${(plan.user.loans[0]?.bank || '—').toUpperCase()}`
              : `${fc(0)}`
          }
          outcomes={[
            { label: 'DEBT-FREE', value: `−${lumpMoSaved} MO`, tone: 'pos' },
            { label: 'INTEREST', value: `−${fc(lumpIntSaved)}`, tone: 'pos' },
          ]}
        />
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 10,
          color: L_T.muted,
          letterSpacing: '0.08em',
        }}
      >
        APPROXIMATE · APPLY VIA <LBracket href="/tools/recompute">[/TOOLS/RECOMPUTE]</LBracket>
      </div>
    </LCardHard>
  );
}

// Re-export for type narrowing in the page wrapper.
export type { PlanData };
// (Decimal is imported above so future contributors keep precise math
// in this file when they wire real engine deltas.)
void Decimal;

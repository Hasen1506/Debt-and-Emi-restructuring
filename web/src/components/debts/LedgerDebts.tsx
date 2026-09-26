'use client';

/**
 * Ledger Debts — full positions list with a highlighted "loudest" card.
 *
 * Sections, top to bottom (matches prototype §4.5):
 *   1. CLI summary line
 *   2. 4-cell KPI: TOTAL OUTSTANDING / WEIGHTED APR / TOTAL EMI / NEXT RESET
 *   3. OPEN POSITIONS · DETAILED  (LDebtsTable with POST-TAX column)
 *   4. HIGHLIGHTED · LOUDEST DEBT  (accent-bordered card)
 *
 * Per-loan expandable breakdown, lifecycle events panel, today card, cash
 * management, and stale-card nudge — all the prior LedgerDebts extras —
 * live in LEDGER_MISSING.md.
 */

import { useMemo } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { userDefaultCurrency } from '@/lib/currency';
import {
  LShell,
  LSectionHeader,
  LCli,
  LKpi,
  LBracket,
  L_T,
  L_MONO,
} from '@/components/ledger/primitives';
import { LDebtsTable } from '@/components/ledger/LDebtsTable';

export function LedgerDebts({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: string | number) => formatCurrency(v, ccy);

  if (m.loans.length === 0) {
    return (
      <LShell>
        <div style={{ padding: '40px 0' }}>
          <LCli>DEBTS · NO OPEN POSITIONS</LCli>
          <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
            Run setup to add your debts: <LBracket href="/onboarding">SETUP →</LBracket>
          </div>
        </div>
      </LShell>
    );
  }

  const loudest = m.loudest!;
  const totalEmi = m.loans.reduce(
    (s, d) => s + Number(d.loan.scheduled_emi || 0),
    0,
  );
  // Floating loans surface a cycle length (months) rather than a precise
  // next-reset date. Pick the shortest cycle as a proxy for "next thing
  // that will requote". /plan's lifecycle events panel has the dated
  // version — listed in LEDGER_MISSING.md as a fidelity gap.
  const nextResetLoan = m.loans
    .map((d) => ({
      d,
      cycle: Number(d.loan.rate_reset_frequency_months ?? 0),
    }))
    .filter((x) => x.cycle > 0 && x.d.loan.rate_type === 'floating')
    .sort((a, b) => a.cycle - b.cycle)[0];

  // Monthly interest on the loudest line = outstanding * (nominal / 12).
  // Use nominal not effective because that's what the bank charges; the
  // shield comes back at filing time, not month-to-month.
  const loudestMonthlyInt = new Decimal(loudest.loan.outstanding || 0)
    .mul(new Decimal(loudest.loan.nominal_rate || 0))
    .div(12)
    .toFixed(0);

  // Spread vs next-loudest as a single number — same comparison the
  // prototype uses to justify "this one is loudest".
  const next = m.loans[1];
  const vsNext = next
    ? new Decimal(loudest.loan.outstanding || 0)
        .mul(new Decimal(loudest.loan.nominal_rate || 0).sub(new Decimal(next.loan.nominal_rate || 0)))
        .div(12)
        .toFixed(0)
    : '0';

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
        <section>
          <LCli>
            DEBTS · {m.loans.length} OPEN · WEIGHTED EFFECTIVE APR{' '}
            {fmtPct(m.blendedEffective)}
          </LCli>
          <LKpi
            cols={4}
            items={[
              {
                l: 'TOTAL OUTSTANDING',
                v: fc(m.totalOutstanding.toString()),
                s: `${m.loans.length} OPEN LINES`,
              },
              {
                l: 'WEIGHTED APR',
                v: fmtPct(m.blendedEffective),
                s: 'POST-TAX',
              },
              {
                l: 'TOTAL EMI',
                v: totalEmi > 0 ? `${fc(totalEmi)}/MO` : '—',
                s: 'SCHEDULED',
              },
              {
                l: 'RESET CYCLE',
                v: nextResetLoan ? `${nextResetLoan.cycle} MO` : 'NONE',
                s: nextResetLoan
                  ? `${(nextResetLoan.d.loan.bank || '—').toUpperCase()} FLT`
                  : 'NO FLOATING LOANS',
                tone: nextResetLoan ? L_T.accent : L_T.muted,
              },
            ]}
          />
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/onboarding">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · DETAILED
          </LSectionHeader>
          <LDebtsTable loans={m.loans} country={profile.user.country} showShield />
        </section>

        {/* Highlighted loudest debt — only block where the border itself goes accent. */}
        <section style={{ border: `2px solid ${L_T.accent}`, padding: '18px 22px' }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              color: L_T.accent,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            $ HIGHLIGHTED · LOUDEST DEBT
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              marginBottom: 8,
            }}
          >
            {(loudest.loan.bank || '—').toUpperCase()} ·{' '}
            {loudest.loan.loan_type.replace('_', ' ').toUpperCase()}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
            <tbody>
              {([
                ['NOMINAL RATE', fmtPct(loudest.nominal), 'PUBLISHED APR'],
                [
                  'EFFECTIVE',
                  fmtPct(loudest.effective),
                  loudest.effective.gt(loudest.nominal)
                    ? 'FEES + GST FOLDED IN'
                    : loudest.effective.lt(loudest.nominal)
                      ? 'TAX SHIELD APPLIED'
                      : 'NO ADJUSTMENTS',
                  loudest.effective.gt(new Decimal('0.24')) ? L_T.negative : L_T.ink,
                ],
                [
                  'OUTSTANDING',
                  fc(loudest.loan.outstanding),
                  loudest.loan.loan_type === 'credit_card'
                    ? 'REVOLVING BALANCE'
                    : 'PRINCIPAL REMAINING',
                ],
                ['MONTHLY INT', fc(loudestMonthlyInt), 'PURE FRICTION'],
                next
                  ? [
                      'VS NEXT',
                      `+${fc(vsNext)}`,
                      `MORE THAN ${(next.loan.bank || '—').toUpperCase()} ${next.loan.loan_type.toUpperCase().replace('_', ' ')} EACH MONTH`,
                    ]
                  : null,
              ].filter(Boolean) as [string, string, string, string?][]).map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td
                    style={{
                      padding: '6px 0',
                      color: L_T.muted,
                      width: 160,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {r[0]}
                  </td>
                  <td
                    style={{
                      padding: '6px 0',
                      fontWeight: 700,
                      color: r[3] ?? L_T.ink,
                      width: 140,
                    }}
                  >
                    {r[1]}
                  </td>
                  <td
                    style={{
                      padding: '6px 0',
                      color: L_T.muted,
                      fontSize: 10,
                      letterSpacing: '0.06em',
                    }}
                  >
                    {r[2]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <LBracket active href="/plan">
              BALANCE TRANSFER →
            </LBracket>
            <LBracket href="/plan">SHOW MATH</LBracket>
            <LBracket href="/insights#activity-ledger">MARK PAID</LBracket>
          </div>
        </section>
      </div>
    </LShell>
  );
}

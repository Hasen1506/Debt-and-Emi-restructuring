'use client';

/**
 * Ledger Debts — full positions list with a highlighted "loudest" card.
 *
 * Sections, top to bottom (matches prototype §4.5):
 *   1. CLI summary line
 *   2. 4-cell KPI: TOTAL OUTSTANDING / WEIGHTED APR / TOTAL EMI / NEXT RESET
 *   3. OPEN POSITIONS · DETAILED  (LDebtsTable)
 *   4. HIGHLIGHTED · LOUDEST DEBT  (accent-bordered card)
 *
 *   5. HOW EACH RATE IS WORKED OUT  (per-loan breakdown)
 *   6. Stale-card nudge, cash section, life events
 */

import { useMemo, useState } from 'react';
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
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { StaleCardNudge } from '@/components/debts/StaleCardNudge';
import { CashManagementSection } from '@/components/debts/CashManagementSection';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';

export function LedgerDebts({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const [showMath, setShowMath] = useState(false);
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
  // What the debts cost each month, before any tax refund: the figure a
  // borrower feels. (A reset-cycle length used to sit here; it said
  // nothing about when the rate next moves.)
  const monthlyInterest = m.loans.reduce(
    (s, d) => s.add(new Decimal(d.loan.outstanding || 0).mul(d.loan.nominal_rate || 0).div(12)),
    new Decimal(0),
  );

  // Monthly interest on the loudest line = outstanding * (nominal / 12).
  // Use nominal not effective because that's what the bank charges; the
  // shield comes back at filing time, not month-to-month.
  const loudestMonthlyInt = new Decimal(loudest.loan.outstanding || 0)
    .mul(new Decimal(loudest.loan.nominal_rate || 0))
    .div(12)
    .toFixed(0);
  const breakdownProps = {
    marginalTaxRate: profile.marginalRate,
    country: profile.user.country,
    taxRegime: profile.user.country === 'IN' ? profile.user.tax_regime : undefined,
    incomeType: profile.user.income_type,
  };

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
            DEBTS · {m.loans.length} OPEN · AVERAGE EFFECTIVE RATE{' '}
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
                l: 'EFFECTIVE RATE',
                v: fmtPct(m.blendedEffective),
                s: 'AVERAGE · AFTER FEES + TAX',
              },
              {
                l: 'TOTAL EMI',
                v: totalEmi > 0 ? `${fc(totalEmi)}/MO` : '—',
                s: 'SCHEDULED',
              },
              {
                l: 'INTEREST',
                v: `${fc(monthlyInterest.toFixed(0))}/MO`,
                s: 'CHARGED THIS MONTH',
                tone: L_T.negative,
              },
            ]}
          />
        </section>

        <section>
          <LSectionHeader right={<LBracket href="/onboarding">+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · DETAILED
          </LSectionHeader>
          <LDebtsTable loans={m.loans} country={profile.user.country} />
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
                ['MONTHLY INT', fc(loudestMonthlyInt), 'CHARGED EACH MONTH'],
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
              {loudest.loan.loan_type === 'credit_card' ? 'CHEAPER CARD RATE →' : 'CHEAPER RATE →'}
            </LBracket>
            <LBracket onClick={() => setShowMath((v) => !v)} active={showMath}>
              {showMath ? 'HIDE MATH' : 'SHOW MATH'}
            </LBracket>
            <LBracket href="/insights#activity-ledger">MARK PAID</LBracket>
          </div>
          {showMath && (
            <div style={{ marginTop: 12 }}>
              <EffectiveAprBreakdown loan={loudest.loan} variant="inline" {...breakdownProps} />
            </div>
          )}
        </section>

        {/* Every loan's rate, worked out */}
        {m.loans.length > 1 && (
          <section>
            <LSectionHeader>HOW EACH RATE IS WORKED OUT</LSectionHeader>
            {m.loans.map((d, i) => (
              <details key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, padding: '8px 0' }}>
                <summary style={{ cursor: 'pointer', fontSize: 11, letterSpacing: '0.06em' }}>
                  {(d.loan.bank || '—').toUpperCase()} · {d.loan.loan_type.replace('_', ' ').toUpperCase()} ·{' '}
                  {fmtPct(d.nominal)} → <strong>{fmtPct(d.effective)}</strong>
                </summary>
                <div style={{ marginTop: 8 }}>
                  <EffectiveAprBreakdown loan={d.loan} variant="inline" {...breakdownProps} />
                </div>
              </details>
            ))}
          </section>
        )}

        <StaleCardNudge user={profile.user} />
        <CashManagementSection profile={profile} />
        <LifecycleEventsPanel user={profile.user} variant="ledger" />
      </div>
    </LShell>
  );
}

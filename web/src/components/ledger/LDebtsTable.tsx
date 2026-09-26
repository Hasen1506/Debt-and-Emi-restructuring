'use client';

/**
 * LDebtsTable + LTrajectory — the two reused data visuals.
 *
 * LDebtsTable: dashed-row debt list with optional POST-TAX column.
 * Highlights the loudest (highest effective APR) row with the yellow
 * wash, the EFFECTIVE cell in negative red, and the NEXT cell in
 * accent — mirrors the prototype contract exactly.
 *
 * LTrajectory: SVG line chart with grid + minimums dashed + avalanche
 * solid + accent square marker on the clear month.
 */

import type { Country, LoanType } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import type { LoanWithEffective } from '@/lib/derived';
import { L_T, L_MONO } from './primitives';

const LOAN_TYPE_SHORT: Record<LoanType, string> = {
  credit_card: 'CARD',
  personal_loan: 'PERS LOAN',
  home_loan: 'HOME',
  auto_loan: 'AUTO',
  education_loan: 'EDU',
  gold_loan: 'GOLD',
  bnpl: 'BNPL',
};

export function LDebtsTable({
  loans,
  country,
  showShield = false,
  mobile,
}: {
  loans: LoanWithEffective[];
  country: Country;
  showShield?: boolean;
  mobile?: boolean;
}) {
  if (loans.length === 0) {
    return (
      <div style={{ padding: 18, fontSize: 12, color: L_T.muted }}>
        $ NO OPEN POSITIONS · run <a href="/onboarding" style={{ color: L_T.accent }}>[SETUP]</a> to add loans.
      </div>
    );
  }

  const ccy = country === 'IN' ? 'INR' : 'USD';
  const fc = (v: string | number) => formatCurrency(v, ccy);
  const totalOutstanding = loans.reduce(
    (sum, d) => sum + Number(d.loan.outstanding || 0),
    0,
  );
  const totalEmi = loans.reduce((sum, d) => sum + Number(d.loan.scheduled_emi || 0), 0);
  const headers = [
    '#',
    'LENDER',
    'TYPE',
    'RATE',
    'EFFECTIVE',
    showShield ? 'POST-TAX' : null,
    'OUTSTANDING',
    'EMI',
    'TENURE',
    'NEXT',
  ].filter(Boolean) as string[];

  return (
    // Scrolls sideways on phones; focusable so the keyboard can scroll it.
    <div role="region" aria-label="Your debts" tabIndex={0} style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 11,
          minWidth: mobile ? 600 : 0,
          fontFamily: L_MONO,
        }}
      >
        <thead>
          <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
            {headers.map((h, i) => (
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
          {loans.map((d, i) => {
            const isHighest = i === 0;
            const tenureMo = Number(d.loan.tenure_months_remaining || 0);
            const tenureLabel =
              d.loan.loan_type === 'credit_card' ? 'REV' : tenureMo > 0 ? `${tenureMo}mo` : '—';
            const nextLabel = isHighest
              ? 'PAY EXTRA'
              : d.loan.rate_type === 'floating'
                ? 'AUTO · FLT'
                : 'AUTO';
            return (
              <tr
                key={i}
                style={{
                  borderBottom: `1px dashed ${L_T.faint}`,
                  background: isHighest ? L_T.highlight : 'transparent',
                }}
              >
                <td style={{ padding: '10px 12px', color: L_T.muted }}>
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                  {(d.loan.bank || '—').toUpperCase()}
                </td>
                <td style={{ padding: '10px 12px', color: L_T.muted }}>
                  {LOAN_TYPE_SHORT[d.loan.loan_type]}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtPct(d.nominal)}</td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: isHighest ? L_T.negative : L_T.ink,
                    fontWeight: isHighest ? 700 : 500,
                  }}
                >
                  {fmtPct(d.effective)}
                </td>
                {showShield && (
                  <td
                    style={{
                      padding: '10px 12px',
                      textAlign: 'right',
                      color: L_T.ink,
                    }}
                  >
                    {/* effective already folds the deduction shield in our
                     *  engine, so post-tax = effective. Listed in
                     *  LEDGER_MISSING.md as a parity gap with the prototype. */}
                    {fmtPct(d.effective)}
                  </td>
                )}
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                  {fc(d.loan.outstanding)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  {d.loan.scheduled_emi && Number(d.loan.scheduled_emi) > 0 ? fc(d.loan.scheduled_emi) : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: L_T.muted }}>
                  {tenureLabel}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: isHighest ? L_T.accent : L_T.muted,
                    fontWeight: isHighest ? 700 : 400,
                  }}
                >
                  {nextLabel}
                </td>
              </tr>
            );
          })}
          <tr style={{ borderTop: `2px solid ${L_T.ink}` }}>
            <td
              colSpan={showShield ? 6 : 5}
              style={{
                padding: '10px 12px',
                color: L_T.muted,
                letterSpacing: '0.1em',
                fontSize: 10,
              }}
            >
              TOTAL
            </td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
              {fc(totalOutstanding)}
            </td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
              {totalEmi > 0 ? fc(totalEmi) : '—'}
            </td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── LTrajectory ────────────────────────────────────────────────────────
export interface LTrajPoint {
  // 0..1 normalised positions
  t: number;
  av: number;
  min: number;
}

export function LTrajectory({
  points,
  clearLabel,
  axisLabels,
  yLabels,
  mobile,
}: {
  points: LTrajPoint[];
  clearLabel?: string;
  axisLabels?: string[];
  yLabels?: Array<{ y: number; l: string }>;
  mobile?: boolean;
}) {
  const w = mobile ? 320 : 800;
  const h = mobile ? 160 : 200;
  const toX = (t: number) => 40 + t * (w - 50);
  const toY = (v: number) => h - 30 - v * (h - 50);
  const path = (key: 'av' | 'min') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p[key]).toFixed(1)}`)
      .join(' ');
  const last = points[points.length - 1];
  const ys = yLabels ?? [
    { y: 1, l: 'HI' },
    { y: 0.5, l: '½' },
    { y: 0, l: '0' },
  ];
  const xs = axisLabels ?? [];
  return (
    <div style={{ border: `2px solid ${L_T.ink}`, padding: '8px 12px 4px', background: L_T.paper }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
          <line
            key={i}
            x1={40}
            x2={w - 10}
            y1={toY(g)}
            y2={toY(g)}
            stroke={i === 0 || i === 4 ? L_T.ink : L_T.faint}
            strokeWidth={i === 0 || i === 4 ? 1 : 0.4}
            strokeDasharray={i === 0 || i === 4 ? '' : '2 3'}
          />
        ))}
        {ys.map((g, i) => (
          <text
            key={i}
            x={32}
            y={toY(g.y) + 3}
            fontFamily={L_MONO}
            fontSize="9"
            fill={L_T.muted}
            textAnchor="end"
          >
            {g.l}
          </text>
        ))}
        <path d={path('min')} stroke={L_T.muted} strokeWidth="1" fill="none" strokeDasharray="4 3" />
        <path d={path('av')} stroke={L_T.ink} strokeWidth="2" fill="none" />
        {last && (
          <>
            <rect x={toX(last.t) - 4} y={toY(last.av) - 4} width="8" height="8" fill={L_T.accent} />
            {clearLabel && (
              <text
                x={toX(last.t) - 8}
                y={toY(last.av) - 10}
                fontFamily={L_MONO}
                fontSize="10"
                fill={L_T.accent}
                fontWeight="700"
                textAnchor="end"
              >
                {clearLabel}
              </text>
            )}
          </>
        )}
        {xs.map((d, i) => (
          <text
            key={i}
            x={toX(i / Math.max(1, xs.length - 1))}
            y={h - 6}
            fontFamily={L_MONO}
            fontSize="9"
            fill={L_T.muted}
            textAnchor="middle"
          >
            {d}
          </text>
        ))}
      </svg>
    </div>
  );
}

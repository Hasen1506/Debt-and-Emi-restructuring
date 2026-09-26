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

import { useEffect, useState } from 'react';
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

/**
 * Plan vs minimums, drawn at the container's real pixel width so the
 * labels stay readable on a phone (a fixed 800-wide viewBox shrank to
 * ~80 px tall with 3 px text at 390 px).
 *
 * `clear` marks the month the plan line reaches zero. It used to sit on
 * the last point of the chart, which is where the *minimums* line ends,
 * so "JUL 2029 · CLEAR" was drawn at 2046.
 */
export function LTrajectory({
  points,
  clear,
  axisLabels,
  yLabels,
  title,
}: {
  points: LTrajPoint[];
  clear?: { t: number; label: string };
  axisLabels?: Array<{ t: number; l: string }>;
  yLabels?: Array<{ y: number; l: string }>;
  /** Spoken summary of the chart for screen readers. */
  title?: string;
}) {
  const [w, ref] = useWidth(800);
  const narrow = w < 480;
  const h = narrow ? 180 : 200;
  const left = narrow ? 58 : 76;
  const right = 12;
  const toX = (t: number) => left + t * (w - left - right);
  const toY = (v: number) => h - 26 - v * (h - 44);
  const path = (key: 'av' | 'min') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p[key]).toFixed(1)}`)
      .join(' ');
  const ys = yLabels ?? [];
  // Keep first, middle and last date on a phone; all five otherwise.
  const xs = (axisLabels ?? []).filter(
    (_, i, all) => !narrow || i === 0 || i === all.length - 1 || i === Math.floor(all.length / 2),
  );
  const clearX = clear ? toX(clear.t) : 0;
  return (
    <div ref={ref} style={{ border: `2px solid ${L_T.ink}`, padding: '8px 0 4px', background: L_T.paper }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={title}
        style={{ display: 'block' }}
      >
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={left}
            x2={w - right}
            y1={toY(g)}
            y2={toY(g)}
            stroke={L_T.faint}
            strokeWidth={0.6}
            strokeDasharray="2 3"
          />
        ))}
        <line x1={left} x2={w - right} y1={toY(0)} y2={toY(0)} stroke={L_T.ink} strokeWidth={1} />
        {ys.map((g, i) => (
          <text
            key={i}
            x={left - 6}
            y={toY(g.y) + 3}
            fontFamily={L_MONO}
            fontSize="10"
            fill={L_T.muted}
            textAnchor="end"
          >
            {g.l}
          </text>
        ))}
        <path d={path('min')} stroke={L_T.muted} strokeWidth="1.2" fill="none" strokeDasharray="4 3" />
        <path d={path('av')} stroke={L_T.ink} strokeWidth="2" fill="none" />
        {clear && (
          <>
            <line
              x1={clearX}
              x2={clearX}
              y1={toY(1)}
              y2={toY(0)}
              stroke={L_T.accent}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <rect x={clearX - 4} y={toY(0) - 4} width="8" height="8" fill={L_T.accent} />
            <text
              x={clear.t > 0.6 ? clearX - 8 : clearX + 8}
              y={toY(0.12)}
              fontFamily={L_MONO}
              fontSize="10"
              fill={L_T.accent}
              fontWeight="700"
              textAnchor={clear.t > 0.6 ? 'end' : 'start'}
            >
              {clear.label}
            </text>
          </>
        )}
        {xs.map((d, i) => (
          <text
            key={i}
            x={toX(d.t)}
            y={h - 8}
            fontFamily={L_MONO}
            fontSize="10"
            fill={L_T.muted}
            textAnchor={d.t === 0 ? 'start' : d.t === 1 ? 'end' : 'middle'}
          >
            {d.l}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** Width of an element in CSS pixels, `fallback` until it has been measured. */
function useWidth(fallback: number): [number, (el: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(fallback);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [width, setEl];
}

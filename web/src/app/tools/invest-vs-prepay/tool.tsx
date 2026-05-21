'use client';

/**
 * Invest-vs-Prepay deep-dive tool.
 *
 * The /plan card answers the simple case (safe vehicles only). This tool
 * handles the harder case: variable-return options like equity / mutual
 * funds where you have a *distribution* of outcomes rather than a single
 * yield.
 *
 * v1 scope (this file):
 *   • User enters loan effective APR + their marginal tax rate.
 *   • Picks an instrument from a small catalogue (FD, tax-free bond,
 *     HYSA, Treasury, equity-MF) — instrument defaults populate the
 *     expected return + volatility sliders.
 *   • Deterministic comparison: nominal → after-tax → vs loan effective.
 *   • Risk-adjusted comparison: subtract one volatility-σ from expected
 *     return to get a conservative scenario; flips the verdict when
 *     the downside is below loan rate.
 *
 * Probabilistic Monte-Carlo + inflation-adjusted real-terms comparison
 * is queued for v2 (see ROADMAP / project memory).
 */

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
import { Stat } from '@/components/ToolPrimitives';
import { quarterlyCompound } from '@/lib/invest-vs-prepay';

const D = (v: string | number | Decimal) => new Decimal(v);

interface Instrument {
  key: string;
  name: string;
  /** Default expected nominal annual return (decimal). */
  defaultReturn: number;
  /** Default annualised volatility (1σ, decimal). 0 for fixed-income. */
  defaultVol: number;
  /** What fraction of returns is taxed at slab. 1 = fully taxed,
   *  0 = tax-free, 0.1 = LTCG on equity (10% in IN above ₹1L gain). */
  taxFraction: number;
  /** Free-text note shown under the instrument selector. */
  note: string;
  /** Compounding mode for the deterministic comparison. */
  compounding: 'simple' | 'quarterly' | 'monthly';
}

const INSTRUMENTS_IN: Instrument[] = [
  {
    key: 'fd_in',
    name: 'Bank FD',
    defaultReturn: 0.071,
    defaultVol: 0,
    taxFraction: 1,
    note: 'Quarterly compounding · taxed at slab',
    compounding: 'quarterly',
  },
  {
    key: 'tfb_in',
    name: 'Tax-free bonds (NHAI/REC)',
    defaultReturn: 0.0525,
    defaultVol: 0,
    taxFraction: 0,
    note: 'Coupon tax-free · semi-annual payment',
    compounding: 'simple',
  },
  {
    key: 'equity_mf_in',
    name: 'Equity Mutual Fund (Nifty/Flexicap)',
    defaultReturn: 0.12,
    defaultVol: 0.18,
    taxFraction: 0.1,
    note: 'Historical ~12% nominal · 18% std-dev · 10% LTCG above ₹1L',
    compounding: 'simple',
  },
];

const INSTRUMENTS_US: Instrument[] = [
  {
    key: 'hysa_us',
    name: 'HYSA (Marcus, Ally)',
    defaultReturn: 0.045,
    defaultVol: 0,
    taxFraction: 1,
    note: 'APY-quoted · taxed federal + state at slab',
    compounding: 'simple',
  },
  {
    key: 'treas_us',
    name: '1-yr US Treasury',
    defaultReturn: 0.05,
    defaultVol: 0,
    taxFraction: 0.8,
    note: 'Federal-only · state-exempt (approx ~20% shield)',
    compounding: 'simple',
  },
  {
    key: 'spx_us',
    name: 'S&P 500 index fund',
    defaultReturn: 0.10,
    defaultVol: 0.16,
    taxFraction: 0.15,
    note: 'Historical ~10% nominal · 16% std-dev · 15% LTCG',
    compounding: 'simple',
  },
];

export function InvestVsPrepayDeepTool() {
  const [country, setCountry] = useState<'IN' | 'US'>('IN');
  const [loanRatePct, setLoanRatePct] = useState('11');
  const [marginalPct, setMarginalPct] = useState('30');

  const instruments = country === 'IN' ? INSTRUMENTS_IN : INSTRUMENTS_US;
  const [instKey, setInstKey] = useState(instruments[0].key);
  const inst = instruments.find((i) => i.key === instKey) ?? instruments[0];

  const [expReturnPct, setExpReturnPct] = useState(
    (inst.defaultReturn * 100).toFixed(1),
  );
  const [volPct, setVolPct] = useState((inst.defaultVol * 100).toFixed(1));

  function applyInstrument(key: string) {
    const next = instruments.find((i) => i.key === key) ?? instruments[0];
    setInstKey(key);
    setExpReturnPct((next.defaultReturn * 100).toFixed(1));
    setVolPct((next.defaultVol * 100).toFixed(1));
  }

  function applyCountry(c: 'IN' | 'US') {
    setCountry(c);
    const next = (c === 'IN' ? INSTRUMENTS_IN : INSTRUMENTS_US)[0];
    setInstKey(next.key);
    setExpReturnPct((next.defaultReturn * 100).toFixed(1));
    setVolPct((next.defaultVol * 100).toFixed(1));
  }

  const result = useMemo(() => {
    const loan = D(loanRatePct).div(100);
    const marginal = D(marginalPct).div(100);
    const expReturn = D(expReturnPct).div(100);
    const vol = D(volPct).div(100);

    // Compounding
    let preTax: Decimal;
    if (inst.compounding === 'quarterly') preTax = quarterlyCompound(expReturn);
    else if (inst.compounding === 'monthly') {
      preTax = expReturn.div(12).plus(1).pow(12).minus(1);
    } else preTax = expReturn;

    // After-tax: only the taxable fraction is taxed at the user's marginal.
    // For LTCG-treated instruments the taxFraction here represents the
    // *effective* tax rate (e.g. 0.1 = 10% LTCG flat, not 10% of marginal).
    const isLtcg = inst.taxFraction > 0 && inst.taxFraction < 1;
    let afterTax: Decimal;
    if (isLtcg) {
      // Treat taxFraction as flat LTCG rate.
      afterTax = preTax.mul(D('1').minus(D(inst.taxFraction)));
    } else if (inst.taxFraction === 0) {
      afterTax = preTax;
    } else {
      afterTax = preTax.mul(D('1').minus(marginal));
    }

    // Downside scenario: expected return - 1σ. Volatility is annualized.
    // For fixed-income (vol=0) this collapses to expected return.
    const downsideReturn = expReturn.minus(vol);
    let downsidePreTax: Decimal;
    if (inst.compounding === 'quarterly') {
      // Cap at zero so quarterly comp formula doesn't blow up for very
      // negative inputs.
      downsidePreTax = downsideReturn.lt(D('-0.99'))
        ? D('-0.99')
        : quarterlyCompound(downsideReturn);
    } else {
      downsidePreTax = downsideReturn;
    }
    let downsideAfterTax: Decimal;
    if (downsidePreTax.lte(0)) {
      // No tax on negative returns
      downsideAfterTax = downsidePreTax;
    } else if (isLtcg) {
      downsideAfterTax = downsidePreTax.mul(D('1').minus(D(inst.taxFraction)));
    } else if (inst.taxFraction === 0) {
      downsideAfterTax = downsidePreTax;
    } else {
      downsideAfterTax = downsidePreTax.mul(D('1').minus(marginal));
    }

    const expectedSpread = afterTax.minus(loan);
    const downsideSpread = downsideAfterTax.minus(loan);

    let verdict: 'prepay' | 'invest' | 'borderline';
    let explanation: string;
    if (expectedSpread.gt(D('0.005'))) {
      if (downsideSpread.gt(0)) {
        verdict = 'invest';
        explanation = `Even in the conservative scenario (return - 1σ), ${inst.name} after-tax beats your loan. Reasonable case to invest.`;
      } else {
        verdict = 'borderline';
        explanation = `Expected ${inst.name} after-tax beats your loan by ${expectedSpread.mul(100).toFixed(2)}%/yr, but the conservative scenario flips negative (${downsideSpread.mul(100).toFixed(2)}%/yr). You're being paid a premium for taking on volatility — prepay if you don't want that risk; invest if you do.`;
      }
    } else if (expectedSpread.lt(D('-0.005'))) {
      verdict = 'prepay';
      explanation = `Loan effective rate beats ${inst.name} after-tax by ${expectedSpread.abs().mul(100).toFixed(2)}%/yr in the expected case. Prepay.`;
    } else {
      verdict = 'borderline';
      explanation = `Within 50 bps either way. Math doesn't favor either path; pick on non-financial factors (liquidity, behavioral commitment).`;
    }

    return {
      preTax,
      afterTax,
      downsideAfterTax,
      expectedSpread,
      downsideSpread,
      verdict,
      explanation,
    };
  }, [loanRatePct, marginalPct, expReturnPct, volPct, inst]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Field label="Country">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['IN', 'US'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => applyCountry(c)}
                  className="chip"
                  style={{
                    background: c === country ? 'var(--accent)' : 'transparent',
                    color: c === country ? 'var(--canvas)' : 'var(--ink)',
                    borderColor: c === country ? 'var(--accent)' : 'var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Loan effective APR (%)">
            <NumInput value={loanRatePct} onChange={setLoanRatePct} />
          </Field>

          <Field label="Your marginal tax rate (%)">
            <NumInput value={marginalPct} onChange={setMarginalPct} />
          </Field>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Instrument</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Pick what you&apos;d invest the surplus in instead of prepaying.
          Defaults pre-fill; you can override expected return and volatility.
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 10,
          }}
        >
          {instruments.map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => applyInstrument(i.key)}
              className="chip"
              style={{
                background: i.key === instKey ? 'var(--accent)' : 'transparent',
                color: i.key === instKey ? 'var(--canvas)' : 'var(--ink)',
                borderColor: i.key === instKey ? 'var(--accent)' : 'var(--border)',
                cursor: 'pointer',
              }}
            >
              {i.name}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          {inst.note}
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <Field label="Expected nominal return (%)">
            <NumInput value={expReturnPct} onChange={setExpReturnPct} />
          </Field>
          <Field label="Annual volatility, 1σ (%)">
            <NumInput value={volPct} onChange={setVolPct} />
          </Field>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
          Verdict ·{' '}
          <span
            style={{
              color:
                result.verdict === 'prepay'
                  ? 'var(--positive)'
                  : result.verdict === 'invest'
                    ? 'var(--accent)'
                    : 'var(--muted-ink)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {result.verdict}
          </span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          {result.explanation}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <Stat
            label="Loan effective"
            value={`${D(loanRatePct).toFixed(2)}%`}
          />
          <Stat
            label="Instrument · after-tax"
            value={`${result.afterTax.mul(100).toFixed(2)}%`}
          />
          <Stat
            label="Conservative (− 1σ)"
            value={`${result.downsideAfterTax.mul(100).toFixed(2)}%`}
          />
          <Stat
            label="Expected spread"
            value={`${result.expectedSpread.mul(100).toFixed(2)}%`}
          />
        </div>
      </Card>

      <div className="muted" style={{ fontSize: 11 }}>
        v1: deterministic comparison + 1σ downside check. Probabilistic
        Monte-Carlo and inflation-adjusted real-terms comparison coming next.
        For the simple case (safe vehicles only), the card on /plan handles it.
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
      <span className="muted" style={{ fontSize: 11 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '6px 8px',
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--canvas)',
        color: 'var(--ink)',
        fontSize: 13,
        width: 120,
      }}
    />
  );
}

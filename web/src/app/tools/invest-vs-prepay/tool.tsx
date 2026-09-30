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
import { InfoTip, Stat } from '@/components/ToolPrimitives';
import {
  CLOSE_CALL,
  SAFE_RATES,
  afterTaxReturn,
  formatAsOf,
  quarterlyCompound,
  returnTaxRate,
  type ReturnTax,
} from '@/lib/invest-vs-prepay';
import { simulateMonteCarlo } from '@/lib/monte-carlo';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { deriveMetrics } from '@/lib/derived';

const D = (v: string | number | Decimal) => new Decimal(v);

interface Instrument {
  key: string;
  name: string;
  /** Default expected nominal annual return (decimal). */
  defaultReturn: number;
  /** Default annualised volatility (1σ, decimal). 0 for fixed-income. */
  defaultVol: number;
  /** How the return is taxed: at the user's rate (or a share of it),
   *  at a flat capital-gains rate, or not at all. */
  tax: ReturnTax;
  /** Free-text note shown under the instrument selector. */
  note: string;
  /** Compounding mode for the deterministic comparison. */
  compounding: 'simple' | 'quarterly' | 'monthly';
  /** For fixed-income defaults: the day the yield was true, and its source
   *  (shared with the /plan card through SAFE_RATES). */
  asOf?: string;
  source?: string;
}

/** A fixed-income instrument from the same dated yields /plan uses. */
function safe(key: keyof typeof SAFE_RATES, name: string, note: string): Instrument {
  const r = SAFE_RATES[key];
  return {
    key,
    name,
    defaultReturn: Number(r.rate),
    defaultVol: 0,
    tax: r.tax,
    note,
    compounding: r.compounding,
    asOf: r.asOf,
    source: r.source,
  };
}

const INSTRUMENTS_IN: Instrument[] = [
  safe('fd_in', 'Bank FD', 'Quarterly compounding · taxed at slab'),
  safe('tax_free_bond_in', 'Tax-free bonds (NHAI/REC)', 'Coupon tax-free · semi-annual payment'),
  {
    key: 'equity_mf_in',
    name: 'Equity Mutual Fund (Nifty/Flexicap)',
    defaultReturn: 0.12,
    defaultVol: 0.18,
    tax: { kind: 'flat', rate: 0.125 },
    note: 'Historical ~12% nominal · 18% std-dev · 12.5% LTCG above ₹1.25L',
    compounding: 'simple',
  },
];

const INSTRUMENTS_US: Instrument[] = [
  safe('hysa_us', 'HYSA (Marcus, Ally)', 'APY-quoted · taxed federal + state at slab'),
  safe('treasury_us', '1-yr US Treasury',
    'Federal tax only · state-exempt, so taxed at ~80% of your rate'),
  {
    key: 'spx_us',
    name: 'S&P 500 index fund',
    defaultReturn: 0.10,
    defaultVol: 0.16,
    tax: { kind: 'flat', rate: 0.15 },
    note: 'Historical ~10% nominal · 16% std-dev · 15% LTCG',
    compounding: 'simple',
  },
];

/** A Decimal from a text field, or null when it isn't a number. */
function parseNum(v: string): Decimal | null {
  if (v.trim() === '') return null;
  try {
    const d = D(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function InvestVsPrepayDeepTool() {
  // Start from the profile: its country, its dearest loan's effective
  // rate and its tax rate (these used to default to India, 11% and 30%).
  const profile = useStoredProfile();
  const loudest = useMemo(() => deriveMetrics(profile).loudest, [profile]);
  const [country, setCountry] = useState<'IN' | 'US'>(profile.user.country);
  const [loanRatePct, setLoanRatePct] = useState(
    loudest ? (Number(loudest.effective) * 100).toFixed(2) : '11',
  );
  const [marginalPct, setMarginalPct] = useState(
    (Number(profile.marginalRate ?? 0.3) * 100).toFixed(0),
  );
  // Holding period for the Monte Carlo simulation — equity returns
  // converge over longer windows, so this knob meaningfully shifts the
  // probability of beating a fixed-rate loan.
  const [yearsHeld, setYearsHeld] = useState('5');
  // Inflation rate for the real-terms comparison. Defaults to typical
  // CPI by country; user can edit.
  const [inflationPct, setInflationPct] = useState(
    profile.user.inflation_rate && Number(profile.user.inflation_rate) > 0
      ? (Number(profile.user.inflation_rate) * 100).toFixed(1)
      : profile.user.country === 'US' ? '3' : '6',
  );

  const instruments = country === 'IN' ? INSTRUMENTS_IN : INSTRUMENTS_US;
  const [instKey, setInstKey] = useState(instruments[0].key);
  const inst = instruments.find((i) => i.key === instKey) ?? instruments[0];

  const [expReturnPct, setExpReturnPct] = useState(
    (inst.defaultReturn * 100).toFixed(2),
  );
  const [volPct, setVolPct] = useState((inst.defaultVol * 100).toFixed(1));
  // A dated default yield is fine for a clear answer. When the answer is
  // within a point, it turns on today's yield: the verdict waits until the
  // user types one in, or says to use the default anyway.
  const [yieldConfirmed, setYieldConfirmed] = useState(false);

  function applyInstrument(key: string) {
    const next = instruments.find((i) => i.key === key) ?? instruments[0];
    setInstKey(key);
    setExpReturnPct((next.defaultReturn * 100).toFixed(2));
    setVolPct((next.defaultVol * 100).toFixed(1));
    setYieldConfirmed(false);
  }

  function applyCountry(c: 'IN' | 'US') {
    setCountry(c);
    const next = (c === 'IN' ? INSTRUMENTS_IN : INSTRUMENTS_US)[0];
    setInstKey(next.key);
    setExpReturnPct((next.defaultReturn * 100).toFixed(2));
    setVolPct((next.defaultVol * 100).toFixed(1));
    setInflationPct(c === 'IN' ? '6' : '3');
    setYieldConfirmed(false);
  }

  const result = useMemo(() => {
    const loanIn = parseNum(loanRatePct);
    const marginalIn = parseNum(marginalPct);
    const returnIn = parseNum(expReturnPct);
    const volIn = parseNum(volPct);
    if (!loanIn || !marginalIn || !returnIn || !volIn || loanIn.lt(0) || loanIn.gt(100)
      || marginalIn.lt(0) || marginalIn.gt(100) || returnIn.lte(-100) || returnIn.gt(1000)
      || volIn.lt(0) || volIn.gt(500)) return null;
    const loan = loanIn.div(100);
    const marginal = Decimal.min(1, Decimal.max(0, marginalIn.div(100)));
    const expReturn = returnIn.div(100);
    const vol = Decimal.max(0, volIn.div(100));

    // Compounding
    let preTax: Decimal;
    if (inst.compounding === 'quarterly') preTax = quarterlyCompound(expReturn);
    else if (inst.compounding === 'monthly') {
      preTax = expReturn.div(12).plus(1).pow(12).minus(1);
    } else preTax = expReturn;

    // After tax, by the instrument's rule: the user's rate (a Treasury pays
    // ~80% of it), a flat capital-gains rate, or none. /plan uses the same.
    const afterTax = afterTaxReturn(preTax, inst.tax, marginal);

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
    // No tax on negative returns.
    const downsideAfterTax = afterTaxReturn(downsidePreTax, inst.tax, marginal);

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

  // Monte Carlo distribution. For fixed-income instruments (vol=0) the
  // result collapses to a deterministic point — we still run the sim
  // because the distribution UI degrades gracefully.
  const mc = useMemo(() => {
    if(!result) return null;
    const years = parseNum(yearsHeld);
    const infl = parseNum(inflationPct);
    if(!years || years.lte(0) || years.gt(100) || !infl || infl.lt(0) || infl.gt(100)) return null;
    const expReturn = result.preTax.toNumber();
    const vol = Math.max(0, Number(volPct) / 100);
    const taxRate = Number(
      returnTaxRate(inst.tax, Math.min(1, Math.max(0, Number(marginalPct) / 100 || 0))),
    );
    const inflation = Math.max(0, Number(inflationPct) / 100);
    return simulateMonteCarlo({
      expectedReturn: expReturn,
      volatility: vol,
      years: years.toNumber(),
      taxRate,
      inflation,
      trials: 5000,
    });
  }, [result, volPct, marginalPct, yearsHeld, inflationPct, inst]);

  // The default is dated and the answer is close: ask for today's yield.
  const needsYield =
    result !== null &&
    Boolean(inst.asOf) &&
    !yieldConfirmed &&
    result.expectedSpread.abs().lt(CLOSE_CALL);

  const loanRateDecimal = Number(loanRatePct) / 100;
  const probBeatNominal = mc?.probBeatLoanNominal(loanRateDecimal) ?? 0;
  const probPositiveReal = mc?.probBeatLoanReal(0) ?? 0;

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
          {inst.asOf && inst.source && (
            <>
              {' '}· default {(inst.defaultReturn * 100).toFixed(2)}% is the{' '}
              {inst.source}, {formatAsOf(inst.asOf)}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <Field label={inst.asOf ? "Today's yield (%)" : 'Expected nominal return (%)'}>
            <NumInput
              value={expReturnPct}
              onChange={(v) => {
                setExpReturnPct(v);
                setYieldConfirmed(true);
              }}
            />
          </Field>
          <Field label="Annual volatility, 1σ (%)">
            <NumInput value={volPct} onChange={setVolPct} />
          </Field>
        </div>
      </Card>

      <Card>
        {result === null ? (
          <div style={{ fontSize: 13 }} role="status">
            Enter a number for the loan rate, your tax rate, the return and
            the volatility to see a verdict.
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              Verdict ·{' '}
              <span
                style={{
                  color: needsYield
                    ? 'var(--muted-ink)'
                    : result.verdict === 'prepay'
                      ? 'var(--positive)'
                      : result.verdict === 'invest'
                        ? 'var(--accent)'
                        : 'var(--muted-ink)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {needsYield ? 'check the yield' : result.verdict}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
              {needsYield && inst.asOf ? (
                <>
                  {inst.name} after tax ({result.afterTax.mul(100).toFixed(2)}%)
                  is within a point of your loan ({D(loanRatePct).toFixed(2)}%),
                  so the answer turns on the exact yield. The{' '}
                  {(inst.defaultReturn * 100).toFixed(2)}% default is the{' '}
                  {inst.source}, {formatAsOf(inst.asOf)}. Enter today&apos;s
                  yield above, or{' '}
                  <button
                    type="button"
                    onClick={() => setYieldConfirmed(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--accent)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    use {(inst.defaultReturn * 100).toFixed(2)}% anyway
                  </button>
                  .
                </>
              ) : (
                result.explanation
              )}
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
          </>
        )}
      </Card>

      <Card>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Probabilistic comparison
          <InfoTip>
            <strong>What this adds.</strong> The verdict above is one
            expected case + one 1σ downside. This block runs 5,000
            trials of annual returns drawn from a log-normal
            distribution with your stated mean and volatility, then
            compounds each trial over the holding period.
            <div style={{ marginTop: 8 }}>
              <strong>Key reads.</strong> P(beat loan) is the share of
              trials where your after-tax annualized return tops the
              loan rate. The 5th / 50th / 95th percentiles bracket your
              realistic best-and-worst case.
            </div>
            <div style={{ marginTop: 8 }}>
              <strong>Real vs nominal.</strong> Real-terms strips out
              inflation — useful because a 7% FD against 6% CPI is
              barely positive in actual buying power. We show both side
              by side. Beating the inflation-adjusted loan has the same probability as beating its nominal rate; purchasing-power probability instead compares real returns with zero.
            </div>
          </InfoTip>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {yearsHeld}-year holding period, 5,000 trials.
          Inflation drag of {inflationPct}% applied for the real-terms column.
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
          <Field label="Years held">
            <NumInput value={yearsHeld} onChange={setYearsHeld} />
          </Field>
          <Field label="Inflation (%)">
            <NumInput value={inflationPct} onChange={setInflationPct} />
          </Field>
        </div>

        {!mc && <p role="alert">Enter valid returns, tax (0–100%), volatility (0–500%), holding period (0–100 years) and inflation (0–100%).</p>}
        {mc && <>
        <div
          style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:12}}
        >
          <Stat
            label="P(beat loan, nominal)"
            value={`${(probBeatNominal * 100).toFixed(0)}%`}
          />
          <Stat
            label="P(preserve purchasing power)"
            value={`${(probPositiveReal * 100).toFixed(0)}%`}
          />
          <Stat
            label="Median nominal after-tax"
            value={`${(mc.percentilesNominal[50] * 100).toFixed(2)}%`}
          />
          <Stat
            label="Median real after-tax"
            value={`${(mc.percentilesReal[50] * 100).toFixed(2)}%`}
          />
        </div>

        <table
          style={{
            width: '100%',
            marginTop: 14,
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
              <th style={{ textAlign: 'left', padding: '6px 0' }}>Percentile</th>
              <th style={{ textAlign: 'right', padding: '6px 0' }}>Nominal after-tax</th>
              <th style={{ textAlign: 'right', padding: '6px 0' }}>Real after-tax</th>
            </tr>
          </thead>
          <tbody>
            {([5, 25, 50, 75, 95] as const).map((p) => (
              <tr key={p} style={{ borderBottom: '1px dashed var(--border)' }}>
                <td style={{ padding: '4px 0' }}>p{p}</td>
                <td style={{ textAlign: 'right', padding: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
                  {(mc.percentilesNominal[p] * 100).toFixed(2)}%
                </td>
                <td style={{ textAlign: 'right', padding: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
                  {(mc.percentilesReal[p] * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: 'var(--soft-bg)',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          <strong>How to read this.</strong>{' '}
          {probBeatNominal >= 0.75 ? (
            <>
              {(probBeatNominal * 100).toFixed(0)}% of trials beat your{' '}
              {loanRatePct}% loan in nominal terms — investing wins clearly
              in the expected case. {probPositiveReal < 0.5 && (
                <>
                  Only {(probPositiveReal * 100).toFixed(0)}%
                  of trials preserve purchasing power after inflation. This is a separate cash-return hurdle.
                </>
              )}
            </>
          ) : probBeatNominal <= 0.4 ? (
            <>
              Only {(probBeatNominal * 100).toFixed(0)}% of trials beat your
              loan — prepaying is the safer bet, math agrees with intuition.
            </>
          ) : (
            <>
              Coin-flippy: {(probBeatNominal * 100).toFixed(0)}% of trials
              beat the loan. You&apos;re paid a small expected premium for
              taking on the volatility; if you can stomach the worst-case
              p5 of {(mc.percentilesNominal[5] * 100).toFixed(2)}%/yr,
              invest. Otherwise prepay.
            </>
          )}
        </div>
        </>}
      </Card>

      <div className="muted" style={{ fontSize: 11 }}>
        v2: deterministic baseline + 5,000-trial Monte Carlo + real-terms
        adjustment. Log-normal returns; tax treatment per instrument
        (LTCG flat for equity, your rate for FDs/HYSAs, ~80% of it for
        Treasuries). Fixed-income defaults match the /plan card.
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

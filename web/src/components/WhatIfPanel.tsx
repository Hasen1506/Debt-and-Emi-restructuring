'use client';

/**
 * /plan what-if sliders. Three independent scenarios run against the engine's
 * sensitivity comparator — surplus, rate shock, lump-sum. Each slider
 * debounces its own POST and shows months pulled forward + interest saved
 * versus baseline. §4.22-ish (sensitivity sliders).
 *
 * Slider caps are derived from the live profile so the user can't drag past
 * physical limits (you can't "cut" more than you actually spend, and a
 * one-time payment can't exceed total outstanding).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import {
  api,
  formatINR,
  type CompareResponse,
  type UserPayload,
} from '@/lib/api';
import { computeBreakdown } from '@/lib/effective-apr';

type ScenarioKey = 'surplus' | 'rate' | 'lump';

interface ScenarioState {
  loading: boolean;
  result: CompareResponse | null;
  error: string | null;
}

const INITIAL: ScenarioState = { loading: false, result: null, error: null };

export function WhatIfPanel({
  user,
  marginalRate,
}: {
  user: UserPayload;
  marginalRate: string;
}) {
  // Derive realistic slider ceilings + the default "Applied to" loan from
  // the live profile. The user complained about a hardcoded 50k cap and a
  // random lump-sum default; both come from these.
  const { fixedExpensesCap, totalOutstandingCap, loanOptions, defaultLoanIdx } =
    useMemo(() => {
      const fixed = Math.max(0, Math.round(Number(user.fixed_expenses || 0)));
      const total = Math.max(
        0,
        Math.round(
          user.loans.reduce((s, l) => s + Number(l.outstanding || 0), 0),
        ),
      );
      const ranked = user.loans
        .map((l, i) => {
          const { effective } = computeBreakdown(
            l,
            marginalRate,
            user.country,
            user.tax_regime,
          );
          return { i, l, effective, outstanding: new Decimal(l.outstanding || 0) };
        })
        .filter((r) => r.outstanding.gt(0))
        .sort((a, b) => b.effective.cmp(a.effective));
      const top = ranked[0]?.i ?? 0;
      const opts = user.loans.map((l, i) => ({
        value: i,
        label: `${l.bank || 'Unnamed'} · ${l.loan_type.replace('_', ' ')} (${formatINR(l.outstanding)})`,
        isTop: i === top,
      }));
      return {
        fixedExpensesCap: fixed,
        totalOutstandingCap: total,
        loanOptions: opts,
        defaultLoanIdx: top,
      };
    }, [user, marginalRate]);

  // Surplus delta: ₹/month extra (positive = more cash to debts).
  const [surplusDelta, setSurplusDelta] = useState(0);
  // Rate shock: basis points applied to floating rates.
  const [rateShockBps, setRateShockBps] = useState(0);
  // Lump sum + target loan.
  const [lumpAmount, setLumpAmount] = useState(0);
  const [lumpTarget, setLumpTarget] = useState(defaultLoanIdx);

  const [surplus, setSurplus] = useState<ScenarioState>(INITIAL);
  const [rate, setRate] = useState<ScenarioState>(INITIAL);
  const [lump, setLump] = useState<ScenarioState>(INITIAL);

  useDebouncedScenario(
    surplusDelta,
    setSurplus,
    async () =>
      surplusDelta === 0
        ? null
        : api.sensitivity({
            user,
            marginal_rate: marginalRate,
            strategy: 'avalanche',
            horizon_months: 240,
            surplus_delta: String(surplusDelta),
          }),
  );

  useDebouncedScenario(
    rateShockBps,
    setRate,
    async () =>
      rateShockBps === 0
        ? null
        : api.sensitivity({
            user,
            marginal_rate: marginalRate,
            strategy: 'avalanche',
            horizon_months: 240,
            rate_shock_delta: (rateShockBps / 10_000).toFixed(4),
            rate_shock_floating_only: true,
          }),
  );

  useDebouncedScenario(
    `${lumpAmount}|${lumpTarget}`,
    setLump,
    async () =>
      lumpAmount === 0
        ? null
        : api.sensitivity({
            user,
            marginal_rate: marginalRate,
            strategy: 'avalanche',
            horizon_months: 240,
            lump_sum_amount: String(lumpAmount),
            lump_sum_target_loan_index: lumpTarget,
          }),
  );

  // Step size scales with the ceiling so the slider stays usable whether
  // fixed expenses are ₹10k or ₹2L (1% rounded to the nearest 100/500/1000).
  const surplusStep = roundStep(fixedExpensesCap / 50, 100);
  const lumpStep = roundStep(totalOutstandingCap / 100, 1_000);

  const summary = (s: CompareResponse | null, positive: boolean): string | null => {
    if (!s) return null;
    const months = Math.round(Number(s.months_pulled_forward));
    const interest = Number(s.interest_saved);
    if (months === 0 && interest === 0) return 'No change';
    const direction = (months > 0) === positive ? 'forward' : 'back';
    const monthsTxt =
      months !== 0
        ? `Pulls debt-free date ${direction} by ${Math.abs(months)} month${Math.abs(months) === 1 ? '' : 's'}`
        : '';
    const interestTxt =
      interest !== 0
        ? `${interest > 0 ? 'saves' : 'adds'} ${formatINR(Math.abs(interest))} in interest`
        : '';
    return [monthsTxt, interestTxt].filter(Boolean).join(' · ');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SliderRow
        title="Cut fixed expenses"
        hint={
          fixedExpensesCap > 0
            ? `Imagine trimming up to ₹${fixedExpensesCap.toLocaleString('en-IN')} from your monthly fixed expenses and redirecting that cash to debt. The most you can cut is what you actually spend.`
            : 'Add your fixed expenses in setup to use this slider.'
        }
        unit="/mo"
        min={0}
        max={Math.max(fixedExpensesCap, 1_000)}
        step={surplusStep}
        value={surplusDelta}
        onChange={setSurplusDelta}
        formatValue={(v) => (v === 0 ? 'no change' : `+${formatINR(v)}`)}
        state={surplus}
        positive
        summary={summary(surplus.result, true)}
        disabled={fixedExpensesCap <= 0}
      />

      <SliderRow
        title="If interest rates change"
        hint="Models what happens if floating-rate loans (most home loans) reprice up or down. 100 bps = 1 percentage point. Fixed-rate loans like personal loans and cards are unaffected."
        unit="bps"
        min={-200}
        max={300}
        step={25}
        value={rateShockBps}
        onChange={setRateShockBps}
        formatValue={(v) =>
          v === 0
            ? 'no change'
            : `${v > 0 ? '+' : ''}${v} bps (${(v / 100).toFixed(2)}pp)`
        }
        state={rate}
        positive={false}
        summary={summary(rate.result, false)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 12 }}>
        <SliderRow
          title="One-time lump-sum payment"
          hint={
            totalOutstandingCap > 0
              ? `A windfall — bonus, tax refund, gift — applied today against the loan chosen on the right. Capped at your total outstanding (${formatINR(totalOutstandingCap)}).`
              : 'Add your loans in setup to use this slider.'
          }
          unit=""
          min={0}
          max={Math.max(totalOutstandingCap, 10_000)}
          step={Math.max(lumpStep, 1_000)}
          value={lumpAmount}
          onChange={setLumpAmount}
          formatValue={(v) => (v === 0 ? 'no payment' : formatINR(v))}
          state={lump}
          positive
          summary={summary(lump.result, true)}
          disabled={totalOutstandingCap <= 0}
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Apply lump-sum to
          </span>
          <select
            value={lumpTarget}
            onChange={(e) => setLumpTarget(Number(e.target.value))}
            style={{
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--canvas)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
          >
            {loanOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.isTop ? '★ ' : ''}
                {o.label}
              </option>
            ))}
          </select>
          <span
            className="muted"
            style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}
          >
            ★ = highest effective APR (avalanche pick). Mathematically the
            best target unless you need a psychological quick win.
          </span>
        </label>
      </div>
    </div>
  );
}

function roundStep(value: number, base: number): number {
  if (value <= base) return base;
  return Math.max(base, Math.round(value / base) * base);
}

// ─────────────────────────────────────────────────────────────────────────────

function SliderRow({
  title,
  hint,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
  state,
  positive,
  summary,
  disabled,
}: {
  title: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue: (v: number) => string;
  state: ScenarioState;
  positive: boolean;
  /** Plain-language one-liner shown below the numeric result. */
  summary?: string | null;
  disabled?: boolean;
}) {
  const months = state.result
    ? Math.round(Number(state.result.months_pulled_forward))
    : 0;
  const interest = state.result?.interest_saved ?? '0';
  const monthsColor =
    months === 0
      ? 'var(--muted)'
      : (months > 0) === positive
        ? 'var(--positive)'
        : 'var(--negative)';

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        display: 'grid',
        gridTemplateColumns: '1fr 220px',
        gap: 16,
        alignItems: 'center',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <span className="num muted" style={{ fontSize: 12 }}>
            {formatValue(value)}
            {unit}
          </span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          style={{ width: '100%', marginTop: 6 }}
        />
        <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
          {hint}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 200 }}>
        {state.loading ? (
          <span className="muted" style={{ fontSize: 12 }}>
            computing…
          </span>
        ) : state.error ? (
          <span style={{ color: 'var(--negative)', fontSize: 12 }}>
            {state.error}
          </span>
        ) : state.result ? (
          <>
            <div
              className="num"
              style={{ fontSize: 18, fontWeight: 600, color: monthsColor }}
            >
              {months > 0 ? '−' : months < 0 ? '+' : ''}
              {Math.abs(months)} mo
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              interest{' '}
              <span
                className="num"
                style={{
                  color:
                    Number(interest) > 0
                      ? 'var(--positive)'
                      : Number(interest) < 0
                        ? 'var(--negative)'
                        : 'var(--muted)',
                }}
              >
                {Number(interest) >= 0 ? '−' : '+'}
                {formatINR(Math.abs(Number(interest)))}
              </span>
            </div>
            {summary && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  marginTop: 4,
                  lineHeight: 1.5,
                  fontStyle: 'italic',
                }}
              >
                {summary}
              </div>
            )}
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            move slider →
          </span>
        )}
      </div>
    </div>
  );
}

function useDebouncedScenario(
  key: unknown,
  setState: (s: ScenarioState) => void,
  fetcher: () => Promise<CompareResponse | null>,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState({ loading: true, result: null, error: null });
      try {
        const r = await fetcher();
        if (r === null) {
          setState({ loading: false, result: null, error: null });
        } else {
          setState({ loading: false, result: r, error: null });
        }
      } catch (e) {
        setState({ loading: false, result: null, error: (e as Error).message });
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // fetcher reference changes each render, intentionally ignore;
    // we re-debounce when `key` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}


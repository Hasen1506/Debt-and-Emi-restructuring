'use client';

/**
 * /plan what-if sliders. Three independent scenarios run against the engine's
 * sensitivity comparator — surplus, rate shock, lump-sum. Each slider
 * debounces its own POST and shows months pulled forward + interest saved
 * versus baseline. §4.22-ish (sensitivity sliders).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  formatINR,
  type CompareResponse,
  type UserPayload,
} from '@/lib/api';

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
  // Surplus delta: ₹/month extra (positive = more cash to debts).
  const [surplusDelta, setSurplusDelta] = useState(0);
  // Rate shock: basis points applied to floating rates.
  const [rateShockBps, setRateShockBps] = useState(0);
  // Lump sum + target loan.
  const [lumpAmount, setLumpAmount] = useState(0);
  const [lumpTarget, setLumpTarget] = useState(0);

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

  const loanOptions = useMemo(
    () =>
      user.loans.map((l, i) => ({
        value: i,
        label: `${l.bank} · ${l.loan_type.replace('_', ' ')} (${formatINR(l.outstanding)})`,
      })),
    [user.loans],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SliderRow
        title="Cut fixed expenses"
        hint="Slide right to redirect more cash to debts. Engine: surplus_delta."
        unit="/mo"
        min={0}
        max={50_000}
        step={1_000}
        value={surplusDelta}
        onChange={setSurplusDelta}
        formatValue={(v) => (v === 0 ? 'no change' : `+${formatINR(v)}`)}
        state={surplus}
        positive
      />

      <SliderRow
        title="Floating rates rise / fall"
        hint="Basis points applied to every floating-rate loan. Engine: rate_shock_delta."
        unit="bps"
        min={-200}
        max={300}
        step={25}
        value={rateShockBps}
        onChange={setRateShockBps}
        formatValue={(v) => (v === 0 ? 'no shock' : `${v > 0 ? '+' : ''}${v} bps`)}
        state={rate}
        positive={false}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 12 }}>
        <SliderRow
          title="One-time lump sum"
          hint="Apply once today against the chosen loan. Engine: lump_sum_amount."
          unit=""
          min={0}
          max={Math.max(500_000, lumpAmount)}
          step={5_000}
          value={lumpAmount}
          onChange={setLumpAmount}
          formatValue={(v) => (v === 0 ? 'no payment' : formatINR(v))}
          state={lump}
          positive
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Applied to
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
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
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
        gridTemplateColumns: '1fr 200px',
        gap: 16,
        alignItems: 'center',
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
          style={{ width: '100%', marginTop: 6 }}
        />
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {hint}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 180 }}>
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


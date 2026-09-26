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
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { useRouter } from 'next/navigation';
import {
  api,
  formatCurrency,
  type CompareResponse,
  type Strategy,
  type PlanRunArgs,
  type UserPayload,
} from '@/lib/api';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { HORIZON_MONTHS } from '@/lib/horizon';
import { computeBreakdown } from '@/lib/effective-apr';
import { usItemises } from '@/lib/deductions';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { applyToolResult } from '@/lib/apply-tool-result';
import {
  addCommitment,
  readCommitmentsClient,
  removeCommitment,
  todayISO,
  writeCommitmentsClient,
  type CommitmentEntry,
} from '@/lib/commitments';
import { readGoalsClient } from '@/lib/goals';
import {
  readContributionsClient,
  totalsByGoal,
} from '@/lib/goal-contributions';
import { computeGoalSlip, materialPullForwards } from '@/lib/goal-slip';

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
  strategy = 'avalanche',
  runArgs,
}: {
  user: UserPayload;
  marginalRate: string;
  /** Active payoff strategy — what-if scenarios run against the same one
   *  the user has selected on the Plan page so deltas are apples-to-apples. */
  strategy?: Strategy;
  /** The plan's own run settings (goals, EF split, planned events...).
   *  Without them the sliders ran a plainer plan, so "before" could differ
   *  from the date /plan shows. */
  runArgs?: PlanRunArgs | null;
}) {
  // Every scenario starts from the plan's settings, then changes one thing.
  const base = useMemo(
    () => ({ ...(runArgs ?? { user, marginal_rate: marginalRate }), strategy }),
    [runArgs, user, marginalRate, strategy],
  );
  // The user's residence currency drives surplus + aggregate displays
  // (interest saved is summed across loans in the engine; for hybrid
  // NRI-US users that mixes ccy, but user-default is the least-wrong
  // choice without restructuring the engine return shape).
  const userCcy = useMemo(() => userDefaultCurrency(user.country), [user.country]);
  const fmtUser = useMemo(
    () => (v: string | number) => formatCurrency(v, userCcy),
    [userCcy],
  );

  // Derive realistic slider ceilings + the default "Applied to" loan from
  // the live profile. The user complained about a hardcoded 50k cap and a
  // random lump-sum default; both come from these.
  const { fixedExpensesCap, totalOutstandingCap, loanOptions, defaultLoanIdx } =
    useMemo(() => {
      // Slider ceiling = variable (discretionary) expenses when present,
      // fall back to fixed_expenses for legacy profiles that pre-date the
      // split. We never let the slider eat into fixed costs — the user's
      // rent isn't a what-if knob.
      const variable = Math.max(0, Math.round(Number(user.variable_expenses || 0)));
      const fallbackFixed = Math.max(0, Math.round(Number(user.fixed_expenses || 0)));
      const fixed = variable > 0 ? variable : fallbackFixed;
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
            usItemises(user),
          );
          return { i, l, effective, outstanding: new Decimal(l.outstanding || 0) };
        })
        .filter((r) => r.outstanding.gt(0))
        .sort((a, b) => b.effective.cmp(a.effective));
      const top = ranked[0]?.i ?? 0;
      const opts = user.loans.map((l, i) => ({
        value: i,
        label: `${l.bank || 'Unnamed'} · ${l.loan_type.replace('_', ' ')} (${formatCurrency(l.outstanding, loanCurrency(l, user.country))})`,
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
  // Month from which the surplus delta kicks in (1-based). 1 = "starting now",
  // anything higher defers the cut. Drives surplus_delta_start_month.
  const [surplusStartMonth, setSurplusStartMonth] = useState(1);
  // Rate shock: basis points applied to floating rates.
  const [rateShockBps, setRateShockBps] = useState(0);
  // Lump sum + target loan.
  const [lumpAmount, setLumpAmount] = useState(0);
  const [lumpTarget, setLumpTarget] = useState(defaultLoanIdx);

  const [surplus, setSurplus] = useState<ScenarioState>(INITIAL);
  const [rate, setRate] = useState<ScenarioState>(INITIAL);
  const [lump, setLump] = useState<ScenarioState>(INITIAL);

  // Currency of the loan the lump-sum is being applied to. A USD card
  // lump-sum should show "$" everywhere; an INR home-loan lump-sum
  // should show "₹". Recomputes when the user changes the dropdown.
  const lumpTargetCcy = useMemo(() => {
    const target = user.loans[lumpTarget];
    return target ? loanCurrency(target, user.country) : userCcy;
  }, [user.loans, user.country, lumpTarget, userCcy]);
  const fmtLump = useMemo(
    () => (v: string | number) => formatCurrency(v, lumpTargetCcy),
    [lumpTargetCcy],
  );

  // Commitments + the toast that fires when one lands.
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [commitments, setCommitments] = useState<CommitmentEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  useEffect(() => {
    setCommitments(readCommitmentsClient());
  }, []);

  function commitSurplusCut() {
    if (surplusDelta <= 0) return;
    const stored = loadProfileClient();
    if (!stored.isLive) {
      setToast('Finish setup first so we can mutate your profile.');
      return;
    }
    // Prefer cutting from variable spending; fall back to fixed for legacy
    // profiles that don't have variable_expenses split out yet.
    const currentVariable = Number(stored.user.variable_expenses || 0);
    const currentFixed = Number(stored.user.fixed_expenses || 0);
    const useVariable = currentVariable > 0;
    const cutFrom = useVariable ? currentVariable : currentFixed;
    const newAmount = Math.max(0, cutFrom - surplusDelta);
    saveProfileClient({
      user: useVariable
        ? { ...stored.user, variable_expenses: String(newAmount) }
        : { ...stored.user, fixed_expenses: String(newAmount) },
    });
    const bucketLabel = useVariable ? 'variable spending' : 'fixed expenses';
    const entry: Omit<CommitmentEntry, 'id'> = {
      date: todayISO(),
      kind: 'surplus_cut',
      amount: String(surplusDelta),
      note: `Cut ${bucketLabel} ${fmtUser(cutFrom)} → ${fmtUser(newAmount)}`,
    };
    const next = addCommitment(readCommitmentsClient(), entry);
    writeCommitmentsClient(next);
    setCommitments(next);
    setSurplusDelta(0);
    setSurplusStartMonth(1);
    setToast(`Locked in — trimming ${fmtUser(surplusDelta)}/mo from ${bucketLabel}.`);
    startTransition(() => router.refresh());
  }

  function commitLumpSum() {
    if (lumpAmount <= 0) return;
    const stored = loadProfileClient();
    if (!stored.isLive || !stored.user.loans[lumpTarget]) {
      setToast('Finish setup first so we can write to your activity ledger.');
      return;
    }
    const target = stored.user.loans[lumpTarget];
    const sched = target.scheduled_emi || '0';
    const outstandingD = new Decimal(target.outstanding || '0');
    const paymentD = new Decimal(String(lumpAmount));
    const fullyClears = paymentD.gte(outstandingD);
    applyToolResult({
      loanIndex: lumpTarget,
      kind: fullyClears ? 'closed' : 'paid_extra',
      amount: fullyClears
        ? outstandingD.toFixed(2)
        : String(Number(sched) + lumpAmount),
      scheduledEmi: sched,
      note: `What-if lock-in — ${fmtLump(lumpAmount)} → ${target.bank}`,
      loans: stored.user.loans,
      country: stored.user.country,
    });
    const entry: Omit<CommitmentEntry, 'id'> = {
      date: todayISO(),
      kind: 'lump_sum',
      amount: String(lumpAmount),
      loanIndex: lumpTarget,
      loanBank: target.bank,
      note: fullyClears ? `Closed ${target.bank}` : undefined,
    };
    const next = addCommitment(readCommitmentsClient(), entry);
    writeCommitmentsClient(next);
    setCommitments(next);
    setLumpAmount(0);
    setToast(`Locked in — ${fmtLump(lumpAmount)} sent to ${target.bank}.`);
    startTransition(() => router.refresh());
  }

  function undoCommitment(id: string) {
    // Note: this only removes the log entry. The underlying profile edit /
    // activity entry has already shaped /plan and isn't reverted from here.
    // The user can edit profile / delete the activity entry directly if they
    // want a true undo.
    const next = removeCommitment(commitments, id);
    writeCommitmentsClient(next);
    setCommitments(next);
  }

  useDebouncedScenario(
    `${surplusDelta}|${surplusStartMonth}`,
    setSurplus,
    async () =>
      surplusDelta === 0
        ? null
        : api.sensitivity({
            ...base,
            horizon_months: HORIZON_MONTHS,
            surplus_delta: String(surplusDelta),
            surplus_delta_start_month: surplusStartMonth,
          }),
  );

  useDebouncedScenario(
    rateShockBps,
    setRate,
    async () =>
      rateShockBps === 0
        ? null
        : api.sensitivity({
            ...base,
            horizon_months: HORIZON_MONTHS,
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
            ...base,
            horizon_months: HORIZON_MONTHS,
            lump_sum_amount: String(lumpAmount),
            lump_sum_target_loan_index: lumpTarget,
          }),
  );

  // Step size scales with the ceiling so the slider stays usable whether
  // fixed expenses are ₹10k or ₹2L (1% rounded to the nearest 100/500/1000).
  const surplusStep = roundStep(fixedExpensesCap / 50, 100);
  const lumpStep = roundStep(totalOutstandingCap / 100, 1_000);

  // Active goals + their saved totals — for the goal-impact line on the
  // surplus slider. Read once at mount; the surplus delta itself drives
  // the recompute via useMemo below.
  const goalSlipInputs = useMemo(() => {
    const goals = readGoalsClient();
    const totals = totalsByGoal(readContributionsClient());
    // Baseline surplus: derive from profile rather than the slider so the
    // pull-forward we report counts from the user's actual starting
    // position, not relative to some other displaced surplus value.
    const profile = loadProfileClient();
    const baseline = Math.max(
      0,
      Number(profile.user.monthly_income || 0) -
        Number(profile.user.fixed_expenses || 0) -
        Number(profile.user.variable_expenses || 0) -
        profile.user.loans.reduce(
          (s, l) => s + Number(l.scheduled_emi || 0),
          0,
        ),
    );
    return {
      goals,
      totals,
      baseline,
      efBalance: Number(profile.user.efund_balance || 0),
      efTarget: Number(profile.user.efund_target || 0),
      monthlyExpenses:
        Number(profile.user.fixed_expenses || 0) +
        Number(profile.user.variable_expenses || 0),
    };
  }, []);

  const goalPullForward = useMemo(() => {
    if (surplusDelta <= 0 || goalSlipInputs.goals.length === 0) return [];
    const rows = computeGoalSlip({
      goals: goalSlipInputs.goals,
      contributionTotals: goalSlipInputs.totals,
      baselineMonthlySurplus: goalSlipInputs.baseline,
      surplusDelta: surplusDelta,
      efBalance: goalSlipInputs.efBalance,
      efTarget: goalSlipInputs.efTarget,
      monthlyExpenses: goalSlipInputs.monthlyExpenses,
    });
    return materialPullForwards(rows);
  }, [surplusDelta, goalSlipInputs]);

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
        ? `${interest > 0 ? 'saves' : 'adds'} ${fmtUser(Math.abs(interest))} in interest`
        : '';
    return [monthsTxt, interestTxt].filter(Boolean).join(' · ');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SliderRow
        title={
          Number(user.variable_expenses || 0) > 0
            ? 'Trim discretionary spending'
            : 'Cut fixed expenses'
        }
        hint={
          fixedExpensesCap > 0
            ? `Imagine trimming up to ${fmtUser(fixedExpensesCap)} from your monthly ${
                Number(user.variable_expenses || 0) > 0
                  ? 'discretionary spending (eating out, travel, shopping)'
                  : 'fixed expenses'
              } and redirecting that cash to debt. The most you can cut is what you actually spend.`
            : 'Add your discretionary spending in setup to use this slider.'
        }
        unit="/mo"
        currency={userCcy}
        min={0}
        max={Math.max(fixedExpensesCap, 1_000)}
        step={surplusStep}
        value={surplusDelta}
        onChange={setSurplusDelta}
        formatValue={(v) => (v === 0 ? 'no change' : `+${fmtUser(v)}`)}
        formatInterest={fmtUser}
        state={surplus}
        positive
        summary={(() => {
          const base = summary(surplus.result, true);
          if (goalPullForward.length === 0) return base;
          const goalLine = goalPullForward
            .slice(0, 2)
            .map((r) => {
              const months = Math.abs(r.slipMonths ?? 0);
              return `${r.goalLabel} lands ${months}mo sooner`;
            })
            .join(', ');
          return base ? `${base}. Goals: ${goalLine}.` : `Goals: ${goalLine}.`;
        })()}
        disabled={fixedExpensesCap <= 0}
        extraControls={
          <>
            <StartMonthPicker
              value={surplusStartMonth}
              onChange={setSurplusStartMonth}
              disabled={fixedExpensesCap <= 0 || surplusDelta === 0}
            />
            <LockItInButton
              disabled={surplusDelta <= 0}
              label={`Lock in — trim ${fmtUser(surplusDelta || 0)}/mo from ${
                Number(user.variable_expenses || 0) > 0
                  ? 'discretionary spending'
                  : 'fixed expenses'
              }`}
              shortLabel="Lock it in"
              onClick={commitSurplusCut}
            />
          </>
        }
      />

      <SliderRow
        title="If interest rates change"
        hint="Models what happens if floating-rate loans (most home loans) reprice up or down. 100 bps = 1 percentage point. Fixed-rate loans like personal loans and cards are unaffected."
        unit="bps"
        currency={userCcy}
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
        formatInterest={fmtUser}
        state={rate}
        positive={false}
        summary={summary(rate.result, false)}
        inputMode="bps"
        showMaxButton={false}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
        <SliderRow
          title="Paid extra, or about to?"
          hint={
            totalOutstandingCap > 0
              ? `A one-off payment against the loan chosen on the right. Already paid it? Log it so the plan starts from the new balance. Capped at your total outstanding (${fmtLump(totalOutstandingCap)}).`
              : 'Add your loans in setup to use this slider.'
          }
          unit=""
          currency={lumpTargetCcy}
          min={0}
          max={Math.max(totalOutstandingCap, 10_000)}
          step={Math.max(lumpStep, 1_000)}
          value={lumpAmount}
          onChange={setLumpAmount}
          formatValue={(v) => (v === 0 ? 'no payment' : fmtLump(v))}
          formatInterest={fmtUser}
          state={lump}
          positive
          summary={summary(lump.result, true)}
          disabled={totalOutstandingCap <= 0}
          extraControls={
            <LockItInButton
              disabled={lumpAmount <= 0}
              label={`Log it — ${fmtLump(lumpAmount || 0)} paid today to ${loanOptions[lumpTarget]?.label.split(' · ')[0] ?? 'loan'}`}
              shortLabel="I paid this — log it"
              onClick={commitLumpSum}
            />
          }
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

      {toast && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--soft-bg, rgba(34, 197, 94, 0.1))',
            border: '1px solid var(--positive)',
            color: 'var(--ink)',
            fontSize: 13,
            display: 'flex', justifyContent: 'space-between', gap: 12,
          }}
        >
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            style={{
              background: 'transparent', border: 0,
              color: 'var(--muted-ink, #666)', cursor: 'pointer', fontSize: 12,
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {commitments.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setShowLog((s) => !s)}
            style={{
              background: 'transparent', border: 0,
              color: 'var(--accent)', cursor: 'pointer',
              fontSize: 12, textDecoration: 'underline', padding: 0,
            }}
          >
            {showLog ? 'Hide' : 'Show'} schedule changes log ({commitments.length})
          </button>
          {showLog && (
            <ul style={{
              listStyle: 'none', padding: 0, margin: '8px 0 0',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {commitments.map((c) => {
                // Find the loan referenced by a lump-sum entry so we can
                // show the right symbol. surplus_cut is always in user-default.
                const entryCcy =
                  c.kind === 'lump_sum' && c.loanIndex != null
                    ? loanCurrency(
                        user.loans[c.loanIndex] ?? user.loans[0],
                        user.country,
                      )
                    : userCcy;
                return (
                <li
                  key={c.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 12,
                    fontSize: 12, padding: '6px 10px',
                    border: '1px solid var(--border)', borderRadius: 6,
                  }}
                >
                  <span>
                    <span className="muted">{c.date}</span>{' · '}
                    {c.kind === 'surplus_cut'
                      ? <>Trimmed {formatCurrency(c.amount, entryCcy)}/mo from spending</>
                      : <>Lump-sum {formatCurrency(c.amount, entryCcy)} → {c.loanBank ?? 'loan'}</>}
                    {c.note && <span className="muted"> · {c.note}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => undoCommitment(c.id)}
                    style={{
                      background: 'transparent', border: 0,
                      color: 'var(--muted-ink, #666)', cursor: 'pointer', fontSize: 11,
                    }}
                    title="Remove from log (doesn't undo the underlying change)"
                  >
                    ✕
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Lock it in" button rendered next to the slider — turns a sandbox value
 * into a real profile/ledger mutation. Disabled when value is zero.
 */
function LockItInButton({
  disabled, label, shortLabel, onClick,
}: {
  disabled: boolean;
  label: string;
  shortLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Slide above 0 to enable" : label}
      style={{
        marginTop: 8,
        padding: '4px 10px',
        fontSize: 12,
        border: '1px solid var(--accent)',
        borderRadius: 4,
        background: disabled ? 'transparent' : 'var(--accent)',
        color: disabled ? 'var(--muted)' : 'white',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {shortLabel}
    </button>
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
  currency,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
  formatInterest,
  state,
  positive,
  summary,
  disabled,
  inputMode = 'integer',
  showMaxButton = true,
  extraControls,
}: {
  title: string;
  hint: string;
  unit: string;
  /** Currency for the inline typable input prefix (₹ or $).
   *  Required for 'integer' mode; ignored for 'bps'. */
  currency: 'INR' | 'USD';
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue: (v: number) => string;
  /** Formatter for the "interest saved" sub-line — uses user-default
   *  currency since interest_saved is engine-summed across loans. */
  formatInterest: (v: number) => string;
  state: ScenarioState;
  positive: boolean;
  /** Plain-language one-liner shown below the numeric result. */
  summary?: string | null;
  disabled?: boolean;
  /** 'integer' for ₹/$ amounts (no decimals), 'bps' for signed basis points. */
  inputMode?: 'integer' | 'bps';
  /** Hide the MAX button (e.g. for bps where +max is rare). */
  showMaxButton?: boolean;
  /** Extra controls slot — e.g. start-date picker on the surplus row. */
  extraControls?: React.ReactNode;
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        gap: 16,
        alignItems: 'center',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <TypableAmountInput
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            unit={unit}
            mode={inputMode}
            currency={currency}
            placeholder={formatValue(0)}
          />
          {showMaxButton && !disabled && (
            <button
              type="button"
              onClick={() => onChange(max)}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
              title={`Set to maximum (${formatValue(max)}${unit})`}
            >
              MAX
            </button>
          )}
          {value !== 0 && (
            <button
              type="button"
              onClick={() => onChange(0)}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
              title="Reset to no change"
            >
              CLEAR
            </button>
          )}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          aria-label={title}
          aria-valuetext={formatValue(value)}
          style={{ width: '100%', marginTop: 8 }}
        />
        <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
          {hint}
        </div>
        {extraControls}
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
                {formatInterest(Math.abs(Number(interest)))}
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

/**
 * "Starting in X months" picker — drives surplus_delta_start_month so the
 * user can model a cut they'll only commit to from a future date. The
 * options are coarse-grained on purpose: precise month-picking is a false
 * sense of accuracy for what's a budget intention.
 */
function StartMonthPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const today = useMemo(() => new Date(), []);

  function labelForOffset(offset: number): string {
    if (offset <= 0) return 'now';
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return d
      .toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
      .replace(' ', " '");
  }

  const options = [
    { v: 1, label: `Starting now (${labelForOffset(0)})` },
    { v: 4, label: `Starting in 3 months (${labelForOffset(3)})` },
    { v: 7, label: `Starting in 6 months (${labelForOffset(6)})` },
    { v: 13, label: `Starting in 12 months (${labelForOffset(12)})` },
  ];

  return (
    <div
      style={{
        marginTop: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
      }}
    >
      <span className="muted">Apply this cut</span>
      <select
        aria-label="Apply this cut"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          opacity: disabled ? 0.55 : 1,
          padding: '3px 8px',
          fontSize: 12,
          fontFamily: 'var(--font-sans)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--canvas)',
          color: 'var(--ink)',
        }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Number input that keeps the slider and a typed value in sync. The user
 * can type freely (even out-of-range) while focused, and we clamp on blur
 * or Enter — so they're never fighting the slider mid-keystroke.
 *
 * `mode = 'integer'` formats with commas (₹ amounts).
 * `mode = 'bps'` keeps the bare number (signed basis points).
 */
function TypableAmountInput({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled,
  mode,
  currency,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  mode: 'integer' | 'bps';
  /** Drives the prefix symbol (₹/$) and the locale for the comma display. */
  currency: 'INR' | 'USD';
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const display = useMemo(() => {
    if (draft != null) return draft;
    if (value === 0) return '';
    if (mode === 'bps') return String(value);
    // USD uses Western grouping (1,234,567); INR uses lakh-comma (12,34,567).
    return value.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  }, [draft, value, mode, currency]);

  function commit(raw: string) {
    setDraft(null);
    if (raw.trim() === '') {
      onChange(0);
      return;
    }
    // Strip commas / ₹ / spaces; keep optional leading '-'
    const cleaned = raw.replace(/[^\d-]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      onChange(0);
      return;
    }
    const stepped = step > 0 ? Math.round(n / step) * step : n;
    const clamped = Math.min(max, Math.max(min, stepped));
    onChange(clamped);
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 2,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {mode === 'integer' && (
        <span className="muted" style={{ fontSize: 12 }}>
          {currency === 'USD' ? '$' : '₹'}
        </span>
      )}
      <input
        type="text"
        inputMode="numeric"
        value={display}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={disabled}
        style={{
          width: mode === 'bps' ? 60 : 90,
          padding: '2px 4px',
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          textAlign: 'right',
        }}
      />
      {unit && (
        <span className="muted" style={{ fontSize: 12 }}>
          {unit}
        </span>
      )}
    </span>
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


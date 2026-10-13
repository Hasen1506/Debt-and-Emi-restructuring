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
import { engineRequests, isAbortError } from '@/lib/engine-requests';
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
import { isOpenCurrentLoan } from '@/lib/plan-controls';
import { resolveLoanIndex, type LoanRef } from '@/lib/loan-ids';
import { HORIZON_MONTHS } from '@/lib/horizon';
import { userMarginalCosts } from '@/lib/marginal-cost';
import { loadProfileClient } from '@/lib/user-store';
import { commitSpendingCut, undoSpendingCut } from '@/lib/commit-spending-cut';
import { applyToolResult } from '@/lib/apply-tool-result';
import { readActivityClient } from '@/lib/activity';
import { activityDeltas, applyActivityDeltas } from '@/lib/activity-cookie';
import { rollBalancesForward } from '@/lib/roll-forward';
import { countryMonthKey, monthIndexToCountryLabel } from '@/lib/today';
import {
  addCommitment,
  readCommitmentsClient,
  removeCommitment,
  todayISO,
  writeCommitmentsClient,
  type CommitmentEntry,
} from '@/lib/commitments';
import { isOpenGoal, readGoalsClient } from '@/lib/goals';
import {
  readContributionsClient,
  totalsByGoal,
} from '@/lib/goal-contributions';
import { computeGoalSlip, materialPullForwards } from '@/lib/goal-slip';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';

type ScenarioKey = 'surplus' | 'rate' | 'lump';

interface ScenarioState {
  loading: boolean;
  result: CompareResponse | null;
  error: string | null;
}

const INITIAL: ScenarioState = { loading: false, result: null, error: null };

export function WhatIfPanel({
  user,
  configuredUser = user,
  marginalRate,
  strategy = 'avalanche',
  runArgs,
}: {
  user: UserPayload;
  configuredUser?: UserPayload;
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
  // An assumption/profile/event change invalidates every active comparison.
  const baseKey = JSON.stringify(base);
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
  const { fixedExpensesCap, loanOptions, defaultLoanIdx } =
    useMemo(() => {
      // Slider ceiling = variable (discretionary) expenses when present,
      // fall back to fixed_expenses for legacy profiles that pre-date the
      // split. We never let the slider eat into fixed costs — the user's
      // rent isn't a what-if knob.
      const variable = Math.max(0, Number(configuredUser.variable_expenses || 0));
      const fallbackFixed = Math.max(0, Number(configuredUser.fixed_expenses || 0));
      const fixed = variable > 0 ? variable : fallbackFixed;
      // First in the avalanche order: what each loan costs a year, the
      // prepayment fee and lock-in counted (lib/marginal-cost), as the plan.
      const costs = userMarginalCosts(user, marginalRate);
      const ranked = user.loans
        .map((l, i) => ({ i, l, key: costs.get(i)?.orderKey }))
        .filter((r) => isOpenCurrentLoan(r.l) && r.key)
        .sort((a, b) => b.key!.cmp(a.key!));
      const top = ranked[0]?.i ?? -1;
      const opts = user.loans.map((l, i) => ({
        value: i,
        // "HDFC credit card · ₹1,50,000"; the part before " · " names the loan in the log.
        label: `${(() => {
          const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
          const t = LOAN_TYPE_NAME[l.loan_type];
          return bank ? `${bank} ${t}` : t.charAt(0).toUpperCase() + t.slice(1);
        })()} · ${formatCurrency(l.outstanding, loanCurrency(l, user.country))}`,
        isTop: i === top,
      })).filter(o => isOpenCurrentLoan(user.loans[o.value]));
      return {
        fixedExpensesCap: fixed,
        loanOptions: opts,
        defaultLoanIdx: top,
      };
    }, [user, configuredUser, marginalRate]);

  // Surplus delta: ₹/month extra (positive = more cash to debts).
  const [surplusDelta, setSurplusDelta] = useState(0);
  // Month from which the surplus delta kicks in (1-based). 1 = "starting now",
  // anything higher defers the cut. Drives surplus_delta_start_month.
  const [surplusStartMonth, setSurplusStartMonth] = useState(1);
  // Rate shock: basis points applied to floating rates.
  const [rateShockBps, setRateShockBps] = useState(0);
  // Lump sum + target loan.
  const [lumpAmount, setLumpAmount] = useState(0);
  const [lumpRef, setLumpRef] = useState<LoanRef>({loanIndex: defaultLoanIdx, loanId: user.loans[defaultLoanIdx]?.id});
  const resolvedLumpTarget = resolveLoanIndex(lumpRef, user.loans);
  const lumpTarget = isOpenCurrentLoan(user.loans[resolvedLumpTarget]) ? resolvedLumpTarget : -1;
  // A lump sum is denominated in its selected loan's native currency.
  const lumpTargetCap = lumpTarget >= 0 ? Number(user.loans[lumpTarget].outstanding) : 0;
  useEffect(() => {
    setLumpAmount(value => Math.min(value, lumpTargetCap));
  }, [lumpTargetCap]);

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
    if (surplusDelta <= 0 || surplusStartMonth !== 1) return;
    try {
      setCommitments(commitSpendingCut(configuredUser, surplusDelta, surplusStartMonth, runArgs?.debt_budget ?? ''));
    } catch (error) {
      setToast((error as Error).message);
      return;
    }
    setSurplusDelta(0);
    setSurplusStartMonth(1);
    setToast(`Locked in — trimming ${fmtUser(surplusDelta)}/mo from your spending.`);
    startTransition(() => router.refresh());
  }

  function commitLumpSum() {
    if (lumpAmount <= 0 || !Number.isFinite(lumpAmount) || lumpTarget < 0) return;
    const stored = loadProfileClient();
    const index = resolveLoanIndex(lumpRef, stored.user.loans);
    if (!stored.isLive || !isOpenCurrentLoan(stored.user.loans[index])) {
      setToast('Finish setup first so we can write to your activity ledger.');
      return;
    }
    const current = applyActivityDeltas(rollBalancesForward(stored.user.loans,countryMonthKey(stored.user.country)).loans,
      activityDeltas(readActivityClient(), stored.user.loans, stored.user.country), countryMonthKey(stored.user.country)).loans;
    const target = current[index];
    const expected = user.loans[lumpTarget];
    if (!isOpenCurrentLoan(target) || stored.user.country !== user.country ||
        loanCurrency(target, stored.user.country) !== loanCurrency(expected, user.country) ||
        Number(target.outstanding) !== Number(expected.outstanding) ||
        target.nominal_rate !== expected.nominal_rate || target.scheduled_emi !== expected.scheduled_emi ||
        (!lumpRef.loanId && target.bank !== expected.bank) || lumpAmount > Number(target.outstanding)) {
      setToast('This loan changed. Refresh the plan and check the payment again.');
      return;
    }
    const sched = target.scheduled_emi || '0';
    const outstandingD = new Decimal(target.outstanding || '0');
    const paymentD = new Decimal(String(lumpAmount));
    const fullyClears = paymentD.gte(outstandingD);
    applyToolResult({
      loanIndex: index,
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
      loanIndex: index,
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
    if (commitments.find((c) => c.id === id)?.spendingSnapshot) {
      try {
        setCommitments(undoSpendingCut(id));
        setToast('Spending cut undone; spending and the monthly debt budget are restored.');
        startTransition(() => router.refresh());
      } catch (error) {
        setToast((error as Error).message);
      }
      return;
    }
    // Note: this only removes the log entry. The underlying profile edit /
    // activity entry has already shaped /plan and isn't reverted from here.
    // The user can edit profile / delete the activity entry directly if they
    // want a true undo.
    const next = removeCommitment(commitments, id);
    writeCommitmentsClient(next);
    setCommitments(next);
  }

  useDebouncedScenario(
    `${baseKey}|${surplusDelta}|${surplusStartMonth}`,
    setSurplus,
    async (signal: AbortSignal) =>
      surplusDelta === 0
        ? null
        : sharedSensitivity({
            ...base,
            horizon_months: HORIZON_MONTHS,
            surplus_delta: String(surplusDelta),
            spending_cut: true,
            surplus_delta_start_month: surplusStartMonth,
          }, signal),
    surplusDelta !== 0,
  );

  useDebouncedScenario(
    `${baseKey}|${rateShockBps}`,
    setRate,
    async (signal: AbortSignal) =>
      rateShockBps === 0
        ? null
        : sharedSensitivity({
            ...base,
            horizon_months: HORIZON_MONTHS,
            rate_shock_delta: (rateShockBps / 10_000).toFixed(4),
            rate_shock_floating_only: true,
          }, signal),
    rateShockBps !== 0,
  );

  useDebouncedScenario(
    `${baseKey}|${lumpAmount}|${lumpTarget}`,
    setLump,
    async (signal: AbortSignal) =>
      lumpAmount === 0 || lumpTarget < 0
        ? null
        : sharedSensitivity({
            ...base,
            horizon_months: HORIZON_MONTHS,
            lump_sum_amount: String(lumpAmount),
            lump_sum_target_loan_index: lumpTarget,
          }, signal),
    lumpAmount !== 0 && lumpTarget >= 0,
  );

  // Step size scales with the ceiling so the slider stays usable whether
  // fixed expenses are ₹10k or ₹2L (1% rounded to the nearest 100/500/1000).
  const surplusStep = roundStep(fixedExpensesCap / 50, 100);
  const lumpStep = roundStep(lumpTargetCap / 100, 1_000);

  // Active goals + their saved totals — for the goal-impact line on the
  // surplus slider. Read once at mount; the surplus delta itself drives
  // the recompute via useMemo below.
  const goalSlipInputs = useMemo(() => {
    const goals = readGoalsClient().filter(isOpenGoal);
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

  // A rate change only moves floating-rate loans.
  const hasFloating = user.loans.some((l) => l.rate_type === 'floating' && Number(l.outstanding || 0) > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: `2px solid ${L_T.ink}` }}>
      <SliderRow
        country={user.country}
        title={'Spend less each month'}
        hint={
          fixedExpensesCap > 0
            ? `Up to ${fmtUser(fixedExpensesCap)}, what you spend now. The cut goes to the plan's next loan.`
            : 'Add your monthly spending in Profile to try this.'
        }
        unit="/mo"
        currency={userCcy}
        min={0}
        max={fixedExpensesCap}
        step={surplusStep}
        value={surplusDelta}
        onChange={setSurplusDelta}
        formatValue={(v) => (v === 0 ? 'no change' : `+${fmtUser(v)}`)}
        formatInterest={fmtUser}
        state={surplus}
        summary={(() => {
          if (goalPullForward.length === 0) return null;
          const goalLine = goalPullForward
            .slice(0, 2)
            .map((r) => {
              const months = Math.abs(r.slipMonths ?? 0);
              return `${r.goalLabel} lands ${months}mo sooner`;
            })
            .join(', ');
          return `Goals: ${goalLine}.`;
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
              disabled={surplusDelta <= 0 || surplusStartMonth !== 1}
              reason={surplusDelta > 0 && surplusStartMonth !== 1 ? 'Future cuts are previews. Choose this month to save a change to your current spending.' : undefined}
              label={`Lock in — trim ${fmtUser(surplusDelta || 0)}/mo from ${
                Number(user.variable_expenses || 0) > 0
                  ? 'discretionary spending'
                  : 'fixed expenses'
              }`}
              shortLabel="DO IT · SAVE THE CUT"
              onClick={commitSurplusCut}
            />
          </>
        }
      />

      <SliderRow
        country={user.country}
        title={'If floating rates change'}
        hint={
          hasFloating
            ? 'Floating-rate loans (most home loans) move with it; fixed-rate loans and cards don’t. 100 bps = 1 percentage point.'
            : 'None of your loans has a floating rate, so a rate change doesn’t move the plan.'
        }
        disabled={!hasFloating}
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
        inputMode="bps"
        showMaxButton={false}
      />

      <SliderRow
        country={user.country}
        title={'Pay a lump sum'}
        hint={
          lumpTargetCap > 0
            ? `A one-off payment, up to what you owe on this loan (${fmtLump(lumpTargetCap)}). Already paid it? Log it and the plan starts from the new balance.`
            : 'Add your loans in Profile to try this.'
        }
        unit=""
        currency={lumpTargetCcy}
        min={0}
        max={lumpTargetCap}
        step={lumpTargetCap > 0 && lumpTargetCap < 1000 ? Math.min(1, lumpTargetCap) : Math.max(lumpStep, 1_000)}
        value={lumpAmount}
        onChange={setLumpAmount}
        formatValue={(v) => (v === 0 ? 'no payment' : fmtLump(v))}
        formatInterest={fmtUser}
        state={lump}
        disabled={lumpTargetCap <= 0}
        extraControls={
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ color: L_T.muted }}>Into</span>
              <select
                value={lumpTarget}
                onChange={(e) => {
                  const index = Number(e.target.value);
                  setLumpRef({loanIndex:index, loanId:user.loans[index]?.id});
                  setLumpAmount(0);
                }}
                style={{ fontFamily: 'inherit', fontSize: 12, padding: '5px 8px', border: `1px solid ${L_T.ink}`, background: L_T.paper, color: L_T.ink, maxWidth: '100%' }}
              >
                {lumpTarget < 0 && <option value={-1}>Choose an open loan</option>}
                {loanOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.isTop ? '★ ' : ''}
                    {o.label}
                  </option>
                ))}
              </select>
              <span style={{ color: L_T.muted, fontSize: 11 }}>★ The dearest, the plan&apos;s own pick</span>
            </label>
            <LockItInButton
              disabled={lumpAmount <= 0}
              label={`Log it — ${fmtLump(lumpAmount || 0)} paid today to ${loanOptions.find(o => o.value === lumpTarget)?.label.split(' · ')[0] ?? 'loan'}`}
              shortLabel="I PAID THIS · LOG IT"
              onClick={commitLumpSum}
            />
          </>
        }
      />

      {toast && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderLeft: `2px solid ${L_T.positive}`,
            background: L_T.paper,
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>{toast}</span>
          <LBracket onClick={() => setToast(null)} label="Dismiss">
            OK
          </LBracket>
        </div>
      )}

      {commitments.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12 }}>
          <LBracket onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'HIDE' : 'SHOW'} CHANGES MADE HERE · {commitments.length}
          </LBracket>
          {showLog && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
              {commitments.map((c) => {
                // A lump sum is in its loan's currency; a spending cut in the user's.
                const entryCcy =
                  c.kind === 'lump_sum' && c.loanIndex != null
                    ? loanCurrency(user.loans[c.loanIndex] ?? user.loans[0], user.country)
                    : userCcy;
                return (
                  <li
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      padding: '6px 0',
                      borderBottom: `1px dashed ${L_T.ruleSoft}`,
                    }}
                  >
                    <span>
                      <span style={{ color: L_T.muted }}>{c.date}</span>
                      {' · '}
                      {c.kind === 'surplus_cut' ? (
                        <>Spending cut by {formatCurrency(c.amount, entryCcy)} a month</>
                      ) : (
                        <>
                          Lump sum {formatCurrency(c.amount, entryCcy)} → {c.loanBank ?? 'loan'}
                        </>
                      )}
                      {c.note && <span style={{ color: L_T.muted }}> · {c.note}</span>}
                    </span>
                    <LBracket
                      onClick={() => undoCommitment(c.id)}
                      label={c.spendingSnapshot ? 'Undo this spending cut and its debt-budget change' : 'Remove from this list (the change itself stays)'}
                    >
                      {c.spendingSnapshot ? 'UNDO CUT' : 'REMOVE FROM LIST'}
                    </LBracket>
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
  disabled, label, shortLabel, onClick, reason,
}: {
  disabled: boolean;
  label: string;
  shortLabel: string;
  onClick: () => void;
  reason?: string;
}) {
  if (disabled && !reason) return null;
  return (
    <span>
      <LBracket accent onClick={onClick} label={label} disabled={disabled}>
        {shortLabel}
      </LBracket>
      {reason && <span style={{display:'block', fontSize:11, color:L_T.muted}}>{reason}</span>}
    </span>
  );
}

function roundStep(value: number, base: number): number {
  if (value <= base) return base;
  return Math.max(base, Math.round(value / base) * base);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The change as a picture: when the debts are gone, and the interest paid,
 * on the plan as it is and with the change, as two bars each. The numbers
 * alone ("−3 MO") didn't show how big a change is against the whole.
 */
function BeforeAfter({
  result,
  country,
  formatInterest,
}: {
  result: CompareResponse;
  country: 'IN' | 'US';
  formatInterest: (v: number) => string;
}) {
  const base = result.baseline_debt_free_month;
  const next = result.scenario_debt_free_month;
  const baseInt = Number(result.baseline_total_interest ?? NaN);
  const nextInt = Number(result.scenario_total_interest ?? NaN);
  const rows: { label: string; a: number; b: number; aText: string; bText: string; lowerIsBetter: true }[] = [];
  if (base != null && next != null) {
    rows.push({
      label: 'DEBT-FREE',
      a: base,
      b: next,
      aText: monthIndexToCountryLabel(base, country),
      bText: monthIndexToCountryLabel(next, country),
      lowerIsBetter: true,
    });
  }
  if (Number.isFinite(baseInt) && Number.isFinite(nextInt)) {
    rows.push({
      label: 'INTEREST PAID',
      a: baseInt,
      b: nextInt,
      aText: formatInterest(baseInt),
      bText: formatInterest(nextInt),
      lowerIsBetter: true,
    });
  }
  if (rows.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
      {rows.map((r) => {
        const max = Math.max(r.a, r.b, 1);
        const better = r.b < r.a;
        const same = Math.abs(r.b - r.a) < 0.5;
        const bar = (v: number, color: string, filled: boolean) => (
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              height: 10,
              width: `${Math.max(2, (v / max) * 100)}%`,
              background: filled ? color : 'transparent',
              border: `1px solid ${color}`,
            }}
          />
        );
        return (
          <div key={r.label} role="img" aria-label={`${r.label.toLowerCase()}: ${r.aText} on your plan, ${r.bText} with this change`}>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 4 }}>{r.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) auto', columnGap: 8, rowGap: 4, alignItems: 'center', fontSize: 11 }}>
              <span style={{ color: L_T.muted }}>Your plan</span>
              {bar(r.a, L_T.inkSoft, false)}
              <span style={{ color: L_T.inkSoft, whiteSpace: 'nowrap' }}>{r.aText}</span>
              <span style={{ color: L_T.ink, fontWeight: 600 }}>With this</span>
              {bar(r.b, same ? L_T.inkSoft : better ? L_T.positive : L_T.negative, true)}
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: same ? L_T.ink : better ? L_T.positive : L_T.negative }}>
                {r.bText}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SliderRow({
  country,
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
  summary,
  disabled,
  inputMode = 'integer',
  showMaxButton = true,
  extraControls,
}: {
  country: 'IN' | 'US';
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
  const interest = Number(state.result?.interest_saved ?? '0');
  const tone = (good: boolean | null) => (good == null ? L_T.muted : good ? L_T.positive : L_T.negative);
  const small = { fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.1em', padding: '3px 8px', border: `1px solid ${L_T.muted}`, background: 'transparent', color: L_T.muted, cursor: 'pointer' } as const;

  return (
    <div
      style={{
        padding: '14px 0',
        borderBottom: `1px dashed ${L_T.ruleSoft}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
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
          // R6-3: a plain "0" placeholder. The words ("no payment", "no change")
          // stopped fitting a 390px box once C-02 set inputs in 16px type;
          // the slider's own readout still says them.
          placeholder="0"
          label={title}
        />
        {showMaxButton && !disabled && (
          <button type="button" onClick={() => onChange(max)} className="l-hit" style={small} title={`Set to the most: ${formatValue(max)}${unit}`}>
            MAX
          </button>
        )}
        {value !== 0 && (
          <button type="button" onClick={() => onChange(0)} className="l-hit" style={small}>
            CLEAR
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={inputMode === 'bps' ? step : 'any'}
        value={value}
        onChange={(e) => onChange(Number(Number(e.target.value).toFixed(2)))}
        disabled={disabled}
        aria-label={title}
        aria-valuetext={formatValue(value)}
        style={{ width: '100%', accentColor: L_T.accent }}
      />
      <div style={{ fontSize: 11, color: L_T.muted, lineHeight: 1.5 }}>{hint}</div>
      <div aria-live="polite" style={{ fontSize: 12, lineHeight: 1.6 }}>
        {state.loading ? (
          <span style={{ color: L_T.muted }}>Working it out…</span>
        ) : state.error ? (
          <span style={{ color: L_T.negative }}>{state.error}</span>
        ) : state.result ? (
          <>
            <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              <strong style={{ color: tone(months === 0 ? null : months > 0) }}>
                {months === 0
                  ? 'Same debt-free month'
                  : `Debt-free ${Math.abs(months)} month${Math.abs(months) === 1 ? '' : 's'} ${months > 0 ? 'sooner' : 'later'}`}
              </strong>
              <span style={{ color: L_T.muted }}>·</span>
              <strong style={{ color: tone(interest === 0 ? null : interest > 0) }}>
                {interest === 0
                  ? 'the same interest'
                  : `${formatInterest(Math.abs(interest))} ${interest > 0 ? 'less' : 'more'} interest`}
              </strong>
            </span>
            {summary && <div style={{ color: L_T.muted, fontSize: 11 }}>{summary}</div>}
            {value !== 0 && <BeforeAfter result={state.result} country={country} formatInterest={formatInterest} />}
          </>
        ) : (
          !disabled && <span style={{ color: L_T.muted }}>Move the slider or type an amount to see the change.</span>
        )}
      </div>
      {extraControls}
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
    { v: 1, label: `this month` },
    { v: 4, label: `${labelForOffset(3)} (in 3 months)` },
    { v: 7, label: `${labelForOffset(6)} (in 6 months)` },
    { v: 13, label: `${labelForOffset(12)} (in a year)` },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
      }}
    >
      <span style={{ color: L_T.muted }}>From</span>
      <select
        aria-label="When the cut starts"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          opacity: disabled ? 0.55 : 1,
          padding: '5px 8px',
          fontSize: 12,
          fontFamily: 'inherit',
          border: `1px solid ${L_T.ink}`,
          background: L_T.paper,
          color: L_T.ink,
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
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  /** Spoken name of the box (the row's title). */
  label: string;
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
    const cleaned = raw.replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      onChange(0);
      return;
    }
    // The range has coarse steps; a typed money amount may be exact to cents.
    const stepped = mode === 'bps' && step > 0 ? Math.round(n / step) * step : Number(n.toFixed(2));
    const clamped = Math.min(max, Math.max(min, stepped));
    onChange(clamped);
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 2,
        fontFamily: 'inherit',
      }}
    >
      {mode === 'integer' && (
        <span style={{ fontSize: 12, color: L_T.muted }}>
          {currency === 'USD' ? '$' : '₹'}
        </span>
      )}
      <input
        type="text"
        inputMode={mode === 'bps' ? 'numeric' : 'decimal'}
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
        aria-label={`${label}${mode === 'bps' ? ', basis points' : ''}`}
        style={{
          width: mode === 'bps' ? 70 : 104,
          padding: '4px 6px',
          fontSize: 13,
          fontFamily: 'inherit',
          border: `1px solid ${L_T.ink}`,
          background: L_T.paper,
          color: L_T.ink,
          textAlign: 'right',
        }}
      />
      {unit && (
        <span style={{ fontSize: 12, color: L_T.muted }}>
          {unit}
        </span>
      )}
    </span>
  );
}

/** A what-if run, shared with an identical one in flight or just answered (NEW-19). */
function sharedSensitivity(req: Parameters<typeof api.sensitivity>[0], signal: AbortSignal): Promise<CompareResponse> {
  return engineRequests.run('compare', req, (s) => api.sensitivity(req, { signal: s }), signal);
}

function useDebouncedScenario(
  key: unknown,
  setState: (s: ScenarioState) => void,
  fetcher: (signal: AbortSignal) => Promise<CompareResponse | null>,
  active: boolean,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    // NEW-19: a newer slider value cancels the request it replaced.
    const controller = new AbortController();
    if (timer.current) clearTimeout(timer.current);
    if (!active) {
      setState(INITIAL);
      return;
    }
    setState({ loading: true, result: null, error: null });
    timer.current = setTimeout(async () => {
      try {
        const r = await fetcher(controller.signal);
        if (cancelled) return;
        if (r === null) {
          setState({ loading: false, result: null, error: null });
        } else {
          setState({ loading: false, result: r, error: null });
        }
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setState({ loading: false, result: null, error: (e as Error).message });
      }
    }, 350);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
    // fetcher reference changes each render, intentionally ignore;
    // we re-debounce when `key` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, setState]);
}

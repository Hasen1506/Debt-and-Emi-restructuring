'use client';

import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Flame,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Target,
} from 'lucide-react';
import { useRightDue } from '@/lib/store';
import {
  addMonthsLabel,
  analyzePaymentOutcome,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatPct,
  simulatePayoffPlan,
} from '@/engine/math';
import type { PayoffStrategy } from '@/engine/types';

export function CommandCenter() {
  const {
    profile,
    country,
    strategy,
    setStrategy,
    stress,
    updateStress,
    resetStress,
    paidIds,
    togglePaid,
    paymentLogs,
    logPayment,
    clearPaymentLog,
    toggleGoal,
    updateLoan,
    setSection,
    updateProfile,
    theme,
  } = useRightDue();

  const [expandedAprId, setExpandedAprId] = useState<string | null>(null);
  const [customPayLoanId, setCustomPayLoanId] = useState<string | null>(null);
  const [customPayValue, setCustomPayValue] = useState<string>('');
  const [stressOpen, setStressOpen] = useState(true);

  const sim = useMemo(
    () => simulatePayoffPlan(profile, strategy, undefined, stress),
    [profile, strategy, stress],
  );

  // Baseline without stress so user can see exact delta caused by Hike / Windfall / Inflation / Step-Up / Rate Shock / Layoff
  const hasActiveStress =
    stress.annualHikePct > 0 ||
    stress.windfallAmount > 0 ||
    stress.expenseInflationPct > 0 ||
    stress.annualStepUpPct > 0 ||
    stress.rateShockBps !== 0 ||
    stress.incomeDropPct > 0;

  const baselineSim = useMemo(
    () => (hasActiveStress ? simulatePayoffPlan(profile, strategy) : sim),
    [hasActiveStress, profile, strategy, sim],
  );

  const paidTotalThisMonth = useMemo(() => {
    let sum = 0;
    for (const row of sim.allocations) {
      const log = paymentLogs[row.loanId];
      if (log) {
        sum += log.amountPaid;
      } else if (paidIds.includes(row.loanId)) {
        sum += row.total;
      }
    }
    if (paidIds.includes('emergency-fund') && sim.monthlyToEmergencyFund > 0) {
      sum += sim.monthlyToEmergencyFund;
    }
    return sum;
  }, [sim, paidIds, paymentLogs]);

  const plannedTotalThisMonth =
    sim.allocations.reduce((s, r) => s + r.total, 0) +
    sim.monthlyToEmergencyFund +
    sim.monthlyToGoals;

  // FIXED: Static capacity-based slider max (NEVER derived from sim.monthlyExtraToDebt so dragging never jumps!)
  const staticCapacity = Math.max(
    profile.monthlyTakeHome - profile.monthlyLivingSpend,
    country === 'IN' ? 120000 : 4000,
  );
  const sliderMax = Math.max(
    country === 'IN' ? 150000 : 5000,
    Math.ceil(staticCapacity / (country === 'IN' ? 5000 : 250)) * (country === 'IN' ? 5000 : 250),
  );
  const sliderStep = country === 'IN' ? 1000 : 50;
  const activeExtraSliderValue = strategy === 'minimums' ? 0 : Math.min(sliderMax, sim.monthlyExtraToDebt);

  function handleExtraChange(nextVal: number) {
    const clean = Math.max(0, Math.round(nextVal));
    if (strategy === 'minimums' && clean > 0) {
      setStrategy('avalanche');
    }
    updateProfile({ extraMonthlyOverride: clean });
  }

  function openCustomPay(loanId: string, defaultAmount: number) {
    setCustomPayLoanId(loanId);
    const existing = paymentLogs[loanId];
    setCustomPayValue(String(existing ? existing.amountPaid : defaultAmount));
  }

  function submitCustomPay(loanId: string, plannedTotal: number) {
    const num = Math.max(0, Math.round(Number(customPayValue) || 0));
    const status =
      num === 0
        ? 'unable'
        : num > plannedTotal + (country === 'IN' ? 100 : 5)
          ? 'extra'
          : num >= plannedTotal
            ? 'full'
            : 'partial';
    logPayment(loanId, status, num);
    setCustomPayLoanId(null);
  }

  const chartStroke = theme === 'ledger' ? '#14532D' : theme === 'dark' ? '#14b8a6' : '#0f766e';
  const chartMinStroke = theme === 'ledger' ? '#78716C' : '#94a3b8';
  const chartTickColor = theme === 'ledger' ? '#57534E' : theme === 'dark' ? '#94a3b8' : '#64748b';
  const chartGridColor =
    theme === 'ledger' ? 'rgba(120,113,108,0.22)' : 'rgba(148,163,184,0.2)';

  if (profile.loans.filter((l) => l.outstanding > 0).length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">No open loans on file</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          Add your home loan, credit card, or personal loan — or drop your bank CSV / Android SMS backup — to generate a live payoff plan and rate audit.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setSection('vault')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white"
          >
            Add First Loan
          </button>
          <button
            type="button"
            onClick={() => setSection('sms')}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Bulk Import SMS / CSV
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header + Strategy Selector */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {country === 'IN'
              ? `India · ${profile.taxRegimeIN === 'old' ? 'Old' : 'New'} tax regime · ${Math.round(profile.marginalTaxRate * 100)}% marginal slab`
              : `United States · ${Math.round(profile.marginalTaxRate * 100)}% marginal tax bracket`}
            {hasActiveStress ? ' · Stress simulation active' : ''}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Pay {formatMoney(plannedTotalThisMonth, country)} this month, debt-free by{' '}
            <span className="text-teal-700 dark:text-teal-400">{sim.debtFreeDateLabel}</span>
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            {sim.isShortfall ? (
              <span className="text-red-600 dark:text-red-400 font-medium">
                Shortfall of {formatMoney(sim.shortfallAmount, country)} this month (emergency runway:{' '}
                {sim.emergencyRunwayMonths} mo) — open Can&apos;t Pay Shield to protect secured assets first.
              </span>
            ) : (
              <>
                {formatMoney(sim.monthlyMandatoryDues, country)} mandatory dues,{' '}
                {formatMoney(sim.monthlyExtraToDebt, country)} extra routed to your costliest debt
                {sim.monthlyToGoals > 0
                  ? `, ${formatMoney(sim.monthlyToGoals, country)} to active cash goals`
                  : ''}
                {sim.monthlyToEmergencyFund > 0
                  ? `, and ${formatMoney(sim.monthlyToEmergencyFund, country)} to your emergency buffer.`
                  : '.'}
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-3 sm:inline-flex w-full sm:w-auto p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 self-start md:self-auto shrink-0">
          {(
            [
              { id: 'avalanche', label: 'Lowest Interest' },
              { id: 'snowball', label: 'Fastest Win' },
              { id: 'minimums', label: 'Minimums' },
            ] as { id: PayoffStrategy; label: string }[]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setStrategy(opt.id)}
              className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-colors whitespace-nowrap text-center ${
                strategy === opt.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* 4-Column KPI Strip */}
      <section aria-label="Key debt metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Debt</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatMoney(sim.totalPrincipal, country)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {sim.loanMetrics.length} active {sim.loanMetrics.length === 1 ? 'account' : 'accounts'} ·{' '}
            {formatMoney(sim.monthlyMandatoryDues, country)}/mo due
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Interest You Save</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-teal-700 dark:text-teal-400">
            {formatMoney(sim.interestSavedVsMinimums, country)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Debt-free {formatDuration(sim.monthsSavedVsMinimums)} sooner ({formatDuration(sim.debtFreeMonths)} total)
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">This Month&apos;s Interest</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-red-600 dark:text-red-400">
            {formatMoney(sim.monthOneInterest, country)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Total lifetime interest: {formatMoney(sim.totalInterest, country)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Free Cash / Month</div>
          <div
            className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
              sim.isShortfall
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {sim.isShortfall ? `−${formatMoney(sim.shortfallAmount, country)}` : formatMoney(sim.monthlySpareCash, country)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {formatMoney(sim.monthlyIncome, country)} take-home −{' '}
            {formatMoney(sim.monthlyLivingSpend + sim.monthlyMandatoryDues + sim.monthlyToGoals, country)} bills &amp; EMIs
          </div>
        </div>
      </section>

      {/* Main Split: Flexible Execution Checklist + Trajectory & Stress Simulator */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 cols: Flexible Monthly Execution (Full / Custom Less or More / Can't Pay with Real Consequences) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                This Month&apos;s Execution
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {formatMoney(paidTotalThisMonth, country)} of {formatMoney(plannedTotalThisMonth, country)} logged
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSection('sms')}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
            >
              Bulk SMS / CSV Sync
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {sim.allocations.map((row) => {
              const loanObj = profile.loans.find((l) => l.id === row.loanId);
              const log = paymentLogs[row.loanId];
              const isFullPaid =
                (log && (log.status === 'full' || log.status === 'extra')) ||
                (!log && paidIds.includes(row.loanId));
              const isCustomOpen = customPayLoanId === row.loanId;

              const consequence =
                log && loanObj
                  ? analyzePaymentOutcome({
                      loan: loanObj,
                      amountPaid: log.amountPaid,
                      plannedTotal: row.total,
                      minimumDue: row.minimum,
                      country,
                    })
                  : null;

              return (
                <div key={row.loanId} className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-900 dark:text-white">
                          {row.label}
                        </span>
                        {row.isExtraTarget && (
                          <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
                            · Priority target
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {row.extra > 0
                          ? `${formatMoney(row.minimum, country)} due + ${formatMoney(row.extra, country)} extra`
                          : row.reason}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-white">
                        {formatMoney(row.total, country)}
                      </div>
                      <div className="flex items-center justify-end gap-2 text-[11px]">
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatPct(row.trueAllInApr)} APR
                        </span>
                        {row.loanType === 'home_loan' && (
                          <button
                            type="button"
                            onClick={() => setSection('shield')}
                            className="font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
                          >
                            Audit rate →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 3-State Realistic Payment Controls: Paid Full / Custom Amount / Unable to Pay */}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (isFullPaid && (!log || log.status === 'full')) {
                          clearPaymentLog(row.loanId);
                        } else {
                          logPayment(row.loanId, 'full', row.total);
                          setCustomPayLoanId(null);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        isFullPaid && (!log || log.status === 'full')
                          ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-300'
                          : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isFullPaid && (!log || log.status === 'full') ? 'Paid Full' : 'Mark Paid'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        isCustomOpen ? setCustomPayLoanId(null) : openCustomPay(row.loanId, row.minimum)
                      }
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        isCustomOpen || (log && (log.status === 'partial' || log.status === 'extra'))
                          ? 'border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300'
                          : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {log && (log.status === 'partial' || log.status === 'extra')
                        ? `Paid ${formatMoney(log.amountPaid, country)}`
                        : 'Paid Less / More'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (log?.status === 'unable') {
                          clearPaymentLog(row.loanId);
                        } else {
                          logPayment(row.loanId, 'unable', 0);
                          setCustomPayLoanId(null);
                        }
                      }}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        log?.status === 'unable'
                          ? 'border-rose-400 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300'
                          : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-400'
                      }`}
                    >
                      Can&apos;t Pay
                    </button>
                  </div>

                  {/* Custom Amount Input Drawer */}
                  {isCustomOpen && (
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>Enter exact amount you paid this month</span>
                        <span className="font-mono tabular-nums">
                          Min: {formatMoney(row.minimum, country)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={customPayValue}
                          onChange={(e) => setCustomPayValue(e.target.value)}
                          aria-label={`Custom payment amount for ${row.label}`}
                          className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => submitCustomPay(row.loanId, row.total)}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-teal-700 hover:bg-teal-800 text-white whitespace-nowrap"
                        >
                          Log Amount
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Real Consequence Receipt whenever Partial, Extra, or Unable is logged */}
                  {consequence && log && log.status !== 'full' && (
                    <div
                      className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                        consequence.severity === 'critical'
                          ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60 text-rose-950 dark:text-rose-200'
                          : consequence.severity === 'warning'
                            ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60 text-amber-950 dark:text-amber-200'
                            : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold flex items-center gap-1.5">
                          {consequence.severity === 'critical' ? (
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                          ) : consequence.severity === 'warning' ? (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>{consequence.headline}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => clearPaymentLog(row.loanId)}
                          className="text-[11px] underline opacity-75 hover:opacity-100 shrink-0"
                        >
                          Clear
                        </button>
                      </div>
                      <p className="leading-relaxed opacity-90">{consequence.summary}</p>
                      <p className="text-[11px] font-medium opacity-90">
                        Bureau: {consequence.bureauImpact}
                      </p>
                      {consequence.legalTimeline && (
                        <p className="text-[11px] font-mono opacity-85">{consequence.legalTimeline}</p>
                      )}
                      {consequence.severity === 'critical' && (
                        <button
                          type="button"
                          onClick={() => setSection('cant-pay')}
                          className="inline-flex items-center gap-1 pt-1 text-xs font-semibold underline"
                        >
                          <span>Open Can&apos;t Pay Shield &amp; Draft Hardship Notice</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {sim.monthlyToEmergencyFund > 0 && (
              <div className="p-5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm text-slate-900 dark:text-white">
                    Emergency Buffer Transfer
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {formatMoney(profile.emergencyFundCurrent, country)} of{' '}
                    {formatMoney(profile.emergencyFundTarget, country)} target funded
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-white">
                    {formatMoney(sim.monthlyToEmergencyFund, country)}
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePaid('emergency-fund')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      paidIds.includes('emergency-fund')
                        ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-300'
                        : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {paidIds.includes('emergency-fund') ? 'Set Aside' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {/* Debt-Competing Goals Sinking Fund Toggle */}
            {(profile.goals ?? []).length > 0 && (
              <div className="p-5 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                    <span>Competing Cash Goals (Sinking Fund)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSection('vault')}
                    className="text-xs text-teal-700 dark:text-teal-400 hover:underline"
                  >
                    Manage
                  </button>
                </div>
                <div className="space-y-1.5">
                  {(profile.goals ?? []).map((g) => {
                    const monthlyNeed = Math.ceil(
                      Math.max(0, g.targetAmount - g.savedSoFar) / Math.max(1, g.targetMonths),
                    );
                    return (
                      <label
                        key={g.id}
                        className="flex items-center justify-between gap-2 text-xs cursor-pointer py-1"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={g.enabled}
                            onChange={() => toggleGoal(g.id)}
                            className="accent-teal-700 rounded shrink-0"
                          />
                          <span className="truncate text-slate-700 dark:text-slate-300">
                            {g.name} ({g.targetMonths} mo)
                          </span>
                        </span>
                        <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-white shrink-0">
                          {formatMoney(monthlyNeed, country)}/mo
                        </span>
                      </label>
                    );
                  })}
                </div>
                {sim.goalTradeoff.activeGoalCount > 0 && (
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    Carving {formatMoney(sim.goalTradeoff.totalMonthlyGoalSinking, country)}/mo delays debt-free by{' '}
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {sim.goalTradeoff.monthsDelayedByGoals} mo
                    </span>{' '}
                    (+{formatMoney(sim.goalTradeoff.extraLoanInterestFromGoals, country)} loan interest) — but avoids{' '}
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      ~{formatMoney(sim.goalTradeoff.cardDebtCostIfUnfunded, country)}
                    </span>{' '}
                    in credit card interest if funded on debt later.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right 7 cols: Interactive Trajectory + Fixed Extra Payment Lever + Stress Tests */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Debt-Free Timeline
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Your plan finishes in {formatDuration(sim.debtFreeMonths)} ({sim.debtFreeDateLabel}) vs{' '}
                  {formatDuration(sim.minimumsMonths)} on minimum payments
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 shrink-0 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className="w-3 h-0.5 inline-block shrink-0"
                    style={{ backgroundColor: chartStroke }}
                    aria-hidden="true"
                  />
                  Your Plan
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className="w-3 h-0.5 inline-block shrink-0"
                    style={{ backgroundColor: chartMinStroke }}
                    aria-hidden="true"
                  />
                  Minimum Payments
                </span>
              </div>
            </div>

            <div className="h-64 w-full" data-testid="trajectory-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  key={`${country}-${strategy}`}
                  data={sim.trajectory}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="optGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartStroke} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={chartStroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: chartTickColor }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    domain={[0, 'auto']}
                    tickFormatter={(v) => formatMoneyCompact(Number(v), country)}
                    tick={{ fontSize: 11, fill: chartTickColor }}
                    tickLine={false}
                    axisLine={false}
                    width={68}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatMoney(value, country),
                      name === 'optimizedBalance' ? 'Your Plan' : 'Minimum Payments',
                    ]}
                    contentStyle={{
                      backgroundColor: theme === 'ledger' ? '#1C1917' : '#0f172a',
                      borderColor: theme === 'ledger' ? '#44403C' : '#1e293b',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="minimumsBalance"
                    stroke={chartMinStroke}
                    strokeWidth={1.75}
                    strokeDasharray="4 4"
                    fill="transparent"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="optimizedBalance"
                    stroke={chartStroke}
                    strokeWidth={2.5}
                    fill="url(#optGrad)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* FIXED Interactive Extra Payment Lever (Static Max + Direct Number Input + Quick Presets) */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="extra-debt-slider"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Monthly Extra Payment Lever
                  {strategy === 'minimums' && (
                    <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                      (drag to exit Minimums Only)
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1">
                    <span className="text-xs font-mono text-slate-500">{country === 'IN' ? '₹' : '$'}</span>
                    <input
                      type="number"
                      min={0}
                      max={sliderMax * 2}
                      step={sliderStep}
                      aria-label="Exact monthly extra payment"
                      value={activeExtraSliderValue}
                      onChange={(e) => handleExtraChange(Number(e.target.value) || 0)}
                      className="w-20 bg-transparent text-right font-mono tabular-nums text-xs font-semibold text-teal-700 dark:text-teal-400 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/mo</span>
                  </div>
                  {profile.extraMonthlyOverride !== null && (
                    <button
                      type="button"
                      onClick={() => updateProfile({ extraMonthlyOverride: null })}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Auto
                    </button>
                  )}
                </div>
              </div>

              <input
                id="extra-debt-slider"
                type="range"
                min={0}
                max={sliderMax}
                step={sliderStep}
                value={activeExtraSliderValue}
                onChange={(e) => handleExtraChange(Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />

              <div className="space-y-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <div className="flex items-center justify-between">
                  <span>{formatMoney(0, country)}</span>
                  <span>{formatMoney(sliderMax, country)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(country === 'IN'
                    ? [
                        { label: '₹0', val: 0 },
                        { label: 'Auto Spare', val: null },
                        { label: '+₹10k', val: Math.max(0, sim.monthlyExtraToDebt) + 10000 },
                        { label: '+₹25k', val: Math.max(0, sim.monthlyExtraToDebt) + 25000 },
                      ]
                    : [
                        { label: '$0', val: 0 },
                        { label: 'Auto Spare', val: null },
                        { label: '+$250', val: Math.max(0, sim.monthlyExtraToDebt) + 250 },
                        { label: '+$500', val: Math.max(0, sim.monthlyExtraToDebt) + 500 },
                      ]
                  ).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        if (preset.val === null) {
                          if (strategy === 'minimums') setStrategy('avalanche');
                          updateProfile({ extraMonthlyOverride: null });
                        } else {
                          handleExtraChange(preset.val);
                        }
                      }}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Life-Scenario & Stress-Test Simulator (Annual Hike %, Windfall, Rate Shock, Job Loss Runway) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setStressOpen((v) => !v)}
              className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Life-Event &amp; Stress Simulator (Hike %, Windfall, Rate Shock, Income Drop)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {hasActiveStress
                      ? `Vs baseline: ${
                          baselineSim.debtFreeMonths - sim.debtFreeMonths >= 0
                            ? `${baselineSim.debtFreeMonths - sim.debtFreeMonths} mo faster`
                            : `${sim.debtFreeMonths - baselineSim.debtFreeMonths} mo slower`
                        } · ${
                          baselineSim.totalInterest - sim.totalInterest >= 0
                            ? `saves ${formatMoney(baselineSim.totalInterest - sim.totalInterest, country)}`
                            : `costs +${formatMoney(sim.totalInterest - baselineSim.totalInterest, country)}`
                        }`
                      : 'Model annual salary raises, bonuses, RBI/Fed hikes, or a pay-cut runway'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasActiveStress && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      resetStress();
                    }}
                    className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline px-2 py-1"
                  >
                    Reset
                  </span>
                )}
                {stressOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>
            </button>

            {stressOpen && (
              <div className="px-5 pb-5 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 1. Annual Salary Hike % + Start Month + % Directed to Debt */}
                  <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="stress-hike" className="font-semibold text-slate-800 dark:text-slate-200">
                        Annual Salary Hike
                      </label>
                      <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                        +{stress.annualHikePct}% / yr
                      </span>
                    </div>
                    <input
                      id="stress-hike"
                      type="range"
                      min={0}
                      max={20}
                      step={2}
                      value={stress.annualHikePct}
                      onChange={(e) => updateStress({ annualHikePct: Number(e.target.value) })}
                      className="w-full accent-teal-700 cursor-pointer"
                    />
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Starts From</span>
                        <select
                          aria-label="Salary hike start month"
                          value={stress.hikeStartMonth}
                          onChange={(e) => updateStress({ hikeStartMonth: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((mo) => (
                            <option key={mo} value={mo}>
                              {addMonthsLabel(mo, 'short')}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Raise to Debt</span>
                        <select
                          aria-label="Share of salary hike directed to debt"
                          value={stress.hikeToDebtPct}
                          onChange={(e) => updateStress({ hikeToDebtPct: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          {[25, 50, 75, 100].map((pct) => (
                            <option key={pct} value={pct}>
                              {pct}% to debt
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* 2. Bonus / Windfall + Exact Month + One-Time vs Recurring Annual */}
                  <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="stress-windfall" className="font-semibold text-slate-800 dark:text-slate-200">
                        Bonus / Windfall
                      </label>
                      <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                        {formatMoney(stress.windfallAmount, country)}
                      </span>
                    </div>
                    <input
                      id="stress-windfall"
                      type="range"
                      min={0}
                      max={country === 'IN' ? 1000000 : 25000}
                      step={country === 'IN' ? 50000 : 1000}
                      value={stress.windfallAmount}
                      onChange={(e) => updateStress({ windfallAmount: Number(e.target.value) })}
                      className="w-full accent-teal-700 cursor-pointer"
                    />
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Received In</span>
                        <select
                          aria-label="Bonus or windfall month"
                          value={stress.windfallMonth}
                          onChange={(e) => updateStress({ windfallMonth: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          {[1, 3, 4, 5, 6, 9, 12, 18, 24].map((mo) => (
                            <option key={mo} value={mo}>
                              {addMonthsLabel(mo, 'short')}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Frequency</span>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => updateStress({ windfallRecurring: false })}
                            className={`py-1.5 rounded text-[11px] border transition-colors ${
                              !stress.windfallRecurring
                                ? 'bg-teal-700 text-white border-teal-700'
                                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            Once
                          </button>
                          <button
                            type="button"
                            onClick={() => updateStress({ windfallRecurring: true })}
                            className={`py-1.5 rounded text-[11px] border transition-colors ${
                              stress.windfallRecurring
                                ? 'bg-teal-700 text-white border-teal-700'
                                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            Yearly
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. Living Expense Inflation & Annual Extra Payment Step-Up */}
                  <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Expense Inflation / Yr
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                        Erodes spare cash
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[0, 4, 6, 8].map((inf) => (
                        <button
                          key={inf}
                          type="button"
                          onClick={() => updateStress({ expenseInflationPct: inf })}
                          className={`py-1.5 rounded font-mono tabular-nums text-[11px] border transition-colors ${
                            stress.expenseInflationPct === inf
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {inf}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Annual Extra Step-Up
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                        Grows prepayments
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[0, 5, 10, 15].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => updateStress({ annualStepUpPct: step })}
                          className={`py-1.5 rounded font-mono tabular-nums text-[11px] border transition-colors ${
                            stress.annualStepUpPct === step
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          +{step}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Floating Rate Shock + Start Month + Lender Action */}
                  <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                      Floating Rate Shock ({country === 'IN' ? 'RBI Repo' : 'Fed / SOFR'})
                    </span>
                    <div className="grid grid-cols-5 gap-1">
                      {[-50, 0, 50, 100, 150].map((bps) => (
                        <button
                          key={bps}
                          type="button"
                          onClick={() => updateStress({ rateShockBps: bps })}
                          className={`py-1.5 rounded font-mono tabular-nums text-[11px] border transition-colors ${
                            stress.rateShockBps === bps
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {bps > 0 ? `+${(bps / 100).toFixed(1)}%` : bps === 0 ? '0%' : `${(bps / 100).toFixed(1)}%`}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Starts</span>
                        <select
                          aria-label="Rate shock effective month"
                          value={stress.rateShockMonth}
                          onChange={(e) => updateStress({ rateShockMonth: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          <option value={1}>Now (Mo 1)</option>
                          <option value={3}>Month 3</option>
                          <option value={6}>Month 6</option>
                          <option value={12}>Month 12</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Bank Action</span>
                        <select
                          aria-label="Bank action on rate shock"
                          value={stress.rateShockAction}
                          onChange={(e) =>
                            updateStress({
                              rateShockAction: e.target.value as 'extend_tenure' | 'raise_emi',
                            })
                          }
                          className="w-full px-2 py-1.5 text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          <option value="extend_tenure">Extend Tenure</option>
                          <option value="raise_emi">Raise EMI</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* 5. Income Drop / Layoff Test + Start + Duration */}
                  <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Income Drop / Layoff
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-400">
                        Runway: {sim.emergencyRunwayMonths} mo
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[0, 25, 50, 100].map((drop) => (
                        <button
                          key={drop}
                          type="button"
                          onClick={() => updateStress({ incomeDropPct: drop })}
                          className={`py-1.5 rounded font-mono tabular-nums text-[11px] border transition-colors ${
                            stress.incomeDropPct === drop
                              ? drop > 0
                                ? 'bg-rose-700 text-white border-rose-700'
                                : 'bg-teal-700 text-white border-teal-700'
                              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {drop === 0 ? 'Normal' : `-${drop}%`}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Starts</span>
                        <select
                          aria-label="Income drop start month"
                          value={stress.incomeDropStartMonth}
                          onChange={(e) => updateStress({ incomeDropStartMonth: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          <option value={1}>Now (Mo 1)</option>
                          <option value={3}>Month 3</option>
                          <option value={6}>Month 6</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Duration</span>
                        <select
                          aria-label="Income drop duration"
                          value={stress.incomeDropDurationMonths}
                          onChange={(e) =>
                            updateStress({ incomeDropDurationMonths: Number(e.target.value) })
                          }
                          className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                          <option value={3}>3 months</option>
                          <option value={6}>6 months</option>
                          <option value={12}>12 months</option>
                          <option value={0}>Ongoing</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Hidden Costs Banks & Plain Calculators Miss */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Hidden Costs Banks &amp; Plain Calculators Miss
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Exact rupee and dollar impacts from GST compounding, missed benchmark cuts, and revolving card interest.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {sim.disagreements.map((d) => (
            <div
              key={d.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className={`font-medium ${
                      d.severity === 'high'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-teal-700 dark:text-teal-400'
                    }`}
                  >
                    {d.severity === 'high' ? 'Actionable Recovery' : 'Plan Edge'}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                    {formatMoney(d.rupeeImpact, country)}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                  {d.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{d.summary}</p>
              </div>
              {d.actionLabel && d.actionTab && (
                <button
                  type="button"
                  onClick={() => setSection(d.actionTab as 'shield' | 'decisions')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline self-start"
                >
                  <span>{d.actionLabel}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Your Loans & Credit Cards Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Your Loans &amp; Credit Cards
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Click any True APR to inspect GST compounding, lost grace periods, and revolving debt math.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSection('vault')}
            className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
          >
            Edit loans
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 sm:px-5">Account</th>
                <th className="py-3 px-3 sm:px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">Stated Rate</th>
                <th className="py-3 px-3 sm:px-4 text-right">True APR</th>
                <th className="py-3 px-4 sm:px-5 text-right hidden sm:table-cell">Monthly Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sim.loanMetrics.map((m) => {
                const expanded = expandedAprId === m.loan.id;
                const rev = m.revolvingAnalysis;
                return (
                  <React.Fragment key={m.loan.id}>
                    <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3.5 px-4 sm:px-5">
                        <div className="font-medium text-slate-900 dark:text-white">{m.loan.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {m.loan.bank} · {m.loan.rateType === 'floating' ? `Floating (${m.loan.benchmark.toUpperCase()})` : 'Fixed'}
                          {m.loan.accountLast4 ? ` · XX${m.loan.accountLast4}` : ''}
                          {rev && !rev.gracePeriodActive ? ' · Grace period revoked' : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 sm:px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-white whitespace-nowrap">
                        <div>{formatMoney(m.loan.outstanding, country)}</div>
                        <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 sm:hidden">
                          {formatMoney(m.minimumDueThisMonth, country)}/mo
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 hidden sm:table-cell">
                        {formatPct(m.nominalApr)}
                      </td>
                      <td className="py-3.5 px-3 sm:px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setExpandedAprId(expanded ? null : m.loan.id)}
                          className={`inline-flex items-center gap-1 font-mono tabular-nums font-semibold ${
                            m.trueAllInApr > 0.2
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-teal-700 dark:text-teal-400'
                          }`}
                        >
                          <span>{formatPct(m.trueAllInApr)}</span>
                          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 sm:hidden">
                          vs {formatPct(m.nominalApr)}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono tabular-nums text-slate-900 dark:text-white hidden sm:table-cell">
                        {formatMoney(m.minimumDueThisMonth, country)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50/80 dark:bg-slate-950/60">
                        <td colSpan={5} className="px-5 py-4 space-y-3 text-xs">
                          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                            <span className="font-semibold text-slate-900 dark:text-white">True APR Math: </span>
                            {m.aprExplanation}
                          </p>

                          {/* Deep Revolving Credit Card Physics */}
                          {rev && (
                            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                                  <Flame className="w-3.5 h-3.5" />
                                  <span>Revolving Card Trap Diagnostics</span>
                                </span>
                                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                  Daily interest bleed: {formatMoney(rev.dailyInterestBleed, country)}/day
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                  <span className="text-slate-500 dark:text-slate-400 block">
                                    If paying only Minimum Due
                                  </span>
                                  <span className="font-mono tabular-nums text-sm font-bold text-rose-700 dark:text-rose-400">
                                    {rev.isDebtSpiral
                                      ? 'Never clears (Debt Spiral)'
                                      : `${formatDuration(rev.minimumOnlyMonths)} · ${formatMoney(rev.minimumOnlyTotalInterest, country)} int`}
                                  </span>
                                </div>
                                <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                  <span className="text-slate-500 dark:text-slate-400 block">
                                    Grace Period Status
                                  </span>
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    Revoked (new swipes charged Day 1)
                                  </span>
                                </div>
                                <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                  <label className="text-slate-500 dark:text-slate-400 block mb-1">
                                    Test Ongoing Monthly Card Swipes ({country === 'IN' ? '₹' : '$'})
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step={country === 'IN' ? 1000 : 100}
                                    value={m.loan.monthlyNewSpend ?? 0}
                                    onChange={(e) =>
                                      updateLoan(m.loan.id, {
                                        monthlyNewSpend: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 font-mono tabular-nums text-xs text-slate-900 dark:text-white"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

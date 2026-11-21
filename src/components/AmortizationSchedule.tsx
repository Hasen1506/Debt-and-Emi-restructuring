'use client';

import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, BarChart3, Calendar, Layers } from 'lucide-react';
import { formatDuration, formatMoney, formatMoneyCompact, formatPct } from '@/engine/math';
import type {
  AmortizationScenarioKey,
  AmortizationScenarioResult,
  Country,
  ThemeMode,
} from '@/engine/types';

interface AmortizationScheduleProps {
  country: Country;
  theme: ThemeMode;
  scenarios: Record<AmortizationScenarioKey, AmortizationScenarioResult>;
  activeKey: AmortizationScenarioKey;
  onSelectKey: (key: AmortizationScenarioKey) => void;
  extraMonthly: number;
  onChangeExtraMonthly: (val: number) => void;
  annualStepUpPct: number;
  onChangeAnnualStepUpPct: (val: number) => void;
}

const SCENARIO_ORDER: AmortizationScenarioKey[] = [
  'current',
  'fair_reset',
  'hike_higher_emi',
  'extra_prepay',
];

export function AmortizationSchedule({
  country,
  theme,
  scenarios,
  activeKey,
  onSelectKey,
  extraMonthly,
  onChangeExtraMonthly,
  annualStepUpPct,
  onChangeAnnualStepUpPct,
}: AmortizationScheduleProps) {
  const [granularity, setGranularity] = useState<'yearly' | 'monthly'>('yearly');
  const [showAllMonths, setShowAllMonths] = useState(false);

  const active = scenarios[activeKey];
  const current = scenarios.current;

  const principalBarColor =
    theme === 'ledger' ? '#14532D' : theme === 'dark' ? '#14b8a6' : '#0f766e';
  const interestBarColor =
    theme === 'ledger' ? '#991B1B' : theme === 'dark' ? '#f87171' : '#dc2626';
  const tickColor = theme === 'ledger' ? '#57534E' : theme === 'dark' ? '#94a3b8' : '#64748b';
  const gridColor =
    theme === 'ledger' ? 'rgba(120,113,108,0.22)' : 'rgba(148,163,184,0.2)';

  const totalPayments = active.totalPaid;
  const principalPctOfTotal =
    totalPayments > 0 ? Math.round(((totalPayments - active.totalInterest) / totalPayments) * 100) : 0;
  const interestPctOfTotal = Math.max(0, 100 - principalPctOfTotal);

  const visibleMonthlyRows = showAllMonths ? active.monthly : active.monthly.slice(0, 36);

  return (
    <section
      aria-label="Visual amortization schedule"
      data-testid="amortization-schedule"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>Principal vs Interest Over the Life of Your Loan</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Compare how much of every payment builds equity versus goes to bank interest across 4 repayment paths.
          </p>
        </div>

        <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setGranularity('yearly')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              granularity === 'yearly'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Yearly</span>
          </button>
          <button
            type="button"
            onClick={() => setGranularity('monthly')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              granularity === 'monthly'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Monthly</span>
          </button>
        </div>
      </div>

      {/* 4 Scenario Toggle Cards */}
      <div
        role="radiogroup"
        aria-label="Repayment scenarios"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-stretch"
      >
        {SCENARIO_ORDER.map((key) => {
          const sc = scenarios[key];
          const isSelected = key === activeKey;
          const saves = sc.interestSavedVsCurrent;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-testid={`amort-scenario-${key}`}
              onClick={() => onSelectKey(key)}
              className={`text-left p-3.5 rounded-xl border transition-colors flex flex-col justify-between gap-2.5 ${
                isSelected
                  ? 'border-teal-700 dark:border-teal-500 bg-teal-50/60 dark:bg-teal-950/35'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                    {sc.label}
                  </span>
                  <span className="font-mono tabular-nums text-[11px] font-semibold text-teal-700 dark:text-teal-400 shrink-0">
                    {formatPct(sc.annualRate)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  {sc.subtitle}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-baseline justify-between gap-2">
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                  {formatDuration(sc.totalMonths)}
                </span>
                <span
                  className={`font-mono tabular-nums text-[11px] font-semibold ${
                    key === 'current'
                      ? 'text-slate-500 dark:text-slate-400'
                      : saves > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : saves < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {key === 'current'
                    ? 'Baseline'
                    : saves > 0
                      ? `Saves ${formatMoneyCompact(saves, country)}`
                      : saves < 0
                        ? `+${formatMoneyCompact(Math.abs(saves), country)} int`
                        : 'Same cost'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Interactive Extra Prepay & Step-Up Controls when Scenario 4 is active */}
      {activeKey === 'extra_prepay' && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="amort-extra-monthly" className="font-medium text-slate-700 dark:text-slate-300">
                Extra Monthly Prepayment
              </label>
              <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                +{formatMoney(extraMonthly, country)}/mo
              </span>
            </div>
            <input
              id="amort-extra-monthly"
              type="range"
              min={0}
              max={country === 'IN' ? 75000 : 2000}
              step={country === 'IN' ? 2500 : 50}
              value={extraMonthly}
              onChange={(e) => onChangeExtraMonthly(Number(e.target.value))}
              className="w-full accent-teal-700 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Annual EMI Step-Up (Each Year)
              </span>
              <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                +{annualStepUpPct}% / yr
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 5, 10, 15].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => onChangeAnnualStepUpPct(pct)}
                  className={`py-1.5 rounded-md font-mono tabular-nums text-xs border transition-colors ${
                    annualStepUpPct === pct
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  +{pct}%
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Negative Amortization Guard */}
      {active.negativeAmortization && (
        <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Warning: At {formatPct(active.annualRate)}, your current EMI of{' '}
            {formatMoney(active.monthlyEmi, country)} does not cover monthly interest. Your loan balance will grow unless you raise the EMI or make a prepayment.
          </span>
        </div>
      )}

      {/* Active Scenario Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
        <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Payoff Timeline
          </span>
          <div className="mt-1.5 font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-white">
            {formatDuration(active.totalMonths)}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Ends {active.payoffDateLabel}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Total Interest Paid
          </span>
          <div className="mt-1.5 font-mono tabular-nums text-base font-semibold text-rose-600 dark:text-rose-400">
            {formatMoney(active.totalInterest, country)}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {principalPctOfTotal}% principal · {interestPctOfTotal}% interest
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Vs Current Schedule
          </span>
          <div
            className={`mt-1.5 font-mono tabular-nums text-base font-semibold ${
              active.interestSavedVsCurrent > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : active.interestSavedVsCurrent < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-white'
            }`}
          >
            {activeKey === 'current'
              ? 'Baseline'
              : active.interestSavedVsCurrent >= 0
                ? `Saves ${formatMoney(active.interestSavedVsCurrent, country)}`
                : `+${formatMoney(Math.abs(active.interestSavedVsCurrent), country)}`}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {activeKey === 'current'
              ? `EMI ${formatMoney(current.monthlyEmi, country)}/mo`
              : active.monthsSavedVsCurrent > 0
                ? `${formatDuration(active.monthsSavedVsCurrent)} faster`
                : active.monthsSavedVsCurrent < 0
                  ? `${formatDuration(Math.abs(active.monthsSavedVsCurrent))} longer`
                  : 'Same tenure'}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Principal Beats Interest
          </span>
          <div className="mt-1.5 font-mono tabular-nums text-base font-semibold text-teal-700 dark:text-teal-400">
            {active.crossoverMonth === null
              ? 'Never'
              : active.crossoverMonth === 1
                ? 'Month 1'
                : `Month ${active.crossoverMonth}`}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {active.crossoverMonth === null
              ? 'Interest exceeds principal'
              : active.monthly[active.crossoverMonth - 1]?.label ?? 'Immediately'}
          </span>
        </div>
      </div>

      {/* Stacked Bar Chart: Principal vs Interest by Year */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Annual Payment Split — {active.label}
          </span>
          <div className="flex items-center gap-4 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                style={{ backgroundColor: principalBarColor }}
                aria-hidden="true"
              />
              Principal Paid
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                style={{ backgroundColor: interestBarColor }}
                aria-hidden="true"
              />
              Interest Paid
            </span>
          </div>
        </div>

        <div className="h-64 w-full" data-testid="amortization-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              key={`${country}-${activeKey}-${active.totalMonths}`}
              data={active.yearly}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="yearLabel"
                tick={{ fontSize: 11, fill: tickColor }}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                domain={[0, 'auto']}
                tickFormatter={(v) => formatMoneyCompact(Number(v), country)}
                tick={{ fontSize: 11, fill: tickColor }}
                tickLine={false}
                axisLine={false}
                width={68}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatMoney(value, country),
                  name === 'principalPaid' ? 'Principal Paid' : 'Interest Paid',
                ]}
                contentStyle={{
                  backgroundColor: theme === 'ledger' ? '#1C1917' : '#0f172a',
                  borderColor: theme === 'ledger' ? '#44403C' : '#1e293b',
                  borderRadius: '8px',
                  color: '#f8fafc',
                  fontSize: '12px',
                }}
              />
              <Bar
                dataKey="principalPaid"
                stackId="a"
                fill={principalBarColor}
                isAnimationActive={false}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="interestPaid"
                stackId="a"
                fill={interestBarColor}
                isAnimationActive={false}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Year-by-Year or Month-by-Month Ledger Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          {granularity === 'yearly' ? (
            <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2.5 px-3.5 font-sans font-medium">Year</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Opening Bal</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Principal</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Interest</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Ending Bal</th>
                  <th className="py-2.5 px-3.5 font-sans font-medium hidden sm:table-cell w-36">
                    Principal Share
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {active.yearly.map((yr) => (
                  <tr
                    key={yr.year}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200"
                  >
                    <td className="py-2 px-3.5 font-semibold">{yr.yearLabel}</td>
                    <td className="py-2 px-3.5 text-right text-slate-600 dark:text-slate-400">
                      {formatMoney(yr.openingBalance, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right font-semibold text-teal-700 dark:text-teal-400">
                      {formatMoney(yr.principalPaid, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right text-rose-600 dark:text-rose-400">
                      {formatMoney(yr.interestPaid, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right font-medium">
                      {formatMoney(yr.closingBalance, country)}
                    </td>
                    <td className="py-2 px-3.5 hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-rose-200/80 dark:bg-rose-950 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${yr.principalSharePct}%`,
                              backgroundColor: principalBarColor,
                            }}
                          />
                        </div>
                        <span className="w-8 text-right text-[11px] text-slate-500 dark:text-slate-400">
                          {yr.principalSharePct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2.5 px-3.5 font-sans font-medium">Month</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Opening</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Payment</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Principal</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Interest</th>
                  <th className="py-2.5 px-3.5 text-right font-sans font-medium">Ending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleMonthlyRows.map((row) => (
                  <tr
                    key={row.month}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200"
                  >
                    <td className="py-2 px-3.5 font-medium whitespace-nowrap">
                      Mo {row.month} · {row.label}
                    </td>
                    <td className="py-2 px-3.5 text-right text-slate-600 dark:text-slate-400">
                      {formatMoney(row.openingBalance, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right">
                      {formatMoney(row.emiPaid, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right font-semibold text-teal-700 dark:text-teal-400">
                      {formatMoney(row.principalPaid + row.extraPrincipal, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right text-rose-600 dark:text-rose-400">
                      {formatMoney(row.interestPaid, country)}
                    </td>
                    <td className="py-2 px-3.5 text-right font-medium">
                      {formatMoney(row.closingBalance, country)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {granularity === 'monthly' && active.monthly.length > 36 && (
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Showing {visibleMonthlyRows.length} of {active.monthly.length} months
            </span>
            <button
              type="button"
              onClick={() => setShowAllMonths((v) => !v)}
              className="font-medium text-teal-700 dark:text-teal-400 hover:underline"
            >
              {showAllMonths ? 'Show first 36 months' : `Show all ${active.monthly.length} months`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

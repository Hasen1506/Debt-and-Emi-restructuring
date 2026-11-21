'use client';

import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  HeartHandshake,
  Lock,
  Plus,
  RotateCcw,
  Shield,
  Target,
  Trash2,
} from 'lucide-react';
import { useRightDue } from '@/lib/store';
import { formatMoney, simulatePayoffPlan } from '@/engine/math';
import { auditLoan, generateFormalLetter } from '@/engine/loanAudit';
import type { FinancialGoal, Loan, LoanType, RateBenchmark, RateType } from '@/engine/types';

const COLLATERAL_RANK: Record<LoanType, { priority: number; tier: string; why: string }> = {
  home_loan: {
    priority: 1,
    tier: 'Protect First (Secured Collateral)',
    why: 'Mortgage / home loan default triggers SARFAESI (IN) or foreclosure (US) risk against your home.',
  },
  gold_loan: {
    priority: 2,
    tier: 'Protect First (Pledged Gold)',
    why: 'Lenders can auction pledged gold rapidly after short arrears.',
  },
  auto_loan: {
    priority: 3,
    tier: 'Protect Second (Vehicle)',
    why: 'Missed auto EMIs carry vehicle repossession risk if mobility is required for work.',
  },
  education_loan: {
    priority: 4,
    tier: 'Negotiate Moratorium / Deferment',
    why: 'Usually eligible for formal hardship deferment or income-driven restructuring.',
  },
  personal_loan: {
    priority: 5,
    tier: 'Unsecured — Request Proactive Restructuring',
    why: 'No physical collateral; ask lender in writing for a 3-month tenure extension before missing a due date.',
  },
  bnpl: {
    priority: 6,
    tier: 'Unsecured — Pay After Essentials',
    why: 'High late fee risk, but never sacrifice rent, food, or home EMI for BNPL.',
  },
  credit_card: {
    priority: 7,
    tier: 'Unsecured — Pay Minimum Only If Cash Is Tight',
    why: 'Paying minimum preserves CIBIL/FICO standing during a 1-month crunch; request hardship EMI conversion if multi-month.',
  },
};

export function CantPayShield() {
  const { country, profile } = useRightDue();
  const sim = useMemo(() => simulatePayoffPlan(profile, 'avalanche'), [profile]);
  const openLoans = useMemo(
    () =>
      [...profile.loans]
        .filter((l) => l.outstanding > 0)
        .sort(
          (a, b) =>
            (COLLATERAL_RANK[a.loanType]?.priority ?? 9) -
            (COLLATERAL_RANK[b.loanType]?.priority ?? 9),
        ),
    [profile.loans],
  );

  const [selectedLoanId, setSelectedLoanId] = useState<string>(openLoans[0]?.id ?? '');
  const [borrowerName, setBorrowerName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [copied, setCopied] = useState(false);

  const activeLoan = openLoans.find((l) => l.id === selectedLoanId) ?? openLoans[0];

  const hardshipLetter = useMemo(() => {
    if (!activeLoan) return null;
    const audit = auditLoan({
      country,
      lenderName: activeLoan.bank,
      lenderType: activeLoan.lenderType,
      loanType: activeLoan.loanType,
      benchmark: activeLoan.benchmark,
      startMonth: activeLoan.startMonth || '2023-06',
      startRate: activeLoan.startRate ?? activeLoan.annualRate,
      currentRate: activeLoan.annualRate,
      outstanding: activeLoan.outstanding,
      monthsRemaining: activeLoan.monthsRemaining,
      emi: activeLoan.emi,
      spreadChanged: 'no',
      spreadDelta: 0,
      bankActionAfterHike: 'none_yet',
      choiceOffered: 'yes',
    });
    return generateFormalLetter(
      country === 'IN' ? 'hardship_in' : 'hardship_us',
      audit,
      {
        name: borrowerName,
        accountNumber: accountNumber || (activeLoan.accountLast4 ? `XXXX${activeLoan.accountLast4}` : ''),
        phone: '',
        email: '',
        address: '',
        sentDate: new Date().toISOString().slice(0, 10),
      },
      {
        outstanding: activeLoan.outstanding,
        currentRate: activeLoan.annualRate,
        startMonth: activeLoan.startMonth || '2023-06',
        startRate: activeLoan.startRate ?? activeLoan.annualRate,
        emi: activeLoan.emi,
      },
    );
  }, [activeLoan, country, borrowerName, accountNumber]);

  async function handleCopy() {
    if (!hardshipLetter) return;
    try {
      await navigator.clipboard.writeText(hardshipLetter.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Can&apos;t Pay This Month — Calm Triage
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
          Short months happen. Never panic-borrow from an instant loan app or pay a credit card before protecting your home. Follow the legal collateral priority order and notify lenders in writing before the due date.
        </p>
      </div>

      {/* Cash Cushion Snapshot */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mandatory Monthly Dues
          </p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatMoney(sim.monthlyMandatoryDues, country)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across {openLoans.length} active accounts
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Emergency Reserve Available
          </p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400">
            {formatMoney(profile.emergencyFundCurrent, country)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Covers{' '}
            {sim.monthlyMandatoryDues > 0
              ? (profile.emergencyFundCurrent / sim.monthlyMandatoryDues).toFixed(1)
              : '0'}{' '}
            months of EMIs
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monthly Surplus / Shortfall
          </p>
          <p
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              sim.isShortfall
                ? 'text-rose-700 dark:text-rose-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {sim.isShortfall
              ? `-${formatMoney(sim.shortfallAmount, country)}`
              : `+${formatMoney(sim.monthlySpareCash, country)}`}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            After living spend &amp; minimums
          </p>
        </div>
      </div>

      {/* Collateral Priority Order */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <HeartHandshake className="w-5 h-5 text-teal-700 dark:text-teal-400" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Legal Protection Priority Order (Pay Top to Bottom)
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-4">Priority</th>
                <th className="py-2.5 px-4">Account</th>
                <th className="py-2.5 px-4 text-right">Due This Month</th>
                <th className="py-2.5 px-4 text-right">1-Month Interest Cost</th>
                <th className="py-2.5 pl-4">Guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {openLoans.map((loan, idx) => {
                const rank = COLLATERAL_RANK[loan.loanType];
                const monthlyInt = Math.round(loan.outstanding * (loan.annualRate / 12));
                return (
                  <tr key={loan.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 pr-4 font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                      #{idx + 1}
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-medium text-slate-900 dark:text-white">{loan.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {loan.bank} · {rank.tier}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {formatMoney(loan.emi, country)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">
                      {formatMoney(monthlyInt, country)}
                    </td>
                    <td className="py-3.5 pl-4 text-xs text-slate-600 dark:text-slate-400 max-w-sm">
                      {rank.why}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Proactive Hardship Letter Builder */}
      {hardshipLetter && activeLoan && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Proactive Hardship &amp; Restructuring Notice
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sending a written request 5–10 days BEFORE a missed due date creates a statutory paper trail and avoids NACH bounce charges.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap self-start"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied Letter' : 'Copy Hardship Letter'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Loan Account
              </span>
              <select
                value={activeLoan.id}
                onChange={(e) => setSelectedLoanId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                {openLoans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.bank})
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Your Full Name
              </span>
              <input
                type="text"
                value={borrowerName}
                onChange={(e) => setBorrowerName(e.target.value)}
                placeholder="e.g. Aarav Sharma"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Loan / Card Account No.
              </span>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="Optional — defaults to last 4"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono text-slate-900 dark:text-white"
              />
            </label>
          </div>

          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 max-h-80 overflow-y-auto">
            {hardshipLetter.body}
          </pre>
        </section>
      )}
    </div>
  );
}

export function LoansAndVault() {
  const {
    country,
    profile,
    updateProfile,
    addLoan,
    updateLoan,
    deleteLoan,
    addGoal,
    toggleGoal,
    deleteGoal,
    exportJson,
    resetAllData,
  } = useRightDue();

  const sim = useMemo(() => simulatePayoffPlan(profile, 'avalanche'), [profile]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [newName, setNewName] = useState('');
  const [newBank, setNewBank] = useState('');
  const [newType, setNewType] = useState<LoanType>('personal_loan');
  const [newRateType, setNewRateType] = useState<RateType>('floating');
  const [newBenchmark, setNewBenchmark] = useState<RateBenchmark>('repo');
  const [newOutstanding, setNewOutstanding] = useState<number>(country === 'IN' ? 250000 : 8000);
  const [newRatePct, setNewRatePct] = useState<number>(country === 'IN' ? 11.5 : 10.5);
  const [newEmi, setNewEmi] = useState<number>(country === 'IN' ? 8200 : 280);
  const [newMonths, setNewMonths] = useState<number>(36);

  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState<number>(country === 'IN' ? 150000 : 5000);
  const [goalSaved, setGoalSaved] = useState<number>(0);
  const [goalMonths, setGoalMonths] = useState<number>(12);
  const [goalPriority, setGoalPriority] = useState<'essential' | 'flexible'>('essential');

  function handleAddLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newBank.trim()) return;
    const loan: Loan = {
      id: `loan-${Date.now()}`,
      name: newName.trim(),
      bank: newBank.trim(),
      lenderType: country === 'IN' ? 'commercial_bank' : 'us_bank',
      loanType: newType,
      rateType: newType === 'credit_card' ? 'floating' : newRateType,
      benchmark: newType === 'credit_card' ? 'prime' : newBenchmark,
      outstanding: Math.max(0, newOutstanding),
      annualRate: Math.max(0, newRatePct / 100),
      startRate: Math.max(0, newRatePct / 100),
      startMonth: '2025-01',
      emi: Math.max(0, newEmi),
      monthsRemaining: Math.max(1, newMonths),
      monthlyNewSpend: 0,
    };
    addLoan(loan);
    setNewName('');
    setNewBank('');
    setShowAddForm(false);
  }

  function handleAddGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!goalName.trim() || goalTarget <= 0) return;
    const goal: FinancialGoal = {
      id: `goal-${Date.now()}`,
      name: goalName.trim(),
      targetAmount: Math.max(0, goalTarget),
      savedSoFar: Math.max(0, goalSaved),
      targetMonths: Math.max(1, goalMonths),
      priority: goalPriority,
      enabled: true,
    };
    addGoal(goal);
    setGoalName('');
    setGoalSaved(0);
    setShowGoalForm(false);
  }

  function handleDownloadVault() {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rightdue-vault-${country.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Loans, Competing Goals &amp; Data Vault
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
          Every figure below updates your payoff trajectory, true APRs, goal sinking funds, and Loan Shield diagnostics instantly. All state lives strictly in your browser.
        </p>
      </div>

      {/* Household Cashflow & Tax Profile */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Household Cash Flow &amp; Tax Settings ({country === 'IN' ? 'India ₹' : 'USA $'})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Monthly Take-Home ({country === 'IN' ? '₹' : '$'})
            </span>
            <input
              type="number"
              value={profile.monthlyTakeHome}
              onChange={(e) => updateProfile({ monthlyTakeHome: Number(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Monthly Living Spend ({country === 'IN' ? '₹' : '$'})
            </span>
            <input
              type="number"
              value={profile.monthlyLivingSpend}
              onChange={(e) => updateProfile({ monthlyLivingSpend: Number(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Emergency Fund Held ({country === 'IN' ? '₹' : '$'})
            </span>
            <input
              type="number"
              value={profile.emergencyFundCurrent}
              onChange={(e) => updateProfile({ emergencyFundCurrent: Number(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
          </label>
          {country === 'IN' ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                India Tax Regime
              </span>
              <select
                value={profile.taxRegimeIN}
                onChange={(e) => updateProfile({ taxRegimeIN: e.target.value as 'new' | 'old' })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                <option value="new">New Regime (No 24(b))</option>
                <option value="old">Old Regime (24(b) ₹2L)</option>
              </select>
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Marginal Tax Bracket (%)
              </span>
              <input
                type="number"
                value={Math.round(profile.marginalTaxRate * 100)}
                onChange={(e) =>
                  updateProfile({ marginalTaxRate: Math.min(0.5, Math.max(0, (Number(e.target.value) || 0) / 100)) })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
              />
            </label>
          )}
        </div>
      </section>

      {/* Active Loans CRUD */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Active Loans &amp; Credit Cards ({profile.loans.length})
          </h2>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddForm ? 'Cancel' : 'Add Loan / Card'}</span>
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleAddLoan}
            className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            <input
              type="text"
              required
              placeholder="Account Name (e.g. ICICI Car Loan)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
            <input
              type="text"
              required
              placeholder="Lender (e.g. ICICI Bank)"
              value={newBank}
              onChange={(e) => setNewBank(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as LoanType)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              <option value="home_loan">Home Loan / Mortgage</option>
              <option value="credit_card">Credit Card</option>
              <option value="personal_loan">Personal Loan</option>
              <option value="auto_loan">Auto Loan</option>
              <option value="education_loan">Education Loan</option>
              <option value="gold_loan">Gold Loan</option>
            </select>
            <select
              value={newRateType}
              onChange={(e) => setNewRateType(e.target.value as RateType)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              <option value="floating">Floating Rate</option>
              <option value="fixed">Fixed Rate</option>
            </select>
            <input
              type="number"
              placeholder="Balance"
              value={newOutstanding}
              onChange={(e) => setNewOutstanding(Number(e.target.value) || 0)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
            <input
              type="number"
              step="0.05"
              placeholder="Annual Rate (%)"
              value={newRatePct}
              onChange={(e) => setNewRatePct(Number(e.target.value) || 0)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
            <input
              type="number"
              placeholder="Monthly EMI"
              value={newEmi}
              onChange={(e) => setNewEmi(Number(e.target.value) || 0)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Months"
                value={newMonths}
                onChange={(e) => setNewMonths(Number(e.target.value) || 12)}
                className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
              />
              <select
                value={newBenchmark}
                onChange={(e) => setNewBenchmark(e.target.value as RateBenchmark)}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2 text-xs text-slate-900 dark:text-white"
              >
                <option value="repo">Repo</option>
                <option value="mclr">MCLR</option>
                <option value="prime">Prime</option>
                <option value="fixed">Fixed</option>
              </select>
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-teal-700 text-white whitespace-nowrap"
              >
                Save
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-4">Account</th>
                <th className="py-2.5 px-3 text-right">Balance</th>
                <th className="py-2.5 px-3 text-right">Rate (%)</th>
                <th className="py-2.5 px-3 text-right">Monthly EMI</th>
                <th className="py-2.5 pl-3 text-right">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {profile.loans.map((loan) => (
                <tr key={loan.id}>
                  <td className="py-3 pr-4">
                    <p className="font-medium text-slate-900 dark:text-white">{loan.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {loan.bank} · {loan.rateType} · {loan.benchmark.toUpperCase()}
                    </p>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <input
                      type="number"
                      aria-label={`${loan.name} balance`}
                      value={loan.outstanding}
                      onChange={(e) =>
                        updateLoan(loan.id, { outstanding: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-28 text-right rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </td>
                  <td className="py-3 px-3 text-right">
                    <input
                      type="number"
                      step="0.05"
                      aria-label={`${loan.name} annual rate`}
                      value={Number((loan.annualRate * 100).toFixed(2))}
                      onChange={(e) =>
                        updateLoan(loan.id, {
                          annualRate: Math.max(0, (Number(e.target.value) || 0) / 100),
                        })
                      }
                      className="w-20 text-right rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </td>
                  <td className="py-3 px-3 text-right">
                    <input
                      type="number"
                      aria-label={`${loan.name} monthly EMI`}
                      value={loan.emi}
                      onChange={(e) =>
                        updateLoan(loan.id, { emi: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-24 text-right rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => deleteLoan(loan.id)}
                      disabled={profile.loans.length <= 1}
                      aria-label={`Delete ${loan.name}`}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Debt-Competing Financial Goals (Sinking Fund vs Borrowing Tradeoff) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <span>Debt-Competing Cash Goals ({(profile.goals ?? []).length})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upcoming lump-sum bills (medical, tuition, wedding, tax) carved out of spare cash so you never get forced onto a 60% credit card when the bill arrives.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowGoalForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap self-start"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showGoalForm ? 'Cancel' : 'Add Cash Goal'}</span>
          </button>
        </div>

        {showGoalForm && (
          <form
            onSubmit={handleAddGoal}
            className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
          >
            <input
              type="text"
              required
              placeholder="Goal Name (e.g. Annual Tuition)"
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white lg:col-span-2"
            />
            <input
              type="number"
              required
              placeholder="Target Amount"
              value={goalTarget}
              onChange={(e) => setGoalTarget(Number(e.target.value) || 0)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
            <input
              type="number"
              min={1}
              max={120}
              placeholder="Months away"
              value={goalMonths}
              onChange={(e) => setGoalMonths(Math.max(1, Number(e.target.value) || 12))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
            />
            <div className="flex items-center gap-2">
              <select
                value={goalPriority}
                onChange={(e) => setGoalPriority(e.target.value as 'essential' | 'flexible')}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2 text-xs text-slate-900 dark:text-white"
              >
                <option value="essential">Essential</option>
                <option value="flexible">Flexible</option>
              </select>
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-medium rounded-lg bg-teal-700 text-white"
              >
                Add
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {(profile.goals ?? []).map((g) => {
            const monthlyNeed = Math.ceil(
              Math.max(0, g.targetAmount - g.savedSoFar) / Math.max(1, g.targetMonths),
            );
            return (
              <div key={g.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <label className="flex items-center gap-3 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={g.enabled}
                    onChange={() => toggleGoal(g.id)}
                    className="accent-teal-700 rounded shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">{g.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Target {formatMoney(g.targetAmount, country)} ({formatMoney(g.savedSoFar, country)} saved) · Due in{' '}
                      {g.targetMonths} mo · {g.priority}
                    </p>
                  </div>
                </label>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                    {formatMoney(monthlyNeed, country)}/mo
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteGoal(g.id)}
                    aria-label={`Delete goal ${g.name}`}
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {sim.goalTradeoff.activeGoalCount > 0 && (
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
            Active goal sinking fund ({formatMoney(sim.goalTradeoff.totalMonthlyGoalSinking, country)}/mo) adds{' '}
            <strong className="font-mono">{sim.goalTradeoff.monthsDelayedByGoals} mo</strong> (+
            {formatMoney(sim.goalTradeoff.extraLoanInterestFromGoals, country)} loan interest) to your payoff timeline — vs{' '}
            <strong className="font-mono text-rose-700 dark:text-rose-400">
              ~{formatMoney(sim.goalTradeoff.cardDebtCostIfUnfunded, country)}
            </strong>{' '}
            in card interest if you had to borrow for those goals later.
          </div>
        )}
      </section>

      {/* Honest Business Model & Local Vault */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              How RightDue Stays 100% Independent
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Loan marketplaces make money when you borrow more or transfer a loan through their referral link. RightDue takes zero bank commissions — funded strictly by borrowers who recover multiples of the subscription in interest.
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-white">RightDue Free</p>
              <p className="text-slate-600 dark:text-slate-400">
                Full Payoff Command Center, True All-In APR math, 1st Loan Shield diagnostic, Advice Verifier &amp; Bulk SMS/CSV Pulse.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-teal-700 dark:text-teal-400">
                RightDue Shield · {country === 'IN' ? '₹299/yr' : '$19/yr'}
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Unlimited statutory escalation packs (Bank → Internal Ombudsman → RBI/CFPB), quarterly repo/Fed reset watchdog &amp; multi-loan audit annexures.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Local-First Data Vault
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Your loans, goals, payment logs, parsed SMS alerts, and tracked escalation deadlines stay in your browser&apos;s local storage. Export a clean JSON backup anytime or wipe everything instantly.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownloadVault}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Export Vault JSON</span>
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Wipe &amp; Reset Sample Data</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetAllData();
                    setConfirmReset(false);
                  }}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Confirm Wipe
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

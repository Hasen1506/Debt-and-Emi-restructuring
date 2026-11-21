'use client';

import React, { useState } from 'react';
import { ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { useRightDue } from '@/lib/store';
import { formatMoney } from '@/engine/math';

export function OnboardingDrawer() {
  const {
    onboardingOpen,
    setOnboardingOpen,
    country,
    setCountry,
    profile,
    updateProfile,
    theme,
    setTheme,
    setSection,
  } = useRightDue();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  if (!onboardingOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="60-Second Household Setup"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              60-Second Household Setup · Step {step} of 3
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOnboardingOpen(false)}
            aria-label="Close setup drawer"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  1. Choose Market, Tax Regime &amp; Workspace Style
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  RightDue tailors statutory rules (RBI Directions 2025 vs US RESPA/FCBA), GST/tax shields, and currency automatically.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCountry('IN')}
                  className={`p-3.5 rounded-lg border text-left transition-colors ${
                    country === 'IN'
                      ? 'border-teal-700 bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-semibold text-sm">India (₹)</div>
                  <div className="text-xs opacity-80 mt-0.5">RBI EBLR resets, 18% card GST, Sec 24(b)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCountry('US')}
                  className={`p-3.5 rounded-lg border text-left transition-colors ${
                    country === 'US'
                      ? 'border-teal-700 bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-semibold text-sm">United States ($)</div>
                  <div className="text-xs opacity-80 mt-0.5">RESPA Reg X, FCBA Reg Z, daily APR</div>
                </button>
              </div>

              {country === 'IN' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Income Tax Regime
                  </span>
                  <select
                    value={profile.taxRegimeIN}
                    onChange={(e) => updateProfile({ taxRegimeIN: e.target.value as 'new' | 'old' })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  >
                    <option value="new">New Tax Regime (Default — no Sec 24(b) shield)</option>
                    <option value="old">Old Tax Regime (Sec 24(b) home loan shield up to ₹2L)</option>
                  </select>
                </label>
              )}

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                  Visual Style (Switch anytime)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'light', label: 'Modern Light' },
                      { id: 'ledger', label: 'Paper Ledger' },
                      { id: 'dark', label: 'Dark Slate' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${
                        theme === t.id
                          ? 'border-teal-700 bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-200'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  2. Monthly Take-Home, Essential Living Spend &amp; Buffer
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Drives your exact monthly spare cash, payoff speed, and layoff survival runway.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Monthly Take-Home ({country === 'IN' ? '₹' : '$'})
                  </span>
                  <input
                    type="number"
                    value={profile.monthlyTakeHome}
                    onChange={(e) => updateProfile({ monthlyTakeHome: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Essential Monthly Spend ({country === 'IN' ? '₹' : '$'})
                  </span>
                  <input
                    type="number"
                    value={profile.monthlyLivingSpend}
                    onChange={(e) => updateProfile({ monthlyLivingSpend: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Emergency Cash Held ({country === 'IN' ? '₹' : '$'})
                  </span>
                  <input
                    type="number"
                    value={profile.emergencyFundCurrent}
                    onChange={(e) => updateProfile({ emergencyFundCurrent: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Emergency Target ({country === 'IN' ? '₹' : '$'})
                  </span>
                  <input
                    type="number"
                    value={profile.emergencyFundTarget}
                    onChange={(e) => updateProfile({ emergencyFundTarget: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  3. Where Should We Start?
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  You currently have {profile.loans.length} accounts loaded (totaling{' '}
                  {formatMoney(
                    profile.loans.reduce((s, l) => s + l.outstanding, 0),
                    country,
                  )}
                  ). Pick your fastest next move:
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setOnboardingOpen(false);
                    setSection('shield');
                  }}
                  className="w-full p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-teal-600 text-left flex items-center justify-between gap-3 transition-colors"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      Audit my floating loan for missed RBI/Fed rate cuts
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Generates refund annexure &amp; third-person statutory grievance letter
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-teal-700 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOnboardingOpen(false);
                    setSection('sms');
                  }}
                  className="w-full p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-teal-600 text-left flex items-center justify-between gap-3 transition-colors"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      Bulk drop a bank CSV or Android SMS Backup XML
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Auto-syncs card balances, EMIs &amp; exposes spend leaks (0 KB uploaded)
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-teal-700 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOnboardingOpen(false);
                    setSection('vault');
                  }}
                  className="w-full p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-teal-600 text-left flex items-center justify-between gap-3 transition-colors"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      Edit my exact loans &amp; competing cash goals manually
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Add home/auto/personal loans, credit cards, and upcoming milestones
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-teal-700 shrink-0" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-950/60">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              Back
            </button>
          ) : (
            <span className="text-[11px] text-slate-500">Saved locally in your browser</span>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white"
            >
              <span>Continue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOnboardingOpen(false);
                setSection('command');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Open Command Center</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

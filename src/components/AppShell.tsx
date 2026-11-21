'use client';

import React, { useState } from 'react';
import {
  Activity,
  BookOpen,
  Calculator,
  HeartHandshake,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useRightDue, type AppSection } from '@/lib/store';
import type { ThemeMode } from '@/engine/types';

interface NavItem {
  id: AppSection;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'command', label: 'Command Center', shortLabel: 'Home', icon: LayoutDashboard },
  { id: 'shield', label: 'Loan Shield', shortLabel: 'Shield', icon: ShieldAlert },
  { id: 'sms', label: 'SMS & Spend Pulse', shortLabel: 'SMS', icon: MessageSquareText },
  { id: 'decisions', label: 'Check Before Signing', shortLabel: 'Check', icon: Calculator },
  { id: 'cant-pay', label: "Can't Pay Shield", shortLabel: 'Relief', icon: HeartHandshake },
  { id: 'vault', label: 'Loans, Goals & Vault', shortLabel: 'Vault', icon: SlidersHorizontal },
];

const SECTION_TITLE: Record<AppSection, string> = {
  command: 'Command Center',
  shield: 'Loan Shield & Rights Audit',
  sms: 'On-Device SMS & Spend Pulse',
  decisions: 'Check Before Signing',
  'cant-pay': "Can't Pay Relief Triage",
  vault: 'Loans, Goals & Data Vault',
};

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'ledger', label: 'Ledger', icon: BookOpen },
  { id: 'dark', label: 'Dark', icon: Moon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    section,
    setSection,
    setOnboardingOpen,
    country,
    setCountry,
    theme,
    setTheme,
    toggleTheme,
    trackedCases,
  } = useRightDue();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function go(id: AppSection) {
    setSection(id);
    setMobileMenuOpen(false);
  }

  return (
    <div className="rd-canvas min-h-screen flex bg-[#F8FAFC] text-slate-900 dark:bg-[#0B1120] dark:text-slate-100">
      {/* Desktop Sidebar (248px) */}
      <aside className="hidden lg:flex lg:w-[248px] lg:shrink-0 lg:flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 sticky top-0 h-screen">
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => go('command')}
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            RightDue
          </button>
          <button
            type="button"
            onClick={() => setOnboardingOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
          >
            <Sparkles className="w-3 h-3" />
            <span>Quick Setup</span>
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  active
                    ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.id === 'shield' && trackedCases.length > 0 && (
                  <span className="ml-auto font-mono text-xs tabular-nums text-teal-700 dark:text-teal-400">
                    {trackedCases.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-4 pt-4 pb-6 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Market</span>
            <div className="inline-flex p-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCountry('IN')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  country === 'IN'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                India ₹
              </button>
              <button
                type="button"
                onClick={() => setCountry('US')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  country === 'US'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                USA $
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400 block">Appearance</span>
            <div
              role="radiogroup"
              aria-label="Color theme"
              className="grid grid-cols-3 p-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            >
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(opt.id)}
                    className={`inline-flex items-center justify-center gap-1 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 pt-1">
            Independent borrower software. Zero lender commissions or referral payouts.
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-semibold text-slate-900 dark:text-white lg:hidden whitespace-nowrap shrink-0">
                RightDue
              </span>
              <span className="hidden sm:inline lg:hidden text-slate-300 dark:text-slate-700" aria-hidden="true">
                /
              </span>
              <span className="hidden lg:inline text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                Workspace
              </span>
              <span className="hidden lg:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
                /
              </span>
              <span className="hidden sm:inline font-semibold text-slate-900 dark:text-white truncate">
                {SECTION_TITLE[section]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setOnboardingOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
              <span>60s Setup</span>
            </button>
            <button
              type="button"
              onClick={() => setCountry(country === 'IN' ? 'US' : 'IN')}
              className="lg:hidden px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
            >
              {country === 'IN' ? 'IN ₹' : 'US $'}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Theme: ${theme}. Click to cycle Light, Ledger, Dark`}
              title={`Theme: ${theme}`}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
            >
              {theme === 'dark' ? (
                <Moon className="w-4 h-4" />
              ) : theme === 'ledger' ? (
                <BookOpen className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => go(section === 'sms' ? 'shield' : 'sms')}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Activity className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">{section === 'sms' ? 'Audit' : 'SMS'}</span>
              <span className="hidden sm:inline">
                {section === 'sms' ? 'Audit Loan Rate' : 'Bulk SMS / CSV'}
              </span>
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-950/50"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-950 h-full border-r border-slate-200 dark:border-slate-800 flex flex-col">
              <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <span className="text-lg font-bold text-slate-900 dark:text-white">RightDue</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 p-3 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors text-left ${
                        active
                          ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-3 p-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  {THEME_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTheme(opt.id)}
                        className={`inline-flex items-center justify-center gap-1 py-1.5 text-xs font-medium rounded ${
                          theme === opt.id
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setOnboardingOpen(true);
                  }}
                  className="w-full py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                >
                  Open 60-Second Guided Setup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Primary Viewport */}
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>

        {/* Quiet Legal Footer */}
        <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 dark:text-slate-400">
          <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p>
              RightDue calculations are deterministic estimates from your numbers and cited regulatory texts — not investment, tax, or legal advice.
            </p>
            <p className="whitespace-nowrap shrink-0">
              100% local-first privacy · No bank commissions
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import { useRightDue } from '@/lib/store';
import { AUDIT_SCENARIO_PRESETS } from '@/engine/presets';
import { auditLoan, compareBankRewriteOffer, generateFormalLetter } from '@/engine/loanAudit';
import { buildLoanShieldAmortizationScenarios } from '@/engine/amortization';
import { downloadLoanAuditPdf, PDF_THEME_PALETTES } from '@/engine/pdfAuditReport';
import { formatMoney, formatPct } from '@/engine/math';
import { LENDER_DIRECTORY, NEXT_POLICY_MEETING } from '@/engine/policyRates';
import { AmortizationSchedule } from './AmortizationSchedule';
import type {
  AmortizationScenarioKey,
  BorrowerIdentity,
  LetterKind,
  LoanAuditInput,
  ThemeMode,
} from '@/engine/types';

export function LoanShield() {
  const { country, theme, profile, trackedCases, addTrackedCase, updateCaseStatus } = useRightDue();

  const defaultHome = profile.loans.find((l) => l.loanType === 'home_loan') || profile.loans[0];

  const [input, setInput] = useState<LoanAuditInput>(() =>
    country === 'IN'
      ? AUDIT_SCENARIO_PRESETS.missed_cut_in.input
      : AUDIT_SCENARIO_PRESETS.us_respa_audit.input,
  );

  // Bank Rewrite vs Balance Transfer comparator inputs
  const [convRatePct, setConvRatePct] = useState(country === 'IN' ? '8.35' : '6.25');
  const [convFee, setConvFee] = useState(country === 'IN' ? '10000' : '500');
  const [btRatePct, setBtRatePct] = useState(country === 'IN' ? '8.15' : '6.00');
  const [btCosts, setBtCosts] = useState(country === 'IN' ? '35000' : '3800');
  const [oldForeclosureFee, setOldForeclosureFee] = useState('0');
  const [keepYears, setKeepYears] = useState('5');

  // Visual Amortization Schedule state
  const [amortScenarioKey, setAmortScenarioKey] = useState<AmortizationScenarioKey>('current');
  const [amortExtraMonthly, setAmortExtraMonthly] = useState(country === 'IN' ? 10000 : 300);
  const [amortStepUpPct, setAmortStepUpPct] = useState(5);

  // Sync preset & comparator defaults when country changes
  const [lastCountry, setLastCountry] = useState(country);
  if (lastCountry !== country) {
    setLastCountry(country);
    setInput(
      country === 'IN'
        ? AUDIT_SCENARIO_PRESETS.missed_cut_in.input
        : AUDIT_SCENARIO_PRESETS.us_respa_audit.input,
    );
    setConvRatePct(country === 'IN' ? '8.35' : '6.25');
    setConvFee(country === 'IN' ? '10000' : '500');
    setBtRatePct(country === 'IN' ? '8.15' : '6.00');
    setBtCosts(country === 'IN' ? '35000' : '3800');
    setAmortExtraMonthly(country === 'IN' ? 10000 : 300);
  }

  // Statutory Letter Builder & Formal PDF Export state
  const [letterKind, setLetterKind] = useState<LetterKind>(country === 'IN' ? 'in_grievance' : 'us_respa_noe');
  const [borrower, setBorrower] = useState<BorrowerIdentity>({
    name: '',
    accountNumber: defaultHome?.accountLast4 ? `XXXX-${defaultHome.accountLast4}` : '',
    phone: '',
    email: '',
    address: '',
    sentDate: '2026-11-20',
  });
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [caseSavedNotice, setCaseSavedNotice] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [pdfThemeOverride, setPdfThemeOverride] = useState<'match' | ThemeMode>('match');
  const pdfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audit = useMemo(() => auditLoan(input), [input]);

  const amortScenarios = useMemo(
    () =>
      buildLoanShieldAmortizationScenarios(input, audit, {
        extraMonthly: amortExtraMonthly,
        annualStepUpPct: amortStepUpPct,
      }),
    [input, audit, amortExtraMonthly, amortStepUpPct],
  );

  const offerComparison = useMemo(
    () =>
      compareBankRewriteOffer({
        country: input.country,
        outstanding: input.outstanding,
        currentRate: input.currentRate,
        monthsRemaining: input.monthsRemaining,
        expectedKeepYears: Math.max(1, Number(keepYears) || 5),
        owedCutRate: audit.totalClaimableRefund > 0 ? audit.expectedRateNow : null,
        conversionRate: (Number(convRatePct) || 8.35) / 100,
        conversionFee: Number(convFee) || 0,
        transferRate: (Number(btRatePct) || 8.15) / 100,
        transferCosts: Number(btCosts) || 0,
        oldForeclosureFee: Number(oldForeclosureFee) || 0,
        isFloatingIndividualIN: input.country === 'IN',
      }),
    [input, audit, convRatePct, convFee, btRatePct, btCosts, oldForeclosureFee, keepYears],
  );

  const activeLetterKind: LetterKind =
    input.country === 'US' && !letterKind.startsWith('us_') && letterKind !== 'hardship_us'
      ? 'us_respa_noe'
      : input.country === 'IN' && (letterKind.startsWith('us_') || letterKind === 'hardship_us')
        ? 'in_grievance'
        : letterKind;

  const letter = useMemo(
    () =>
      generateFormalLetter(activeLetterKind, audit, borrower, {
        outstanding: input.outstanding,
        currentRate: input.currentRate,
        startMonth: input.startMonth,
        startRate: input.startRate,
        emi: input.emi,
      }),
    [activeLetterKind, audit, borrower, input],
  );

  const allChecked = letter.selfCheck.every((_, i) => checkedItems[i]);

  function loadScenario(key: string) {
    const preset = AUDIT_SCENARIO_PRESETS[key];
    if (!preset) return;
    setInput(preset.input);
    if (preset.input.country === 'US') {
      setLetterKind('us_respa_noe');
    } else if (key === 'hike_cycle_in') {
      setLetterKind('in_reset_choice');
    } else {
      setLetterKind('in_grievance');
    }
    setCheckedItems({});
  }

  function handleCopyLetter() {
    navigator.clipboard?.writeText(letter.body).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadLetter() {
    const blob = new Blob([letter.body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rightdue-${activeLetterKind}-${borrower.sentDate}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLogEscalation() {
    const firstDeadline = letter.statutoryDeadlines[0]?.date || borrower.sentDate;
    const lastDeadline =
      letter.statutoryDeadlines[letter.statutoryDeadlines.length - 1]?.date || firstDeadline;
    addTrackedCase({
      id: `case-${Date.now()}`,
      lenderName: input.lenderName,
      kind: activeLetterKind,
      sentDate: borrower.sentDate,
      claimAmount: audit.totalClaimableRefund,
      status: 'sent',
      replyDueDate: firstDeadline,
      escalationDeadline: lastDeadline,
    });
    setCaseSavedNotice('Logged in your statutory countdown tracker below.');
    setTimeout(() => setCaseSavedNotice(null), 3500);
  }

  async function handleDownloadPdf(explicitTheme?: ThemeMode) {
    const resolvedTheme: ThemeMode =
      explicitTheme ?? (pdfThemeOverride === 'match' ? theme : pdfThemeOverride);
    setPdfExporting(true);
    try {
      const payload = await downloadLoanAuditPdf({
        input,
        audit,
        letter,
        borrower,
        scenarios: [
          amortScenarios.current,
          amortScenarios.fair_reset,
          amortScenarios.hike_higher_emi,
          amortScenarios.extra_prepay,
        ],
        activeScenario: amortScenarios[amortScenarioKey],
        theme: resolvedTheme,
      });
      setPdfNotice(
        `Saved ${payload.fileName} (${payload.palette.label} theme · Ref ${payload.referenceId})`,
      );
      if (pdfTimerRef.current) clearTimeout(pdfTimerRef.current);
      pdfTimerRef.current = setTimeout(() => setPdfNotice(null), 6000);
    } finally {
      setPdfExporting(false);
    }
  }

  const effectivePdfTheme: ThemeMode = pdfThemeOverride === 'match' ? theme : pdfThemeOverride;
  const effectivePdfLabel = PDF_THEME_PALETTES[effectivePdfTheme].label;

  const lenders = LENDER_DIRECTORY.filter((l) => l.country === input.country);

  return (
    <div className="space-y-8">
      {/* Intro, Formal PDF Export & Scenario Quick Loaders */}
      <section className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Verified policy rates as of {audit.rateAsOf} · Next decision: {NEXT_POLICY_MEETING[input.country].label}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Loan Shield — Audit Your Rate &amp; Claim Overcharges
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
              Check if your bank failed to pass on rate cuts, inspect your principal-vs-interest amortization across 4 scenarios, and download a formal PDF audit dossier with legal escalation deadlines.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              aria-label="PDF document theme style"
              value={pdfThemeOverride}
              onChange={(e) => setPdfThemeOverride(e.target.value as 'match' | ThemeMode)}
              className="px-2.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            >
              <option value="match">PDF Style: Match App ({PDF_THEME_PALETTES[theme].label})</option>
              <option value="light">PDF Style: Clean Light</option>
              <option value="ledger">PDF Style: Paper Ledger</option>
              <option value="dark">PDF Style: Dark Slate</option>
            </select>
            <button
              type="button"
              data-testid="download-pdf-dossier-top"
              disabled={pdfExporting}
              onClick={() => handleDownloadPdf()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white transition-colors whitespace-nowrap"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              <span>{pdfExporting ? 'Generating PDF…' : `Download PDF Dossier (${effectivePdfLabel})`}</span>
            </button>
          </div>
        </div>

        {pdfNotice && (
          <div
            data-testid="pdf-download-confirmation"
            className="px-3.5 py-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-800 dark:text-teal-300 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{pdfNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Sample loan:</span>
          {Object.entries(AUDIT_SCENARIO_PRESETS).map(([key, sc]) => (
            <button
              key={key}
              type="button"
              onClick={() => loadScenario(key)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-teal-600 dark:hover:border-teal-500 transition-colors whitespace-nowrap"
            >
              {sc.label}
            </button>
          ))}
        </div>
      </section>

      {/* Loan Inputs + Live Diagnostic Output */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 cols: Inputs */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Loan Facts</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Lender</span>
              <select
                value={input.lenderName}
                onChange={(e) => {
                  const found = lenders.find((l) => l.name === e.target.value);
                  setInput((prev) => ({
                    ...prev,
                    lenderName: e.target.value,
                    lenderType: found?.type ?? prev.lenderType,
                  }));
                }}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                {lenders.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name} ({l.type === 'hfc' ? 'HFC' : l.type === 'commercial_bank' ? 'Commercial Bank' : 'Lender'})
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Benchmark</span>
              <select
                value={input.benchmark}
                onChange={(e) =>
                  setInput((prev) => ({ ...prev, benchmark: e.target.value as LoanAuditInput['benchmark'] }))
                }
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                {input.country === 'IN' ? (
                  <>
                    <option value="repo">RBI Repo (EBLR)</option>
                    <option value="mclr">MCLR (Pre-2019)</option>
                    <option value="base_rate">Base Rate / BPLR</option>
                    <option value="plr">HFC / NBFC PLR</option>
                  </>
                ) : (
                  <>
                    <option value="fixed">Fixed 30-Yr / 15-Yr</option>
                    <option value="sofr">ARM (SOFR + Margin)</option>
                    <option value="prime">Prime Rate</option>
                  </>
                )}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Start Month</span>
              <input
                type="month"
                value={input.startMonth}
                onChange={(e) => setInput((prev) => ({ ...prev, startMonth: e.target.value }))}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Starting Rate (%)</span>
              <input
                type="number"
                step="0.05"
                value={(input.startRate * 100).toFixed(2)}
                onChange={(e) =>
                  setInput((prev) => ({ ...prev, startRate: Math.max(0.01, (Number(e.target.value) || 0) / 100) }))
                }
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Current Billed Rate (%)</span>
              <input
                type="number"
                step="0.05"
                value={(input.currentRate * 100).toFixed(2)}
                onChange={(e) =>
                  setInput((prev) => ({ ...prev, currentRate: Math.max(0.01, (Number(e.target.value) || 0) / 100) }))
                }
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Outstanding ({input.country === 'IN' ? '₹' : '$'})
              </span>
              <input
                type="number"
                step="10000"
                value={input.outstanding}
                onChange={(e) => setInput((prev) => ({ ...prev, outstanding: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Months Remaining</span>
              <input
                type="number"
                min={1}
                max={360}
                value={input.monthsRemaining}
                onChange={(e) =>
                  setInput((prev) => ({ ...prev, monthsRemaining: Math.max(1, Number(e.target.value) || 12) }))
                }
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </label>

            {input.country === 'IN' && (
              <>
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    After the Oct 2026 RBI hike (+0.25%), what did your bank do?
                  </span>
                  <select
                    value={input.bankActionAfterHike}
                    onChange={(e) =>
                      setInput((prev) => ({
                        ...prev,
                        bankActionAfterHike: e.target.value as LoanAuditInput['bankActionAfterHike'],
                      }))
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                  >
                    <option value="tenure_extended">Extended tenure without asking</option>
                    <option value="emi_raised">Raised EMI</option>
                    <option value="both">Raised both EMI and tenure</option>
                    <option value="none_yet">No change yet</option>
                  </select>
                </label>

                <div className="sm:col-span-2 space-y-1.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Did they offer the mandatory written choice (Higher EMI / Longer Tenure / Prepay)?
                  </span>
                  <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    {(['no', 'yes', 'unsure'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setInput((prev) => ({ ...prev, choiceOffered: opt }))}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize ${
                          input.choiceOffered === opt
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right 7 cols: Audit Findings & Hike Impact */}
        <div className="lg:col-span-7 space-y-4">
          {/* Benchmark Summary Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {input.country === 'IN' ? 'Repo at Start' : 'Fed Rate at Start'}
              </div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-white">
                {formatPct(audit.repoAtStart)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {input.country === 'IN' ? 'Repo Today' : 'Fed Rate Today'}
              </div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-white">
                {formatPct(audit.repoNow)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Expected Rate</div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-teal-700 dark:text-teal-400">
                {formatPct(audit.expectedRateNow)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Claimable Refund</div>
              <div
                className={`mt-1 font-mono tabular-nums text-lg font-semibold ${
                  audit.totalClaimableRefund > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-900 dark:text-white'
                }`}
              >
                {formatMoney(audit.totalClaimableRefund, input.country)}
              </div>
            </div>
          </div>

          {/* Findings List */}
          <div className="space-y-3">
            {audit.findings.map((f, idx) => (
              <div
                key={`${f.kind}-${idx}`}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      {f.claimable ? (
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          Claimable Refund · Conservative Floor
                        </span>
                      ) : f.kind === 'choice_not_offered' ? (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold">
                          Statutory Conduct Violation
                        </span>
                      ) : (
                        <span>Diagnostic Finding</span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">{f.headline}</h3>
                  </div>
                  {f.amountThisYear > 0 && (
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-white">
                        {formatMoney(f.amountThisYear, input.country)}/yr
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">at stake</div>
                    </div>
                  )}
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.detail}</p>
                <p className="text-xs font-medium text-teal-800 dark:text-teal-300 bg-teal-50/70 dark:bg-teal-950/40 px-3 py-2 rounded-lg">
                  Next step: {f.nextStep}
                </p>

                {f.annexure && f.annexure.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300 hover:text-teal-700">
                      View month-by-month refund annexure ({f.annexure.length} months · sums to{' '}
                      {formatMoney(f.overchargedSoFar, input.country)})
                    </summary>
                    <div className="mt-2 overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-left font-mono tabular-nums">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500">
                            <th className="py-2 px-3">Month</th>
                            <th className="py-2 px-3 text-right">Should Be</th>
                            <th className="py-2 px-3 text-right">Charged</th>
                            <th className="py-2 px-3 text-right">Excess</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {f.annexure.map((row) => (
                            <tr key={row.month}>
                              <td className="py-1.5 px-3">{row.month}</td>
                              <td className="py-1.5 px-3 text-right">{formatPct(row.expectedRate)}</td>
                              <td className="py-1.5 px-3 text-right">{formatPct(row.chargedRate)}</td>
                              <td className="py-1.5 px-3 text-right font-semibold">
                                {formatMoney(row.excessAmount, input.country)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                {f.citations.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                    {f.citations.map((c) => (
                      <div key={c.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{c.rule}</span> — {c.requirement}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Visual Amortization Schedule (Principal vs Interest across 4 scenarios) */}
      <AmortizationSchedule
        country={input.country}
        theme={theme}
        scenarios={amortScenarios}
        activeKey={amortScenarioKey}
        onSelectKey={setAmortScenarioKey}
        extraMonthly={amortExtraMonthly}
        onChangeExtraMonthly={setAmortExtraMonthly}
        annualStepUpPct={amortStepUpPct}
        onChangeAnnualStepUpPct={setAmortStepUpPct}
      />

      {/* Ask Your Own Bank First vs Balance Transfer Comparator */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <span>Stay &amp; Reprice vs Switch Lenders</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare paying a one-time conversion fee at your current bank against moving your loan to a new lender.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <label className="flex flex-col justify-between gap-1.5 h-full">
            <span className="text-xs text-slate-600 dark:text-slate-400 leading-tight">Bank Rewrite Rate (%)</span>
            <input
              type="number"
              step="0.05"
              value={convRatePct}
              onChange={(e) => setConvRatePct(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="flex flex-col justify-between gap-1.5 h-full">
            <span className="text-xs text-slate-600 dark:text-slate-400 leading-tight">Conversion Fee</span>
            <input
              type="number"
              value={convFee}
              onChange={(e) => setConvFee(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="flex flex-col justify-between gap-1.5 h-full">
            <span className="text-xs text-slate-600 dark:text-slate-400 leading-tight">Transfer Rate (%)</span>
            <input
              type="number"
              step="0.05"
              value={btRatePct}
              onChange={(e) => setBtRatePct(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="flex flex-col justify-between gap-1.5 h-full">
            <span className="text-xs text-slate-600 dark:text-slate-400 leading-tight">Transfer Closing Costs</span>
            <input
              type="number"
              value={btCosts}
              onChange={(e) => setBtCosts(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="flex flex-col justify-between gap-1.5 h-full">
            <span className="text-xs text-slate-600 dark:text-slate-400 leading-tight">Quoted Exit Penalty</span>
            <input
              type="number"
              value={oldForeclosureFee}
              onChange={(e) => setOldForeclosureFee(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="flex flex-col justify-between gap-1.5 h-full">
            <span className="text-xs text-slate-600 dark:text-slate-400 leading-tight">Years Keeping Loan</span>
            <input
              type="number"
              min={1}
              max={25}
              value={keepYears}
              onChange={(e) => setKeepYears(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
        </div>

        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {offerComparison.verdictText}
            </span>
            <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
              Baseline: {formatPct(offerComparison.baselineRate)}
            </span>
          </div>
          {offerComparison.illegalForeclosureFlag && (
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">
              Illegal Fee Flagged: Under RBI Pre-payment Charges Directions 2025, lenders cannot charge foreclosure penalties on individual floating-rate loans. RightDue excluded that penalty.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
            <div>
              Own-bank rewrite net saving:{' '}
              <strong className="text-slate-900 dark:text-white">
                {formatMoney(offerComparison.convNetSavings, input.country)}
              </strong>{' '}
              (fee + tax: {formatMoney(offerComparison.convFeeTotal, input.country)}
              {offerComparison.convBreakEven ? `, break-even ${offerComparison.convBreakEven} mo` : ''})
            </div>
            <div>
              Balance transfer net saving:{' '}
              <strong className="text-slate-900 dark:text-white">
                {formatMoney(offerComparison.btNetSavings, input.country)}
              </strong>{' '}
              (costs: {formatMoney(offerComparison.btFeeTotal, input.country)}
              {offerComparison.btBreakEven ? `, break-even ${offerComparison.btBreakEven} mo` : ''})
            </div>
          </div>
        </div>
      </section>

      {/* Formal Statutory Letter Generator & Countdown Tracker */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <span>Statutory Letter &amp; Escalation Pack</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Personal details stay strictly in your browser. Third-person formal legal drafting with verified citations.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(input.country === 'IN'
              ? ([
                  { id: 'in_grievance', label: 'Bank Grievance' },
                  { id: 'in_reset_choice', label: 'Reset Choice (Para 349)' },
                  { id: 'in_rbi_ombudsman', label: 'RBI Ombudsman Pack' },
                  { id: 'in_noc_closure', label: 'NOC / ₹5,000-Day Rule' },
                ] as { id: LetterKind; label: string }[])
              : ([
                  { id: 'us_respa_noe', label: 'RESPA Notice of Error' },
                  { id: 'us_fcba_dispute', label: 'FCBA Card Dispute' },
                  { id: 'hardship_us', label: 'Hardship Request' },
                ] as { id: LetterKind; label: string }[])
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setLetterKind(t.id);
                  setCheckedItems({});
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  activeLetterKind === t.id
                    ? 'bg-teal-700 border-teal-700 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Borrower Fill-in Fields (Client-Side Only) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-slate-600 dark:text-slate-400">Your Full Name</span>
            <input
              type="text"
              placeholder="Aarav Sharma"
              value={borrower.name}
              onChange={(e) => setBorrower((b) => ({ ...b, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-600 dark:text-slate-400">Loan Account Number</span>
            <input
              type="text"
              placeholder="HL-004821"
              value={borrower.accountNumber}
              onChange={(e) => setBorrower((b) => ({ ...b, accountNumber: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-600 dark:text-slate-400">Email (optional)</span>
            <input
              type="email"
              placeholder="you@example.com"
              value={borrower.email}
              onChange={(e) => setBorrower((b) => ({ ...b, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-600 dark:text-slate-400">Date Sent</span>
            <input
              type="date"
              value={borrower.sentDate}
              onChange={(e) => setBorrower((b) => ({ ...b, sentDate: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
        </div>

        {/* Statutory Deadlines Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {letter.statutoryDeadlines.map((d) => (
            <div
              key={d.label}
              className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">{d.label}</span>
                <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                  {d.date}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{d.note}</p>
            </div>
          ))}
        </div>

        {/* Letter Preview */}
        <pre
          data-testid="letter-preview"
          className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200 max-h-80 overflow-y-auto"
        >
          {letter.body}
        </pre>

        {/* Compliance Self-Check before Copy/Download */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Pre-Send Verification Checklist (confirm before copying or sending):
          </div>
          {letter.selfCheck.map((item, idx) => (
            <label key={idx} className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(checkedItems[idx])}
                onChange={(e) => setCheckedItems((prev) => ({ ...prev, [idx]: e.target.checked }))}
                className="mt-0.5 accent-teal-700"
              />
              <span>{item}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            data-testid="download-pdf-dossier-letter"
            disabled={pdfExporting}
            onClick={() => handleDownloadPdf()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{pdfExporting ? 'Generating PDF…' : `Download Formal PDF (${effectivePdfLabel})`}</span>
          </button>
          <button
            type="button"
            disabled={!allChecked}
            onClick={handleCopyLetter}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copied ? 'Copied to Clipboard' : 'Copy Formal Letter'}</span>
          </button>
          <button
            type="button"
            disabled={!allChecked}
            onClick={handleDownloadLetter}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .txt</span>
          </button>
          <button
            type="button"
            onClick={handleLogEscalation}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-teal-700/40 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Track 30/90-Day Deadlines</span>
          </button>
          {letter.portalUrl && (
            <a
              href={letter.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-teal-700 ml-auto"
            >
              <span>Open Regulator Portal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        {caseSavedNotice && (
          <p className="text-xs font-medium text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>{caseSavedNotice}</span>
          </p>
        )}
      </section>

      {/* Tracked Statutory Escalation Cases */}
      {trackedCases.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <span>Active Escalation Tracker ({trackedCases.length})</span>
            </h2>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {trackedCases.map((c) => (
              <div key={c.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    {c.lenderName} · {c.kind.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                    Sent {c.sentDate} · Reply due {c.replyDueDate} · Escalation cutoff {c.escalationDeadline}
                    {c.claimAmount > 0 ? ` · Claim ${formatMoney(c.claimAmount, country)}` : ''}
                  </div>
                </div>
                <select
                  value={c.status}
                  onChange={(e) => updateCaseStatus(c.id, e.target.value as typeof c.status)}
                  aria-label={`Status for ${c.lenderName} case`}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="sent">Sent to Bank</option>
                  <option value="io_escalated">Internal Ombudsman</option>
                  <option value="ombudsman_ready">RBI / CFPB Filed</option>
                  <option value="resolved">Resolved &amp; Rate Fixed</option>
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  FileUp,
  Lock,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingDown,
} from 'lucide-react';
import { useRightDue } from '@/lib/store';
import {
  computeSpendLeakImpact,
  deduplicateParsedSms,
  parseBulkInput,
  SAMPLE_ANDROID_XML,
  SAMPLE_CSV_STATEMENTS,
  SAMPLE_SMS_BATCHES,
} from '@/engine/smsParser';
import { formatMoney, simulatePayoffPlan } from '@/engine/math';
import type { ParsedSms, SmsKind } from '@/engine/types';

type FilterKind = 'all' | 'debt' | 'spend' | 'skipped';

const KIND_LABEL: Record<SmsKind, string> = {
  emi_debit: 'EMI Debit',
  emi_bounce: 'EMI Bounce',
  card_statement: 'Card Statement',
  card_spend: 'Card Spend',
  upi_debit: 'UPI / Bank Debit',
  credit: 'Income Credit',
  otp: 'OTP Skipped',
  promo: 'Promo Skipped',
  unknown: 'Unclassified',
};

export function SmsPulse() {
  const {
    country,
    profile,
    importedSms,
    setImportedSms,
    updateLoan,
    updateProfile,
    logPayment,
    setSection,
  } = useRightDue();

  const [rawInput, setRawInput] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [syncedRowIds, setSyncedRowIds] = useState<string[]>([]);
  const [appliedCategory, setAppliedCategory] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAutomationGuide, setShowAutomationGuide] = useState(false);
  const [copiedShortcutUrl, setCopiedShortcutUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const baseSim = useMemo(() => simulatePayoffPlan(profile, 'avalanche'), [profile]);
  const leaks = useMemo(() => computeSpendLeakImpact(importedSms, profile), [importedSms, profile]);

  const stats = useMemo(() => {
    const debt = importedSms.filter(
      (r) => r.kind === 'emi_debit' || r.kind === 'emi_bounce' || r.kind === 'card_statement',
    );
    const spend = importedSms.filter((r) => r.kind === 'card_spend' || r.kind === 'upi_debit');
    const skipped = importedSms.filter((r) => r.kind === 'otp' || r.kind === 'promo');
    const syncable = debt.filter((r) => r.matchedLoanId && (r.kind === 'card_statement' || r.kind === 'emi_debit'));
    const totalDiscretionary = spend.reduce((s, r) => s + (r.amount ?? 0), 0);
    return {
      total: importedSms.length,
      debtCount: debt.length,
      spendCount: spend.length,
      skippedCount: skipped.length,
      syncableCount: syncable.length,
      totalDiscretionary: Math.round(totalDiscretionary),
    };
  }, [importedSms]);

  const visibleRows = useMemo(() => {
    return importedSms.filter((row) => {
      if (filter === 'debt') {
        return row.kind === 'emi_debit' || row.kind === 'emi_bounce' || row.kind === 'card_statement';
      }
      if (filter === 'spend') {
        return row.kind === 'card_spend' || row.kind === 'upi_debit';
      }
      if (filter === 'skipped') {
        return row.kind === 'otp' || row.kind === 'promo';
      }
      return true;
    });
  }, [importedSms, filter]);

  function runParse(text: string, fileName?: string, mergeWithExisting = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { rows, detectedFormat } = parseBulkInput(trimmed, profile.loans, {
      fileName,
      defaultCountry: country,
    });
    const finalRows = mergeWithExisting ? deduplicateParsedSms([...rows, ...importedSms]) : rows;
    setImportedSms(finalRows);
    setSyncedRowIds([]);
    setAppliedCategory(null);
    const formatName =
      detectedFormat === 'xml'
        ? 'Android SMS Backup XML'
        : detectedFormat === 'csv'
          ? 'Bank / Card Statement CSV'
          : 'Bank SMS Batch';
    setStatusNote(
      `Parsed ${rows.length} entries (${formatName}) on this device — duplicates removed, 0 KB uploaded.`,
    );
  }

  async function processFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    let allRows: ParsedSms[] = [];
    const formats = new Set<string>();
    for (const file of Array.from(files)) {
      const text = await file.text();
      if (!text.trim()) continue;
      const { rows, detectedFormat } = parseBulkInput(text, profile.loans, {
        fileName: file.name,
        defaultCountry: country,
      });
      allRows = [...allRows, ...rows];
      formats.add(detectedFormat.toUpperCase());
    }
    const deduped = deduplicateParsedSms([...allRows, ...importedSms]);
    setImportedSms(deduped);
    setSyncedRowIds([]);
    setStatusNote(
      `Bulk imported ${files.length} file${files.length === 1 ? '' : 's'} (${Array.from(formats).join(' + ')}) — ${deduped.length} unique alerts ready.`,
    );
  }

  function handleSyncRow(row: ParsedSms) {
    if (!row.matchedLoanId) return false;
    const targetLoan = profile.loans.find((l) => l.id === row.matchedLoanId);
    if (!targetLoan) return false;

    if (row.kind === 'card_statement' && row.amount !== null) {
      updateLoan(targetLoan.id, {
        outstanding: Math.round(row.amount),
        emi: row.minDue ? Math.round(row.minDue) : targetLoan.emi,
        lastUpdated: new Date().toISOString().slice(0, 10),
      });
      setSyncedRowIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
      return true;
    }

    if (row.kind === 'emi_debit' && row.amount !== null) {
      logPayment(targetLoan.id, 'full', Math.round(row.amount));
      setSyncedRowIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
      return true;
    }
    return false;
  }

  function handleSyncAllMatched() {
    let count = 0;
    for (const row of importedSms) {
      if (row.matchedLoanId && (row.kind === 'card_statement' || row.kind === 'emi_debit')) {
        if (handleSyncRow(row)) count += 1;
      }
    }
    if (count > 0) {
      setStatusNote(
        `Bulk synced ${count} matched account${count === 1 ? '' : 's'} (statement balances & EMI payments updated on Command Center).`,
      );
    }
  }

  function handleRedirectLeak(category: string, monthlyAmount: number) {
    const newExtra = baseSim.monthlyExtraToDebt + monthlyAmount;
    updateProfile({
      extraMonthlyOverride: newExtra,
    });
    setAppliedCategory(category);
    setStatusNote(
      `Added ${formatMoney(monthlyAmount, country)}/mo from ${category} into your monthly extra debt payment (now ${formatMoney(newExtra, country)}/mo).`,
    );
  }

  function clearAll() {
    setRawInput('');
    setImportedSms([]);
    setSyncedRowIds([]);
    setAppliedCategory(null);
    setStatusNote(null);
  }

  const shortcutUrlTemplate =
    typeof window !== 'undefined'
      ? `${window.location.origin}/#sms=[Shortcut Input]`
      : 'https://rightdue.app/#sms=[Shortcut Input]';

  async function copyShortcutUrl() {
    try {
      await navigator.clipboard.writeText(shortcutUrlTemplate);
      setCopiedShortcutUrl(true);
      setTimeout(() => setCopiedShortcutUrl(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Bulk On-Device SMS, XML &amp; CSV Pulse
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Drop an entire month&apos;s bank/card statement CSV, an Android SMS Backup XML export (1,000+ alerts at once), or batch-paste SMS — RightDue deduplicates, strips OTPs, bulk-syncs loans, and converts spend leaks into months shaved off debt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const sample = SAMPLE_SMS_BATCHES[country];
              setRawInput(sample);
              runParse(sample);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Sample SMS Batch</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const csv = SAMPLE_CSV_STATEMENTS[country];
              setRawInput(csv);
              runParse(csv, 'statement.csv');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
            <span>Sample Bank CSV</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const xml = SAMPLE_ANDROID_XML[country];
              setRawInput(xml);
              runParse(xml, 'sms-backup.xml');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Sample Android XML</span>
          </button>
          {importedSms.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-400 transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Transparent OS / Play Store Reality + Zero-Cloud Auto-Capture Setup */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Why bulk drop + phone automation beats blocked <code className="font-mono">READ_SMS</code>
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                Web browsers &amp; iOS forbid silent SMS inbox scraping, and Google Play rejects <code className="font-mono">READ_SMS</code> for finance apps. Drop a full bank CSV or Android SMS Backup XML once a week — or set up a 1-time iOS Shortcut that beams bank SMS directly to your browser hash with <strong>0 KB cloud upload</strong>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAutomationGuide((v) => !v)}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 self-start sm:self-center"
          >
            {showAutomationGuide ? 'Hide Phone Auto-Sync' : 'Set Up Auto-Sync Bridge'}
          </button>
        </div>

        {showAutomationGuide && (
          <div className="px-5 pb-5 pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50/70 dark:bg-slate-950/50">
            <div className="space-y-2">
              <p className="font-semibold text-slate-900 dark:text-white">
                iPhone (iOS Personal Automation — Fully Automatic)
              </p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>Open Apple <strong>Shortcuts → Automation → + → Message</strong>.</li>
                <li>Set trigger: Message Contains <code className="font-mono">debited</code> (or <code className="font-mono">spent</code> / <code className="font-mono">EMI</code>).</li>
                <li>Add action: <strong>URL Encode</strong> Shortcut Input → <strong>Open URL</strong> using the hash bridge below (never hits a server):</li>
              </ol>
              <div className="flex items-center gap-2 pt-1">
                <code className="flex-1 truncate px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  {shortcutUrlTemplate}
                </code>
                <button
                  type="button"
                  onClick={copyShortcutUrl}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                >
                  {copiedShortcutUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedShortcutUrl ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-slate-900 dark:text-white">
                Android (Bulk 1,000+ SMS XML Export or Bank CSV)
              </p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>Use open-source <strong>SMS Backup &amp; Restore</strong> (or your bank&apos;s monthly CSV download).</li>
                <li>Export your last 30–90 days as a single <code className="font-mono">.xml</code> or <code className="font-mono">.csv</code> file.</li>
                <li>Drag-and-drop multiple files into the dropzone below — RightDue parses all messages locally, strips OTPs/promos, and deduplicates automatically.</li>
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Multi-File Drag & Drop + Paste Panel */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            void processFiles(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed p-5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            isDragging
              ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30'
              : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/50'
          }`}
        >
          <div className="flex items-start gap-3">
            <FileUp className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Drag &amp; drop multiple Bank CSVs, Android SMS Backup XMLs, or Alert TXT files
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Auto-detects HDFC, SBI, ICICI, Axis, Kotak, IDFC, Chase, Amex, Wells Fargo, BofA, and Citi statement columns &amp; XML tags.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv,.xml,.txt,.eml,text/csv,text/xml,application/xml,text/plain"
              onChange={(e) => {
                void processFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-teal-700 hover:bg-slate-800 dark:hover:bg-teal-600 text-white transition-colors whitespace-nowrap"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>Choose Files (Bulk)</span>
            </button>
          </div>
        </div>

        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          rows={4}
          placeholder={
            country === 'IN'
              ? 'Or paste multiple HDFC / SBI / ICICI SMS alerts, CSV lines, or XML here...'
              : 'Or paste multiple Chase / Amex / Wells Fargo alerts, CSV lines, or XML here...'
          }
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {statusNote ? (
              <span className="text-teal-700 dark:text-teal-400 font-medium">{statusNote}</span>
            ) : (
              <span>Auto-deduplicates repeated uploads so you can drop weekly statements safely.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stats.syncableCount > 0 && (
              <button
                type="button"
                onClick={handleSyncAllMatched}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Sync All Matched ({stats.syncableCount})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => runParse(rawInput)}
              disabled={!rawInput.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Parse Pasted Text</span>
            </button>
          </div>
        </div>
      </section>

      {/* Parsed Results */}
      {importedSms.length > 0 && (
        <>
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Unique Entries Parsed</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {stats.total}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Deduplicated in browser
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Loan &amp; Card Syncs</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                {stats.debtCount}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                EMIs &amp; statement balances
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Discretionary Spend Found</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                {formatMoney(stats.totalDiscretionary, country)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Across {stats.spendCount} card &amp; UPI debits
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Noise Stripped</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {stats.skippedCount}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                OTPs &amp; loan spam ignored
              </p>
            </div>
          </div>

          {/* Spend-Leak to Debt-Freedom Converter */}
          {leaks.length > 0 && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                    <span>Spend-Leak to Debt-Freedom Converter</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Exact interest saved and months shaved off your debt-free date if you redirect each spend leak into your costliest loan.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('command')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <span>View updated payoff chart</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 pr-4">Spend Category</th>
                      <th className="py-2.5 px-4 text-right">Detected Spend</th>
                      <th className="py-2.5 px-4 text-right">Interest Saved</th>
                      <th className="py-2.5 px-4 text-right">Debt-Free Sooner</th>
                      <th className="py-2.5 pl-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {leaks.map((leak) => {
                      const applied = appliedCategory === leak.category;
                      return (
                        <tr key={leak.category} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-3.5 pr-4">
                            <p className="font-medium text-slate-900 dark:text-white">{leak.category}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {leak.transactionCount} txn{leak.transactionCount === 1 ? '' : 's'}
                              {leak.merchants.length > 0 ? ` · ${leak.merchants.join(', ')}` : ''}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-white whitespace-nowrap">
                            {formatMoney(leak.monthlyTotal, country)}/mo
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                            {formatMoney(leak.interestSavedIfRedirected, country)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {leak.monthsShavedIfRedirected > 0
                              ? `${leak.monthsShavedIfRedirected} mo faster`
                              : 'Faster card clear'}
                          </td>
                          <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleRedirectLeak(leak.category, leak.monthlyTotal)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                applied
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  : 'bg-teal-700 hover:bg-teal-800 text-white'
                              }`}
                            >
                              {applied ? <Check className="w-3.5 h-3.5" /> : null}
                              <span>{applied ? 'Applied to Plan' : 'Redirect to Debt'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Parsed Alerts Ledger */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Parsed Ledger &amp; Bulk Account Sync
              </h2>
              <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 self-start">
                {(
                  [
                    { id: 'all', label: `All (${stats.total})` },
                    { id: 'debt', label: `EMIs & Cards (${stats.debtCount})` },
                    { id: 'spend', label: `Spend (${stats.spendCount})` },
                    { id: 'skipped', label: `Skipped (${stats.skippedCount})` },
                  ] as Array<{ id: FilterKind; label: string }>
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      filter === tab.id
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-4">Type &amp; Source</th>
                    <th className="py-2.5 px-4">Merchant / Details</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 pl-4 text-right">Loan Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {visibleRows.map((row) => {
                    const matchedLoan = row.matchedLoanId
                      ? profile.loans.find((l) => l.id === row.matchedLoanId)
                      : null;
                    const isSynced = syncedRowIds.includes(row.id);
                    const isSkipped = row.kind === 'otp' || row.kind === 'promo';

                    return (
                      <tr
                        key={row.id}
                        className={isSkipped ? 'opacity-60' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'}
                      >
                        <td className="py-3 pr-4 align-top">
                          <p
                            className={`text-xs font-semibold ${
                              row.kind === 'emi_bounce'
                                ? 'text-rose-700 dark:text-rose-400'
                                : row.kind === 'card_statement' || row.kind === 'emi_debit'
                                  ? 'text-teal-700 dark:text-teal-400'
                                  : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {KIND_LABEL[row.kind]}
                            {row.sourceFormat ? ` · ${row.sourceFormat.toUpperCase()}` : ''}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {row.bank || 'Bank Alert'}
                            {row.accountLast4 ? ` · XX${row.accountLast4}` : ''}
                            {row.date ? ` · ${row.date}` : ''}
                          </p>
                        </td>
                        <td className="py-3 px-4 align-top max-w-md">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {row.merchant || row.category}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                            {row.raw}
                          </p>
                        </td>
                        <td className="py-3 px-4 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {row.amount !== null ? (
                            <div>
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {formatMoney(row.amount, row.currency === 'USD' ? 'US' : 'IN')}
                              </span>
                              {row.minDue ? (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  Min {formatMoney(row.minDue, row.currency === 'USD' ? 'US' : 'IN')}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 pl-4 align-top text-right whitespace-nowrap">
                          {matchedLoan && (row.kind === 'card_statement' || row.kind === 'emi_debit') ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (handleSyncRow(row)) {
                                  setStatusNote(`Synced ${matchedLoan.name} on Command Center.`);
                                }
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                isSynced
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  : 'border border-teal-700/30 dark:border-teal-500/40 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40'
                              }`}
                            >
                              {isSynced ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Synced</span>
                                </>
                              ) : (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>
                                    {row.kind === 'card_statement'
                                      ? `Sync ${matchedLoan.name}`
                                      : `Mark Paid`}
                                  </span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {row.category}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Empty State */}
      {importedSms.length === 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
          <MessageSquareText className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Drop a monthly CSV, Android SMS XML backup, or try a sample pack
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            Test all three bulk ingestion engines in one click — zero manual entry, zero cloud upload.
          </p>
        </section>
      )}
    </div>
  );
}

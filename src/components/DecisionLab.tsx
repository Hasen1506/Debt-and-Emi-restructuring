'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useRightDue } from '@/lib/store';
import {
  auditLoanOffer,
  SAMPLE_ADVICE_TEXT,
  verifyPastedAdvice,
} from '@/engine/adviceVerifier';
import {
  computeInvestVsPrepay,
  formatMoney,
  formatPct,
} from '@/engine/math';
import type { OfferAuditInput } from '@/engine/types';

type DecisionTab = 'advice' | 'offer' | 'invest';

export function DecisionLab() {
  const { country, profile } = useRightDue();
  const [activeTab, setActiveTab] = useState<DecisionTab>('advice');

  // Tab 1: Advice Verifier state
  const [adviceInput, setAdviceInput] = useState<string>(SAMPLE_ADVICE_TEXT[country]);
  const [adviceCountrySync, setAdviceCountrySync] = useState(country);
  if (adviceCountrySync !== country) {
    setAdviceCountrySync(country);
    setAdviceInput(SAMPLE_ADVICE_TEXT[country]);
  }

  const adviceReport = useMemo(
    () => verifyPastedAdvice(adviceInput, profile),
    [adviceInput, profile],
  );

  // Tab 2: "Don't Sign That" Offer & No-Cost EMI Checker state
  const defaultPrincipal = country === 'IN' ? 120000 : 4500;
  const defaultFee = country === 'IN' ? 1999 : 95;
  const defaultDiscount = country === 'IN' ? 8500 : 250;

  const [offerKind, setOfferKind] = useState<OfferAuditInput['kind']>('no_cost_emi');
  const [offerPrincipal, setOfferPrincipal] = useState<number>(defaultPrincipal);
  const [offerQuotedRate, setOfferQuotedRate] = useState<number>(13.5);
  const [offerTenure, setOfferTenure] = useState<number>(12);
  const [offerFeeFlat, setOfferFeeFlat] = useState<number>(defaultFee);
  const [offerFeePct, setOfferFeePct] = useState<number>(1.5);
  const [offerForegoneDiscount, setOfferForegoneDiscount] = useState<number>(defaultDiscount);
  const [replacesLoanId, setReplacesLoanId] = useState<string>('');
  const [offerCountrySync, setOfferCountrySync] = useState(country);

  if (offerCountrySync !== country) {
    setOfferCountrySync(country);
    setOfferPrincipal(country === 'IN' ? 120000 : 4500);
    setOfferFeeFlat(country === 'IN' ? 1999 : 95);
    setOfferForegoneDiscount(country === 'IN' ? 8500 : 250);
    setReplacesLoanId('');
  }

  const offerResult = useMemo(
    () =>
      auditLoanOffer(
        {
          country,
          kind: offerKind,
          principal: Math.max(100, offerPrincipal),
          quotedAnnualRate: offerKind === 'no_cost_emi' ? 0 : offerQuotedRate / 100,
          tenureMonths: Math.max(3, offerTenure),
          processingFeeAmount: Math.max(0, offerFeeFlat),
          processingFeePct: Math.max(0, offerFeePct),
          foregoneDiscount: offerKind === 'no_cost_emi' ? Math.max(0, offerForegoneDiscount) : 0,
          replacesLoanId: offerKind === 'card_consolidation' && replacesLoanId ? replacesLoanId : undefined,
        },
        profile,
      ),
    [
      country,
      offerKind,
      offerPrincipal,
      offerQuotedRate,
      offerTenure,
      offerFeeFlat,
      offerFeePct,
      offerForegoneDiscount,
      replacesLoanId,
      profile,
    ],
  );

  // Tab 3: Invest vs Prepay state
  const openLoans = profile.loans.filter((l) => l.outstanding > 0);
  const [selectedLoanId, setSelectedLoanId] = useState<string>(openLoans[0]?.id ?? '');
  const activeLoan =
    openLoans.find((l) => l.id === selectedLoanId) ?? openLoans[0] ?? profile.loans[0];

  const [lumpSum, setLumpSum] = useState<number>(country === 'IN' ? 200000 : 10000);
  const [expectedReturnPct, setExpectedReturnPct] = useState<number>(country === 'IN' ? 11.5 : 8.0);
  const [investTaxPct, setInvestTaxPct] = useState<number>(country === 'IN' ? 12.5 : 15.0);
  const [prepaySharePct, setPrepaySharePct] = useState<number>(60);
  const [horizonYears, setHorizonYears] = useState<number>(5);
  const [investCountrySync, setInvestCountrySync] = useState(country);

  if (investCountrySync !== country) {
    setInvestCountrySync(country);
    setLumpSum(country === 'IN' ? 200000 : 10000);
    setExpectedReturnPct(country === 'IN' ? 11.5 : 8.0);
    setInvestTaxPct(country === 'IN' ? 12.5 : 15.0);
    setSelectedLoanId(profile.loans[0]?.id ?? '');
  }

  const investResult = useMemo(() => {
    if (!activeLoan) return null;
    return computeInvestVsPrepay({
      country,
      loan: activeLoan,
      taxRegimeIN: profile.taxRegimeIN,
      marginalTaxRate: profile.marginalTaxRate,
      amount: Math.max(100, lumpSum),
      expectedPreTaxReturn: expectedReturnPct / 100,
      investmentTaxRate: investTaxPct / 100,
      prepaySharePct,
      horizonYears,
    });
  }, [
    country,
    activeLoan,
    profile.taxRegimeIN,
    profile.marginalTaxRate,
    lumpSum,
    expectedReturnPct,
    investTaxPct,
    prepaySharePct,
    horizonYears,
  ]);

  return (
    <div className="space-y-8">
      {/* Header + Segmented Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Check Before Signing
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Deterministic truth checks against your exact loans and statutory rules — verify Bank RM or AI advice, expose &ldquo;No-Cost EMI&rdquo; traps, and compute tax-adjusted Invest vs Prepay break-even returns.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Decision tools"
          className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 self-start"
        >
          {(
            [
              { id: 'advice', label: 'Verify Advice' },
              { id: 'offer', label: "Don't Sign That" },
              { id: 'invest', label: 'Invest vs Prepay' },
            ] as Array<{ id: DecisionTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: VERIFY BANK RM / AI ADVICE */}
      {activeTab === 'advice' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Paste Bank RM Pitch, Influencer Reel, or AI Chat Response
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Checked deterministically against your active loans, verified Oct 2026 policy rates, and RBI/US statutory rules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdviceInput(SAMPLE_ADVICE_TEXT[country])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap self-start"
              >
                <Sparkles className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                <span>Load Sample Bank RM Pitch</span>
              </button>
            </div>

            <textarea
              value={adviceInput}
              onChange={(e) => setAdviceInput(e.target.value)}
              rows={4}
              placeholder="Paste any advice about prepaying, credit card minimum dues, repo rates, or foreclosure penalties..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </section>

          {/* Scorecard Summary */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {adviceReport.headline}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Zero generative guessing — every verdict traces to arithmetic or a dated rule.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums shrink-0">
                <span className="text-rose-700 dark:text-rose-400 font-semibold">
                  {adviceReport.wrongCount} Wrong
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                  {adviceReport.verifiedCount} Verified
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-amber-700 dark:text-amber-400 font-semibold">
                  {adviceReport.cantCheckCount} Nuanced
                </span>
              </div>
            </div>

            {adviceReport.claims.length > 0 ? (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {adviceReport.claims.map((claim) => (
                  <div key={claim.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {claim.verdict === 'wrong' ? (
                          <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                        ) : claim.verdict === 'verified' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <HelpCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        )}
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {claim.kind}
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span
                          className={`text-xs font-semibold ${
                            claim.verdict === 'wrong'
                              ? 'text-rose-700 dark:text-rose-400'
                              : claim.verdict === 'verified'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {claim.verdict === 'wrong'
                            ? 'Contradicts Math / Rules'
                            : claim.verdict === 'verified'
                              ? 'Verified'
                              : 'Depends on Assumptions'}
                        </span>
                      </div>
                      {claim.impactAmount ? (
                        <span className="text-xs font-mono tabular-nums font-semibold text-rose-700 dark:text-rose-400">
                          Potential cost: {formatMoney(claim.impactAmount, country)}
                        </span>
                      ) : null}
                    </div>

                    <p className="text-xs italic text-slate-600 dark:text-slate-400">
                      &ldquo;{claim.quote}&rdquo;
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">
                        <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                          What they claimed
                        </span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {claim.theirs}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200/70 dark:border-teal-900/60">
                        <span className="text-teal-800 dark:text-teal-300 block mb-0.5">
                          Verified against your loans
                        </span>
                        <span className="font-medium text-slate-900 dark:text-white">
                          {claim.ours}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {claim.why}
                      {claim.citation ? (
                        <span className="text-slate-500 dark:text-slate-400">
                          {' '}
                          — Source: {claim.citation}
                        </span>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Paste a pitch mentioning a prepayment fee, payoff order, card minimum due, or repo/Fed rate to verify it.
              </p>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: "DON'T SIGN THAT" OFFER & NO-COST EMI AUDITOR */}
      {activeTab === 'offer' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Form */}
          <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Audit a Loan Offer or &ldquo;No-Cost EMI&rdquo;
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Solves true monthly IRR including processing fees, {country === 'IN' ? '18% GST on fees & implicit interest, ' : ''}and foregone upfront cash discounts.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'no_cost_emi', label: 'No-Cost EMI' },
                  { id: 'personal_loan', label: 'Personal Loan' },
                  { id: 'top_up', label: 'Loan Top-Up' },
                  { id: 'card_consolidation', label: 'Card Consolidation' },
                ] as Array<{ id: OfferAuditInput['kind']; label: string }>
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setOfferKind(k.id)}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    offerKind === k.id
                      ? 'border-teal-700 bg-teal-50 text-teal-900 dark:border-teal-500 dark:bg-teal-950/60 dark:text-teal-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Amount / Principal ({country === 'IN' ? '₹' : '$'})
                </span>
                <input
                  type="number"
                  value={offerPrincipal}
                  onChange={(e) => setOfferPrincipal(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Tenure (months)
                </span>
                <input
                  type="number"
                  min={3}
                  max={240}
                  value={offerTenure}
                  onChange={(e) => setOfferTenure(Number(e.target.value) || 12)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              {offerKind !== 'no_cost_emi' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Quoted Interest Rate (% p.a.)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={offerQuotedRate}
                    onChange={(e) => setOfferQuotedRate(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              )}

              {offerKind === 'no_cost_emi' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Upfront Cash Discount Lost ({country === 'IN' ? '₹' : '$'})
                  </span>
                  <input
                    type="number"
                    value={offerForegoneDiscount}
                    onChange={(e) => setOfferForegoneDiscount(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Flat Processing Fee ({country === 'IN' ? '₹' : '$'})
                </span>
                <input
                  type="number"
                  value={offerFeeFlat}
                  onChange={(e) => setOfferFeeFlat(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Processing Fee (% of loan)
                </span>
                <input
                  type="number"
                  step="0.25"
                  value={offerFeePct}
                  onChange={(e) => setOfferFeePct(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              {offerKind === 'card_consolidation' && (
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Replacing Existing Debt
                  </span>
                  <select
                    value={replacesLoanId}
                    onChange={(e) => setReplacesLoanId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  >
                    <option value="">Select existing card or loan...</option>
                    {openLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({formatMoney(l.outstanding, country)} @ {formatPct(l.annualRate)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>

          {/* Right Verdict Panel */}
          <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                {offerResult.verdict === 'trap' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                ) : offerResult.verdict === 'worth_it' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <Scale className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p
                    className={`text-xs font-semibold ${
                      offerResult.verdict === 'trap'
                        ? 'text-rose-700 dark:text-rose-400'
                        : offerResult.verdict === 'worth_it'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {offerResult.verdict === 'trap'
                      ? 'Expensive Trap — Do Not Sign Blindly'
                      : offerResult.verdict === 'worth_it'
                        ? 'Mathematically Sound'
                        : 'Borderline — Negotiate Fees'}
                  </p>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {offerResult.headline}
                  </h3>
                </div>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {offerResult.explanation}
              </p>

              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">True All-In APR</p>
                  <p
                    className={`mt-1 text-2xl font-bold font-mono tabular-nums ${
                      offerResult.trueAllInApr > 0.14
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {formatPct(offerResult.trueAllInApr)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Monthly EMI</p>
                  <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {formatMoney(offerResult.emi, country)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Upfront Fees {country === 'IN' ? '(incl. 18% GST)' : ''}
                  </p>
                  <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
                    {formatMoney(offerResult.upfrontFeesWithTax, country)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Household EMI Load</p>
                  <p
                    className={`mt-1 text-base font-semibold font-mono tabular-nums ${
                      offerResult.emiToIncomePct > 50
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {offerResult.emiToIncomePct.toFixed(1)}% of take-home
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Total real cost over {offerTenure} mo</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                {formatMoney(offerResult.totalInterest, country)}
              </span>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: INVEST VS PREPAY (TAX-REGIME AWARE) */}
      {activeTab === 'invest' && investResult && activeLoan && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Spare Cash: Prepay Loan vs Invest
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Compares guaranteed after-tax interest saved (accounting for {country === 'IN' ? `${profile.taxRegimeIN} tax regime` : 'US marginal tax'}) against taxed investment returns.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Target Loan to Compare Against
                </span>
                <select
                  value={activeLoan.id}
                  onChange={(e) => setSelectedLoanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {openLoans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {formatPct(l.annualRate)} quoted
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Spare Cash Amount ({country === 'IN' ? '₹' : '$'})
                  </span>
                  <input
                    type="number"
                    value={lumpSum}
                    onChange={(e) => setLumpSum(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Horizon (years)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={horizonYears}
                    onChange={(e) => setHorizonYears(Math.max(1, Number(e.target.value) || 5))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Expected Pre-Tax Return (% p.a.)
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    value={expectedReturnPct}
                    onChange={(e) => setExpectedReturnPct(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Capital Gains Tax (% on gains)
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    value={investTaxPct}
                    onChange={(e) => setInvestTaxPct(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Your Split: {prepaySharePct}% Prepay · {100 - prepaySharePct}% Invest
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {formatMoney(investResult.prepayAmount, country)} / {formatMoney(investResult.investAmount, country)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={prepaySharePct}
                  onChange={(e) => setPrepaySharePct(Number(e.target.value))}
                  aria-label="Percentage of spare cash allocated to prepayment"
                  className="w-full accent-teal-700"
                />
              </div>
            </div>
          </section>

          <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <TrendingUp className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                  {investResult.edgeFavors === 'prepay'
                    ? 'Prepaying Wins (Guaranteed)'
                    : investResult.edgeFavors === 'invest'
                      ? 'Investing Leads (With Market Risk)'
                      : 'Near Break-Even — Split Works Well'}
                </p>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  Need {formatPct(investResult.breakEvenPreTaxReturn)} pre-tax return to beat prepaying {activeLoan.name}
                </h3>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Guaranteed Loan Saving</p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                  {formatPct(investResult.trueLoanCost)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Risk-free after-tax APR
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Post-Tax Invest Return</p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatPct(investResult.postTaxInvestReturn)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Subject to market volatility
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">100% Prepay ({horizonYears} yr benefit)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                  {formatMoney(investResult.purePrepayBenefit, country)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">100% Invest ({horizonYears} yr post-tax gain)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                  {formatMoney(investResult.pureInvestGain, country)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="font-medium text-slate-900 dark:text-white">
                  Your {prepaySharePct}/{100 - prepaySharePct} Split Combined Value
                </span>
                <span className="font-mono tabular-nums font-bold text-teal-700 dark:text-teal-400">
                  {formatMoney(investResult.combinedNetAdvantage, country)}
                </span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

'use client';

import Decimal from 'decimal.js';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  ApplyAction,
  Field,
  InfoTip,
  Select,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import {
  api,
  formatCurrency,
  formatPct,
  type AssetLiquidationResponse,
  type LiquidationRecommendation,
} from '@/lib/api';
import { DEMO_ASSET } from '@/lib/demo-user';
import { loadProfileClient } from '@/lib/user-store';
import { useFormErrors } from '@/lib/form-errors';
import { applyToolResult } from '@/lib/apply-tool-result';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { DecisionLogControls } from '@/components/DecisionLogControls';
import { PortfolioRanker } from './PortfolioRanker';

const FINANCE_ACT_2024_CUTOFF = '2024-07-23';
const DEFAULT_INFLATION = '0.046';
const ENGINE_DEFAULT_LEFTOVER_YIELD = '0.068';

/** Convert any user-typed purchase date into a full ISO date.
 *  Accepts YYYY (→ Oct 1 of that year, mid-FY), YYYY-MM (→ 1st of that month),
 *  or YYYY-MM-DD (pass-through). Returns null if unparseable. */
function normalizePurchaseDate(input: string): string | null {
  const v = input.trim();
  if (/^\d{4}$/.test(v)) return `${v}-10-01`;
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

function fyFromISO(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}`
                : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}

type SaleMode = 'whole' | 'partial';


// The API's field names → this form's inputs, so a rejected value's
// message shows under the input it came from.
const FIELDS: Record<string, string> = {
  'asset.purchase_price': 'purchasePrice',
  'asset.purchase_date': 'purchaseDate',
  'asset.state': 'state',
  'asset.current_market_value': 'salePrice',
  sale_price: 'salePrice',
  debt_balance: 'debtBalance',
  debt_effective_rate: 'debtRate',
  taxable_income: 'taxableIncome',
  asset_nominal_return: 'assetReturn',
  inflation: 'inflation',
  expected_hold_years_post_sale: 'holdYears',
  surplus_reinvestment_yield: 'leftoverYield',
};

export function LiquidateTool() {
  const profile = useMemo(() => loadProfileClient(), []);
  const country = profile.user.country;

  // ─── Asset inputs ──────────────────────────────────────────────────────
  const [purchasePrice, setPurchasePrice] = useState(DEMO_ASSET.purchase_price);
  // Accepts YYYY, YYYY-MM, or YYYY-MM-DD. Free-text so user can type a year.
  const [purchaseDate, setPurchaseDate] = useState(
    DEMO_ASSET.purchase_date.slice(0, 4),
  );
  const [state, setState] = useState(DEMO_ASSET.state ?? 'Maharashtra');

  // Sale mode: sell the whole thing, or only a piece (sq.ft, shares, etc.)
  const [saleMode, setSaleMode] = useState<SaleMode>('whole');
  const [salePrice, setSalePrice] = useState(DEMO_ASSET.current_market_value);
  const [qty, setQty] = useState('1000');
  const [unitPrice, setUnitPrice] = useState('5000');
  const [totalQty, setTotalQty] = useState('4000');
  const [unitLabel, setUnitLabel] = useState('sq.ft');

  // ─── Debt inputs ──────────────────────────────────────────────────────
  // Defaults to highest-rate loan when profile is populated.
  const initialIdx = useMemo(() => {
    if (!profile.user.loans?.length) return '';
    let best = 0;
    let bestRate = Number(profile.user.loans[0].nominal_rate);
    for (let i = 1; i < profile.user.loans.length; i++) {
      const r = Number(profile.user.loans[i].nominal_rate);
      if (r > bestRate) {
        bestRate = r;
        best = i;
      }
    }
    return String(best);
  }, [profile.user.loans]);
  const [targetIdx, setTargetIdx] = useState<string>(initialIdx);
  const [debtBalance, setDebtBalance] = useState('1500000');
  const [debtRate, setDebtRate] = useState('0.36');
  const [taxableIncome, setTaxableIncome] = useState('1800000');

  // ─── Advanced (asset-return, hold horizon, leftover yield, inflation) ─
  const [assetReturn, setAssetReturn] = useState('0.06');
  const [holdYears, setHoldYears] = useState('5');
  const [leftoverYield, setLeftoverYield] = useState(ENGINE_DEFAULT_LEFTOVER_YIELD);
  const [inflation, setInflation] = useState(DEFAULT_INFLATION);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [v, setV] = useState<AssetLiquidationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const [applied, setApplied] = useState(false);

  // The asset (real estate, Indian-tax mechanics) is denominated in the user's
  // residence currency. The picked target loan may be in a different currency
  // for NRI-US users — format the "apply payoff" line in that loan's currency.
  const userCcy = userDefaultCurrency(country);
  const targetLoanForCcy =
    targetIdx !== '' ? profile.user.loans[Number(targetIdx)] : undefined;
  const loanCcy = targetLoanForCcy ? loanCurrency(targetLoanForCcy, country) : userCcy;
  const fmt = (v: string | number) => formatCurrency(v, userCcy);
  const fmtLoan = (v: string | number) => formatCurrency(v, loanCcy);

  // Mirror picked loan's balance + rate into the form.
  function pickTargetLoan(idx: string) {
    setTargetIdx(idx);
    const i = Number(idx);
    if (!Number.isNaN(i) && profile.user.loans[i]) {
      const loan = profile.user.loans[i];
      setDebtBalance(loan.outstanding);
      setDebtRate(loan.nominal_rate);
    }
  }

  // Auto-apply the initial pick when component mounts with a live profile.
  useEffect(() => {
    if (initialIdx !== '') pickTargetLoan(initialIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived sale price under partial mode = qty × unit_price.
  const effectiveSalePrice = useMemo(() => {
    if (saleMode === 'partial') {
      const q = new Decimal(qty || '0');
      const u = new Decimal(unitPrice || '0');
      return q.mul(u).toString();
    }
    return salePrice;
  }, [saleMode, qty, unitPrice, salePrice]);

  // Derived purchase price proportional to partial sale, if user wants — but
  // we don't know what fraction of the original purchase the qty represents
  // without total_qty. Default: scale linearly by qty / total_qty.
  const effectivePurchasePrice = useMemo(() => {
    if (saleMode === 'partial') {
      const q = new Decimal(qty || '0');
      const t = new Decimal(totalQty || '0');
      if (t.isZero()) return purchasePrice;
      return new Decimal(purchasePrice).mul(q).div(t).toFixed(2);
    }
    return purchasePrice;
  }, [saleMode, qty, totalQty, purchasePrice]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    clear();
    setApplied(false);
    try {
      const isoDate = normalizePurchaseDate(purchaseDate);
      if (!isoDate) {
        throw new Error('Enter purchase as a year (2018), year-month (2018-06), or full date (2018-06-15).');
      }
      const isPre = isoDate < FINANCE_ACT_2024_CUTOFF;
      const payload = {
        asset: {
          asset_type: 'real_estate',
          purchase_price: effectivePurchasePrice,
          purchase_date: isoDate,
          current_market_value: effectiveSalePrice,
          state,
        },
        sale_price: effectiveSalePrice,
        debt_balance: debtBalance,
        debt_effective_rate: debtRate,
        taxable_income: taxableIncome,
        asset_nominal_return: assetReturn,
        inflation,
        expected_hold_years_post_sale: holdYears,
        surplus_reinvestment_yield: leftoverYield,
        ...(isPre
          ? { purchase_fy: fyFromISO(isoDate), current_fy: '2024-25' }
          : {}),
      };
      setV(await api.assetLiquidation(payload));
    } catch (e) {
      fail(e, FIELDS);
    } finally {
      setBusy(false);
    }
  }

  // After result lands: surplus > 0 means proceeds exceed debt. Suggest
  // partial sale (sell only enough to clear).
  const partialSaleHint = useMemo(() => {
    if (!v || v.surplus == null || saleMode !== 'whole') return null;
    const surplusD = new Decimal(v.surplus);
    if (surplusD.lte(0)) return null;
    const saleD = new Decimal(effectiveSalePrice);
    if (saleD.isZero()) return null;
    const fractionNeeded = new Decimal(debtBalance).div(saleD).toFixed(2);
    return { fractionNeeded, surplus: v.surplus };
  }, [v, saleMode, effectiveSalePrice, debtBalance]);

  const hasAssets = (profile.user.assets?.length ?? 0) > 0;

  // Drill-in handler: pre-fill the sandbox form from a ranker recommendation.
  // Only supports real-estate fully (sandbox is RE-focused). For other types
  // we still pre-fill what we can and let the user see the existing UI.
  function drillIn(rec: LiquidationRecommendation) {
    if (!profile.user.assets) return;
    const asset = profile.user.assets[rec.asset_index];
    if (!asset) return;
    if (asset.purchase_price) setPurchasePrice(asset.purchase_price);
    if (asset.purchase_date) {
      // Normalise to YYYY-only acceptance the form already supports.
      setPurchaseDate(asset.purchase_date.slice(0, 10) || asset.purchase_date);
    }
    if (asset.current_market_value) setSalePrice(asset.current_market_value);
    if (asset.state) setState(asset.state);
    setTargetIdx(String(rec.target_loan_index));
    setDebtBalance(rec.debt_balance);
    setDebtRate(rec.debt_effective_rate);
    // Scroll the sandbox section into view.
    if (typeof document !== 'undefined') {
      document.getElementById('sandbox-section')?.scrollIntoView({
        behavior: 'smooth', block: 'start',
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {hasAssets ? (
        <PortfolioRanker
          user={profile.user}
          marginalRate={profile.marginalRate}
          isLive={profile.isLive}
          onDrillIn={drillIn}
        />
      ) : (
        <Card>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            <strong>Add your assets</strong> at{' '}
            <a href="/onboarding/assets" style={{ color: 'var(--accent)' }}>
              /onboarding/assets
            </a>{' '}
            to see every asset ranked against every debt — net of tax, lockups,
            and selling costs. Skip if you'd rather just compute a single
            scenario below.
          </p>
        </Card>
      )}

      <section id="sandbox-section">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          {hasAssets ? 'Sandbox — model a specific scenario' : 'Run a single scenario'}
        </h2>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Real-estate flavoured; fine-grained controls for one (asset, debt)
          pairing.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          {/* Asset block */}
          <Field
            label="Purchase price"
            value={purchasePrice}
            error={at('purchasePrice')}
            onChange={setPurchasePrice}
            info={
              <>
                What you originally paid for the whole asset. If you&apos;re
                modelling a partial sale below, we&apos;ll pro-rate this by
                quantity automatically.
              </>
            }
          />
          <Field
            label="Purchase year or date"
            value={purchaseDate}
            error={at('purchaseDate')}
            onChange={setPurchaseDate}
            kind="text"
            placeholder="e.g. 2018 or 2018-06-15"
            hint="Year is fine; we default to Oct 1 (mid-FY) when only year is given."
            info={
              <>
                Purchase date drives Finance Act 2024 indexation eligibility.
                Anything before 23 Jul 2024 can use indexed cost (CII); newer
                purchases pay flat 12.5% on the gain.
              </>
            }
          />
          <Field
            label="State (for selling costs)"
            value={state}
            error={at('state')}
            onChange={setState}
            kind="text"
            info={
              <>
                Stamp duty + registration vary by state in India. Maharashtra,
                Karnataka and Delhi all have different rates. Brokerage is
                assumed 1.5% on top.
              </>
            }
          />
          <Select
            label="Sale mode"
            value={saleMode}
            onChange={(v) => setSaleMode(v as SaleMode)}
            options={[
              { value: 'whole', label: 'Sell the whole asset' },
              { value: 'partial', label: 'Sell only a portion (qty × price)' },
            ]}
            info={
              <>
                <strong>Whole</strong>: a single sale price.{' '}
                <strong>Partial</strong>: useful for land (X sq.ft of Y sq.ft
                owned) or equity (X shares of Y owned). The tool will then
                also tell you if a smaller sale clears your debt.
              </>
            }
          />
          {saleMode === 'whole' ? (
            <Field
              label="Expected sale price (whole asset)"
              value={salePrice}
              error={at('salePrice')}
              onChange={setSalePrice}
              info={<>What you realistically expect to net before tax + selling costs.</>}
            />
          ) : (
            <>
              <Field
                label="Unit name"
                value={unitLabel}
                onChange={setUnitLabel}
                kind="text"
                placeholder="sq.ft, acres, shares, units…"
              />
              <Field
                label={`Total owned (${unitLabel})`}
                value={totalQty}
                onChange={setTotalQty}
                info={<>Total quantity you own. Used to pro-rate the purchase price.</>}
              />
              <Field
                label={`Quantity to sell (${unitLabel})`}
                value={qty}
                onChange={setQty}
              />
              <Field
                label={`Price per ${unitLabel}`}
                value={unitPrice}
                error={at('salePrice')}
                onChange={setUnitPrice}
              />
              <div
                className="muted"
                style={{ gridColumn: '1 / -1', fontSize: 12, padding: '4px 0' }}
              >
                Derived sale price:{' '}
                <span className="num" style={{ color: 'var(--ink)' }}>
                  {fmt(effectiveSalePrice)}
                </span>{' '}
                · pro-rated cost basis:{' '}
                <span className="num" style={{ color: 'var(--ink)' }}>
                  {fmt(effectivePurchasePrice)}
                </span>
              </div>
            </>
          )}

          {/* Debt block */}
          {profile.user.loans.length > 0 && (
            <Select
              label="Which debt would this clear?"
              value={targetIdx}
              onChange={pickTargetLoan}
              options={[
                { value: '', label: '— hypothetical / not in my profile' },
                ...profile.user.loans
                  .map((l, i) => ({
                    value: String(i),
                    label: `${l.bank} · ${l.loan_type.replace('_', ' ')} · ${formatPct(l.nominal_rate)} · ${formatCurrency(l.outstanding, loanCurrency(l, country))}`,
                    rate: Number(l.nominal_rate),
                  }))
                  .sort((a, b) => b.rate - a.rate)
                  .map(({ value, label }) => ({ value, label })),
              ]}
              info={
                <>
                  Defaults to your highest-rate loan — that&apos;s where a
                  payoff saves the most interest. Picking the loan also wires
                  the &ldquo;Apply&rdquo; button at the bottom.
                </>
              }
            />
          )}
          <Field
            label="Debt balance to clear"
            value={debtBalance}
            error={at('debtBalance')}
            onChange={setDebtBalance}
          />
          <Field
            label="Loan rate (decimal)"
            value={debtRate}
            error={at('debtRate')}
            onChange={setDebtRate}
            hint="e.g. 0.36 for 36% card APR, 0.085 for 8.5% home loan"
            info={
              <>
                The <strong>effective</strong> interest rate you&apos;re paying
                on this debt — after any tax benefits. For a home loan with
                Sec 80EEA, the effective rate may be 2–3pp lower than the
                quoted rate. For credit cards, effective ≈ quoted.
              </>
            }
          />
          <Field
            label="Your annual taxable income"
            value={taxableIncome}
            error={at('taxableIncome')}
            onChange={setTaxableIncome}
            hint="Drives the LTCG surcharge band"
            info={
              <>
                Surcharge on long-term capital gains depends on which income
                slab you fall in. Capped at 25% under the Finance Act 2024.
              </>
            }
          />

          {/* Advanced toggle */}
          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 12,
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced settings (return, horizon, leftover-cash yield, inflation)
            </button>
          </div>
          {showAdvanced && (
            <>
              <Field
                label="Asset's expected return (decimal, nominal)"
                value={assetReturn}
                error={at('assetReturn')}
                onChange={setAssetReturn}
                hint="e.g. 0.06 for 6% — what you think this asset will appreciate"
                info={
                  <>
                    Nominal annual return you expect from the asset if you{' '}
                    <em>don&apos;t</em> sell. Real estate is ~5–7% nominal in
                    India over long horizons; equity ~10–12%. Subtract
                    inflation below to see real return.
                  </>
                }
              />
              <Field
                label="Years you'd hold if you don't sell"
                value={holdYears}
                error={at('holdYears')}
                onChange={setHoldYears}
                info={
                  <>
                    Horizon for the hold-vs-sell wealth comparison. Default 5
                    years — long enough that one-time selling costs
                    don&apos;t dominate.
                  </>
                }
              />
              <Field
                label="What would the leftover cash earn?"
                value={leftoverYield}
                error={at('leftoverYield')}
                onChange={setLeftoverYield}
                hint="Default 6.8% — liquid fund / 12-mo FD (IN)"
                info={
                  <>
                    If you sell and clear the debt, what&apos;s left over goes
                    here — typically a liquid fund or short-term deposit.
                    Drives the &ldquo;wealth if you sell&rdquo; figure below.
                  </>
                }
              />
              <Field
                label="Inflation (decimal)"
                value={inflation}
                error={at('inflation')}
                onChange={setInflation}
                hint="Default 4.6% — RBI's headline CPI target band"
                info={
                  <>
                    Subtracted from nominal return to give the asset&apos;s
                    real return. Higher inflation makes holding a low-yield
                    asset look worse.
                  </>
                }
              />
            </>
          )}
          <SubmitBar busy={busy} error={err} label="Should I sell?" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={v.recommend_liquidation ? 'Sell the asset' : 'Hold the asset'}
            color={v.recommend_liquidation ? 'var(--positive)' : 'var(--muted)'}
            detail={v.rationale}
          />

          {partialSaleHint && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: 'var(--soft-bg)',
                border: '1px dashed var(--accent)',
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              You&apos;d be left with{' '}
              <strong className="num" style={{ color: 'var(--positive)' }}>
                {fmt(partialSaleHint.surplus)}
              </strong>{' '}
              of cash after clearing this debt. If you can split the asset,
              selling roughly{' '}
              <strong>{(Number(partialSaleHint.fractionNeeded) * 100).toFixed(0)}%</strong>{' '}
              of it would clear the debt and leave the rest compounding.
              Switch to &ldquo;partial sale&rdquo; mode above to model that.
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Stat
              label="Net proceeds (after tax + selling costs)"
              value={fmt(v.net_proceeds)}
            />
            <Stat
              label="LTCG tax"
              value={fmt(v.ltcg_tax)}
              color="var(--negative)"
            />
            <Stat
              label="Net benefit after debt + interest during sale"
              value={fmt(v.net_benefit)}
              color={Number(v.net_benefit) > 0 ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label={
                <>
                  Asset&apos;s real return{' '}
                  <InfoTip>
                    Nominal return − inflation − holding cost − one-time drag
                    (selling cost + tax amortised over horizon). If this is
                    below your loan rate, the asset is being out-earned by
                    your debt.
                  </InfoTip>
                </>
              }
              value={formatPct(v.asset_real_return_net, 2)}
            />
          </div>

          {v.gate_0_wealth_edge !== null && (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
                background: 'var(--canvas)',
              }}
            >
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Hold vs sell over {v.horizon_years ?? '5'}y (leftover parked at{' '}
                {formatPct(leftoverYield, 1)})
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 12,
                }}
              >
                <Stat
                  label="Keep asset, keep debt"
                  value={fmt(v.wealth_hold ?? '0')}
                />
                <Stat
                  label="Sell, clear debt, invest surplus"
                  value={fmt(v.wealth_sell ?? '0')}
                  color={
                    Number(v.wealth_edge) > 0
                      ? 'var(--positive)'
                      : 'var(--negative)'
                  }
                />
                <Stat
                  label="Edge of selling"
                  value={`${Number(v.wealth_edge) >= 0 ? '+' : ''}${fmt(v.wealth_edge ?? '0')}`}
                  color={
                    Number(v.wealth_edge) > 0
                      ? 'var(--positive)'
                      : 'var(--negative)'
                  }
                />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Surplus after clearing debt:{' '}
                <span className="num" style={{ color: 'var(--ink)' }}>
                  {fmt(v.surplus ?? '0')}
                </span>
              </div>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: v.gate_0_wealth_edge !== null
                ? 'repeat(4, 1fr)'
                : 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            {v.gate_0_wealth_edge !== null && (
              <Stat
                label={
                  <>
                    Sell beats hold{' '}
                    <InfoTip>
                      Selling must leave you ≥ 10% wealthier than holding,
                      over the horizon above. Filters out cases where the
                      math &ldquo;works&rdquo; but the leftover cash earns
                      less than the asset would have.
                    </InfoTip>
                  </>
                }
                value={v.gate_0_wealth_edge ? 'Pass' : 'Fail'}
                color={v.gate_0_wealth_edge ? 'var(--positive)' : 'var(--negative)'}
              />
            )}
            <Stat
              label={
                <>
                  Benefit ≥ 10%{' '}
                  <InfoTip>
                    After-tax net benefit must be at least 10% of asset value
                    — small wins aren&apos;t worth the friction.
                  </InfoTip>
                </>
              }
              value={v.gate_1_net_benefit ? 'Pass' : 'Fail'}
              color={v.gate_1_net_benefit ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label={
                <>
                  High-rate debt{' '}
                  <InfoTip>
                    Loan rate must exceed 20%. Selling an appreciating asset
                    to clear a 9% home loan is usually a bad trade.
                  </InfoTip>
                </>
              }
              value={v.gate_2_high_rate ? 'Pass' : 'Fail'}
              color={v.gate_2_high_rate ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label={
                <>
                  Debt &gt; asset return{' '}
                  <InfoTip>
                    Loan rate must beat the asset&apos;s real return by 3pp.
                    Otherwise the asset is still out-earning the debt.
                  </InfoTip>
                </>
              }
              value={v.gate_3_spread ? 'Pass' : 'Fail'}
              color={v.gate_3_spread ? 'var(--positive)' : 'var(--negative)'}
            />
          </div>

          <DecisionLogControls
            kind="liquidation"
            context={
              v.recommend_liquidation
                ? 'Sell asset — recommended'
                : 'Sell asset — hold instead'
            }
            estimatedAmount={v.net_proceeds}
            reasoning={v.rationale}
            source="tools/liquidate"
            ccySym={userCcy === 'INR' ? '₹' : '$'}
          />
          {v.recommend_liquidation &&
            targetIdx !== '' &&
            profile.isLive &&
            profile.user.loans[Number(targetIdx)] && (
              <ApplyAction
                applied={applied}
                onApply={() => {
                  const target = profile.user.loans[Number(targetIdx)];
                  const sched = target.scheduled_emi || '0';
                  const proceeds = new Decimal(v.net_proceeds);
                  const outstandingD = new Decimal(target.outstanding);
                  const fullyClears = proceeds.gte(outstandingD);
                  applyToolResult({
                    loanIndex: Number(targetIdx),
                    kind: fullyClears ? 'closed' : 'paid_extra',
                    amount: fullyClears
                      ? proceeds.toFixed(2)
                      : String(Number(sched) + Number(v.net_proceeds)),
                    scheduledEmi: sched,
                    note: `Asset sold — ${fmtLoan(v.net_proceeds)} net proceeds applied to ${target.bank}`,
                    loans: profile.user.loans,
                    country: profile.user.country,
                  });
                  setApplied(true);
                }}
                label={`Apply this — log ${fmtLoan(v.net_proceeds)} payoff to ${profile.user.loans[Number(targetIdx)].bank} & reprice /plan`}
              />
            )}
        </Card>
      )}
    </div>
  );
}

'use client';

import { assetKindsFor } from '@/lib/r8-inputs';
import { whereToFind } from '@/lib/where-to-find';
import Decimal from 'decimal.js';
import { dec } from '@/lib/safe-decimal';
import { useEffect, useMemo, useState } from 'react';
import { ApplyAction, Field, SubmitBar } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LStepSub, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import {
  api,
  formatCurrency,
  formatPct,
  type AssetLiquidationResponse,
  type LiquidationRecommendation,
  type LoanPayload,
} from '@/lib/api';
import { useCurrentProfile as useStoredProfile, useOwedTodayProfile } from '@/lib/use-profile';
import { loadProfileClient } from '@/lib/user-store';
import { useFormErrors } from '@/lib/form-errors';
import { rateOutOfRange } from '@/lib/loan-gaps';
import { applyToolResult } from '@/lib/apply-tool-result';
import { loanCurrency, loanToUser, userDefaultCurrency } from '@/lib/currency';
import { SAFE_RATES, formatAsOf } from '@/lib/invest-vs-prepay';
import { loanLabel, loanName } from '@/lib/loan-types';
import dynamic from 'next/dynamic';
const DecisionLogControls = dynamic(() => import('@/components/DecisionLogControls').then((m) => m.DecisionLogControls)); // r3e: route budget (shown with a result)
import { assetTypeLabel } from '@/components/portfolio/portfolioSummary';
import { assetReturn as assumedReturn } from '@/lib/assumptions';
import { LIQUIDATE_DISCLAIMER, LIQUIDATE_DISCLAIMER_US } from '@/lib/disclaimers';
import { Term } from '@/components/Term';
import { SALE_ASSET_TYPES, saleSummary, ownAssetsInOrder, needsOwnGrowth } from '@/lib/sale-calculator';
import { requiredMonthly } from '@/lib/min-payment';
import { INFLATION_FORECAST, inflationRateFor, readInflationRateClient } from '@/lib/inflation-modeling';

// Per country: India's default describes Indian deposits; a US seller's
// leftover cash sits in a savings account. Prices rise at the central
// bank's forecast, or the user's own rate from Plan.
const DEFAULT_LEFTOVER_YIELD = { IN: SAFE_RATES.liquid_in.rate, US: SAFE_RATES.hysa_us.rate } as const;

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
  debt_monthly_payment: 'debtPayment',
  debt_effective_rate: 'debtRate',
  taxable_income: 'taxableIncome',
  asset_nominal_return: 'assetReturn',
  inflation: 'inflation',
  expected_hold_years_post_sale: 'holdYears',
  surplus_reinvestment_yield: 'leftoverYield',
};

/**
 * Sell to repay, as a calculator (sprint G10, founder's cut-list decision 1).
 *
 * The person picks what they would sell; the page works out the tax, the
 * selling costs and what is left after the loan, and sets keeping it beside
 * selling it on their own assumptions. It never ranks their holdings and
 * never says "sell" or "keep": naming the asset to sell is the line SEBI's
 * Investment Adviser rules draw (grill #50).
 */
export function LiquidateTool() {
  const profile = useStoredProfile();
  // Owed-fix: the debt balance filled in is what's owed now, as Home shows.
  const owedProfile = useOwedTodayProfile();
  const country = profile.user.country;
  const isUS = country === 'US';

  // ─── Asset inputs ──────────────────────────────────────────────────────
  // Blank until the user describes their asset (or picks one from the
  // ranker): a sample property here gave a "Sell the asset" verdict and a
  // ₹9.77 lakh advantage to someone who had never entered one.
  const [purchasePrice, setPurchasePrice] = useState('');
  // Accepts YYYY, YYYY-MM, or YYYY-MM-DD. Free-text so user can type a year.
  const [purchaseDate, setPurchaseDate] = useState('');
  // Not asked for (the seller pays no stamp duty); kept for assets that carry one.
  const [state, setState] = useState<string | undefined>(undefined);
  // US only: a main home the seller lived in 2 of the last 5 years has up to
  // $250,000 ($500,000 married filing jointly) of gain excluded (§121). The
  // tax can be zero or tens of thousands, so it's asked, not assumed.
  const [mainHome, setMainHome] = useState<'' | 'yes' | 'no'>('');
  // What is being sold. A sale worked out here is a property unless it was
  // opened from the ranker, where shares, funds or gold keep their own tax.
  const [assetType, setAssetType] = useState('real_estate');
  // Which of the person's own assets this was filled from, if any.
  const [fromAsset, setFromAsset] = useState<number | null>(null);
  const [assetName, setAssetName] = useState('');
  const isProperty = assetType === 'real_estate';

  // Sale mode: sell the whole thing, or only a piece (sq.ft, shares, etc.)
  const [saleMode, setSaleMode] = useState<SaleMode>('whole');
  const [salePrice, setSalePrice] = useState('');
  const [qty, setQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [totalQty, setTotalQty] = useState('');
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
  // From the profile's dearest loan (below) and its income, else blank.
  const [debtBalance, setDebtBalance] = useState('');
  const [debtRate, setDebtRate] = useState('');
  // The loan's monthly payment. Keeping the asset then pays the loan down on
  // schedule (and invests the payment once it's cleared) instead of letting
  // the whole balance compound for five years.
  const [debtPayment, setDebtPayment] = useState('');
  // Set when the picked loan is in another currency: its balance and EMI
  // were converted into the asset's currency at the profile's saved rate.
  const [convertedFrom, setConvertedFrom] = useState<string | null>(null);
  const incomeOnFile = profile.isLive
    ? String(Math.round(Number(profile.user.annual_gross_salary || profile.user.annual_business_income || profile.user.annual_income || 0)) || '')
    : '';
  const [taxableIncome, setTaxableIncome] = useState(incomeOnFile);

  // ─── Advanced (asset-return, hold horizon, leftover yield, inflation) ─
  // Growth if kept: the person's own assumption for this kind of asset
  // (Profile → Assumptions), else the app's default, shown beside the
  // answer rather than hidden. Crypto has no default: they enter one.
  const growthFor = (type: string) => (needsOwnGrowth(profile.user, type) ? '' : String(assumedReturn(profile.user, type)));
  const [assetReturn, setAssetReturn] = useState(() => growthFor('real_estate'));
  const [holdYears, setHoldYears] = useState('5');
  const [leftoverYield, setLeftoverYield] = useState<string>(DEFAULT_LEFTOVER_YIELD[country]);
  const [inflation, setInflation] = useState<string>(INFLATION_FORECAST[country].rate);
  const [ownInflation, setOwnInflation] = useState('');
  // The user's own rate lives in a cookie: read after hydration.
  useEffect(() => {
    const own = readInflationRateClient();
    if (own) {
      setOwnInflation(own);
      setInflation((cur) => (cur === INFLATION_FORECAST[country].rate ? inflationRateFor(country, own) : cur));
    }
  }, [country]);
  const [more, setMore] = useState(false);

  const [resultValue, setV] = useState<AssetLiquidationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, failField, at, clearField } = useFormErrors();
  const [applied, setApplied] = useState(false);
  const [resultProfileKey,setResultProfileKey] = useState('');

  // The asset (real estate, Indian-tax mechanics) is denominated in the user's
  // residence currency. The picked target loan may be in a different currency
  // for NRI-US users — format the "apply payoff" line in that loan's currency.
  const userCcy = userDefaultCurrency(country);
  const targetLoanForCcy =
    targetIdx !== '' ? profile.user.loans[Number(targetIdx)] : undefined;
  const loanCcy = targetLoanForCcy ? loanCurrency(targetLoanForCcy, country) : userCcy;
  const fmt = (v: string | number) => formatCurrency(v, userCcy);
  const fmtLoan = (v: string | number) => formatCurrency(v, loanCcy);
  // User-currency units per loan-currency unit (1 when they match); null
  // when the loan is foreign and the profile has no rate for it.
  const loanFx = (loan: LoanPayload): number | null => loanToUser(1, loan, country, profile.user.fx_to_user_currency);

  // Mirror picked loan's balance, rate and payment into the form, in the
  // asset's currency: the sale proceeds and the debt must be one currency.
  // The EMI, or a card's minimum: a card has no EMI, and a blank payment
  // made "keep it" assume the card went unpaid for years.
  const monthlyDue = (loan: (typeof profile.user.loans)[number]) => {
    const due = requiredMonthly(loan, country);
    return due.gt(0) ? due.toFixed(0) : '';
  };

  function pickTargetLoan(idx: string) {
    setTargetIdx(idx);
    setConvertedFrom(null);
    if (idx === '') {
      setDebtBalance('');
      setDebtPayment('');
      setDebtRate('');
      return;
    }
    const i = Number(idx);
    if (!Number.isNaN(i) && profile.user.loans[i]) {
      const loan = { ...profile.user.loans[i], outstanding: owedProfile.user.loans[i]?.outstanding ?? profile.user.loans[i].outstanding };
      const fx = loanFx(loan);
      const emi = monthlyDue(loan);
      if (fx === 1) {
        setDebtBalance(loan.outstanding);
        setDebtPayment(emi);
      } else if (fx != null) {
        setDebtBalance((Number(loan.outstanding) * fx).toFixed(2));
        setDebtPayment(emi ? (Number(emi) * fx).toFixed(2) : '');
        setConvertedFrom(
          `${formatCurrency(loan.outstanding, loanCurrency(loan, country))} converted at 1 ${loanCurrency(loan, country)} = ${fx} ${userCcy}, the rate saved in Setup.`,
        );
      } else {
        setDebtBalance('');
        setDebtPayment('');
        setConvertedFrom(`This loan is in ${loanCurrency(loan, country)}: enter its balance and payment in ${userCcy}, or save an exchange rate in Setup.`);
      }
      setDebtRate(loan.nominal_rate);
    }
  }

  // Auto-apply the initial pick when component mounts with a live profile.
  useEffect(() => {
    if (initialIdx !== '') pickTargetLoan(initialIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.user.loans, owedProfile.user.loans]);

  // Derived sale price under partial mode = qty × unit_price.
  const effectiveSalePrice = useMemo(() => {
    if (saleMode === 'partial') {
      const q = dec(qty || '0');
      const u = dec(unitPrice || '0');
      return q.mul(u).toString();
    }
    return salePrice;
  }, [saleMode, qty, unitPrice, salePrice]);

  // Derived purchase price proportional to partial sale, if user wants — but
  // we don't know what fraction of the original purchase the qty represents
  // without total_qty. Default: scale linearly by qty / total_qty.
  const effectivePurchasePrice = useMemo(() => {
    if (saleMode === 'partial') {
      const q = dec(qty || '0');
      const t = dec(totalQty || '0');
      if (t.isZero()) return purchasePrice;
      return dec(purchasePrice).mul(q).div(t).toFixed(2);
    }
    return purchasePrice;
  }, [saleMode, qty, totalQty, purchasePrice]);

  const fingerprint = JSON.stringify([assetType,purchasePrice,purchaseDate,state,mainHome,saleMode,salePrice,qty,unitPrice,totalQty,targetIdx,debtBalance,debtRate,debtPayment,taxableIncome,assetReturn,holdYears,leftoverYield,inflation]);
  const [checked,setChecked] = useState('');
  const v = checked === fingerprint ? resultValue : null;
  async function check(e: React.FormEvent) {
    e.preventDefault();
    const required: [string, string, string][] = [
      ['purchasePrice', purchasePrice, 'Enter what you paid for it.'],
      ['purchaseDate', purchaseDate, 'Enter when you bought it, e.g. 2018.'],
      ...(saleMode === 'whole'
        ? [['salePrice', salePrice, 'Enter what you expect to sell it for.'] as [string, string, string]]
        : [
            ['totalQty', totalQty, 'Enter how much you own.'] as [string, string, string],
            ['qty', qty, 'Enter how much you would sell.'] as [string, string, string],
            ['unitPrice', unitPrice, 'Enter the price per unit.'] as [string, string, string],
          ]),
      ['debtBalance', debtBalance, 'Enter the debt this would clear.'],
      ['debtRate', debtRate, 'Enter that loan’s interest rate.'],
      ['taxableIncome', taxableIncome, 'Enter your taxable income for the year: it sets the tax on the sale.'],
      ['assetReturn', assetReturn, 'Enter how much a year you expect it to grow if you keep it.'],
      ...(isUS && isProperty
        ? [['mainHome', mainHome, 'Say whether this is your main home: it sets the tax on the sale.'] as [string, string, string]]
        : []),
    ];
    const missing = required.find(([, value]) => value.trim() === '');
    if (missing) {
      failField(missing[0], missing[2]);
      return;
    }
    // R7-5: the same 0–100% a year as the field shows while typing.
    const rateErr = rateOutOfRange(debtRate);
    if (rateErr) {
      failField('debtRate', rateErr);
      return;
    }
    if (saleMode === 'partial' && (![qty,totalQty,unitPrice].every(v => Number.isFinite(Number(v)) && Number(v)>0) || Number(qty)>Number(totalQty))) {
      failField('qty','Sell more than 0 and no more than you own, at a price above 0.'); return;
    }
    setV(null);
    setBusy(true);
    clear();
    setApplied(false);
    try {
      const requestProfileKey = JSON.stringify(loadProfileClient().user) + (document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1] ?? '');
      const isoDate = normalizePurchaseDate(purchaseDate);
      if (!isoDate) {
        throw new Error('Enter when you bought it as a year (2018), a month (2018-06) or a date (2018-06-15).');
      }
      const payload = {
        asset: {
          asset_type: assetType,
          ...(assetName ? { label: assetName } : {}),
          purchase_price: effectivePurchasePrice,
          purchase_date: isoDate,
          current_market_value: effectiveSalePrice,
          state,
          ...(isUS && isProperty ? { us_section_121_eligible: mainHome === 'yes' } : {}),
        },
        sale_price: effectiveSalePrice,
        debt_balance: debtBalance,
        ...(debtPayment.trim() ? { debt_monthly_payment: debtPayment } : {}),
        debt_effective_rate: debtRate,
        // A property takes months to sell; shares, funds and gold sell in days.
        ...(isProperty ? {} : { selling_period_months: 0 }),
        taxable_income: taxableIncome,
        asset_nominal_return: assetReturn,
        inflation,
        expected_hold_years_post_sale: holdYears,
        surplus_reinvestment_yield: leftoverYield,
        // The API works out both financial years from the purchase date and
        // today (this used to send a fixed "2024-25" as the current year).
        ...(profile.marginalRate && !isUS ? { marginal_rate: profile.marginalRate } : {}),
        country,
        ...(isUS
          ? {
              filing_status: profile.user.filing_status ?? 'single',
              ...(profile.user.state_marginal_rate
                ? { state_marginal_rate: profile.user.state_marginal_rate }
                : {}),
            }
          : {}),
      };
      setV(await api.assetLiquidation(payload));
      setChecked(fingerprint);
      setResultProfileKey(requestProfileKey);
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

  /** Pick a kind of asset; the growth rate follows it unless typed. */
  function pickType(type: string) {
    setAssetType(type);
    setFromAsset(null);
    setAssetName('');
    setAssetReturn(growthFor(type));
  }

  /** Fill the form from one of the person's own assets (their choice). */
  function fillFrom(i: number) {
    const asset = profile.user.assets?.[i];
    if (!asset) return;
    setFromAsset(i);
    setAssetType(asset.asset_type);
    setAssetName(asset.label ?? '');
    setPurchasePrice(asset.purchase_price || '');
    setPurchaseDate((asset.purchase_date || '').slice(0, 10));
    setSalePrice(asset.current_market_value || '');
    setState(asset.state || undefined);
    setSaleMode('whole');
    setAssetReturn(asset.expected_return_pct ? String(asset.expected_return_pct) : growthFor(asset.asset_type));
  }

  const ownAssets = ownAssetsInOrder(profile.user.assets);
  // R8-4: no gold or gold ETF chips for a US user (kept if already picked).
  const typeChips = assetKindsFor(SALE_ASSET_TYPES[country], country, assetType);

  const loanChips = profile.user.loans
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => Number(l.outstanding) > 0)
    .sort((x, y) => Number(y.l.nominal_rate) - Number(x.l.nominal_rate));
  const target = targetIdx !== '' ? profile.user.loans[Number(targetIdx)] : undefined;
  const pctText = (f: string) => `${(Number(f) * 100).toFixed(2)}%`;
  const sellingCosts = v ? Number(effectiveSalePrice) - Number(v.ltcg_tax) - Number(v.net_proceeds) : 0;
  const proceedsInLoan = v && target ? new Decimal(v.net_proceeds).div(loanFx(target) ?? 1).toFixed(2) : null;

  return (
    <LSteps>
      <LNote style={{ margin: 0, color: L_T.ink }}>{isUS ? LIQUIDATE_DISCLAIMER_US : LIQUIDATE_DISCLAIMER}</LNote>

      <LStep no="01" id="sandbox-section" title="What you'd sell">
        <form onSubmit={check} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {ownAssets.length > 0 && (
            <LChipRow label="Fill in from what you own (in the order you added them)">
              {ownAssets.map(({ a, i }) => (
                <LChip key={i} on={fromAsset === i} onClick={() => fillFrom(i)}>
                  {a.label || assetTypeLabel(country, a.asset_type)}
                </LChip>
              ))}
            </LChipRow>
          )}
          {!hasAssets && (
            <LNote style={{ margin: 0 }}>
              Or <a href="/profile/assets" style={{ color: L_T.accent }}>add what you own</a> on Portfolio, and fill this in from it.
            </LNote>
          )}
          <LChipRow label="What kind of asset?">
            {typeChips.map(([type, label]) => (
              <LChip key={type} on={assetType === type} onClick={() => pickType(type)}>
                {label}
              </LChip>
            ))}
          </LChipRow>
          {assetName && <LNote style={{ margin: 0 }}>{assetName}: taxed as {assetTypeLabel(country, assetType).toLowerCase()}.</LNote>}
          <LFieldGrid min={200}>
            <Field
              label="What you paid"
              kind="money"
              currency={userCcy}
              value={purchasePrice}
              onChange={setPurchasePrice}
              error={at('purchasePrice')}
              findIt={whereToFind('purchasePrice', { country: isUS ? 'US' : 'IN' })}
              hint={saleMode === 'partial' ? 'For all of it; split by how much you sell' : undefined}
            />
            <Field
              label="When you bought it"
              kind="text"
              value={purchaseDate}
              onChange={setPurchaseDate}
              error={at('purchaseDate')}
              placeholder="2018 or 2018-06"
              hint={
                isUS
                  ? 'Just the year is fine. Held over a year: a long-term gain'
                  : isProperty
                    ? 'Just the year is fine. Held over 2 years: a long-term gain; bought before 23 Jul 2024, indexed cost can apply'
                    : 'Just the year is fine. It sets whether the gain is short- or long-term'
              }
            />
          </LFieldGrid>

          {isUS && isProperty && (
            <div>
              <LChipRow label="Is it your main home?">
                <LChip on={mainHome === 'yes'} onClick={() => setMainHome('yes')}>
                  Yes, lived in 2 of the last 5 years
                </LChip>
                <LChip on={mainHome === 'no'} onClick={() => setMainHome('no')}>
                  No: rental, second home or land
                </LChip>
              </LChipRow>
              {at('mainHome') && (
                <p role="alert" style={{ margin: '6px 0 0', fontSize: 12, color: L_T.negative }}>
                  {at('mainHome')}
                </p>
              )}
              <LNote style={{ margin: '6px 0 0' }}>A main home can leave up to $250,000 of gain untaxed ($500,000 filing jointly).</LNote>
            </div>
          )}

          <LChipRow label="How much of it?">
            <LChip on={saleMode === 'whole'} onClick={() => setSaleMode('whole')}>
              All of it
            </LChip>
            <LChip on={saleMode === 'partial'} onClick={() => setSaleMode('partial')}>
              Part of it
            </LChip>
          </LChipRow>
          {saleMode === 'whole' ? (
            <div style={{ maxWidth: 360 }}>
              <Field
                label="What it would sell for"
                kind="money"
                currency={userCcy}
                value={salePrice}
                onChange={setSalePrice}
                error={at('salePrice')}
                hint="Before tax and selling costs"
              />
            </div>
          ) : (
            <div>
              <LFieldGrid min={170}>
                <Field label="Counted in" kind="text" value={unitLabel} onChange={setUnitLabel} placeholder="sq.ft, acres, shares" />
                <Field label={`You own (${unitLabel})`} value={totalQty} onChange={setTotalQty} error={at('totalQty')} />
                <Field label={`You'd sell (${unitLabel})`} value={qty} onChange={setQty} error={at('qty')} />
                <Field
                  label={`Price per ${unitLabel}`}
                  kind="money"
                  currency={userCcy}
                  value={unitPrice}
                  onChange={setUnitPrice}
                  error={at('unitPrice') ?? at('salePrice')}
                />
              </LFieldGrid>
              <LNote style={{ margin: '8px 0 0' }}>
                Sells for {fmt(effectiveSalePrice)}; its share of what you paid is {fmt(effectivePurchasePrice)}.
              </LNote>
            </div>
          )}

          <div>
            <LStepSub>The loan it would clear</LStepSub>
            {loanChips.length > 0 && (
              <div style={{ margin: '10px 0 12px' }}>
                <LChipRow label="Which loan? Dearest first">
                  {loanChips.map(({ l, i }) => (
                    <LChip key={i} on={targetIdx === String(i)} onClick={() => pickTargetLoan(String(i))}>
                      {loanLabel(l)} · {pctText(l.nominal_rate)}
                    </LChip>
                  ))}
                  <LChip on={targetIdx === ''} onClick={() => pickTargetLoan('')}>
                    One not saved yet
                  </LChip>
                </LChipRow>
              </div>
            )}
            <LFieldGrid min={200}>
              <Field
                label="Still owed"
                kind="money"
                currency={userCcy}
                value={debtBalance}
                onChange={(x) => {
                  setDebtBalance(x);
                  setConvertedFrom(null);
                }}
                error={at('debtBalance')}
                findIt={whereToFind('balance', { country: isUS ? 'US' : 'IN' })}
                hint={convertedFrom ?? undefined}
              />
              <Field
                label="Its rate (%)"
                kind="percent"
                value={debtRate}
                onChange={(v) => { setDebtRate(v); clearField('debtRate'); }}
                // R7-5: checked as it's typed (0 to 100% a year, as Loan Check),
                // so an absurd rate never reaches the API's fraction bound.
                error={rateOutOfRange(debtRate) ?? at('debtRate')}
                hint="After any tax break on it"
              />
              <Field
                label="Monthly payment (optional)"
                kind="money"
                currency={userCcy}
                value={debtPayment}
                onChange={setDebtPayment}
                error={at('debtPayment')}
                findIt={whereToFind('emi', { country: isUS ? 'US' : 'IN' })}
                hint="Blank: the loan grows unpaid, a stress case"
              />
              <Field
                label="Your taxable income, a year"
                kind="money"
                currency={userCcy}
                value={taxableIncome}
                onChange={setTaxableIncome}
                error={at('taxableIncome')}
                findIt={whereToFind('taxableIncome', { country: isUS ? 'US' : 'IN' })}
                hint={incomeOnFile !== '' && taxableIncome === incomeOnFile ? 'From your profile. Sets the tax on the gain.' : 'Sets the tax on the gain'}
              />
            </LFieldGrid>
          </div>

          <div>
            <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
            {!more && (
              <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>
                {assetReturn.trim() === ''
                  ? 'Enter how much it grows a year if you keep it'
                  : `Your assumptions: it grows ${formatPct(assetReturn, 1)} a year · ${holdYears} years · spare cash earns ${formatPct(leftoverYield, 1)}`}
              </span>
            )}
            {at('assetReturn') && !more && (
              <p role="alert" style={{ margin: '6px 0 0', fontSize: 12, color: L_T.negative }}>{at('assetReturn')}</p>
            )}
            {more && (
              <div style={{ marginTop: 10 }}>
                <LFieldGrid min={200}>
                  <Field
                    label="It grows a year if you keep it (%)"
                    kind="percent"
                    value={assetReturn}
                    onChange={setAssetReturn}
                    error={at('assetReturn')}
                    hint="Your own estimate. Change the default on Profile → Assumptions"
                  />
                  <Field label="Years you'd keep it" value={holdYears} onChange={setHoldYears} error={at('holdYears')} />
                  <Field
                    label="Spare cash earns (%)"
                    kind="percent"
                    value={leftoverYield}
                    onChange={setLeftoverYield}
                    error={at('leftoverYield')}
                    hint={
                      isUS
                        ? `${SAFE_RATES.hysa_us.source}, ${formatAsOf(SAFE_RATES.hysa_us.asOf)}`
                        : `${SAFE_RATES.liquid_in.source}, ${formatAsOf(SAFE_RATES.liquid_in.asOf)}`
                    }
                  />
                  <Field
                    label="Prices rise a year (%)"
                    kind="percent"
                    value={inflation}
                    onChange={setInflation}
                    error={at('inflation')}
                    hint={
                      ownInflation && inflation === ownInflation
                        ? 'Your own rate, set on Plan'
                        : inflation === INFLATION_FORECAST[country].rate
                          ? `${INFLATION_FORECAST[country].who}’s ${INFLATION_FORECAST[country].what}`
                          : undefined
                    }
                  />
                </LFieldGrid>
              </div>
            )}
          </div>

          <SubmitBar busy={busy} error={err} label="Work it out" />
        </form>
      </LStep>

      {v && (
        <>
          <LStep no="02" id="liq-out" title="What selling it would do" answer>
            <LVerdict>{saleSummary(v, fmt, Number(debtBalance || 0))}</LVerdict>
            <LKpi
              items={[
                { l: 'YOU GET', v: fmt(v.net_proceeds), s: 'after tax and selling costs' },
                { l: 'TAX', v: fmt(v.ltcg_tax), s: isUS ? 'federal and state' : 'on the gain', tone: Number(v.ltcg_tax) > 0 ? L_T.negative : undefined },
                {
                  l: 'LEFT AFTER THE LOAN',
                  v: fmt(v.net_benefit),
                  s: 'and its interest while selling',
                  tone: Number(v.net_benefit) < 0 ? L_T.negative : undefined,
                },
                { l: 'IT REALLY EARNS', v: formatPct(v.asset_real_return_net, 2), s: 'a year if kept, after prices and costs' },
              ]}
            />

            {v.wealth_edge != null && (
              <div style={{ marginTop: 18 }}>
                <LStepSub right={`SPARE CASH AT ${formatPct(leftoverYield, 1).toUpperCase()}`}>{`On your assumptions, in ${v.horizon_years ?? holdYears} years`}</LStepSub>
                <div style={{ marginTop: 10 }}>
                  <LKpi
                    items={[
                      {
                        l: 'IF YOU KEEP IT',
                        v: fmt(v.wealth_hold ?? '0'),
                        s: v.wealth_basis === 'amortising' ? 'and pay the loan down' : 'loan left unpaid',
                      },
                      { l: 'IF YOU SELL IT', v: fmt(v.wealth_sell ?? '0'), s: 'clear the loan, the rest saved' },
                      {
                        l: 'DIFFERENCE',
                        v: fmt(String(Math.abs(Number(v.wealth_edge)))),
                        s: Number(v.wealth_edge) > 0 ? 'more if sold' : Number(v.wealth_edge) < 0 ? 'more if kept' : 'the same either way',
                      },
                    ]}
                  />
                </div>
                <LNote style={{ margin: '10px 0 0' }}>
                  {v.wealth_basis === 'amortising'
                    ? `Both ways pay ${fmt(debtPayment)} a month: to the loan until it's gone, then into savings. Kept, it grows ${formatPct(assetReturn, 1)} a year: that's your estimate, and the answer moves with it.`
                    : 'With no monthly payment, keeping it lets the loan grow unpaid. Enter the payment for the usual case.'}
                </LNote>
              </div>
            )}

            {partialSaleHint && (
              <LNote style={{ margin: '14px 0 0', color: L_T.ink }}>
                You&apos;d have {fmt(partialSaleHint.surplus)} left after clearing the loan. Selling about{' '}
                {(Number(partialSaleHint.fractionNeeded) * 100).toFixed(0)}% would cover the loan alone: pick PART OF IT above to work that out.
              </LNote>
            )}

            <p style={{ margin: '14px 0 0', fontSize: 12, color: L_T.muted }}>
              Terms: <Term id="ltcg" />{!isUS && <> · <Term id="indexation" /> · <Term id="vda" /></>}
            </p>
            <div style={{ marginTop: 18 }}>
              <LStepSub>What these numbers leave out</LStepSub>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: L_T.inkSoft }}>
                <li>What it means to you, and whether you&apos;ll need it later (a home, gold for a wedding, money for retiring).</li>
                <li>Prices can fall as well as rise: the growth rate is your estimate, not a forecast.</li>
                <li>Rent or other income it pays you, unless you entered it on Portfolio.</li>
                <li>Whether waiting (past a holding period, or a lock-in) would change the tax.</li>
              </ul>
            </div>

            {!!v.tax_notes?.length && (
              <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: L_T.muted }}>
                {v.tax_notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}

            <DecisionLogControls
              kind="liquidation"
              context={`Sale worked out: ${assetName || assetTypeLabel(country, assetType)}`}
              estimatedAmount={v.net_proceeds}
              reasoning={v.rationale}
              source="tools/liquidate"
              ccySym={userCcy === 'INR' ? '₹' : '$'}
            />
            {target && proceedsInLoan && profile.isLive && Number(proceedsInLoan) > 0 && (
              <ApplyAction
                applied={applied}
                onApply={() => {
                  if (applied || busy || checked !== fingerprint) return;
                  const currentKey = JSON.stringify(loadProfileClient().user) + (document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1] ?? '');
                  if (currentKey !== resultProfileKey) {
                    setErr('Your balances changed. Check the sale again before logging the payment.');
                    return;
                  }
                  try {
                    const sched = target.scheduled_emi || '0';
                    const proceeds = new Decimal(proceedsInLoan);
                    const fullyClears = proceeds.gte(new Decimal(target.outstanding));
                    applyToolResult({
                      loanIndex: Number(targetIdx),
                      kind: fullyClears ? 'closed' : 'paid_extra',
                      amount: fullyClears ? proceeds.toFixed(2) : String(Number(sched) + proceeds.toNumber()),
                      scheduledEmi: sched,
                      note: `Asset sold: ${fmtLoan(proceeds.toFixed(2))} paid to the ${loanName(target)}`,
                      loans: profile.user.loans,
                      country: profile.user.country,
                    });
                    setApplied(true);
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
                label={`I sold it · log ${fmtLoan(proceedsInLoan)} paid to the ${loanName(target)}`}
              />
            )}
          </LStep>

          <LMathBlock
            rows={[
              { k: 'it sells for', v: fmt(effectiveSalePrice) },
              { k: 'you paid', v: fmt(effectivePurchasePrice) },
              { k: 'tax', v: fmt(v.ltcg_tax), tone: Number(v.ltcg_tax) > 0 ? ('neg' as const) : undefined },
              ...(sellingCosts >= 1 ? [{ k: 'selling costs', v: fmt(sellingCosts.toFixed(0)), note: 'brokerage and fees' }] : []),
              { k: 'you get', v: fmt(v.net_proceeds), note: 'sale − tax − costs' },
              { k: 'the loan', v: fmt(debtBalance), note: `${formatPct(debtRate, 2)} a year` },
              ...(v.surplus != null ? [{ k: 'left over', v: fmt(v.surplus), note: 'after clearing the loan' }] : []),
              {
                k: 'left after the loan',
                v: fmt(v.net_benefit),
                note: 'less its interest while selling',
                tone: Number(v.net_benefit) > 0 ? ('pos' as const) : ('neg' as const),
              },
              { k: 'it really earns', v: formatPct(v.asset_real_return_net, 2), note: `${formatPct(assetReturn, 1)} less prices, upkeep and selling, a year` },
              ...(v.wealth_edge != null
                ? [
                    {
                      k: `keep vs sell, ${v.horizon_years ?? holdYears} years`,
                      v: `${fmt(v.wealth_hold ?? '0')} vs ${fmt(v.wealth_sell ?? '0')}`,
                      tone: Number(v.wealth_edge) > 0 ? ('pos' as const) : undefined,
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
    </LSteps>
  );
}

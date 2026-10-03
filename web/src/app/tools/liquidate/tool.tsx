'use client';

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
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { loadProfileClient } from '@/lib/user-store';
import { useFormErrors } from '@/lib/form-errors';
import { applyToolResult } from '@/lib/apply-tool-result';
import { loanCurrency, loanToUser, userDefaultCurrency } from '@/lib/currency';
import { SAFE_RATES, formatAsOf } from '@/lib/invest-vs-prepay';
import { loanLabel, loanName } from '@/lib/loan-types';
import { DecisionLogControls } from '@/components/DecisionLogControls';
import { PortfolioRanker } from './PortfolioRanker';
import { assetTypeLabel } from '@/components/portfolio/portfolioSummary';
import { requiredMonthly } from '@/lib/min-payment';
import { INFLATION_FORECAST, inflationRateFor, readInflationRateClient } from '@/lib/inflation-modeling';

// Per country: India's default describes Indian deposits; a US seller's
// leftover cash sits in a savings account. Prices rise at the central
// bank's forecast, or the user's own rate from Plan.
const DEFAULT_LEFTOVER_YIELD = { IN: '0.068', US: SAFE_RATES.hysa_us.rate } as const;

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

export function LiquidateTool() {
  const profile = useStoredProfile();
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
  const [assetReturn, setAssetReturn] = useState('0.06');
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
  const { err, setErr, clear, fail, failField, at } = useFormErrors();
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
      const loan = profile.user.loans[i];
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
  }, [profile.user.loans]);

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
      ...(isUS && isProperty
        ? [['mainHome', mainHome, 'Say whether this is your main home: it sets the tax on the sale.'] as [string, string, string]]
        : []),
    ];
    const missing = required.find(([, value]) => value.trim() === '');
    if (missing) {
      failField(missing[0], missing[2]);
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
      const requestProfileKey = JSON.stringify(loadProfileClient().user) + (document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1] ?? '');
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

  // Drill-in handler: pre-fill the sandbox form from a ranker recommendation.
  // Only supports real-estate fully (sandbox is RE-focused). For other types
  // we still pre-fill what we can and let the user see the existing UI.
  function drillIn(rec: LiquidationRecommendation) {
    if (!profile.user.assets) return;
    const asset = profile.user.assets[rec.asset_index];
    if (!asset) return;
    setAssetType(asset.asset_type);
    setAssetName(asset.label ?? '');
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
    const recLoan = profile.user.loans[rec.target_loan_index];
    setDebtPayment(recLoan ? monthlyDue(recLoan) : '');
    setConvertedFrom(null);
    // Scroll the sandbox section into view.
    if (typeof document !== 'undefined') {
      document.getElementById('sandbox-section')?.scrollIntoView({
        behavior: 'smooth', block: 'start',
      });
    }
  }

  const loanChips = profile.user.loans
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => Number(l.outstanding) > 0)
    .sort((x, y) => Number(y.l.nominal_rate) - Number(x.l.nominal_rate));
  const target = targetIdx !== '' ? profile.user.loans[Number(targetIdx)] : undefined;
  // How much of what the sale raises goes to the loan: a small share means
  // the answer is about the asset, not the loan.
  const loanShare = v && Number(v.net_proceeds) > 0 ? Number(debtBalance || 0) / Number(v.net_proceeds) : 1;
  const pctText = (f: string) => `${(Number(f) * 100).toFixed(2)}%`;
  const gate = (ok: boolean) => (
    <span aria-hidden style={{ color: ok ? L_T.positive : L_T.negative, fontWeight: 700, marginRight: 8 }}>
      {ok ? '✓' : '✗'}
    </span>
  );
  const sellingCosts = v ? Number(effectiveSalePrice) - Number(v.ltcg_tax) - Number(v.net_proceeds) : 0;
  const proceedsInLoan = v && target ? new Decimal(v.net_proceeds).div(loanFx(target) ?? 1).toFixed(2) : null;

  return (
    <LSteps>
      {hasAssets ? (
        <PortfolioRanker
          user={profile.user}
          marginalRate={profile.marginalRate}
          isLive={profile.isLive}
          onDrillIn={drillIn}
        />
      ) : (
        <LNote style={{ margin: 0 }}>
          <a href="/profile/assets" style={{ color: L_T.accent }}>Add your assets</a> (shares, funds, gold, property) to rank
          each one against each loan, after tax and costs. Or work out a property sale below.
        </LNote>
      )}

      <LStep no="01" id="sandbox-section" title={isProperty ? "The property you'd sell" : "What you'd sell"}>
        <form onSubmit={check} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!isProperty && (
            <LNote style={{ margin: 0 }}>
              {assetName || assetTypeLabel(country, assetType)}, from your assets: taxed as{' '}
              {assetTypeLabel(country, assetType).toLowerCase()}, not as property.{' '}
              <button
                type="button"
                onClick={() => {
                  setAssetType('real_estate');
                  setAssetName('');
                }}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: L_T.accent, textDecoration: 'underline', cursor: 'pointer' }}
              >
                Work out a property instead
              </button>
            </LNote>
          )}
          <LFieldGrid min={200}>
            <Field
              label="What you paid"
              kind="money"
              currency={userCcy}
              value={purchasePrice}
              onChange={setPurchasePrice}
              error={at('purchasePrice')}
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
                !isProperty
                  ? 'Just the year is fine'
                  : isUS
                    ? 'Just the year is fine. Held over a year: a long-term gain'
                    : 'Just the year is fine. Held over 2 years: a long-term gain; bought before 23 Jul 2024, indexed cost can apply'
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
                hint={convertedFrom ?? undefined}
              />
              <Field
                label="Its rate (%)"
                kind="percent"
                value={debtRate}
                onChange={setDebtRate}
                error={at('debtRate')}
                hint="After any tax break on it"
              />
              <Field
                label="Monthly payment (optional)"
                kind="money"
                currency={userCcy}
                value={debtPayment}
                onChange={setDebtPayment}
                error={at('debtPayment')}
                hint="Blank: the loan grows unpaid, a stress case"
              />
              <Field
                label="Your taxable income, a year"
                kind="money"
                currency={userCcy}
                value={taxableIncome}
                onChange={setTaxableIncome}
                error={at('taxableIncome')}
                hint={incomeOnFile !== '' && taxableIncome === incomeOnFile ? 'From your profile. Sets the tax on the gain.' : 'Sets the tax on the gain'}
              />
            </LFieldGrid>
          </div>

          <div>
            <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
            {!more && (
              <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>
                Grows {formatPct(assetReturn, 1)} a year · {holdYears} years · spare cash earns {formatPct(leftoverYield, 1)}
              </span>
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
                    hint={isUS ? 'What homes near yours have done' : 'Property in India: about 5–7%'}
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
                        : 'A liquid fund or 1-year FD'
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

          <SubmitBar busy={busy} error={err} label="Should I sell?" />
        </form>
      </LStep>

      {v && (
        <>
          <LStep no="02" id="liq-out" title="The answer" answer>
            <LVerdict tone={v.recommend_liquidation ? 'pos' : null}>
              {v.recommend_liquidation
                ? loanShare < 0.25
                  ? 'Selling pays, but mostly not because of the loan.'
                  : 'Sell it and clear the loan.'
                : 'Keep it.'}
            </LVerdict>
            <LNote>
              {v.rationale}
              {v.recommend_liquidation && loanShare < 0.25 && (
                <>
                  {' '}The loan is {Math.max(1, Math.round(loanShare * 100))}% of what the sale raises: the rest of the answer is
                  this asset against spare cash at {formatPct(leftoverYield, 1)}.
                </>
              )}
            </LNote>
            <LKpi
              items={[
                { l: 'YOU GET', v: fmt(v.net_proceeds), s: 'after tax and selling costs' },
                { l: 'TAX', v: fmt(v.ltcg_tax), s: isUS ? 'federal and state' : 'on the gain', tone: Number(v.ltcg_tax) > 0 ? L_T.negative : undefined },
                {
                  l: 'LEFT AFTER THE LOAN',
                  v: fmt(v.net_benefit),
                  s: 'and its interest while selling',
                  tone: Number(v.net_benefit) > 0 ? L_T.positive : L_T.negative,
                },
                { l: 'IT REALLY EARNS', v: formatPct(v.asset_real_return_net, 2), s: 'a year, after prices and costs' },
              ]}
            />

            {v.wealth_edge != null && (
              <div style={{ marginTop: 18 }}>
                <LStepSub right={`SPARE CASH AT ${formatPct(leftoverYield, 1).toUpperCase()}`}>{`In ${v.horizon_years ?? holdYears} years`}</LStepSub>
                <div style={{ marginTop: 10 }}>
                  <LKpi
                    items={[
                      {
                        l: 'KEEP IT',
                        v: fmt(v.wealth_hold ?? '0'),
                        s: v.wealth_basis === 'amortising' ? 'and pay the loan down' : 'loan left unpaid',
                      },
                      { l: 'SELL IT', v: fmt(v.wealth_sell ?? '0'), s: 'clear the loan, invest the rest' },
                      {
                        l: Number(v.wealth_edge) >= 0 ? 'SELLING AHEAD BY' : 'KEEPING AHEAD BY',
                        v: fmt(String(Math.abs(Number(v.wealth_edge)))),
                        s: v.wealth_edge_needed != null ? `selling needs ${fmt(v.wealth_edge_needed)}` : undefined,
                        tone: Number(v.wealth_edge) > 0 ? L_T.positive : L_T.negative,
                      },
                    ]}
                  />
                </div>
                <LNote style={{ margin: '10px 0 0' }}>
                  {v.wealth_basis === 'amortising'
                    ? `Both ways pay ${fmt(debtPayment)} a month: to the loan until it's gone, then into savings.`
                    : 'With no monthly payment, keeping it lets the loan grow unpaid. Enter the payment for the usual case.'}
                </LNote>
              </div>
            )}

            {partialSaleHint && (
              <LNote style={{ margin: '14px 0 0', color: L_T.ink }}>
                You&apos;d have {fmt(partialSaleHint.surplus)} left after clearing the loan. If it can be split, selling about{' '}
                {(Number(partialSaleHint.fractionNeeded) * 100).toFixed(0)}% clears the loan and keeps the rest: pick PART OF IT above.
              </LNote>
            )}

            <div style={{ marginTop: 18 }}>
              <LStepSub right="ALL MUST PASS">The tests</LStepSub>
              <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
                {v.gate_0_wealth_edge !== null && (
                  <li>
                    {gate(v.gate_0_wealth_edge)}Selling leaves you better off by 10% of its value
                  </li>
                )}
                <li>
                  {gate(v.gate_1_net_benefit)}What&apos;s left after the loan is at least 10% of its value
                </li>
                <li>
                  {gate(v.gate_2_high_rate)}The loan costs over 20% a year
                </li>
                <li>
                  {gate(v.gate_3_spread)}The loan costs 3 points more than the asset earns
                </li>
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
              context={v.recommend_liquidation ? 'Sell asset — recommended' : 'Sell asset — hold instead'}
              estimatedAmount={v.net_proceeds}
              reasoning={v.rationale}
              source="tools/liquidate"
              ccySym={userCcy === 'INR' ? '₹' : '$'}
            />
            {v.recommend_liquidation && target && proceedsInLoan && profile.isLive && (
              <ApplyAction
                applied={applied}
                onApply={() => {
                  if (applied || busy || checked !== fingerprint) return;
                  const currentKey = JSON.stringify(loadProfileClient().user) + (document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1] ?? '');
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

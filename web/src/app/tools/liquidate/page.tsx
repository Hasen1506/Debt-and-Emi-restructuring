'use client';

import { useState } from 'react';
import { Card } from '@/components/Card';
import {
  Field,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import {
  api,
  formatINR,
  formatPct,
  type AssetLiquidationResponse,
} from '@/lib/api';
import { DEMO_ASSET } from '@/lib/demo-user';

const FINANCE_ACT_2024_CUTOFF = '2024-07-23';

function fyFromISO(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  // Indian FY runs Apr → Mar
  return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}`
                : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}

export default function LiquidatePage() {
  const [purchasePrice, setPurchasePrice] = useState(DEMO_ASSET.purchase_price);
  const [purchaseDate, setPurchaseDate] = useState(DEMO_ASSET.purchase_date);
  const [salePrice, setSalePrice] = useState(DEMO_ASSET.current_market_value);
  const [state, setState] = useState(DEMO_ASSET.state ?? 'Maharashtra');
  const [debtBalance, setDebtBalance] = useState('1500000');
  const [debtRate, setDebtRate] = useState('0.36');
  const [taxableIncome, setTaxableIncome] = useState('1800000');
  const [assetReturn, setAssetReturn] = useState('0.06');
  const [holdYears, setHoldYears] = useState('5');
  const [v, setV] = useState<AssetLiquidationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const isPre = purchaseDate < FINANCE_ACT_2024_CUTOFF;
      const payload = {
        asset: {
          asset_type: 'real_estate',
          purchase_price: purchasePrice,
          purchase_date: purchaseDate,
          current_market_value: salePrice,
          state,
        },
        sale_price: salePrice,
        debt_balance: debtBalance,
        debt_effective_rate: debtRate,
        taxable_income: taxableIncome,
        asset_nominal_return: assetReturn,
        expected_hold_years_post_sale: holdYears,
        ...(isPre
          ? { purchase_fy: fyFromISO(purchaseDate), current_fy: '2024-25' }
          : {}),
      };
      setV(await api.assetLiquidation(payload));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Should I sell this asset to clear debt?</h1>
        <p className="muted">
          Runs the §4.18 gates: net benefit after LTCG and selling costs,
          high-rate debt check, and whether the asset is actually
          out-earning the debt rate.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field
            label="Purchase price"
            value={purchasePrice}
            onChange={setPurchasePrice}
          />
          <Field
            label="Purchase date (YYYY-MM-DD)"
            value={purchaseDate}
            onChange={setPurchaseDate}
            hint="Determines Finance Act 2024 indexation eligibility"
          />
          <Field
            label="Expected sale price"
            value={salePrice}
            onChange={setSalePrice}
          />
          <Field
            label="State (for selling-cost lookup)"
            value={state}
            onChange={setState}
          />
          <Field
            label="Debt balance to clear"
            value={debtBalance}
            onChange={setDebtBalance}
          />
          <Field
            label="Debt effective rate (decimal)"
            value={debtRate}
            onChange={setDebtRate}
            hint="e.g. 0.36 for 36% (credit card)"
          />
          <Field
            label="Your taxable income"
            value={taxableIncome}
            onChange={setTaxableIncome}
            hint="Drives the LTCG surcharge band"
          />
          <Field
            label="Asset's expected nominal return (decimal)"
            value={assetReturn}
            onChange={setAssetReturn}
          />
          <Field
            label="Years you'd hold if you don't sell"
            value={holdYears}
            onChange={setHoldYears}
          />
          <div />
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Stat label="Net proceeds (after LTCG)" value={formatINR(v.net_proceeds)} />
            <Stat label="LTCG tax" value={formatINR(v.ltcg_tax)} color="var(--negative)" />
            <Stat
              label="Net benefit after debt + sale-period interest"
              value={formatINR(v.net_benefit)}
              color={Number(v.net_benefit) > 0 ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label="Asset's real return (net of drag)"
              value={formatPct(v.asset_real_return_net, 2)}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            <Stat
              label="Gate 1 · benefit ≥ 10%"
              value={v.gate_1_net_benefit ? 'Pass' : 'Fail'}
              color={v.gate_1_net_benefit ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label="Gate 2 · high-rate debt"
              value={v.gate_2_high_rate ? 'Pass' : 'Fail'}
              color={v.gate_2_high_rate ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label="Gate 3 · debt > asset return"
              value={v.gate_3_spread ? 'Pass' : 'Fail'}
              color={v.gate_3_spread ? 'var(--positive)' : 'var(--negative)'}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

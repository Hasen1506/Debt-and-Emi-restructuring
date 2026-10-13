'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, Select } from '@/components/ToolPrimitives';
import type { AssetPayload, AssetType, Country } from '@/lib/api';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { parseAmountText } from '@/lib/amount';
import { assetAmountError, marketValueError, rowStarted } from '@/lib/r8-inputs';

// Asset-type choices per country. Shares engine asset_type strings; only
// the label changes (e.g. fixed_deposit → "CD" on US).
const ASSET_TYPES_IN: { value: AssetType; label: string }[] = [
  { value: 'savings_balance', label: 'Savings / current account' },
  { value: 'fixed_deposit',   label: 'Fixed deposit (FD)' },
  { value: 'equity_stocks',   label: 'Equity stocks (direct)' },
  { value: 'equity_mf',       label: 'Equity mutual fund' },
  { value: 'debt_mf',         label: 'Debt mutual fund' },
  // Physical gold and gold ETFs are taxed differently: an ETF's listed
  // units are long-term after 12 months, physical gold after 24 (sprint G10).
  { value: 'gold_physical',   label: 'Gold (physical, or a gold mutual fund)' },
  { value: 'gold_etf',        label: 'Gold ETF (exchange-listed)' },
  { value: 'sgb',             label: 'Sovereign Gold Bond (SGB)' },
  { value: 'real_estate',     label: 'Real estate' },
  { value: 'ppf',             label: 'PPF' },
  { value: 'epf',             label: 'EPF' },
  { value: 'nps',             label: 'NPS' },
  { value: 'crypto',          label: 'Crypto (virtual digital asset)' },
  { value: 'other',           label: 'Other' },
];

const ASSET_TYPES_US: { value: AssetType; label: string }[] = [
  { value: 'savings_balance', label: 'HYSA / checking' },
  { value: 'fixed_deposit',   label: 'CD (certificate of deposit)' },
  { value: 'equity_stocks',   label: 'Equity stocks (direct)' },
  { value: 'equity_mf',       label: 'Equity mutual fund / ETF' },
  { value: 'debt_mf',         label: 'Bond fund' },
  { value: 'gold_physical',   label: 'Gold (physical)' },
  { value: 'gold_etf',        label: 'Gold ETF (e.g. a bullion trust)' },
  { value: 'real_estate',     label: 'Real estate' },
  { value: 'epf',             label: '401(k) / IRA  (blocked but trackable)' },
  { value: 'crypto',          label: 'Crypto (digital asset)' },
  { value: 'other',           label: 'Other' },
];

function blankAsset(): AssetPayload {
  return {
    asset_type: 'savings_balance',
    label: '',
    purchase_price: '',
    purchase_date: '',
    current_market_value: '',
  };
}

export default function OnboardingAssetsPage() {
  const router = useRouter();
  const [country, setCountry] = useState<Country>('IN');
  const [assets, setAssets] = useState<AssetPayload[]>([blankAsset()]);
  const [approxFlags, setApproxFlags] = useState<boolean[]>([false]);
  const [isLive, setIsLive] = useState(false);

  // Rehydrate from cookie
  useEffect(() => {
    const stored = loadProfileClient();
    setIsLive(stored.isLive);
    setCountry(stored.user.country);
    if (stored.user.assets && stored.user.assets.length > 0) {
      setAssets(stored.user.assets);
      setApproxFlags(stored.user.assets.map(() => false));
    }
  }, []);

  // Errors show once Save has been tried, not while typing.
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // An asset's tax turns on how long it was held, so it needs a date (a year will do).
  const missingDate = (a: AssetPayload) =>
    Boolean(a.asset_type) && Number(a.current_market_value) > 0 && !String(a.purchase_date ?? '').trim();

  function update(idx: number, patch: Partial<AssetPayload>) {
    setAssets((cur) => cur.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  function setApprox(idx: number, on: boolean) {
    setApproxFlags((cur) => cur.map((f, i) => (i === idx ? on : f)));
  }

  function add() {
    setAssets((cur) => [...cur, blankAsset()]);
    setApproxFlags((cur) => [...cur, false]);
  }

  function remove(idx: number) {
    setAssets((cur) => cur.filter((_, i) => i !== idx));
    setApproxFlags((cur) => cur.filter((_, i) => i !== idx));
  }

  function save() {
    if (!isLive) {
      router.push('/profile?step=country');
      return;
    }
    setTried(true);
    setSaveError(null);
    if (assets.some(missingDate)) return;
    // R8-9: a started row with a bad amount blocks the save with a message;
    // it is never dropped silently.
    const ccy = country === 'US' ? 'USD' : 'INR';
    if (assets.some((a) => marketValueError(a, ccy, true) || assetAmountError(a.purchase_price ?? '', ccy))) {
      setSaveError('Not saved yet: fix the highlighted field.');
      return;
    }
    const amount = (v: string | undefined) => (v ?? '').trim() === '' ? '' : (parseAmountText(v ?? '', ccy).value ?? '');
    const stored = loadProfileClient();
    const cleaned: AssetPayload[] = assets
      .filter((a) => a.asset_type && rowStarted(a) && Number(amount(a.current_market_value)) > 0)
      .map((a) => {
        // For approximate basis: ensure purchase_date is year-only ("YYYY")
        // — engine accepts it, ranker adds a wider error band.
        const out: AssetPayload = {
          ...a,
          asset_type: a.asset_type,
          label: a.label?.trim() || undefined,
          purchase_price: amount(a.purchase_price) || '0',
          purchase_date: a.purchase_date || '',
          current_market_value: amount(a.current_market_value),
        };
        // Pass through optional fields if filled.
        if (a.rental_income_annual) out.rental_income_annual = a.rental_income_annual;
        if (a.holding_costs_annual) out.holding_costs_annual = a.holding_costs_annual;
        if (a.state) out.state = a.state;
        if (a.expected_return_pct) out.expected_return_pct = a.expected_return_pct;
        if (a.user_marks_liquid !== undefined) out.user_marks_liquid = a.user_marks_liquid;
        if (a.fd_rate_pct) out.fd_rate_pct = a.fd_rate_pct;
        if (a.fd_maturity_date) out.fd_maturity_date = a.fd_maturity_date;
        if (a.fd_premature_penalty_pct) out.fd_premature_penalty_pct = a.fd_premature_penalty_pct;
        if (a.ppf_opened_date) out.ppf_opened_date = a.ppf_opened_date;
        if (a.sgb_at_maturity !== undefined) out.sgb_at_maturity = a.sgb_at_maturity;
        if (a.us_section_121_eligible !== undefined) {
          out.us_section_121_eligible = a.us_section_121_eligible;
        }
        if (a.appreciation_cagr) out.appreciation_cagr = a.appreciation_cagr;
        if (a.us_is_tax_exempt_muni !== undefined) {
          out.us_is_tax_exempt_muni = a.us_is_tax_exempt_muni;
        }
        return out;
      });
    const saved = saveProfileClient({
      user: { ...stored.user, assets: cleaned },
    });
    if (!saved) {
      setSaveError('Your assets could not be saved. Your previous saved assets are still available. Try again before continuing.');
      return;
    }
    router.push('/portfolio');
  }

  const choices = country === 'US' ? ASSET_TYPES_US : ASSET_TYPES_IN;
  const currencySymbol = country === 'IN' ? '₹' : '$';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">PORTFOLIO · ADD WHAT YOU OWN</h1>
        <p className="muted">
          Optional. These show on Portfolio, and the Sell to repay calculator can fill in a sale from any of them.
          Each kind is taxed by its own rule when sold (a gold ETF is long-term after 12 months, physical gold after
          24), so pick the closest kind.
        </p>
        {saveError && <p role="alert" style={{ color: 'var(--negative)' }}>{saveError}</p>}
        {!isLive && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--warn, #b45309)' }}>
            Finish setup first. Saving here takes you there; come back after.
          </p>
        )}
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {assets.map((a, i) => {
          const isApprox = approxFlags[i];
          const isFD = a.asset_type === 'fixed_deposit';
          const isPPF = a.asset_type === 'ppf';
          const isSGB = a.asset_type === 'sgb';
          const isRE = a.asset_type === 'real_estate';
          return (
            <div
              key={i}
              style={{
                display: 'grid',
                gap: 12,
                // Two columns where they fit; one on a phone.
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                padding: 12,
                border: '1px solid var(--border)',
                borderRadius: 6,
                position: 'relative',
              }}
            >
              <Select
                label="Asset type"
                value={a.asset_type as AssetType}
                onChange={(v) => update(i, { asset_type: v })}
                options={choices}
              />
              <Field
                label="Label (optional)"
                value={a.label ?? ''}
                onChange={(v) => update(i, { label: v })}
                kind="text"
                placeholder={isFD ? 'HDFC FD #2' : isRE ? 'Bangalore flat' : 'My ICICI prudential MF'}
              />
              <Field
                label={`Current market value (${currencySymbol})`}
                value={a.current_market_value}
                onChange={(v) => update(i, { current_market_value: v })}
                error={marketValueError(a, country === 'US' ? 'USD' : 'INR', tried)}
                hint="Approximate is fine."
              />
              <label style={{
                alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: 'var(--muted-ink, #666)',
              }}>
                <input
                  type="checkbox"
                  checked={isApprox}
                  onChange={(e) => setApprox(i, e.target.checked)}
                />
                I don't remember the exact purchase price
              </label>

              {isApprox ? (
                <>
                  <Field
                    label="Roughly when did you buy it? (year)"
                    value={a.purchase_date}
                    onChange={(v) => update(i, { purchase_date: v.replace(/[^0-9]/g, '').slice(0, 4) })}
                    kind="integer"
                    placeholder="e.g. 2019"
                    hint="Year only. The ranker will add a wider error band."
                    error={tried && missingDate(a) ? 'Add the year you bought it.' : null}
                  />
                  <Field
                    label={`Approximate purchase price (${currencySymbol})`}
                    value={a.purchase_price}
                    onChange={(v) => update(i, { purchase_price: v })}
                    error={assetAmountError(a.purchase_price ?? '', country === 'US' ? 'USD' : 'INR')}
                    hint="Within ±20% is fine for ranking."
                  />
                </>
              ) : (
                <>
                  <Field
                    label="Purchase date"
                    value={a.purchase_date}
                    onChange={(v) => update(i, { purchase_date: v })}
                    kind="date"
                    error={tried && missingDate(a) ? 'Add when you bought it. If you don’t know the day, tick the box above and give the year.' : null}
                  />
                  <Field
                    label={`Purchase price (${currencySymbol})`}
                    value={a.purchase_price}
                    onChange={(v) => update(i, { purchase_price: v })}
                    error={assetAmountError(a.purchase_price ?? '', country === 'US' ? 'USD' : 'INR')}
                  />
                </>
              )}

              {isFD && (
                <>
                  <Field
                    label="FD rate (%)"
                    kind="percent"
                    value={a.fd_rate_pct ?? ''}
                    onChange={(v) => update(i, { fd_rate_pct: v })}
                    hint="e.g. 7.2"
                  />
                  <Field
                    label="Maturity date"
                    value={a.fd_maturity_date ?? ''}
                    onChange={(v) => update(i, { fd_maturity_date: v })}
                    kind="date"
                  />
                  <Field
                    label="Premature withdrawal penalty (%)"
                    kind="percent"
                    value={a.fd_premature_penalty_pct ?? ''}
                    onChange={(v) => update(i, { fd_premature_penalty_pct: v })}
                    hint="Default 1% if unknown. Bank-specific."
                  />
                  <div />
                </>
              )}

              {isPPF && (
                <Field
                  label="PPF account opened (date)"
                  value={a.ppf_opened_date ?? ''}
                  onChange={(v) => update(i, { ppf_opened_date: v })}
                  kind="date"
                  hint="Used to compute lockup remaining. Year-only OK."
                />
              )}

              {isSGB && (
                <label style={{
                  alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={a.sgb_at_maturity ?? false}
                    onChange={(e) => update(i, { sgb_at_maturity: e.target.checked })}
                  />
                  At maturity (tax-free)
                </label>
              )}

              {(isRE || a.asset_type === 'gold_physical') && (
                <Field
                  label="Growth a year (%, optional)"
                  value={a.appreciation_cagr ?? ''}
                  onChange={(v) => update(i, { appreciation_cagr: v })}
                  kind="percent"
                  placeholder={country === 'IN' ? '7' : '6'}
                  hint="Your view of yearly growth; overrides the default for this asset type."
                />
              )}

              {isRE && country === 'US' && (
                <label style={{
                  alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={a.us_section_121_eligible ?? false}
                    onChange={(e) => update(i, { us_section_121_eligible: e.target.checked })}
                  />
                  Primary residence — IRC §121 eligible ($250k/$500k exclusion)
                </label>
              )}

              {a.asset_type === 'debt_mf' && country === 'US' && (
                <label style={{
                  alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={a.us_is_tax_exempt_muni ?? false}
                    onChange={(e) => update(i, { us_is_tax_exempt_muni: e.target.checked })}
                  />
                  Tax-exempt municipal bond fund (§103 federal exemption)
                </label>
              )}

              {assets.length > 1 && (
                <button
                  onClick={() => remove(i)}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'transparent', border: 0,
                    color: 'var(--muted-ink, #666)', cursor: 'pointer',
                    fontSize: 12,
                  }}
                  aria-label="Remove asset"
                  className="l-hit"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}

        <div>
          <button
            onClick={add}
            style={{
              padding: '6px 10px', borderRadius: 6,
              border: '1px dashed var(--border)',
              background: 'transparent', color: 'var(--ink)',
              cursor: 'pointer', fontSize: 13,
            }}
          >
            + ADD ANOTHER ASSET
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <button
          onClick={() => router.push('/portfolio')}
          style={{
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--ink)', cursor: 'pointer',
          }}
        >
          SKIP
        </button>
        <button
          onClick={save}
          className="btn btn-primary"
          style={{ padding: '8px 14px' }}
        >
          SAVE · BACK TO PORTFOLIO
        </button>
      </div>
    </div>
  );
}

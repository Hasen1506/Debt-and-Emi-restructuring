'use client';

/**
 * Holdings tracker — equity stocks / MFs entered as ticker + quantity,
 * with live price refresh via /api/holdings/quote (Yahoo Finance proxy).
 *
 * Lives on /portfolio under the asset list. Persisted as AssetPayload
 * entries with ticker + quantity + last_price populated; the existing
 * portfolio summary, liquidation advisor, and invest-vs-prepay card
 * consume `current_market_value` exactly as before.
 *
 * Ticker conventions:
 *   • IN — NSE primary by default (bare symbol auto-suffixed `.NS`).
 *     Type the full `.BO` for BSE.
 *   • US — bare symbol (AAPL, GOOGL).
 *
 * Refresh policy: per-row refresh button + "refresh all" button. We never
 * auto-poll. Yahoo's terms discourage continuous polling; users hit the
 * button when they want a quote.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import type { AssetPayload, UserPayload } from '@/lib/api';
import { api, formatCurrency } from '@/lib/api';
import { saveProfileClient } from '@/lib/user-store';
import { userDefaultCurrency } from '@/lib/currency';
import {
  fetchQuote,
  fxForQuote,
  holdingToAsset,
  majorUnits,
  normalizeTicker,
  quantityError,
  refreshAssetWithQuote,
  tickerHoldings,
  type QuoteResult,
} from '@/lib/holdings';
import { Card } from '@/components/Card';
import { InfoTip } from '@/components/ToolPrimitives';

type Variant = 'existing' | 'ledger' | 'editorial';

interface Props {
  user: UserPayload;
  marginalRate: string;
  variant: Variant;
}

interface Status {
  kind: 'idle' | 'loading' | 'error' | 'ok';
  msg?: string;
}

export function HoldingsTracker({ user, marginalRate, variant }: Props) {
  const router = useRouter();
  const userCcy = userDefaultCurrency(user.country);
  // A quote's rate into the profile's currency (null when it's the same).
  const fxFor = (quote: QuoteResult) =>
    fxForQuote(quote, userCcy, user.fx_to_user_currency, api.fxRate);
  const [assets, setAssets] = useState<AssetPayload[]>(user.assets ?? []);
  const [tickerInput, setTickerInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [assetType, setAssetType] = useState<'equity_stocks' | 'equity_mf'>(
    'equity_stocks',
  );
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [refreshingTicker, setRefreshingTicker] = useState<string | null>(null);

  const holdings = useMemo(() => tickerHoldings(assets), [assets]);
  const totalValue = useMemo(
    () =>
      holdings.reduce(
        (s, h) => s.plus(new Decimal(h.current_market_value || 0)),
        new Decimal(0),
      ),
    [holdings],
  );
  const totalCost = useMemo(
    () =>
      holdings.reduce(
        (s, h) => s.plus(new Decimal(h.purchase_price || 0)),
        new Decimal(0),
      ),
    [holdings],
  );
  const unrealized = totalValue.minus(totalCost);

  function persist(next: AssetPayload[]) {
    setAssets(next);
    saveProfileClient({
      user: { ...user, assets: next },
      marginalRate,
    });
    // The page's headline (count, total, mix) is drawn on the server from
    // the saved profile; redraw it, or it says "no holdings" beside one.
    router.refresh();
  }

  async function handleAdd() {
    if (!tickerInput.trim()) {
      setStatus({ kind: 'error', msg: 'Enter a ticker.' });
      return;
    }
    // "What you own": a zero or negative quantity (a short) isn't a holding,
    // and -5 shares used to take $500 off the total.
    const qtyErr = quantityError(qtyInput);
    if (qtyErr) {
      setStatus({ kind: 'error', msg: qtyErr });
      return;
    }
    if (costInput.trim() && !(Number(costInput) >= 0)) {
      setStatus({ kind: 'error', msg: 'Enter the average cost as a number (or leave it blank).' });
      return;
    }
    const ticker = normalizeTicker(tickerInput, user.country);
    setStatus({ kind: 'loading', msg: `Fetching ${ticker}…` });
    try {
      const quote = await fetchQuote(ticker);
      const fx = await fxFor(quote);
      const asset = holdingToAsset(
        {
          ticker,
          quantity: qtyInput.trim(),
          avgCost: costInput.trim() || undefined,
          assetType,
        },
        quote,
        userCcy,
        fx,
      );
      const next = [...assets, asset];
      persist(next);
      const { price, currency } = majorUnits(quote);
      setStatus({
        kind: 'ok',
        msg: fx
          ? `Added ${ticker} at ${currency} ${price.toFixed(2)}, worth ${formatCurrency(asset.current_market_value, userCcy)} at 1 ${currency} = ${fx.rate} ${userCcy} (${fx.source === 'live' ? `rate of ${fx.asOf}` : 'your saved rate'}).`
          : `Added ${ticker} at ${currency} ${price.toFixed(2)}.`,
      });
      setTickerInput('');
      setQtyInput('');
      setCostInput('');
    } catch (err) {
      setStatus({
        kind: 'error',
        msg: `Couldn't add ${ticker}: ${(err as Error).message}.`,
      });
    }
  }

  async function handleRefresh(asset: AssetPayload) {
    if (!asset.ticker) return;
    setRefreshingTicker(asset.ticker);
    setStatus({ kind: 'loading', msg: `Refreshing ${asset.ticker}…` });
    try {
      const quote = await fetchQuote(asset.ticker);
      const fresh = refreshAssetWithQuote(asset, quote, userCcy, await fxFor(quote));
      const next = assets.map((a) => (a === asset ? fresh : a));
      persist(next);
      setStatus({
        kind: 'ok',
        msg: `Updated ${asset.ticker} to ${quote.currency} ${quote.price.toFixed(2)}.`,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        msg: `Refresh failed for ${asset.ticker}: ${(err as Error).message}`,
      });
    } finally {
      setRefreshingTicker(null);
    }
  }

  async function handleRefreshAll() {
    if (holdings.length === 0) return;
    setStatus({ kind: 'loading', msg: 'Refreshing all holdings…' });
    let next = [...assets];
    let okCount = 0;
    const errs: string[] = [];
    for (const h of holdings) {
      if (!h.ticker) continue;
      try {
        const quote = await fetchQuote(h.ticker);
        const fresh = refreshAssetWithQuote(h, quote, userCcy, await fxFor(quote));
        next = next.map((a) => (a === h ? fresh : a));
        okCount += 1;
      } catch (err) {
        errs.push(`${h.ticker}: ${(err as Error).message}`);
      }
    }
    persist(next);
    setStatus(
      errs.length === 0
        ? { kind: 'ok', msg: `Refreshed ${okCount} holdings.` }
        : {
            kind: 'error',
            msg: `Refreshed ${okCount}; failed ${errs.length}: ${errs.join('; ')}`,
          },
    );
  }

  function handleRemove(asset: AssetPayload) {
    const next = assets.filter((a) => a !== asset);
    persist(next);
    setStatus({ kind: 'ok', msg: `Removed ${asset.ticker ?? asset.label}.` });
  }

  const tip = (
    <>
      <strong>What this does.</strong> Tracks equity stocks and ETF / mutual
      fund holdings as ticker + quantity instead of a flat market value, so
      a price refresh keeps your portfolio current without you re-typing.
      <div style={{ marginTop: 8 }}>
        <strong>Ticker format.</strong> India uses NSE by default — type{' '}
        <code>RELIANCE</code> or <code>TCS</code> and we suffix{' '}
        <code>.NS</code> automatically. For BSE, type the full{' '}
        <code>RELIANCE.BO</code>. US tickers stay bare (<code>AAPL</code>).
      </div>
      <div style={{ marginTop: 8 }}>
        <strong>Refresh policy.</strong> We don&apos;t auto-poll. Click the
        ↻ button on a row, or &quot;refresh all&quot;, when you want fresh
        prices. Yahoo Finance is the data source — free but unofficial; the
        occasional ticker doesn&apos;t resolve.
      </div>
    </>
  );

  // Render — variant-aware but the controls are the same. We tweak the
  // surrounding container styling to match the surface.
  const containerStyle: React.CSSProperties =
    variant === 'ledger'
      ? {
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          border: '1px solid var(--ink)',
          padding: 12,
          background: 'var(--card)',
        }
      : variant === 'editorial'
        ? {
            paddingLeft: 14,
            borderLeft: '3px solid var(--accent)',
            margin: '24px 0',
          }
        : {
            padding: 16,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            borderRadius: 8,
            borderLeft: '3px solid var(--accent)',
          };

  return (
    <div style={containerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: variant === 'ledger' ? 11 : 15,
            letterSpacing: variant === 'ledger' ? '0.18em' : undefined,
            textTransform: variant === 'ledger' ? 'uppercase' : undefined,
            color: variant === 'ledger' ? 'var(--accent)' : 'var(--ink)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {variant === 'ledger' ? '$ HOLDINGS · STOCKS + MF' : 'Holdings tracker'}
          <InfoTip>{tip}</InfoTip>
        </div>
        {holdings.length > 0 && (
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={status.kind === 'loading'}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: status.kind === 'loading' ? 'wait' : 'pointer',
              fontSize: 12,
              color: 'var(--accent)',
            }}
          >
            ↻ Refresh all
          </button>
        )}
      </div>

      {holdings.length === 0 ? (
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          No holdings yet. Add a ticker below — we&apos;ll fetch the latest
          price from Yahoo Finance and value the position as quantity × price.
        </div>
      ) : (
        <>
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>
              Value:{' '}
              <strong>
                {formatCurrency(totalValue.toFixed(2), user.country === 'IN' ? 'INR' : 'USD')}
              </strong>
            </span>
            <span className="muted">
              Cost basis:{' '}
              {formatCurrency(totalCost.toFixed(2), user.country === 'IN' ? 'INR' : 'USD')}
            </span>
            <span
              style={{
                color: unrealized.gte(0) ? 'var(--positive)' : 'var(--negative)',
              }}
            >
              {unrealized.gte(0) ? '+' : ''}
              {formatCurrency(unrealized.toFixed(2), user.country === 'IN' ? 'INR' : 'USD')}{' '}
              unrealized
            </span>
          </div>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              marginTop: 10,
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                <th style={{ textAlign: 'left', padding: '6px 6px' }}>Ticker</th>
                <th style={{ textAlign: 'right', padding: '6px 6px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '6px 6px' }}>Last px</th>
                <th style={{ textAlign: 'right', padding: '6px 6px' }}>Value</th>
                <th style={{ textAlign: 'right', padding: '6px 6px' }}>P/L</th>
                <th style={{ textAlign: 'right', padding: '6px 6px' }}></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const value = new Decimal(h.current_market_value || 0);
                const cost = new Decimal(h.purchase_price || 0);
                const pl = value.minus(cost);
                const last = h.last_price ? Number(h.last_price) : null;
                return (
                  <tr
                    key={`${h.ticker}-${h.purchase_date}`}
                    style={{ borderBottom: '1px dashed var(--border)' }}
                  >
                    <td style={{ padding: '6px 6px' }}>
                      <strong>{h.ticker}</strong>
                      {h.label && h.label !== h.ticker && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {h.label}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 6px' }}>
                      {h.quantity}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 6px' }}>
                      {last != null ? `${h.price_currency ? `${h.price_currency} ` : ''}${last.toFixed(2)}` : '—'}
                      {h.price_currency && h.fx_to_user && (
                        <div className="muted" style={{ fontSize: 10 }}>
                          1 {h.price_currency} = {h.fx_to_user} {userCcy}
                          {h.fx_as_of ? `, ${h.fx_as_of}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 6px' }}>
                      {formatCurrency(value.toFixed(2), user.country === 'IN' ? 'INR' : 'USD')}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '6px 6px',
                        color: pl.gte(0) ? 'var(--positive)' : 'var(--negative)',
                      }}
                    >
                      {pl.gte(0) ? '+' : ''}
                      {formatCurrency(pl.toFixed(2), user.country === 'IN' ? 'INR' : 'USD')}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 6px' }}>
                      <button
                        type="button"
                        onClick={() => handleRefresh(h)}
                        disabled={refreshingTicker === h.ticker}
                        title="Refresh price"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          padding: '2px 6px',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: 'var(--accent)',
                        }}
                      >
                        ↻
                      </button>{' '}
                      <button
                        type="button"
                        onClick={() => handleRemove(h)}
                        title="Remove holding"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          padding: '2px 6px',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: 'var(--muted-ink)',
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* Add form */}
      <div
        style={{
          marginTop: 14,
          padding: 10,
          background: 'var(--soft-bg)',
          borderRadius: 6,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <Field label={user.country === 'IN' ? 'Ticker (NSE)' : 'Ticker'} hint={user.country === 'IN' ? 'e.g. RELIANCE' : 'e.g. AAPL'}>
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder={user.country === 'IN' ? 'RELIANCE' : 'AAPL'}
            style={inputStyle}
          />
        </Field>
        <Field label="Quantity">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            placeholder="100"
            style={inputStyle}
          />
        </Field>
        <Field label="Avg cost / share (optional)" hint="In the currency the stock trades in">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value)}
            placeholder="—"
            style={inputStyle}
          />
        </Field>
        <Field label="Type">
          <select
            value={assetType}
            onChange={(e) =>
              setAssetType(e.target.value as 'equity_stocks' | 'equity_mf')
            }
            style={{ ...inputStyle, width: 130 }}
          >
            <option value="equity_stocks">Stock</option>
            <option value="equity_mf">MF / ETF</option>
          </select>
        </Field>
        <button
          type="button"
          onClick={handleAdd}
          disabled={status.kind === 'loading'}
          style={{
            background: 'var(--ink)',
            color: 'var(--canvas)',
            border: 'none',
            borderRadius: 0,
            padding: '8px 14px',
            cursor: status.kind === 'loading' ? 'wait' : 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
          }}
        >
          [ ADD HOLDING ]
        </button>
      </div>

      {status.kind !== 'idle' && status.msg && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color:
              status.kind === 'error'
                ? 'var(--negative)'
                : status.kind === 'ok'
                  ? 'var(--positive)'
                  : 'var(--muted-ink)',
          }}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--canvas)',
  color: 'var(--ink)',
  fontSize: 13,
  width: 110,
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="muted" style={{ fontSize: 11 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="muted" style={{ fontSize: 10 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * GET /api/holdings/quote?ticker=<symbol>
 *
 * Proxies Yahoo Finance's v8 chart endpoint to fetch the latest price for
 * a ticker. Used by the holdings tracker on /portfolio for both Indian
 * (suffix .NS / .BO) and US (no suffix) stocks + ETFs.
 *
 * Why proxy: Yahoo's CORS headers are inconsistent for browser calls.
 * Doing the fetch server-side keeps the failure modes narrow and lets us
 * cache aggressively (5min) without burning Yahoo's rate limit when the
 * user mashes "refresh".
 *
 * Response shape (success):
 *   { ticker, price, currency, name, ts }
 *
 * Response shape (error):
 *   { error: string }
 *   HTTP 400 for bad input, 404 for unknown ticker, 502 for upstream issues.
 */
import { NextRequest, NextResponse } from 'next/server';

// 5-minute cache. The route runs on the Next.js server (not edge), so
// `fetch` honors `next.revalidate`.
const REVALIDATE_SECONDS = 300;

interface YahooMeta {
  regularMarketPrice?: number;
  currency?: string;
  symbol?: string;
  longName?: string;
  shortName?: string;
  exchangeName?: string;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{ meta?: YahooMeta }>;
    error?: { code?: string; description?: string } | null;
  };
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker')?.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
  }
  // Basic shape guard — allow A-Z, 0-9, .  (Indian suffixes use a dot)
  if (!/^[A-Z0-9.\-]{1,16}$/.test(ticker)) {
    return NextResponse.json({ error: 'invalid ticker format' }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?interval=1d&range=1d`;

  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo rejects requests without a UA in some regions.
        'User-Agent':
          'Mozilla/5.0 (compatible; RightDueHoldings/1.0; +https://github.com/Hasen1506/Debt-and-Emi-restructuring)',
        Accept: 'application/json',
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as YahooChartResponse;
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) {
      return NextResponse.json(
        { error: 'unknown ticker or no quote available' },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ticker,
      price: meta.regularMarketPrice,
      currency: meta.currency ?? 'USD',
      name: meta.longName ?? meta.shortName ?? ticker,
      exchange: meta.exchangeName ?? null,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

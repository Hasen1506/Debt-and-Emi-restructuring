/**
 * Per-visitor limits for Next.js route handlers (a route file may only
 * export handlers and route config, so the buckets live here).
 */
import { TokenBucket } from './client-ip';

// UX50 E-20: FastAPI's limiter never sees /api/holdings/quote. 30 quotes a
// minute, bursts of 30: a portfolio refresh asks once per holding; a loop
// over tickers would make this server a Yahoo scraper and get it blocked.
export const quoteLimiter = new TokenBucket(30, 30);

// UX50 E-03: browser error reports, 10 a minute.
export const clientErrorLimiter = new TokenBucket(10, 10);

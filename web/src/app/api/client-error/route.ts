/**
 * POST /api/client-error: a browser error report (components/site/
 * BrowserErrorReporter). Forwarded to Sentry only when SENTRY_DSN is set,
 * scrubbed the same way as server errors (digits masked, 300 characters,
 * path without query). 204 either way. Per-visitor limit: 10 a minute.
 */
import { NextRequest } from 'next/server';
import { clientIp, TokenBucket } from '../../../lib/client-ip';
import { reportServerError } from '../../../lib/error-report';
import { shouldReport } from '../../../lib/client-error';

export const dynamic = 'force-dynamic';
export const clientErrorLimiter = new TokenBucket(10, 10);

export async function POST(req: NextRequest): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (!process.env.SENTRY_DSN) return done;
  if (clientErrorLimiter.take(clientIp(req.headers)) !== null) return new Response(null, { status: 429 });
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 4096) return new Response(null, { status: 413 });
    raw = JSON.parse(text);
  } catch { return new Response(null, { status: 400 }); }
  const r = (raw ?? {}) as { name?: unknown; message?: unknown; path?: unknown };
  const name = typeof r.name === 'string' ? r.name.slice(0, 80) : 'Error';
  const message = typeof r.message === 'string' ? r.message : '';
  const path = typeof r.path === 'string' ? r.path.split(/[?#]/)[0].slice(0, 120) : '';
  if (!shouldReport(name, message)) return done;
  const err = new Error(message);
  err.name = name;
  await reportServerError(err, { method: 'BROWSER', routePath: path, routeType: 'browser' });
  return done;
}

/**
 * Server-side error reports to Sentry, OFF unless SENTRY_DSN is set (grill #64).
 * The web half of api/observability.py; same rules, same wire format.
 *
 * Sentry is an error-tracking service: when a page fails to render on the
 * server, it gets a short report so we hear about it before users do.
 * This is a tiny client, not the Sentry SDK (which would add a large
 * dependency and send far more by default). A report holds only:
 *   - the error's name and a message cut to 300 characters, digits masked
 *     (digits can be amounts or account numbers);
 *   - the route pattern (e.g. "/tools/[tool]"), never the query string;
 *   - the HTTP method, and whether it was a page, a route handler or
 *     middleware.
 * Never the request body, headers, cookies, client address or account.
 * Browser errors are not sent: the browser holds the user's figures.
 *
 * Wire format: https://develop.sentry.dev/sdk/data-model/envelopes/
 * (POST /api/<project_id>/envelope/, read 12 Oct 2026).
 */

const MAX_MESSAGE = 300;

export interface ParsedDsn { raw: string; publicKey: string; envelopeUrl: string }

export function parseDsn(raw: string | undefined): ParsedDsn | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    const parts = u.pathname.replace(/\/+$/, '').split('/');
    const project = parts.pop();
    if (!/^https?:$/.test(u.protocol) || !u.username || !project) return null;
    const prefix = parts.join('/');
    return { raw: value, publicKey: u.username, envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/` };
  } catch {
    return null;
  }
}

export function scrub(text: string): string {
  return text.replace(/\d/g, '#').slice(0, MAX_MESSAGE);
}

export interface RequestInfo { method?: string; routePath?: string; routeType?: string }

function hex32(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildEnvelope(error: unknown, info: RequestInfo, dsn: ParsedDsn, now = new Date()): { id: string; body: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  const id = hex32();
  const event = {
    event_id: id,
    timestamp: now.toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'rightdue.web',
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    exception: { values: [{ type: err.name || 'Error', value: scrub(err.message || '') }] },
    request: { method: info.method ?? '', url: scrub(info.routePath ?? '') },
    tags: { component: 'web', route_type: info.routeType ?? '' },
    ...(process.env.SENTRY_RELEASE ? { release: process.env.SENTRY_RELEASE } : {}),
  };
  const payload = JSON.stringify(event);
  const header = JSON.stringify({ event_id: id, dsn: dsn.raw, sent_at: now.toISOString() });
  const item = JSON.stringify({ type: 'event', length: Buffer.byteLength(payload), content_type: 'application/json' });
  return { id, body: `${header}\n${item}\n${payload}\n` };
}

/** Send one report if SENTRY_DSN is set. Never throws; gives up after 3 s. */
export async function reportServerError(error: unknown, info: RequestInfo, send: typeof fetch = fetch): Promise<string | null> {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return null;
  try {
    const { id, body } = buildEnvelope(error, info, dsn);
    await send(dsn.envelopeUrl, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=rightdue-web/1`,
      },
      signal: AbortSignal.timeout(3000),
    });
    return id;
  } catch {
    return null;
  }
}

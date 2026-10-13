import { NextRequest } from 'next/server';
import { waitForSignInApi, SignInApiStarting } from '@/lib/sign-in-readiness';
import { allowedOrigins, isAllowedOrigin, setCookieHeaders } from '@/lib/request-origin';
import { serverApiBase } from '@/lib/api-base';
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE, sessionToken } from '@/lib/storage-migration';

export const dynamic = 'force-dynamic';
const METHODS: Record<string, string[]> = {
  'auth/request-otp': ['POST'],
  'auth/verify-otp': ['POST'],
  'auth/logout': ['POST'],
  'auth/me': ['GET'],
  'user/state': ['GET', 'PUT', 'PATCH'],
  // "Your data" page (grill #51): download everything, delete the account.
  'auth/account/export': ['GET'],
  'auth/account/delete': ['POST'],
};
const MAX_BODY_BYTES = 256 * 1024;

class BodyTooLarge extends Error {}

/** The API's cap must also apply before the frontend buffers a request. */
async function readBody(req: NextRequest): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** Fixed upstream and path allowlist: never a general-purpose proxy. */
async function proxyInner(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const path = (await context.params).path.join('/');
  const methods = METHODS[path];
  if (!methods) return new Response(null, { status: 404 });
  if (!methods.includes(req.method)) return new Response(null, { status: 405 });
  // Same-site session cookies alone do not protect a login from CSRF.
  // WEB_ORIGIN may list several origins; without it the origin is rebuilt
  // from X-Forwarded-Proto/-Host, since TLS ends at Render/Cloudflare (M6).
  const origins = allowedOrigins(process.env.WEB_ORIGIN, req.headers, req.nextUrl.protocol, req.nextUrl.host);
  if (req.method !== 'GET' && !isAllowedOrigin(req.headers.get('origin'), origins)) {
    return new Response('This request must come from RightDue.', { status: 403 });
  }
  if (req.method !== 'GET') {
    const length = req.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
      return Response.json({ detail: 'Invalid request length.' }, { status: 400 });
    }
    if (length !== null && Number(length) > MAX_BODY_BYTES) {
      return Response.json({ detail: 'The request is too large.' }, { status: 413 });
    }
  }
  const headers = new Headers();
  if (req.method !== 'GET') headers.set('Content-Type', 'application/json');
  // Either cookie name for one release (critique #58); the API is sent the new one.
  const token = sessionToken(req.cookies);
  // UX50 E-22: a visitor with no session cookie is signed out; say so here
  // with a 200 and null instead of asking the API for a 401, which showed
  // as two red console errors on every signed-out page (and would flood
  // browser error reports). api.me() still reads it as signed out.
  if (path === 'auth/me' && !token) {
    return Response.json(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
  if (token) headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
  const expectedAccount = req.headers.get('x-account-id');
  if (path === 'user/state' && expectedAccount) headers.set('X-Account-Id', expectedAccount);
  // The visitor's X-Forwarded-For, unchanged, so the API's per-IP limits on
  // sign-in (api/security.py) see the visitor and not this server. The API
  // trusts only its last TRUSTED_PROXY_HOPS entries (api/client_ip.py), the
  // ones Cloudflare and Render appended; a forged left part is ignored.
  // Without it every sign-in shared one bucket: this server's address.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);
  // UX50 E-01: on Render the visitor is the CF-Connecting-IP written by
  // Render's own Cloudflare edge (api/client_ip.py). Without copying it the
  // API fell back to X-Forwarded-For, where the old hop count picked the
  // rotating edge address, and sign-in was never limited.
  const clientIpHeader = (process.env.CLIENT_IP_HEADER ?? (process.env.RENDER ? 'cf-connecting-ip' : '')).trim().toLowerCase();
  if (clientIpHeader && !['none', 'off', '0', 'false'].includes(clientIpHeader)) {
    const value = req.headers.get(clientIpHeader);
    if (value) headers.set(clientIpHeader, value);
  }
  // Never send INTERNAL_API_TOKEN: it would bypass the OTP rate limits.
  const base = serverApiBase();
  try {
    const body = req.method === 'GET' ? undefined : await readBody(req);
    // Wake a sleeping API with safe reads before creating an OTP. Never replay
    // an email request or code verification after an ambiguous failure.
    if (path === 'auth/request-otp') await waitForSignInApi(base);
    const upstream = await fetch(`${base.replace(/\/$/, '')}/api/${path}`, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    const disposition = upstream.headers.get('content-disposition');
    if (disposition && path === 'auth/account/export') responseHeaders.set('Content-Disposition', disposition);
    // Forward every Set-Cookie separately: headers.get() joins them with
    // commas, which browsers read as one broken cookie.
    for (const cookie of setCookieHeaders(upstream.headers)) responseHeaders.append('Set-Cookie', cookie);
    // Signing out or in also drops a session cookie still under the old name.
    if ((path === 'auth/logout' || path === 'auth/verify-otp') && req.cookies.get(LEGACY_SESSION_COOKIE)) {
      responseHeaders.append('Set-Cookie', `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    }
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
    return new Response(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof SignInApiStarting) {
      return Response.json({ detail: { code: 'sign_in_starting' } }, {
        status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
      });
    }
    if (error instanceof BodyTooLarge) {
      return Response.json({ detail: 'The request is too large.' }, { status: 413 });
    }
    return Response.json({ detail: 'Sign-in service is temporarily unavailable. Try again shortly.' }, { status: 502 });
  }
}

/** R6-6: every answer here is per-person (or says who is signed in), so no
 *  cache or proxy may keep or share it: private, no-store on every status,
 *  including the 404/405/403/413/502 branches and HEAD, and Vary: Cookie. */
function noStore(res: Response): Response {
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.append('Vary', 'Cookie');
  return res;
}
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return noStore(await proxyInner(req, context));
}
async function head(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const path = (await context.params).path.join('/');
  return noStore(new Response(null, { status: METHODS[path] ? 405 : 404, headers: { Allow: (METHODS[path] ?? []).join(', ') } }));
}

export const GET = proxy;
export const HEAD = head;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;

import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
const METHODS: Record<string, string[]> = {
  'auth/request-otp': ['POST'],
  'auth/verify-otp': ['POST'],
  'auth/logout': ['POST'],
  'auth/me': ['GET'],
  'user/state': ['GET', 'PUT', 'PATCH'],
};

/** Fixed upstream and path allowlist: never a general-purpose proxy. */
async function proxy(req: NextRequest, context: { params: { path: string[] } }): Promise<Response> {
  const path = context.params.path.join('/');
  const methods = METHODS[path];
  if (!methods) return new Response(null, { status: 404 });
  if (!methods.includes(req.method)) return new Response(null, { status: 405 });
  // Same-site session cookies alone do not protect a login from CSRF.
  const webOrigin = process.env.WEB_ORIGIN ?? `${req.nextUrl.protocol}//${req.headers.get('host') ?? req.nextUrl.host}`;
  if (req.method !== 'GET' && req.headers.get('origin') !== webOrigin) {
    return new Response('This request must come from RightDue.', { status: 403 });
  }
  const headers = new Headers();
  if (req.method !== 'GET') headers.set('Content-Type', 'application/json');
  const token = req.cookies.get('finoptima_session')?.value;
  if (token) headers.set('Cookie', `finoptima_session=${token}`);
  const expectedAccount = req.headers.get('x-account-id');
  if (path === 'user/state' && expectedAccount) headers.set('X-Account-Id', expectedAccount);
  // Never send INTERNAL_API_TOKEN: it would bypass the OTP rate limits.
  const base = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/api/${path}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' ? undefined : await req.text(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    const cookie = upstream.headers.get('set-cookie');
    if (cookie) responseHeaders.set('Set-Cookie', cookie);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
    return new Response(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json({ detail: 'Sign-in service is temporarily unavailable. Try again shortly.' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;

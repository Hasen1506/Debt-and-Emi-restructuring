/**
 * Where the FastAPI service is, seen from the browser and from the web server.
 *
 * Single-service deploy (render.yaml `rightdue`, Dockerfile): FastAPI runs in
 * the same container on 127.0.0.1:8000 and Next.js proxies every /api/* path
 * it does not serve itself to it (next.config.mjs `rewrites.fallback`). So:
 *
 * - The browser calls the API on its own origin: NEXT_PUBLIC_API_BASE_URL is
 *   left unset (or empty) and requests go to `/api/...` on the page's host.
 *   Setting it to an absolute URL still works for a split deploy or the E2E
 *   run, which point the browser straight at a separate API.
 * - The web server (server components, the /api/session proxy) calls the API
 *   directly at API_INTERNAL_URL (default http://127.0.0.1:8000). The older
 *   API_BASE_URL and an absolute NEXT_PUBLIC_API_BASE_URL are still honoured,
 *   in that order, so a split deploy keeps working unchanged.
 */
export const DEFAULT_INTERNAL_API_URL = 'http://127.0.0.1:8000';

const trim = (url: string) => url.replace(/\/+$/, '');

/** The API as the Next.js server reaches it. Never the empty string. */
export function serverApiBase(): string {
  return trim(
    process.env.API_INTERNAL_URL ||
      process.env.API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      DEFAULT_INTERNAL_API_URL,
  );
}

/** The API as the browser reaches it: '' means the page's own origin. */
export function browserApiBase(): string {
  return trim(process.env.NEXT_PUBLIC_API_BASE_URL || '');
}

export function apiBase(): string {
  return typeof window === 'undefined' ? serverApiBase() : browserApiBase();
}

/**
 * Live re-test 3 NEW-19: Render's health check. It answers from the
 * Next.js server itself: no proxy to FastAPI, no page render, no fetch,
 * and it is prerendered at build time (force-static), so a busy API
 * (a long plan on the free plan's fraction of a CPU) no longer makes the
 * check time out and the instance look down.
 *
 * /api/health (FastAPI, through the rewrite) is unchanged: it still reports
 * the API and the database, for people and the landing worker.
 * A route handler wins over next.config.mjs's fallback rewrite, and the
 * middleware matcher skips /api, so nothing else runs for this path.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response('ok\n', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

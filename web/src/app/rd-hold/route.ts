/**
 * An empty script that answers slowly. The page asks for it immediately so
 * the browser's load event stays open, then starts the real scripts after
 * the largest paint. This request is still in flight at that paint, so it
 * is not part of the paint's cost. Sign-in and other clicks wait for load,
 * which is after the page is interactive.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  await new Promise((resolve) => setTimeout(resolve, 1600));
  return new Response('', {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

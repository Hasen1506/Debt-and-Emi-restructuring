/**
 * Next.js calls onRequestError when a page, route handler or middleware
 * throws on the server. With SENTRY_DSN set, a scrubbed report goes to
 * Sentry (lib/error-report, grill #64); otherwise nothing happens.
 */
export function register() {}

export async function onRequestError(
  error: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string },
) {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportServerError } = await import('./lib/error-report');
  await reportServerError(error, { method: request.method, routePath: context.routePath, routeType: context.routeType });
}

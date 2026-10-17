/**
 * Sprint L5: first visit and cold start.
 *  - A signed-out first visit to / gets the public landing (welcome.html),
 *    with no app data and no cookies set (live #1) beyond G10's
 *    non-identifying rd_country=IN|US landing cookie.
 *  - Cold start: right after the servers come up, the landing, /login and
 *    the API health check each answer within a budget. On Render's free
 *    plan the real cold start is the instance wake-up (~50 s, G9 #49);
 *    this guards the part the app controls: no slow work on first request.
 */
import { expect, test } from './fixtures';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8100}`;
const BUDGET_MS = Number(process.env.E2E_COLD_BUDGET_MS ?? 5000);

test('first visit: / is the public landing, no app state, no cookies', async ({ page, context }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);              // rewritten, not redirected
  await expect(page.getByRole('link', { name: /sign in|start|try/i }).first()).toBeVisible();
  // No app chrome: the tab nav belongs to signed-in pages.
  await expect(page.getByRole('link', { name: /^\[?activity\]?$/i })).toHaveCount(0);
  // The one cookie a first visit may get is G10's non-identifying landing
  // country (rd_country=IN|US, read by the static page to pick ₹ or $
  // examples). No session, app or tracking cookie.
  const cookies = await context.cookies();
  expect(cookies.filter((c) => c.name !== 'rd_country')).toEqual([]);
  for (const c of cookies) expect(c.value).toMatch(/^(IN|US)$/);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('first visit: Loan Check is public, everything else asks to sign in', async ({ page }) => {
  await page.goto('/tools/loan-check');
  await expect(page).toHaveURL(/\/tools\/loan-check$/);
  for (const p of ['/plan', '/activity', '/profile', '/goals']) {
    await page.goto(p);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  }
});

test('cold start: landing, /login and API health answer within the budget', async ({ request }) => {
  for (const url of ['/welcome.html', '/login', `${API}/api/health`]) {
    const t0 = Date.now();
    const res = await request.get(url);
    const ms = Date.now() - t0;
    expect(res.ok(), url).toBeTruthy();
    expect(ms, `${url} took ${ms} ms`).toBeLessThan(BUDGET_MS);
  }
});

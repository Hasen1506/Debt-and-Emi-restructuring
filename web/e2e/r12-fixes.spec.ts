/**
 * Live re-test 12 fix round.
 *
 * R12-1 (WebKit): leaving /plan while it is still hydrating. Requests in
 * flight at beforeunload were already aborted quietly (R11-1), but the ones
 * /plan *started* during the leave (masthead auth/me, the rates) got a live
 * signal and WebKit cut them off and logged "…/api/… due to access control
 * checks". pageScoped() now holds a request that starts while the page is
 * leaving (lib/page-abort.ts). This leaves /plan by URL 20 times, 0–95 ms
 * after the document commits, half with page.goto and half with an in-page
 * location.href, and expects no such message for a RightDue /api/ route.
 * Only Next's own ?_rsc= / _next/ chunk cut-offs are left out (framework
 * noise, re-test 12 O-3).
 *
 * R12-2 (all engines): the Profile → Loans import buttons use .btn-ghost,
 * which wasn't defined, so they were grey bevelled browser-default buttons.
 */
import { expect, openProfileSection, test } from './fixtures';
import { setUpPersona } from './persona';

const API_ACCESS_CONTROL = /\/api\/.*access control checks/i;
const NEXT_NOISE = /[?&]_rsc=|\/_next\//;

test('R12-1: leaving /plan mid-hydration by URL logs no /api/ "access control checks" (WebKit)', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the "access control checks" log is WebKit-only');
  await setUpPersona(page, 'golden-r12-navaway@rightdue.app');

  const offenders: string[] = [];
  const note = (where: string, text: string) => {
    if (API_ACCESS_CONTROL.test(text) && !NEXT_NOISE.test(text)) offenders.push(`${where}: ${text}`);
  };
  page.on('console', (m) => note(`console.${m.type()} @ ${page.url()}`, m.text()));
  page.on('pageerror', (e) => note(`pageerror @ ${page.url()}`, String(e.message ?? e)));

  const home = /^https?:\/\/[^/]+\/$/;
  for (let i = 0; i < 20; i++) {
    await page.goto('/plan', { waitUntil: 'commit' });
    const wait = (i * 37) % 100; // 0–99 ms after commit: before /plan has hydrated
    if (wait) await page.waitForTimeout(wait);
    if (i % 2 === 0) {
      // In-page leave (the probe's 3-in-10 case). The evaluate may lose its
      // context to the very navigation it starts.
      await page.evaluate(() => { window.location.href = '/'; }).catch(() => {});
    } else {
      await page.goto('/');
    }
    await expect(page).toHaveURL(home);
    await page.waitForLoadState('load');
  }
  // Anything the last leave cut off is logged within a moment.
  await page.waitForTimeout(1500);
  expect(offenders, offenders.join('\n')).toEqual([]);
});

test('R12-2: the Profile → Loans import buttons are styled ledger buttons, not browser defaults', async ({ page }) => {
  await setUpPersona(page, 'golden-r12-ghost@rightdue.app');
  await page.goto('/profile');
  await openProfileSection(page, 'Loans');
  for (const id of ['cr-open', 'kfs-open', 'sms-open']) {
    const b = page.getByTestId(id);
    await expect(b).toBeVisible();
    const s = await b.evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, border: c.borderTopStyle, transform: c.textTransform, font: c.fontFamily };
    });
    expect(s.border, id).toBe('solid'); // not the default "outset"
    expect(s.bg, id).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/); // not rgb(192, 192, 192) / buttonface
    expect(s.transform, id).toBe('uppercase');
    expect(s.font.toLowerCase(), id).toMatch(/mono/);
  }
});

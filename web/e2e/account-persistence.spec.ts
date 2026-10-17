/**
 * L1 persistence: live-test #2/#3/#27/#33 and critiques #58/#63, end to end.
 *
 * The live bug: a browser whose sign-in had ended (the session cookie still
 * there, so every page opened) showed "Changes have not reached your
 * account… Retry save" after every Profile save, forever. These journeys
 * pin what happens now for a signed-in user, a browser whose sign-in ended,
 * two devices on one account, and a browser still holding finoptima_*
 * cookies from before the rename.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { confirmAgeAndSend, expect, fillLoan, FROZEN_NOW, OTP, signIn, test, testEmail, makeSetupChoices, openProfileSection } from './fixtures';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8100}`;
const notice = (page: Page) => page.locator('[data-sync-state]');

async function setUp(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill('120000');
  await page.getByLabel(/Spending a month/).fill('55000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '50000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
}

async function setTakeHome(page: Page, amount: string) {
  await page.goto('/profile');
  await openProfileSection(page, 'Income and spending');
  await page.getByLabel(/In-hand salary|Take-home/).first().fill(amount);
  await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
}

const takeHome = (page: Page, rupees: string) => expect(page.getByText(`${rupees} a month`).first()).toBeVisible();

async function accountTakeHome(context: BrowserContext): Promise<string | undefined> {
  const res = await context.request.get('/api/session/user/state');
  const body = await res.json();
  return body.data?.profile?.user?.monthly_income;
}

test('signed in: a Profile save reaches the account, survives a reload, and leaves no notice', async ({ page, context }) => {
  await setUp(page, 'l1-signed-in@rightdue.app');
  await setTakeHome(page, '70000');
  await expect(notice(page)).toHaveCount(0);
  await page.reload();
  await takeHome(page, '₹70,000');
  await expect(notice(page)).toHaveCount(0);
  expect(await accountTakeHome(context)).toBe('70000');
  // Live-test #27: reverting persists too.
  await setTakeHome(page, '120000');
  await page.reload();
  await takeHome(page, '₹1,20,000');
  expect(await accountTakeHome(context)).toBe('120000');
});

test('sign-in ended elsewhere: the save is kept here, the notice says why, and signing in again sends it', async ({ page, context, playwright }) => {
  const email = 'l1-ended@rightdue.app';
  await setUp(page, email);
  // Profile is open (loaded while still signed in) when the sign-in ends.
  // Revoking first and then opening Profile is a different journey: with
  // nothing waiting to send, that browser's copies are dropped (D21) and it
  // is asked to sign in again (the next test).
  await page.goto('/profile');
  await openProfileSection(page, 'Income and spending');
  // Revoke this browser's session from outside it (another tab's sign-out,
  // expiry, a database reset); the cookie stays in this browser.
  const session = (await context.cookies()).find((c) => c.name === 'rightdue_session')!;
  const outside = await playwright.request.newContext();
  expect((await outside.post(`${API}/api/auth/logout`, { headers: { Cookie: `rightdue_session=${session.value}` } })).status()).toBe(204);
  await page.getByLabel(/In-hand salary|Take-home/).first().fill('70000');
  await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  await expect(notice(page)).toHaveAttribute('data-sync-state', 'signed_out');
  await expect(notice(page)).toContainText("saved on this device, but you're signed out");
  await expect(page.getByText('Changes have not reached your account. Keep this tab open')).toHaveCount(0);
  // Reload: the change is still here and the notice still says so (it used to vanish).
  await page.reload();
  await takeHome(page, '₹70,000');
  await expect(notice(page)).toHaveAttribute('data-sync-state', 'signed_out');
  // Sign in again from the notice: the queued change reaches the account.
  await notice(page).getByRole('link', { name: 'Sign in again' }).click();
  await page.waitForURL(/\/login\?next=%2Fprofile/);
  await page.getByPlaceholder('you@example.com').fill(testEmail(email));
  await confirmAgeAndSend(page);
  await page.getByPlaceholder('••••••').fill(OTP);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  // The login page leaves with window.location.assign. Firefox can report that
  // full load as NS_BINDING_ABORTED to waitForURL even though it completes,
  // so assert where the page ended up instead of waiting on the load event.
  await expect(page).toHaveURL(/\/profile(\?|$)/, { timeout: 15_000 });
  await takeHome(page, '₹70,000');
  await expect(notice(page)).toHaveCount(0);
  expect(await accountTakeHome(context)).toBe('70000');
});

test('sign-in ended with nothing waiting to send: opening a page asks to sign in again, not Setup', async ({ page, context, playwright }) => {
  await setUp(page, 'l1-ended-idle@rightdue.app');
  // Nothing left to send: Setup's saves have all reached the account (WebKit
  // can still be sending one when /plan opens, and a queued change is kept).
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((k) => k.startsWith('rightdue_pending_sync_') && !['', '{}'].includes(localStorage.getItem(k) ?? '')).length)).toBe(0);
  const session = (await context.cookies()).find((c) => c.name === 'rightdue_session')!;
  const outside = await playwright.request.newContext();
  expect((await outside.post(`${API}/api/auth/logout`, { headers: { Cookie: `rightdue_session=${session.value}` } })).status()).toBe(204);
  await page.goto('/profile');
  // The dead cookie is still sent, so the page opens; the 401 behind it drops
  // this browser's copies (D21) and sends the person to sign in, back to Profile.
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile/, { timeout: 15_000 });
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
});

test('two devices: a stale edit is not written over the newer one; the person chooses which to keep', async ({ page, browser }) => {
  const email = 'l1-two-devices@rightdue.app';
  await setUp(page, email);
  const laptop = await browser.newContext({ timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  const phonePage = page;
  const laptopPage = await laptop.newPage();
  await laptopPage.clock.setFixedTime(FROZEN_NOW);
  await laptop.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort('blockedbyclient'));
  await signIn(laptopPage, email);
  await laptopPage.goto('/profile');
  await takeHome(laptopPage, '₹1,20,000');
  // The phone saves first...
  await setTakeHome(phonePage, '90000');
  await expect(notice(phonePage)).toHaveCount(0);
  // ...then the laptop, still on the copy it loaded before.
  await openProfileSection(laptopPage, 'Income and spending');
  await laptopPage.getByLabel(/In-hand salary|Take-home/).first().fill('80000');
  await laptopPage.getByRole('button', { name: /SAVE CHANGES/ }).click();
  await expect(notice(laptopPage)).toHaveAttribute('data-sync-state', 'conflict');
  await expect(notice(laptopPage)).toContainText('changed on another device');
  // The account kept the phone's figure, and the laptop now shows it.
  expect(await accountTakeHome(laptop)).toBe('90000');
  await takeHome(laptopPage, '₹90,000');
  // The person picks the laptop's figure.
  await notice(laptopPage).getByRole('button', { name: "Use this device's version instead" }).click();
  await expect(notice(laptopPage)).toHaveCount(0);
  await takeHome(laptopPage, '₹80,000');
  expect(await accountTakeHome(laptop)).toBe('80000');
  // The phone gets it on its next load.
  await phonePage.reload();
  await takeHome(phonePage, '₹80,000');
  await laptop.close();
});

test('a browser still holding finoptima_* cookies keeps its session and data, and they are renamed', async ({ page, context, browser }) => {
  await setUp(page, 'l1-rename@rightdue.app');
  const old = await browser.newContext({ timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  // Like the page fixture: no outside network (a Google Fonts request that
  // never answers kept "load" from firing).
  await old.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort('blockedbyclient'));
  await old.addCookies((await context.cookies()).map((c) => ({ ...c, name: c.name.replace(/^rightdue_/, 'finoptima_') })));
  const oldPage = await old.newPage();
  await oldPage.clock.setFixedTime(FROZEN_NOW);
  await oldPage.goto('/profile');
  await expect(oldPage).toHaveURL(/\/profile$/);
  await takeHome(oldPage, '₹1,20,000');
  // What the browser sends from now on, not what Firefox's cookie list
  // reports. CI run 38488716548 (and 1 in 12 local Firefox runs): the
  // /profile response expired all five finoptima_* names and every later
  // request carried none, yet old.cookies() still listed some of them 15 s
  // later. The rename is the browser sending only rightdue_* names.
  const probe = '/api/session/auth/me?rename-check=1';
  const [sentRequest, me] = await Promise.all([
    oldPage.waitForRequest((r) => r.url().endsWith(probe)),
    oldPage.evaluate((url) => fetch(url, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()), probe),
  ]);
  // WebKit's driver does not report the Cookie request header (PR #71 run
  // 38495246706); its cookie list never showed the stale entries, so it is
  // read there instead.
  const header = await sentRequest.headerValue('cookie');
  const sent = header ? header.split(/;\s*/).map((c) => c.split('=')[0]) : (await old.cookies()).map((c) => c.name);
  expect(sent).toEqual(expect.arrayContaining(['rightdue_session', 'rightdue_user']));
  expect(sent.filter((n) => n.startsWith('finoptima_'))).toEqual([]);
  expect(me.email).toBe(testEmail('l1-rename@rightdue.app'));
  expect(await oldPage.evaluate(() => document.cookie.split(/;\s*/).filter((c) => c.startsWith('finoptima_')))).toEqual([]);
  expect((await old.cookies()).find((c) => c.name === 'rightdue_session')!.httpOnly).toBe(true);
  expect((await (await old.request.get('/api/session/auth/me')).json()).email).toBe(testEmail('l1-rename@rightdue.app'));
  await old.close();
});

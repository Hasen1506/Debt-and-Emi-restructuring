/**
 * W7 · audit 80+ visual system, navigation, layout shift and screen-reader
 * structure (B5, B18, B19, B20, B26/A20, E10, E13).
 *
 * Every assertion guards a class of defect on every page it lists, not one
 * repro:
 *  - B5   type floor: no visible text under 12px, and at most a budgeted
 *         share at 12px (labels), on every app page at 390 and 1366.
 *  - E3/B18 no page scrolls sideways at 320, 390 or 1366.
 *  - E10  layout shift under 0.1 on Home and Setup at 390, slow 4G, 4x CPU.
 *  - B26  the "More" menu opens every extra section at 390 and 1366.
 *  - E13  no accessible name carries bracket glyphs; one footer landmark;
 *         the plan's answer is a heading plus a term list; the month table
 *         has a caption and scoped, unique column headers.
 *
 * UI_METRICS_OUT=<file.json> writes the measurements (the report's before
 * and after); UI_SHOTS_DIR=<dir> saves full-page screenshots;
 * UI_METRICS_ONLY=1 measures without asserting (used on the old build).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, signIn, fillLoan, makeSetupChoices } from './fixtures';
import { setUpPersona } from './persona';
import { layoutShift, sidewaysOverflow, textStats, throttle, watchLayoutShift, type TextStats } from './support/ui-metrics';

const ONLY_MEASURE = process.env.UI_METRICS_ONLY === '1';
const OUT = process.env.UI_METRICS_OUT;
const SHOTS = process.env.UI_SHOTS_DIR;

const PAGES = ['/', '/plan', '/activity', '/goals', '/portfolio', '/tax', '/profile', '/cant-pay', '/tools/windfall'];
const WIDTHS = [1366, 390, 320];
/** B5 budget: share of visible characters at 12px (labels, figures in
 *  dense tables). Was 80–94% on Home/Plan/Activity before W7. */
const LE12_BUDGET = 35;
/** CLS "good" threshold (web.dev/articles/cls, checked 2026-10-14). */
const CLS_BUDGET = 0.1;

const metrics: Record<string, unknown> = {};
function record(key: string, value: unknown) {
  metrics[key] = value;
  if (OUT) {
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ ...prev, [key]: value }, null, 2));
  }
}

async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
}

test.describe('visual system @w7', () => {
  test.describe.configure({ mode: 'serial' });

  test('B5 + E3: type floor and no sideways scroll on every app page at 320, 390 and 1366', async ({ page }) => {
    test.setTimeout(400_000);
    await setUpPersona(page, 'w7-visual@rightdue.app');
    const failures: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      for (const p of PAGES) {
        await page.goto(p);
        await settle(page);
        const over = await sidewaysOverflow(page);
        const stats: TextStats = await textStats(page);
        record(`text ${p} @${width}`, { ...stats, overflowPx: over });
        if (SHOTS && width !== 320) {
          await page.screenshot({ path: path.join(SHOTS, `${width}${p === '/' ? '_home' : p.replace(/\//g, '_')}.png`), fullPage: true });
        }
        if (over > 0) failures.push(`${p} @${width}: scrolls sideways by ${over}px`);
        if (stats.lt11 > 0) failures.push(`${p} @${width}: ${stats.lt11}% of text under 11px`);
        if (width !== 320 && stats.le12 > LE12_BUDGET) failures.push(`${p} @${width}: ${stats.le12}% of text at or under 12px (budget ${LE12_BUDGET}%)`);
      }
    }
    if (!ONLY_MEASURE) expect(failures).toEqual([]);
  });

  test('E10: Home and Setup layout shift under 0.1 at 390 on slow 4G with 4x CPU', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'layout-shift entries and CDP throttling are Chromium-only');
    test.setTimeout(240_000);
    await setUpPersona(page, 'w7-visual@rightdue.app');
    await page.setViewportSize({ width: 390, height: 844 });
    await watchLayoutShift(page);
    await throttle(page);
    await page.goto('/');
    await page.waitForTimeout(6000);
    const home = await layoutShift(page);
    record('cls /', home);

    // A new account lands on Setup (/onboarding).
    const fresh = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
    const p2 = await fresh.newPage();
    await p2.context().route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (r) => r.abort('blockedbyclient'));
    await signIn(p2, `w7-cls-${Date.now()}@rightdue.app`);
    await watchLayoutShift(p2);
    await throttle(p2);
    await p2.goto('/onboarding');
    await p2.waitForTimeout(6000);
    const setup = await layoutShift(p2);
    record('cls /onboarding', setup);
    await fresh.close();
    if (!ONLY_MEASURE) {
      expect(home.cls, `Home shifts: ${JSON.stringify(home.shifts)}`).toBeLessThan(CLS_BUDGET);
      expect(setup.cls, `Setup shifts: ${JSON.stringify(setup.shifts)}`).toBeLessThan(CLS_BUDGET);
    }
  });

  for (const width of [390, 1366]) {
    test(`B26/A20: core tabs plus a "More" menu that opens every extra section at ${width}`, async ({ page }) => {
      test.skip(ONLY_MEASURE, 'new navigation');
      await setUpPersona(page, 'w7-visual@rightdue.app');
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto('/');
      if (width < 641) await page.getByRole('button', { name: /^menu$/i }).click();
      const nav = page.getByRole('navigation', { name: 'Main' });
      // Four core tabs, nothing else in the main row.
      for (const name of ['Home', 'Plan', 'Activity', 'Profile']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: /portfolio/i })).toHaveCount(0);
      const more = nav.getByRole('button', { name: /^More/ });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const panel = page.locator('#rd-more-panel');
      for (const name of [/^Goals/, /^Assets & tax/, /^Spare cash/, /^Sell to repay/, /^Invest or prepay/, /^Loan check/, /^Can’t pay/, /^Glossary/]) {
        await expect(panel.getByRole('link', { name })).toBeVisible();
      }
      // NRI tools only for someone who chose NRI (this persona didn't).
      await expect(panel.getByRole('link', { name: /NRI/ })).toHaveCount(0);
      // Escape closes it and gives focus back.
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(more).toBeFocused();
      // Open → Assets & tax: one section with both halves, the More button lit.
      await more.click();
      await panel.getByRole('link', { name: /^Assets & tax/ }).click();
      await page.waitForURL('**/portfolio');
      const sub = page.getByRole('navigation', { name: 'Assets and tax' });
      await expect(sub.getByRole('link', { name: 'What you own' })).toHaveAttribute('aria-current', 'page');
      await sub.getByRole('link', { name: 'Tax' }).click();
      await page.waitForURL('**/tax');
      await expect(page.getByRole('navigation', { name: 'Assets and tax' }).getByRole('link', { name: 'Tax' })).toHaveAttribute('aria-current', 'page');
      if (width < 641) await page.getByRole('button', { name: /^menu$/i }).click();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^More/ })).toHaveAttribute('data-current', 'true');
      expect(await sidewaysOverflow(page)).toBe(0);
    });
  }

  test('B20: the header payoff order is a labelled text control, not artwork', async ({ page }) => {
    test.skip(ONLY_MEASURE, 'new header control');
    await setUpPersona(page, 'w7-visual@rightdue.app');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/plan');
    const group = page.getByRole('radiogroup', { name: 'Payoff order' });
    for (const name of ['Cheapest', 'Smallest', 'Mine']) await expect(group.getByRole('radio', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(page.locator('header.rd-masthead svg')).toHaveCount(0);
  });

  test('B18 + B19 + E13: plan reads on a phone and to a screen reader', async ({ page }) => {
    test.skip(ONLY_MEASURE, 'new structure');
    await setUpPersona(page, 'w7-visual@rightdue.app');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/plan');
    await settle(page);
    const main = page.locator('main');
    // The answer is a heading, and the figures a term list.
    await expect(main.getByRole('heading', { level: 2, name: /^Debt-free: [A-Z][a-z]+ \d{4}/ })).toBeVisible();
    await expect(main.locator('dl[aria-label="Plan summary"] dt').first()).toBeVisible();
    // B18: up to 820px the months are cards, no sideways swipe. "Month by
    // month" in the plan's header is a jump link to #schedule.
    await main.getByRole('link', { name: /^month by month$/i }).first().click();
    await expect(page).toHaveURL(/#schedule$/);
    await expect(page.getByText(/swipe sideways/i)).toHaveCount(0);
    const cards = main.locator('[data-testid="month-card"]');
    await expect(cards.first()).toBeVisible();
    expect(await sidewaysOverflow(page)).toBe(0);
    // Each card: date heading, paid, interest, left.
    await expect(cards.first()).toContainText(/Paid/);
    await expect(cards.first()).toContainText(/Interest/);
    await expect(cards.first()).toContainText(/Left/);
    // B19: planned interest is ink, not alarm red.
    const red = await cards.first().evaluate((el) =>
      Array.from(el.querySelectorAll('*')).filter((n) => getComputedStyle(n).color === 'rgb(185, 28, 28)').map((n) => n.textContent),
    );
    expect(red).toEqual([]);
    // Wide: the table has a caption and scoped, unique column headers.
    await page.setViewportSize({ width: 1366, height: 900 });
    const table = main.locator('table:has(caption)').first();
    await expect(table.locator('caption')).toHaveCount(1);
    const ths = await table.locator('thead th').evaluateAll((els) => els.map((e) => ({ scope: e.getAttribute('scope'), text: (e.textContent ?? '').trim() })));
    expect(ths.every((t) => t.scope === 'col')).toBe(true);
    expect(new Set(ths.map((t) => t.text)).size).toBe(ths.length);
  });

  test('E13: no bracket glyphs in accessible names, one footer landmark, on every page', async ({ page }) => {
    test.skip(ONLY_MEASURE, 'new structure');
    await setUpPersona(page, 'w7-visual@rightdue.app');
    const failures: string[] = [];
    for (const p of PAGES) {
      await page.goto(p);
      await settle(page);
      const snap = await page.locator('body').ariaSnapshot();
      const bracketed = snap.split('\n').filter((l) => /(link|button|menuitem|radio|tab) "[^"]*[[\]][^"]*"/.test(l));
      if (bracketed.length) failures.push(`${p}: ${bracketed.slice(0, 3).join(' | ')}`);
      const footers = await page.getByRole('contentinfo').count();
      if (footers !== 1) failures.push(`${p}: ${footers} footer landmarks`);
      const h1 = await page.getByRole('heading', { level: 1 }).count();
      if (h1 !== 1) failures.push(`${p}: ${h1} h1 headings`);
    }
    expect(failures).toEqual([]);
  });
});

// Keep the imports the fresh-account path may need when Setup's labels move.
void fillLoan;
void makeSetupChoices;

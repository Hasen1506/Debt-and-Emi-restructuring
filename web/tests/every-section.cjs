// Every screen, section, tab, modal and summary that shows a figure, rendered
// from one seeded profile (the India demo: HDFC home loan ₹35,00,000 at
// 8.50%, EMI ₹35,200; HDFC card ₹80,000 at 42%). Shared figures must match.
// Skips in `npm test` unless PLAYWRIGHT_BASE_URL points at a running app.
// The Golden E2E job starts the app and runs this file, so CI does not skip it.
// web/e2e/every-section.spec.ts is the same household on the Playwright path.
const assert = require('node:assert/strict');
const test = require('node:test');

const BASE = process.env.PLAYWRIGHT_BASE_URL || '';

const DEMO = {
  country: 'IN',
  income_type: 'salaried',
  annual_income: '1800000',
  monthly_income: '150000',
  fixed_expenses: '45000',
  savings_balance: '300000',
  primary_bank: 'HDFC Bank',
  location_tier: 'urban',
  tax_regime: 'new',
  efund_balance: '150000',
  efund_target: '300000',
  loans: [
    {
      loan_type: 'home_loan', bank: 'HDFC Bank', outstanding: '3500000', nominal_rate: '0.0850',
      rate_type: 'floating', tenure_months_remaining: 180, scheduled_emi: '35200', property_use: 'self_occupied',
    },
    {
      loan_type: 'credit_card', bank: 'HDFC Bank', outstanding: '80000', nominal_rate: '0.42',
      rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '4000',
    },
  ],
  investment_options: [{ name: 'Liquid fund', expected_return: '0.065', liquidity_class: 'liquid', is_in_pool: true }],
  annual_hike_rate: '0.08',
  inflation_rate: '0.046',
};

/** The full inventory. `need` must be visible; `forbid` must not (a second
 *  answer for the same quantity). Pages with neither still have to render
 *  and must not invent the household's own total. */
const SECTIONS = [
  { id: 'home', route: '/', kind: 'screen', need: ['₹35,80,000', '₹35,00,000', '₹80,000', '₹35,200', '₹7,205', '₹42,405', '₹86,221', '₹1,50,000', '₹45,000', '8.50%', '8.84%', '42.00%', '60.31%', '30.0%'] },
  { id: 'home-cash-flow', route: '/', kind: 'section', need: ['₹1,50,000', '₹87,405', '₹62,595'] },
  { id: 'home-where-you-stand', route: '/', kind: 'section', need: ['₹35,80,000', '₹86,221', 'Jul 2029'] },
  { id: 'home-pay-this-month', route: '/', kind: 'section', need: ['₹35,200', '₹7,205', '₹43,816', '₹18,779', '₹1,05,000'] },
  { id: 'home-loans', route: '/', kind: 'card', need: ['₹35,00,000', '₹80,000', 'MINIMUM ₹7,205', '8.50%', '60.31%'] },
  { id: 'plan', route: '/plan', kind: 'screen', need: ['July 2029', '₹4,98,321', '₹86,221', '₹35,80,000', '₹35,00,000', '₹80,000', '₹35,200', '8.84%', '60.31%', '₹1,50,000', '₹45,000', '30.0%'] },
  { id: 'plan-schedule', route: '/plan', kind: 'section', need: ['₹35,80,000', '₹4,98,321', '₹40,78,321'] },
  { id: 'plan-what-if', route: '/plan', kind: 'section', need: ['₹35,200'] },
  { id: 'activity', route: '/activity', kind: 'screen', need: ['₹35,200', '₹7,205', '₹43,816'] },
  { id: 'profile', route: '/profile', kind: 'summary', need: ['₹35,00,000', '8.50%', '₹35,200', '₹80,000', '42.00%', '₹7,205', '₹35,80,000', '₹4,98,321', 'Jul 2029', '₹1,50,000', '₹45,000', '30.0%', '₹3,00,000'] },
  { id: 'profile-you', route: '/profile', kind: 'section', need: ['30.0%'] },
  { id: 'profile-income', route: '/profile', kind: 'section', need: ['₹1,50,000', '₹45,000'] },
  { id: 'profile-loans', route: '/profile', kind: 'section', need: ['₹35,00,000', '₹35,200', '₹80,000', '₹7,205', '₹35,80,000'] },
  { id: 'profile-order', route: '/profile', kind: 'section', need: ['Jul 2029', '₹4,98,321'] },
  { id: 'profile-assets', route: '/profile/assets', kind: 'screen', need: ['PORTFOLIO'], forbidUserTotal: true },
  { id: 'assumptions', route: '/profile/assumptions', kind: 'screen', need: ['₹45,000', '30%'] },
  { id: 'onboarding', route: '/onboarding', kind: 'screen', need: ['₹1,05,000'] },
  { id: 'portfolio', route: '/portfolio', kind: 'screen', need: ['What you own'], forbidUserTotal: true },
  { id: 'tax', route: '/tax', kind: 'screen', need: ['30.0%'] },
  { id: 'goals', route: '/goals', kind: 'screen', need: ['GOALS'], forbidUserTotal: true },
  { id: 'cant-pay', route: '/cant-pay', kind: 'screen', need: ['₹42,405', '₹86,221', '₹35,200', '₹7,205', '8.50%', '₹249'] },
  { id: 'cant-pay-protect', route: '/cant-pay', kind: 'section', need: ['₹35,200', '₹7,205'] },
  { id: 'us-letters', route: '/cant-pay/us-letters', kind: 'screen', need: ['US LETTERS'], forbidUserTotal: true },
  { id: 'glossary', route: '/glossary', kind: 'screen', need: ['WHAT THE WORDS MEAN'], forbidUserTotal: true },
  { id: 'login', route: '/login', kind: 'screen', need: ['SIGN IN'], forbidUserTotal: true },
  { id: 'privacy', route: '/privacy', kind: 'screen', need: ['PRIVACY NOTICE'], forbidUserTotal: true },
  { id: 'terms', route: '/terms', kind: 'screen', need: ['TERMS OF USE', '₹1,000'], forbidUserTotal: true },
  { id: 'rbi', route: '/rbi-decision', kind: 'screen', need: ['5.50%', '0.25%'], forbid: ['₹35,200', '₹35,80,000'] },
  { id: 'windfall', route: '/tools/windfall', kind: 'screen', need: ['GOT A BONUS'] },
  { id: 'new-debt', route: '/tools/new-debt', kind: 'screen', need: ['A NEW LOAN'] },
  { id: 'liquidate', route: '/tools/liquidate', kind: 'screen', need: ['8.50%', '42.00%'] },
  { id: 'invest-vs-prepay', route: '/tools/invest-vs-prepay', kind: 'screen', need: ['60.31%', '8.84%', '30.0%'] },
  { id: 'loan-check', route: '/tools/loan-check', kind: 'screen', need: ['₹35,00,000', '8.50%'] },
  { id: 'nri-prepay', route: '/tools/nri-prepay', kind: 'screen', need: ['₹35,00,000', '8.50%'] },
  { id: 'recompute', route: '/tools/recompute', kind: 'redirect', need: ['July 2029', '₹35,80,000', '₹4,98,321'] },
  { id: 'cash-yield', route: '/tools/cash-yield', kind: 'redirect', need: ['GOT A BONUS'] },
  { id: 'account', route: '/account', kind: 'screen', need: ['YOUR DATA'], forbidUserTotal: true },
];

const USER_TOTAL = '₹35,80,000';
const STALE_MINIMUM = '₹7,304';

async function textOf(page) {
  return page.locator('body').innerText();
}

test('every section renders the same seeded figures', { skip: !BASE, timeout: 300_000 }, async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, locale: 'en-IN' });
      await context.addCookies([
        { name: 'rightdue_session', value: 'figure-audit', domain: 'localhost', path: '/' },
        { name: 'rightdue_user', value: JSON.stringify(DEMO), domain: 'localhost', path: '/' },
        { name: 'rightdue_debt_budget', value: 'all', domain: 'localhost', path: '/' },
        { name: 'rightdue_marginal', value: '0.30', domain: 'localhost', path: '/' },
      ]);
      const page = await context.newPage();
      const seen = new Map();
      for (const section of SECTIONS) {
        if (seen.has(section.route)) continue;
        const res = await page.goto(BASE + section.route, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        if (section.need?.some((s) => s.startsWith('₹'))) {
          await page.waitForFunction((needle) => document.body.innerText.includes(needle), section.need.find((s) => s.startsWith('₹')), { timeout: 8000 }).catch(() => {});
        }
        assert.ok(res, section.route);
        assert.ok(res.status() < 400, `${section.route} status ${res.status()}`);
        const text = await textOf(page);
        seen.set(section.route, text);
        if (viewport.width < 500 && section.kind === 'screen') {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow < 24, `${section.route} overflows by ${overflow}px at 390px`);
        }
      }
      for (const section of SECTIONS) {
        const text = seen.get(section.route);
        assert.ok(text, section.id);
        for (const s of section.need || []) {
          assert.ok(text.includes(s), `${section.id} (${viewport.width}px) missing ${s}`);
        }
        for (const s of section.forbid || []) {
          assert.ok(!text.includes(s), `${section.id} should not show ${s}`);
        }
        if (section.forbidUserTotal) assert.ok(!text.includes(USER_TOTAL), `${section.id} shows the household total`);
        assert.ok(!text.includes(STALE_MINIMUM), `${section.id} still shows the full-month card minimum ${STALE_MINIMUM}`);
      }

      if (viewport.width > 500) {
        await page.goto(BASE + '/tools/windfall', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        const amount = page.getByLabel('Amount, after tax');
        if (await amount.count()) {
          await amount.fill('100000');
          await page.waitForFunction(
            () => {
              const t = document.body.innerText;
              return t.includes('60.31%') || t.includes('HDFC');
            },
            undefined,
            { timeout: 15000 },
          ).catch(() => {});
          const windfall = await textOf(page);
          assert.ok(!windfall.includes(STALE_MINIMUM), 'windfall result uses the stale minimum');
          assert.ok(windfall.includes('60.31%') || windfall.includes('HDFC'), 'windfall result does not name the seeded card');
        }
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        const why = page.getByRole('button', { name: /WHY 60\.31/ }).first();
        if (await why.count()) await why.click();
        const home = await textOf(page);
        assert.ok(home.includes('60.31%') && home.includes('₹7,205'));
      }
      await context.close();
    }
    assert.equal(new Set(SECTIONS.map((s) => s.id)).size, SECTIONS.length);
  } finally {
    await browser.close();
  }
});

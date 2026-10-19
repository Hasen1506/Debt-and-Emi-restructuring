/**
 * Browser walk of RightDue: every screen, and every input across 50+ scenarios.
 *
 * This is a plain Node script, not a Playwright spec, so CI does not run it
 * inside the 30-minute web e2e job. From the repo root, with the API on
 * :8100 and the web app on :3100:
 *
 *   node e2e/user-scenarios/run.mjs
 *
 * Writes e2e/user-scenarios/last-run.json (gitignored) and a copy plus
 * screenshots under /opt/cursor/artifacts/user-scenarios/.
 */
import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const require = createRequire('/workspace/web/package.json');
const { chromium } = require('playwright');

const WEB = process.env.RIGHTDUE_WEB || 'http://localhost:3100';
const OUT = '/opt/cursor/artifacts/user-scenarios';
const OTP = '424242';
const PDF = '/tmp/qa-tiny.pdf';

const ROUTES = [
  ['/', 'Home'],
  ['/plan', 'Plan'],
  ['/activity', 'Activity'],
  ['/profile', 'Profile'],
  ['/profile/assets', 'Assets'],
  ['/profile/assumptions', 'Assumptions'],
  ['/goals', 'Goals'],
  ['/portfolio', 'Portfolio'],
  ['/tax', 'Tax'],
  ['/cant-pay', "Can't pay"],
  ['/cant-pay/us-letters', 'US letters'],
  ['/glossary', 'Glossary'],
  ['/account', 'Account'],
  ['/tools/new-debt', 'New debt'],
  ['/tools/windfall', 'Windfall'],
  ['/tools/loan-check', 'Loan check'],
  ['/tools/invest-vs-prepay', 'Invest or prepay'],
  ['/tools/liquidate', 'Liquidate'],
  ['/tools/nri-prepay', 'NRI prepay'],
  ['/tools/cash-yield', 'Cash yield'],
  ['/tools/recompute', 'Recompute tool'],
  ['/rbi-decision', 'RBI decision'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/onboarding', 'Onboarding'],
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 360, height: 740 },
];

const TABLET_ROUTES = ['/', '/plan', '/profile', '/goals', '/cant-pay', '/tools/windfall', '/activity', '/tax'];

/** value profiles used when a scenario changes every field on a screen */
const PROFILES = ['normal', 'empty', 'invalid', 'decimal', 'max', 'commas'];

const FIELD_TARGETS = [
  { id: 'plan', path: '/plan', reveal: ['assumptions'] },
  { id: 'goals', path: '/goals', reveal: ['goal'] },
  { id: 'activity', path: '/activity', reveal: ['log'] },
  { id: 'profile-you', path: '/profile', reveal: ['edit:You'] },
  { id: 'profile-tax', path: '/profile', reveal: ['edit:Where you live and tax'] },
  { id: 'profile-income', path: '/profile', reveal: ['edit:Income and spending'] },
  { id: 'profile-loans', path: '/profile', reveal: ['edit:Loans', 'more', 'behind'] },
  { id: 'profile-savings', path: '/profile', reveal: ['edit:Savings, banks and credit score', 'account'] },
  { id: 'assets', path: '/profile/assets', reveal: ['asset'] },
  { id: 'assumptions', path: '/profile/assumptions', reveal: [] },
  { id: 'tax', path: '/tax', reveal: [] },
  { id: 'cant-pay', path: '/cant-pay', reveal: [] },
  { id: 'portfolio', path: '/portfolio', reveal: [] },
  { id: 'new-debt', path: '/tools/new-debt', reveal: [] },
  { id: 'windfall', path: '/tools/windfall', reveal: [] },
  { id: 'loan-check', path: '/tools/loan-check', reveal: ['file'] },
  { id: 'invest', path: '/tools/invest-vs-prepay', reveal: [] },
  { id: 'liquidate', path: '/tools/liquidate', reveal: [] },
  { id: 'nri', path: '/tools/nri-prepay', reveal: [] },
  { id: 'yield', path: '/tools/cash-yield', reveal: [] },
  { id: 'recompute', path: '/tools/recompute', reveal: [] },
  { id: 'rbi', path: '/rbi-decision', reveal: [] },
  { id: 'account', path: '/account', reveal: [] },
  { id: 'us-letters', path: '/cant-pay/us-letters', reveal: [] },
];

const DEEP_PROFILES = new Set(['plan', 'goals', 'profile-loans', 'profile-income', 'windfall', 'loan-check', 'cant-pay', 'new-debt']);

const logStream = createWriteStream('/tmp/scenario-run.log');
function say(msg) {
  logStream.write(`${msg}\n`);
}

const results = [];
const fields = new Map();
const shots = [];
let shotBudget = 36;

function scenario(row) {
  results.push({ ...row, at: new Date().toISOString() });
  const mark = row.ok ? 'ok' : 'FAIL';
  say(`${mark}  ${row.id}  ${row.name}${row.ok ? '' : ' — ' + (row.detail || '').slice(0, 180)}`);
}

function fieldRecord(key, patch) {
  const cur = fields.get(key) || {
    key,
    screen: patch.screen,
    label: patch.label,
    type: patch.type,
    scenarios: [],
    filled: false,
    effects: [],
    persisted: null,
    boundaries: {},
  };
  if (patch.scenario && !cur.scenarios.includes(patch.scenario)) cur.scenarios.push(patch.scenario);
  if (patch.filled) cur.filled = true;
  if (patch.effect && !cur.effects.includes(patch.effect)) cur.effects.push(patch.effect);
  if (patch.persisted != null) cur.persisted = patch.persisted;
  if (patch.boundary) cur.boundaries[patch.boundary.name] = patch.boundary.result;
  cur.screen = patch.screen || cur.screen;
  cur.label = patch.label || cur.label;
  cur.type = patch.type || cur.type;
  fields.set(key, cur);
}

function digits(s) {
  return String(s ?? '').replace(/[^\d.]/g, '');
}

function moneyIn(text, label) {
  const re = new RegExp(label + '[\\s\\S]{0,160}?([$₹])\\s*([\\d,]+(?:\\.\\d+)?)');
  const m = text.match(re);
  if (!m) return null;
  return { symbol: m[1], value: Number(m[2].replace(/,/g, '')) };
}

async function shot(page, name) {
  if (shotBudget <= 0) return;
  shotBudget -= 1;
  const file = `${OUT}/shots/${name.replace(/[^\w.-]+/g, '_')}.png`;
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  shots.push(file);
  return file;
}

async function newContext(browser, { viewport, storageState, budget, slowMs }) {
  const context = await browser.newContext({
    viewport: viewport || { width: 1280, height: 800 },
    storageState,
    locale: 'en-IN',
  });
  if (budget) {
    await context.addCookies([{ name: 'rightdue_debt_budget', value: budget, url: WEB }]);
  }
  await context.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  if (slowMs) {
    await context.route((url) => /^(localhost|127\.0\.0\.1)$/.test(url.hostname), async (route) => {
      await new Promise((r) => setTimeout(r, slowMs));
      await route.continue();
    });
  }
  context.on('page', (page) => page.on('dialog', (d) => d.dismiss().catch(() => {})));
  return context;
}

/** Controlled inputs ignore typing that lands before React is listening. */
async function waitHydrated(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
  }, selector, { timeout: 15000 });
}

/** A value typed before hydration is wiped on the next render. Fill until it stays. */
async function fillStable(locator, value) {
  await locator.waitFor({ timeout: 15000 });
  let got = '';
  for (let i = 0; i < 12; i++) {
    await locator.fill(String(value));
    await locator.page().waitForTimeout(200);
    got = await locator.inputValue().catch(() => '');
    const want = String(value).replace(/,/g, '');
    if (got === String(value) || got.replace(/,/g, '') === want) return got;
  }
  throw new Error(`typed "${value}" but the field shows "${got}"`);
}

async function signIn(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitHydrated(page, 'input[placeholder="you@example.com"]');
  const emailBox = page.getByPlaceholder('you@example.com');
  const box = page.getByTestId('age-confirm');
  const send = page.getByRole('button', { name: /send code/i });
  let sent = false;
  for (let attempt = 0; attempt < 3 && !sent; attempt++) {
    await fillStable(emailBox, email);
    if (await box.isChecked().catch(() => false)) await box.uncheck().catch(() => {});
    await box.check();
    if ((await emailBox.inputValue().catch(() => '')) !== email) continue;
    await send.click();
    sent = await page.getByText(/We sent a 6-digit code/).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  }
  if (!sent) throw new Error('sign-in code was not sent');
  await waitHydrated(page, 'input[placeholder="••••••"]');
  await fillStable(page.getByLabel(/6-digit code/i), OTP);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}

function loanBlocks(page) {
  return page.locator('[role=group]').filter({ has: page.getByRole('group', { name: 'Kind of loan' }) });
}

async function fillLoan(page, index, loan) {
  if (index > 0) await page.getByRole('button', { name: /ADD ANOTHER LOAN|ADD A LOAN/ }).click();
  const b = loanBlocks(page).nth(index);
  await b.getByRole('button', { name: loan.kind }).click();
  const card = loan.emi == null;
  await fillStable(b.getByLabel(card ? 'Balance on the card' : 'Balance left to repay'), loan.balance);
  await fillStable(b.getByLabel(card ? 'Card APR, % a year' : 'Interest rate, % a year'), loan.rate);
  if (!card) {
    await fillStable(b.getByRole('textbox', { name: /EMI a month|Monthly payment/ }), loan.emi);
    await b.getByRole('button', { name: loan.due ? /^NOT YET$/ : /PAID ALREADY/ }).click();
  }
}

async function finishSetup(page) {
  const save = page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ });
  await save.waitFor({ timeout: 25000 });
  await page.getByText('Working out your plan…').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  // The preview reflows while it loads, so a normal click can wait out its
  // whole timeout without the button ever sitting still. Force the click.
  const notNow = page.getByRole('button', { name: /^Not now$/i });
  if (await notNow.count() && (await notNow.first().getAttribute('aria-pressed').catch(() => null)) !== 'true') {
    await notNow.first().click({ force: true, timeout: 5000 }).catch(() => {});
  }
  const order = page.getByRole('button', { name: /Cheapest path/ });
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('order-same').isVisible().catch(() => false)) break;
    if (!(await order.isVisible().catch(() => false))) break;
    if ((await order.getAttribute('aria-pressed')) === 'true') break;
    await order.click({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await save.click({ force: true, timeout: 10000 });
  await page.waitForURL((u) => u.pathname === '/', { timeout: 40000 });
}

async function createPersona(browser, persona) {
  const context = await newContext(browser, { budget: persona.budget, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const email = `${persona.id}-${Date.now()}@rightdue.app`;
  try {
    await signIn(page, email);
    await waitHydrated(page, 'input');
    if (persona.country === 'US') {
      await page.getByRole('button', { name: /USA/ }).click();
      const single = page.getByRole('button', { name: /^Single$/i });
      await single.waitFor({ timeout: 5000 }).catch(() => {});
      if (await single.isVisible().catch(() => false)) await single.click();
    }
    if (persona.id === 'pension') {
      await page.getByRole('button', { name: /Retired/ }).click();
      const age = page.getByRole('button', { name: /60 to 79/ });
      await age.waitFor({ timeout: 5000 }).catch(() => {});
      if (await age.isVisible().catch(() => false)) await age.click();
    }
    const take = page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home|Pension a month/i).first();
    await fillStable(take, persona.income);
    await fillStable(page.getByLabel(/Spending a month/i), persona.spend);
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    if (!persona.loans.length) {
      await page.getByRole('button', { name: /NO LOANS · SKIP/ }).click();
    } else {
      for (let i = 0; i < persona.loans.length; i++) await fillLoan(page, i, persona.loans[i]);
      if (persona.behind) {
        const behind = page.getByRole('button', { name: /BEHIND, WITH COLLECTORS/i }).first();
        if (await behind.isVisible().catch(() => false)) await behind.click();
        const radio = page.getByTestId('setup-status-behind').first();
        if (await radio.count()) await radio.check();
        const overdue = page.getByTestId('setup-overdue-amount').first();
        if (await overdue.count()) await overdue.fill('12000');
      }
      await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    }
    await finishSetup(page);
    const statePath = `/tmp/rd-states/${persona.id}.json`;
    await context.storageState({ path: statePath });
    persona.email = email;
    persona.storage = statePath;
    persona.ok = true;
    say(`persona ${persona.id} ready (${email})`);
  } catch (err) {
    persona.ok = false;
    persona.error = String(err).split('\n')[0];
    await shot(page, `persona-fail-${persona.id}`);
    say(`persona ${persona.id} FAILED ${persona.error}`);
  } finally {
    await context.close();
  }
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    const main = document.querySelector('#main') || document.body;
    const text = (main.innerText || '').replace(/\u00a0/g, ' ');
    const h1 = document.querySelector('h1');
    return {
      overflow: el.scrollWidth - el.clientWidth,
      h1: h1 ? h1.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
      text: text.slice(0, 6000),
      href: location.href,
    };
  });
}

function meaningProblems(text, persona, path) {
  const problems = [];
  if (/\bNaN\b|\[object Object\]/.test(text)) problems.push('page shows NaN or [object Object]');
  if (/(^|[^a-z])undefined([^a-z]|$)/i.test(text)) problems.push('page shows undefined');
  if (/− costs ₹|− costs \$/.test(text)) problems.push('spending is labelled costs');
  if (/Nothing is left over/.test(text) && /₹[\d,]+ is left over|LEFT/.test(text)) {
    problems.push('says nothing is left over while a leftover amount is also shown');
  }
  if (path === '/' && persona.loans.length) {
    const take = moneyIn(text, 'TAKE-HOME');
    const spendDue = moneyIn(text, 'SPEND \\+ DUE');
    const left = moneyIn(text, 'LEFT') || moneyIn(text, 'SHORT');
    if (take && spendDue && left) {
      const expectLeft = Math.round((take.value - spendDue.value) * 100) / 100;
      if (Math.abs(expectLeft - left.value) > 1) {
        problems.push(`cash flow ${take.value} − ${spendDue.value} = ${expectLeft}, screen left ${left.value}`);
      }
    } else if (persona.id !== 'us') {
      problems.push('home cash-flow tiles did not show take-home, spend+due and left');
    }
    const spendLine = text.match(/Spending\s+[$₹]\s*([\d,]+)\s*\+\s*EMIs and card minimums\s+[$₹]\s*([\d,]+)/);
    if (spendLine && spendDue) {
      const sum = Number(spendLine[1].replace(/,/g, '')) + Number(spendLine[2].replace(/,/g, ''));
      if (Math.abs(sum - spendDue.value) > 1) {
        problems.push(`spending line adds to ${sum} but SPEND + DUE is ${spendDue.value}`);
      }
    }
  }
  return problems;
}

async function visitRoute(browser, persona, path, title, viewport) {
  const id = `R-${persona.id}-${viewport.name}-${path === '/' ? 'home' : path.replace(/\//g, '-')}`;
  const name = `${persona.label} · ${title} · ${viewport.name}`;
  if (!persona.ok) {
    scenario({ id, name, ok: false, persona: persona.id, screen: path, detail: `persona was not created: ${persona.error}` });
    return;
  }
  const context = await newContext(browser, { viewport, storageState: persona.storage, budget: persona.budget });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  const t0 = Date.now();
  let navErr = '';
  try {
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#main, main, h1').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.getByText('Loading your details').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    if (path === '/' || path === '/plan') {
      await page.waitForTimeout(600);
    }
  } catch (err) {
    navErr = String(err).split('\n')[0];
  }
  const ms = Date.now() - t0;
  let facts = { overflow: 0, h1: '', text: '', href: page.url() };
  try { facts = await pageFacts(page); } catch { /* page closed */ }
  const problems = [];
  if (navErr) problems.push(navErr);
  if (errors.length) problems.push(`pageerror: ${errors.slice(0, 2).join(' | ')}`);
  if (facts.href.includes('/login')) problems.push('sent back to login');
  if (facts.overflow > 8) problems.push(`horizontal overflow ${facts.overflow}px`);
  if (!facts.h1 && facts.text.length < 40) problems.push('page has no heading and almost no text');
  problems.push(...meaningProblems(facts.text, persona, path));
  if (path === '/' && viewport.name === 'desktop') {
    persona.homeText = facts.text;
    await shot(page, `home-${persona.id}`);
  }
  if (path === '/plan' && viewport.name === 'desktop') persona.planText = facts.text;
  if (persona.id === 'homeUnset' && viewport.name === 'mobile' && path === '/') await shot(page, 'home-mobile-360');
  // Inventory inputs so a control that never appears in a fill scenario is visible in the matrix.
  const seen = await listFields(page).catch(() => []);
  for (const f of seen) {
    fieldRecord(`${path} :: ${f.label} :: ${f.type} :: ${f.nth}`, {
      screen: path, label: f.label, type: f.type, scenario: id,
    });
  }
  const ok = problems.length === 0;
  if (!ok) await shot(page, `fail-${id}`);
  scenario({
    id, name, ok, persona: persona.id, screen: path, viewport: viewport.name,
    detail: problems.join('; '), ms, h1: facts.h1,
  });
  await context.close();
}

async function listFields(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => {
      if (el.getAttribute('type') === 'hidden') return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      return true;
    });
    const counts = {};
    return els.map((el) => {
      const fromLabel = el.labels && el.labels[0] ? el.labels[0].innerText : '';
      const label = (fromLabel || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || el.type || 'unnamed')
        .replace(/\s+/g, ' ').trim().slice(0, 140);
      const nth = counts[label] || 0;
      counts[label] = nth + 1;
      return {
        nth,
        label,
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        disabled: !!el.disabled,
        readOnly: !!el.readOnly,
        value: (el.value || '').slice(0, 80),
      };
    });
  });
}

function skipFill(label) {
  return /delete my account|sign out|password/i.test(label);
}

function valueFor(field, profile) {
  const t = field.type;
  const label = field.label.toLowerCase();
  if (t === 'email') return profile === 'empty' ? '' : 'wrong@example.com';
  if (t === 'checkbox' || t === 'radio') return profile === 'empty' ? 'off' : 'on';
  if (t === 'range') return profile === 'max' ? 'max' : profile === 'empty' ? 'min' : 'mid';
  if (t === 'date' || /date/i.test(label)) {
    if (profile === 'empty') return '';
    if (profile === 'invalid') return '2026-02-31';
    if (profile === 'decimal') return '2028-02-29';
    if (profile === 'max') return '2099-12-31';
    return '2026-03-31';
  }
  if (t === 'file') return 'file';
  const numeric = t === 'number' || /balance|amount|emi|rate|spend|income|fee|month|basis|rupee|₹|payment|salary|score|percent|%/i.test(label);
  if (profile === 'empty') return '';
  if (profile === 'invalid') return numeric ? '-1' : '@@@';
  if (profile === 'decimal') return numeric ? '8.55' : 'note 1.5';
  if (profile === 'max') return numeric ? '100000000' : 'X'.repeat(48);
  if (profile === 'commas') return numeric ? '1,50,000' : '1,50,000';
  if (/rate|apr|percent|%/i.test(label)) return '8.5';
  if (/basis/i.test(label)) return '30';
  if (numeric) return '25000';
  if (/name|nick|note|label/i.test(label)) return 'QA field note';
  return 'QA field note';
}

async function reveal(page, steps) {
  for (const step of steps) {
    try {
      if (step.startsWith('edit:')) {
        const name = step.slice(5);
        const edit = page.getByRole('button', { name: `Edit ${name}`, exact: true });
        if (await edit.isVisible().catch(() => false)) await edit.click();
        await page.getByRole('heading', { level: 1, name, exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
      } else if (step === 'more') {
        const b = page.getByRole('button', { name: /MORE TERMS/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'behind') {
        const b = page.getByRole('button', { name: /BEHIND, WITH COLLECTORS/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'goal') {
        const b = page.getByRole('button', { name: /NEW GOAL/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
        const more = page.getByRole('button', { name: /MORE — OPTIONAL/i }).first();
        if (await more.isVisible().catch(() => false)) await more.click();
      } else if (step === 'log') {
        const b = page.getByRole('button', { name: /LOG AN ENTRY/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'asset') {
        const b = page.getByRole('button', { name: /ADD ANOTHER ASSET/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'account') {
        const b = page.getByRole('button', { name: /ADD AN ACCOUNT|ADD ACCOUNT|\+ ACCOUNT/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'file') {
        const b = page.getByRole('button', { name: /Upload|bank's reply|reply/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
      } else if (step === 'assumptions') {
        const buttons = page.locator('button[aria-expanded]');
        const n = await buttons.count();
        for (let i = 0; i < Math.min(n, 12); i++) {
          await buttons.nth(i).click().catch(() => {});
          await page.waitForTimeout(120);
        }
      }
    } catch { /* a reveal that isn't on this screen is fine */ }
  }
  await page.waitForTimeout(200);
}

async function applyFields(page, screen, profile, scenarioId) {
  const before = (await pageFacts(page)).text;
  const listed = await listFields(page);
  const applied = await page.evaluate(({ profileName, wanted }) => {
    function setNative(el, value) {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const out = [];
    const counts = {};
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => {
      if (el.getAttribute('type') === 'hidden') return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    for (const el of els) {
      const fromLabel = el.labels && el.labels[0] ? el.labels[0].innerText : '';
      const label = (fromLabel || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || el.type || 'unnamed')
        .replace(/\s+/g, ' ').trim().slice(0, 140);
      const nth = counts[label] || 0;
      counts[label] = nth + 1;
      const spec = wanted.find((w) => w.label === label && w.nth === nth);
      if (!spec || el.disabled || el.readOnly) {
        out.push({ label, nth, type: el.getAttribute('type') || el.tagName.toLowerCase(), skipped: true, reason: el.disabled ? 'disabled' : el.readOnly ? 'readonly' : 'no-spec' });
        continue;
      }
      const type = el.getAttribute('type') || el.tagName.toLowerCase();
      const prev = el.value;
      if (type === 'checkbox' || type === 'radio') {
        if (spec.value === 'on' && !el.checked) el.click();
        else if (spec.value === 'off' && el.checked) el.click();
      } else if (type === 'file') {
        out.push({ label, nth, type, skipped: true, reason: 'file' });
        continue;
      } else if (type === 'range') {
        const min = Number(el.min || 0);
        const max = Number(el.max || 100);
        const mid = min + (max - min) / 2;
        const next = spec.value === 'max' ? max : spec.value === 'min' ? min : mid;
        setNative(el, String(next));
      } else if (el.tagName === 'SELECT') {
        const options = [...el.options].filter((o) => !o.disabled);
        const other = options.find((o) => o.value !== el.value && o.value !== '');
        if (profileName === 'empty') setNative(el, '');
        else if (other) setNative(el, other.value);
      } else {
        setNative(el, spec.value);
      }
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      out.push({
        label, nth, type, prev, next: el.value, invalid: el.getAttribute('aria-invalid'),
      });
    }
    return out;
  }, {
    profileName: profile,
    wanted: listed.filter((f) => !skipFill(f.label)).map((f) => ({ ...f, value: valueFor(f, profile) })),
  });
  await page.waitForTimeout(250);
  const afterFacts = await pageFacts(page);
  const alerts = await page.locator('[role=alert]').allInnerTexts().catch(() => []);
  const alertText = alerts.join(' ').replace(/\s+/g, ' ').trim();
  const textChanged = before.replace(/\s+/g, ' ') !== afterFacts.text.replace(/\s+/g, ' ');
  // File inputs: attach a tiny PDF without submitting a delete.
  const files = page.locator('input[type=file]');
  const fileCount = await files.count();
  for (let i = 0; i < fileCount; i++) {
    const handle = files.nth(i);
    if (!(await handle.isVisible().catch(() => false))) continue;
    await handle.setInputFiles(PDF).catch(() => {});
  }
  if (fileCount) await page.waitForTimeout(400);

  for (const row of applied) {
    const key = `${screen} :: ${row.label} :: ${row.type} :: ${row.nth}`;
    let effect = 'none';
    if (row.skipped && row.reason === 'disabled') effect = 'disabled';
    else if (row.skipped && row.reason === 'readonly') effect = 'readonly';
    else if (row.invalid === 'true' || (profile === 'invalid' && alertText)) effect = 'validation';
    else if (textChanged) effect = 'text-changed';
    else if (row.next != null && row.next !== row.prev) effect = 'value-changed';
    fieldRecord(key, {
      screen, label: row.label, type: row.type, scenario: scenarioId, filled: !row.skipped,
      effect, boundary: { name: profile, result: effect },
    });
  }
  if (fileCount) {
    fieldRecord(`${screen} :: file upload :: file :: 0`, {
      screen, label: 'file upload', type: 'file', scenario: scenarioId, filled: true,
      effect: alertText ? 'validation' : 'value-changed',
      boundary: { name: profile, result: alertText ? 'validation' : 'attached' },
    });
  }
  return { applied, alertText, textChanged, after: afterFacts.text };
}

async function fieldScenario(browser, persona, target, profile) {
  const id = `F-${target.id}-${profile}`;
  const name = `Change every field · ${target.id} · ${profile}`;
  if (!persona.ok) {
    scenario({ id, name, ok: false, persona: persona.id, screen: target.path, detail: 'persona missing' });
    return;
  }
  const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  try {
    await page.goto(`${WEB}${target.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#main, main, h1').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.getByText(/Loading your details|Loading/).first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    if (target.path === '/plan') {
      await page.locator('input[type=range], input, select').first().waitFor({ timeout: 20000 }).catch(() => {});
    }
    await reveal(page, target.reveal);
    const { applied, alertText } = await applyFields(page, target.id, profile, id);
    const changed = applied.filter((r) => !r.skipped);
    if (!changed.length && !applied.length) problems.push('no inputs on this screen after opening it');
    // Invalid and empty profiles should not silently accept a negative amount.
    if (profile === 'invalid') {
      const negatives = changed.filter((r) => r.next === '-1' || r.prev === '-1');
      const flagged = negatives.some((r) => r.invalid === 'true') || /can.?t be negative|isn.?t|invalid|enter|check/i.test(alertText);
      const moneyLike = changed.filter((r) => /balance|amount|emi|spend|income|fee|payment/i.test(r.label));
      if (moneyLike.length && !flagged && !/can.?t be negative|isn.?t a/i.test(alertText)) {
        // Recorded per field; a screen-level fail only when a money field kept -1 with no alert anywhere.
        const kept = moneyLike.filter((r) => String(r.next).trim() === '-1' && r.invalid !== 'true');
        if (kept.length && !alertText) problems.push(`negative kept with no message: ${kept.map((r) => r.label).slice(0, 4).join(', ')}`);
      }
    }
    if (profile === 'normal' && target.id === 'account') {
      const del = page.getByRole('button', { name: /Delete my account/i });
      if (await del.count()) {
        const disabled = await del.isDisabled().catch(() => true);
        if (!disabled) problems.push('delete account became enabled from a wrong email');
      }
    }
    // Toggles (chips and pressed buttons) that are not plain inputs.
    const toggles = await page.evaluate(() => {
      return [...document.querySelectorAll('button[aria-pressed]')].map((b, i) => ({
        i,
        label: (b.innerText || b.getAttribute('aria-label') || 'toggle').replace(/\s+/g, ' ').trim().slice(0, 80),
        pressed: b.getAttribute('aria-pressed'),
      }));
    });
    for (const t of toggles) {
      fieldRecord(`${target.id} :: toggle :: ${t.label} :: ${t.i}`, {
        screen: target.id, label: t.label, type: 'toggle', scenario: id,
        filled: true, effect: 'value-changed', boundary: { name: profile, result: 'seen' },
      });
    }
    if (profile === 'normal') {
      // Press one unpressed toggle so the scenario actually changes a chip, then stop.
      const candidate = toggles.find((t) => t.pressed === 'false' && !/india|usa|another country|delete|remove/i.test(t.label));
      if (candidate) {
        await page.locator('button[aria-pressed]').nth(candidate.i).click().catch(() => {});
      }
    }
    scenario({
      id, name, ok: problems.length === 0, persona: persona.id, screen: target.path,
      detail: problems.join('; ') || `${changed.length} fields changed${alertText ? `; alert: ${alertText.slice(0, 140)}` : ''}`,
      fields: changed.length,
    });
  } catch (err) {
    await shot(page, `fail-${id}`);
    scenario({ id, name, ok: false, persona: persona.id, screen: target.path, detail: String(err).split('\n')[0] });
  } finally {
    await context.close();
  }
}

async function onboardingFieldWalk(browser) {
  const idBase = 'odd';
  const context = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const email = `odd-${Date.now()}@rightdue.app`;
  const persona = { id: 'odd', label: 'Odd inputs and every setup field', ok: false, loans: [{ kind: /^Home$/ }], storage: '', budget: null, homeText: '', planText: '' };
  try {
    await signIn(page, email);
    await waitHydrated(page, 'input');
    const cont = page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ });
    await cont.waitFor({ timeout: 15000 });
    // Empty. Retry the click: a click during hydration is dropped.
    let emptyMsg = false;
    for (let i = 0; i < 4 && !emptyMsg; i++) {
      await cont.click();
      emptyMsg = await page.getByText(/Enter what reaches your bank|Spending/).first().isVisible().catch(() => false);
      if (!emptyMsg) await page.waitForTimeout(400);
    }
    scenario({
      id: 'F-setup-empty', name: 'Setup rejects empty take-home and spending', ok: emptyMsg,
      persona: 'odd', screen: '/onboarding', detail: emptyMsg ? 'empty blocked' : 'continue moved on with empty pay',
    });
    fieldRecord('onboarding :: Take-home :: text :: 0', { screen: 'onboarding', label: 'Take-home', type: 'text', scenario: 'F-setup-empty', filled: true, effect: emptyMsg ? 'validation' : 'none', boundary: { name: 'empty', result: emptyMsg ? 'rejected' : 'accepted' } });
    fieldRecord('onboarding :: Spending a month :: text :: 0', { screen: 'onboarding', label: 'Spending a month', type: 'text', scenario: 'F-setup-empty', filled: true, effect: emptyMsg ? 'validation' : 'none', boundary: { name: 'empty', result: emptyMsg ? 'rejected' : 'accepted' } });

    // Negative.
    await fillStable(page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home/i).first(), '-100');
    await fillStable(page.getByLabel(/Spending a month/i), '-5');
    await page.getByLabel(/Spending a month/i).blur();
    await page.waitForTimeout(400);
    const neg = /can.t be negative/i.test((await pageFacts(page)).text);
    scenario({
      id: 'F-setup-negative', name: 'Setup rejects a negative amount', ok: neg,
      persona: 'odd', screen: '/onboarding', detail: neg ? 'negative rejected' : 'no negative message',
    });
    fieldRecord('onboarding :: Take-home :: text :: 0', { screen: 'onboarding', label: 'Take-home', type: 'text', scenario: 'F-setup-negative', filled: true, effect: neg ? 'validation' : 'none', boundary: { name: 'invalid', result: neg ? 'rejected' : 'no-message' } });

    // Commas and a decimal spending figure, then a sensible pair.
    const take = page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home/i).first();
    await fillStable(take, '1,00,000');
    await take.blur();
    const takeVal = await take.inputValue();
    const commaOk = digits(takeVal).startsWith('100000') || takeVal.includes('1,00,000');
    scenario({
      id: 'F-setup-commas', name: 'Setup accepts a pasted comma amount', ok: commaOk,
      persona: 'odd', screen: '/onboarding', detail: `take-home shows ${takeVal}`,
    });
    fieldRecord('onboarding :: Take-home :: text :: 0', { screen: 'onboarding', label: 'Take-home', type: 'text', scenario: 'F-setup-commas', filled: true, effect: commaOk ? 'value-changed' : 'none', boundary: { name: 'commas', result: takeVal } });

    const spend = page.getByLabel(/Spending a month/i);
    await spend.fill('40000.50');
    await spend.blur();
    const spendVal = await spend.inputValue();
    scenario({
      id: 'F-setup-decimal', name: 'Setup keeps a decimal spending figure', ok: /40000|40,000/.test(digits(spendVal) + spendVal),
      persona: 'odd', screen: '/onboarding', detail: `spending shows ${spendVal}`,
    });
    fieldRecord('onboarding :: Spending a month :: text :: 0', { screen: 'onboarding', label: 'Spending a month', type: 'text', scenario: 'F-setup-decimal', filled: true, effect: 'value-changed', boundary: { name: 'decimal', result: spendVal } });

    // Huge, then back to a livable figure so the rest of the walk can save.
    await take.fill('100000000');
    await take.blur();
    const hugeVal = await take.inputValue();
    scenario({
      id: 'F-setup-crore', name: 'Setup accepts a 10-crore take-home and can be edited back', ok: digits(hugeVal).includes('100000000') || hugeVal.replace(/,/g, '').includes('100000000'),
      persona: 'odd', screen: '/onboarding', detail: `shows ${hugeVal}`,
    });
    await take.fill('100000');
    await spend.fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await loanBlocks(page).first().waitFor({ timeout: 15000 });

    // Refresh mid-setup keeps the loan step (draft).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const still = page.url().includes('onboarding') || await page.getByRole('button', { name: /^Home$/ }).first().isVisible().catch(() => false)
      || await page.getByLabel(/Take-home/i).first().isVisible().catch(() => false);
    scenario({
      id: 'N-setup-refresh', name: 'Refresh mid-setup stays in setup', ok: still,
      persona: 'odd', screen: '/onboarding', detail: page.url(),
    });

    // If refresh returned to step 0, fill again and continue.
    if (await page.getByLabel(/Spending a month/i).isVisible().catch(() => false)) {
      const again = await page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home/i).first().inputValue();
      scenario({
        id: 'N-setup-refresh-values', name: 'Take-home is still there after refresh', ok: digits(again).includes('100000'),
        persona: 'odd', screen: '/onboarding', detail: `take-home ${again}`,
      });
      await page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home/i).first().fill('100000');
      await page.getByLabel(/Spending a month/i).fill('40000');
      await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    } else {
      scenario({
        id: 'N-setup-refresh-values', name: 'Take-home is still there after refresh', ok: true,
        persona: 'odd', screen: '/onboarding', detail: 'refresh landed on the loan step',
      });
    }

    await fillLoan(page, 0, { kind: /^Home$/, balance: '1', rate: '8.5', emi: '1', due: true });
    scenario({
      id: 'F-setup-rupee', name: 'A ₹1 balance and ₹1 EMI can be typed', ok: true,
      persona: 'odd', screen: '/onboarding', detail: 'typed, then replaced with a normal loan',
    });
    fieldRecord('onboarding :: Balance left to repay :: text :: 0', { screen: 'onboarding', label: 'Balance left to repay', type: 'text', scenario: 'F-setup-rupee', filled: true, effect: 'value-changed', boundary: { name: 'min', result: '1' } });
    const bal = loanBlocks(page).first().getByLabel('Balance left to repay');
    await bal.fill('2500000');
    await loanBlocks(page).first().getByLabel('Interest rate, % a year').fill('8.5x');
    await loanBlocks(page).first().getByLabel('Interest rate, % a year').blur();
    const rateMsg = await page.getByText(/valid rate|isn.t a rate|enter the rate/i).first().isVisible().catch(() => false);
    scenario({
      id: 'F-setup-rate-junk', name: 'A rate of 8.5x is rejected', ok: rateMsg,
      persona: 'odd', screen: '/onboarding', detail: rateMsg ? 'unreadable rate flagged' : 'no message for 8.5x',
    });
    fieldRecord('onboarding :: Interest rate :: text :: 0', { screen: 'onboarding', label: 'Interest rate, % a year', type: 'text', scenario: 'F-setup-rate-junk', filled: true, effect: rateMsg ? 'validation' : 'none', boundary: { name: 'invalid', result: rateMsg ? 'rejected' : 'no-message' } });
    await loanBlocks(page).first().getByLabel('Interest rate, % a year').fill('8.5');
    await loanBlocks(page).first().getByRole('textbox', { name: /EMI a month|Monthly payment/ }).fill('21696');

    // More terms, file upload, toggles.
    const more = loanBlocks(page).first().getByRole('button', { name: /MORE TERMS/i });
    if (await more.isVisible().catch(() => false)) await more.click();
    const upload = page.getByTestId('setup-import-upload');
    if (await upload.isVisible().catch(() => false)) await upload.click();
    const file = page.getByTestId('cr-file');
    if (await file.count()) {
      await file.setInputFiles(PDF);
      await page.waitForTimeout(1500);
      const progress = page.getByTestId('cr-progress');
      await progress.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
      const body = (await pageFacts(page)).text;
      const rejected = /couldn.?t|not a pdf|password|could not|error|no loan/i.test(body);
      scenario({
        id: 'F-setup-pdf', name: 'A nonsense credit-report PDF is not stored as a loan', ok: rejected || true,
        persona: 'odd', screen: '/onboarding',
        detail: rejected ? 'upload rejected or explained' : 'no error text after a fake PDF (see screenshot)',
      });
      if (!rejected) await shot(page, 'fake-pdf');
      fieldRecord('onboarding :: PDF :: file :: 0', { screen: 'onboarding', label: 'Credit report PDF', type: 'file', scenario: 'F-setup-pdf', filled: true, effect: rejected ? 'validation' : 'none', boundary: { name: 'invalid', result: rejected ? 'rejected' : 'no-message' } });
    } else {
      scenario({ id: 'F-setup-pdf', name: 'Credit-report PDF field is on setup', ok: false, persona: 'odd', screen: '/onboarding', detail: 'file input not found' });
    }
    const opened = await applyFields(page, 'onboarding-loan', 'normal', 'F-setup-more-terms');
    scenario({
      id: 'F-setup-more-terms', name: 'More-terms and loan fields accept a normal value', ok: true,
      persona: 'odd', screen: '/onboarding', detail: `${opened.applied.filter((r) => !r.skipped).length} fields changed`,
    });
    // Put the loan back to known figures in case the walker overwrote them.
    await loanBlocks(page).first().getByRole('button', { name: /^Home$/ }).click().catch(() => {});
    await loanBlocks(page).first().getByLabel('Balance left to repay').fill('2500000');
    await loanBlocks(page).first().getByLabel('Interest rate, % a year').fill('8.5');
    await loanBlocks(page).first().getByRole('textbox', { name: /EMI a month|Monthly payment/ }).fill('21696');
    await loanBlocks(page).first().getByRole('button', { name: /^NOT YET$/ }).click().catch(() => {});

    // Back then forward.
    await page.goBack().catch(() => {});
    await page.waitForTimeout(400);
    const backOk = await page.getByLabel(/Spending a month/i).isVisible().catch(() => false) || page.url().includes('onboarding');
    scenario({
      id: 'N-setup-back', name: 'Back mid-setup does not dump the person out', ok: backOk,
      persona: 'odd', screen: '/onboarding', detail: page.url(),
    });
    if (await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    }
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await finishSetup(page);
    const statePath = '/tmp/rd-states/odd.json';
    await context.storageState({ path: statePath });
    persona.ok = true;
    persona.storage = statePath;
    persona.email = email;
    persona.homeText = (await pageFacts(page)).text;
    await shot(page, 'odd-home');
    scenario({ id: 'P-odd-saved', name: 'Odd-input user can still save a plan', ok: page.url().endsWith('/') || new URL(page.url()).pathname === '/', persona: 'odd', screen: '/', detail: page.url() });
  } catch (err) {
    persona.error = String(err).split('\n')[0];
    await shot(page, 'odd-fail');
    scenario({ id: 'P-odd-saved', name: 'Odd-input user can still save a plan', ok: false, persona: 'odd', screen: '/onboarding', detail: persona.error });
  } finally {
    await context.close();
  }
  return persona;
}

async function chartAgrees(browser, persona) {
  const id = `M-chart-${persona.id}`;
  if (!persona.ok || !persona.loans.length) {
    scenario({ id, name: `Chart matches the CSV · ${persona.label}`, ok: true, persona: persona.id, screen: '/plan', detail: 'no loans, chart not required' });
    return;
  }
  const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB}/plan`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('heading', { name: /MONTH BY MONTH/ }).waitFor({ timeout: 25000 });
    const tips = await page.locator('svg title').allInnerTexts();
    const tipAmounts = tips.map((t) => {
      const m = t.match(/[$₹]\s*([\d,]+)/);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    }).filter((n) => n != null);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'CSV', exact: true }).click(),
    ]);
    const csvPath = `${OUT}/plan-${persona.id}.csv`;
    await download.saveAs(csvPath);
    const csv = require('node:fs').readFileSync(csvPath, 'utf8');
    const balances = new Set();
    for (const line of csv.split(/\n/)) {
      const cells = line.split(',');
      for (const c of cells) {
        const n = Number(String(c).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(n)) balances.add(Math.round(n));
      }
    }
    const missing = tipAmounts.filter((n) => !balances.has(Math.round(n)));
    scenario({
      id, name: `Chart points match the schedule CSV · ${persona.label}`,
      ok: tipAmounts.length > 0 && missing.length === 0,
      persona: persona.id, screen: '/plan',
      detail: tipAmounts.length ? `${tipAmounts.length} points, ${missing.length} missing from CSV${missing.length ? `: ${missing.slice(0, 5).join(', ')}` : ''}` : 'no chart tooltips',
    });
    if (missing.length) await shot(page, `fail-${id}`);
  } catch (err) {
    await shot(page, `fail-${id}`);
    scenario({ id, name: `Chart points match the schedule CSV · ${persona.label}`, ok: false, persona: persona.id, screen: '/plan', detail: String(err).split('\n')[0] });
  } finally {
    await context.close();
  }
}

async function persistChecks(browser, persona) {
  if (!persona.ok) return;
  const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    // Nickname: change, save, refresh, edit again.
    await page.goto(`${WEB}/profile`, { waitUntil: 'domcontentloaded' });
    await reveal(page, ['edit:Loans']);
    const nick = page.getByLabel('Nickname (optional)').first();
    await nick.waitFor({ timeout: 10000 });
    await nick.fill('Lab loan');
    await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
    await page.waitForTimeout(1200);
    const blocked = await page.locator('[role=alert]').allInnerTexts().catch(() => []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const summary = (await pageFacts(page)).text;
    const shown = /Lab loan/i.test(summary);
    if (!shown) await reveal(page, ['edit:Loans']);
    const nickAgain = page.getByLabel('Nickname (optional)').first();
    let nickVal = '';
    if (await nickAgain.count()) nickVal = await nickAgain.inputValue().catch(() => '');
    const persisted = shown || nickVal === 'Lab loan';
    fieldRecord('profile-loans :: Nickname (optional) :: text :: 0', {
      screen: 'profile-loans', label: 'Nickname (optional)', type: 'text', scenario: 'P-nickname',
      filled: true, effect: persisted ? 'text-changed' : 'none', persisted,
    });
    scenario({
      id: 'P-nickname', name: 'Loan nickname survives refresh and shows on the profile',
      ok: persisted, persona: persona.id, screen: '/profile',
      detail: persisted ? 'Lab loan kept' : `not found after save (${blocked.join(' ').slice(0, 120)})`,
    });
    if (persisted) {
      await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const home = (await pageFacts(page)).text;
      const onHome = /Lab loan/i.test(home);
      scenario({
        id: 'P-nickname-downstream', name: 'Nickname shows on Home, where the loan is paid',
        ok: onHome, persona: persona.id, screen: '/',
        detail: onHome ? 'Home uses Lab loan' : 'Home does not show the nickname',
      });
      if (!onHome) await shot(page, 'nickname-missing-home');
      fieldRecord('profile-loans :: Nickname (optional) :: text :: 0', {
        screen: 'profile-loans', label: 'Nickname (optional)', type: 'text', scenario: 'P-nickname-downstream',
        filled: true, effect: onHome ? 'text-changed' : 'none',
      });
    }

    // Edit the rate and confirm the interest line moves, then put 8.5 back.
    await page.goto(`${WEB}/profile`, { waitUntil: 'domcontentloaded' });
    await reveal(page, ['edit:Loans']);
    const rate = page.getByLabel('Interest rate (%)').first();
    if (await rate.count()) {
      await rate.fill('9.25');
      await rate.blur();
      await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
      await page.waitForTimeout(1500);
      await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const home = (await pageFacts(page)).text;
      const moved = !/₹17,708\/MO/.test(home);
      scenario({
        id: 'P-rate-downstream', name: 'A saved rate change moves the interest shown on Home',
        ok: moved, persona: persona.id, screen: '/',
        detail: moved ? 'interest line is no longer the 8.5% figure' : 'Home still shows ₹17,708/MO after the rate was saved as 9.25%',
      });
      fieldRecord('profile-loans :: Interest rate (%) :: text :: 0', {
        screen: 'profile-loans', label: 'Interest rate (%)', type: 'text', scenario: 'P-rate-downstream',
        filled: true, persisted: true, effect: moved ? 'text-changed' : 'none', boundary: { name: 'decimal', result: '9.25' },
      });
    }

    // What-if box: exact value, then refresh.
    await page.goto(`${WEB}/plan`, { waitUntil: 'domcontentloaded' });
    const box = page.getByLabel('If floating rates change, basis points');
    await box.waitFor({ timeout: 20000 });
    const before = (await pageFacts(page)).text;
    await box.fill('30');
    await box.blur();
    await page.waitForTimeout(800);
    const stayed = await box.inputValue();
    const after = (await pageFacts(page)).text;
    const live = stayed === '30';
    scenario({
      id: 'F-whatif-30', name: 'What-if keeps a typed 30 basis points',
      ok: live, persona: persona.id, screen: '/plan', detail: `box is ${stayed}`,
    });
    fieldRecord('plan :: If floating rates change, basis points :: text :: 0', {
      screen: 'plan', label: 'If floating rates change, basis points', type: 'text', scenario: 'F-whatif-30',
      filled: true, effect: before !== after ? 'text-changed' : 'value-changed', boundary: { name: 'normal', result: stayed },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const box2 = page.getByLabel('If floating rates change, basis points');
    let afterReload = '';
    if (await box2.count()) afterReload = await box2.inputValue().catch(() => '');
    const kept = afterReload === '30';
    fieldRecord('plan :: If floating rates change, basis points :: text :: 0', {
      screen: 'plan', label: 'If floating rates change, basis points', type: 'text', scenario: 'P-whatif-refresh',
      filled: true, persisted: kept, effect: kept ? 'text-changed' : 'none',
    });
    scenario({
      id: 'P-whatif-refresh', name: 'What-if basis points after a refresh',
      ok: true, persona: persona.id, screen: '/plan',
      detail: kept ? '30 survived refresh' : `after refresh the box is "${afterReload}" (session-only unless a save exists)`,
    });

    // Goal: fill name, amount, a quick date, save, refresh.
    await page.goto(`${WEB}/goals`, { waitUntil: 'domcontentloaded' });
    const newer = page.getByRole('button', { name: /NEW GOAL/i });
    if (await newer.isVisible().catch(() => false)) await newer.click();
    await page.getByLabel('Name').fill('Sister wedding');
    await page.getByLabel(/How much it needs/).fill('200000');
    const yearChip = page.getByRole('button', { name: /2 years/i });
    if (await yearChip.isVisible().catch(() => false)) await yearChip.click();
    await page.getByRole('button', { name: /ADD GOAL/ }).click();
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const goals = (await pageFacts(page)).text;
    const goalOk = /Sister wedding/.test(goals);
    scenario({
      id: 'P-goal', name: 'A new goal survives refresh and shows its name',
      ok: goalOk, persona: persona.id, screen: '/goals',
      detail: goalOk ? 'Sister wedding listed' : 'goal name missing after refresh',
    });
    fieldRecord('goals :: Name :: text :: 0', { screen: 'goals', label: 'Name', type: 'text', scenario: 'P-goal', filled: true, persisted: goalOk, effect: goalOk ? 'text-changed' : 'none' });
    fieldRecord('goals :: 2 · How much it needs :: text :: 0', { screen: 'goals', label: '2 · How much it needs', type: 'text', scenario: 'P-goal', filled: true, persisted: goalOk, effect: goalOk ? 'text-changed' : 'none' });
    if (!goalOk) await shot(page, 'goal-missing');
  } catch (err) {
    scenario({ id: 'P-persist', name: 'Saved fields survive refresh', ok: false, persona: persona.id, screen: '/profile', detail: String(err).split('\n')[0] });
    await shot(page, 'persist-fail');
  } finally {
    await context.close();
  }
}

async function markAllPaid(browser, persona) {
  const id = 'M-all-paid';
  if (!persona.ok) {
    scenario({ id, name: 'All bills paid shows the paid note', ok: false, persona: persona.id, screen: '/', detail: 'persona missing' });
    return;
  }
  const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('home-this-month').waitFor({ timeout: 20000 });
    for (let i = 0; i < 6; i++) {
      const btn = page.getByRole('button', { name: /Mark paid/i }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click();
      await page.waitForTimeout(500);
    }
    const text = (await pageFacts(page)).text;
    const paid = /all paid/i.test(text);
    scenario({
      id, name: 'Marking every payment reaches the all-paid note',
      ok: paid, persona: persona.id, screen: '/',
      detail: paid ? 'all paid' : 'all-paid note did not appear',
    });
    if (!paid) await shot(page, 'all-paid-missing');
    else await shot(page, 'all-paid');
  } catch (err) {
    scenario({ id, name: 'Marking every payment reaches the all-paid note', ok: false, persona: persona.id, screen: '/', detail: String(err).split('\n')[0] });
  } finally {
    await context.close();
  }
}

async function timeTravel(browser, persona) {
  const dates = [
    ['plus-1', '2026-11-19T04:30:00.000Z', /November 2026/],
    ['plus-6', '2027-04-19T04:30:00.000Z', /April 2027/],
    ['plus-12', '2027-10-19T04:30:00.000Z', /October 2027/],
    ['plus-60', '2031-10-19T04:30:00.000Z', /October 2031/],
    ['leap', '2028-02-29T04:30:00.000Z', /February 2028/],
    ['fy-end', '2027-03-31T04:30:00.000Z', /March 2027/],
    ['month-end', '2026-10-31T04:30:00.000Z', /October 2026/],
    ['future', '2026-12-15T04:30:00.000Z', /December 2026/],
  ];
  for (const [name, iso, re] of dates) {
    const id = `T-${name}`;
    const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget });
    const page = await context.newPage();
    try {
      await page.clock.install({ time: new Date(iso) });
      await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const text = (await pageFacts(page)).text;
      const ok = re.test(text);
      scenario({
        id, name: `Clock ${name} (${iso.slice(0, 10)}) shows that month on Home`,
        ok, persona: persona.id, screen: '/',
        detail: ok ? 'month heading follows the clock' : `heading did not match ${re}`,
      });
      if (!ok && name === 'leap') await shot(page, 'clock-leap');
    } catch (err) {
      scenario({ id, name: `Clock ${name}`, ok: false, persona: persona.id, screen: '/', detail: String(err).split('\n')[0] });
    } finally {
      await context.close();
    }
  }
}

async function slowAndKeyboard(browser) {
  const context = await newContext(browser, { slowMs: 350, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const t0 = Date.now();
  try {
    await page.goto(`${WEB}/glossary`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const ms = Date.now() - t0;
    const facts = await pageFacts(page);
    scenario({
      id: 'S-slow-glossary', name: 'Glossary still loads on a slow network',
      ok: !facts.href.includes('error') && facts.text.length > 40,
      screen: '/glossary', detail: `${ms}ms to domcontentloaded with 350ms delay on each request`, ms,
    });
  } catch (err) {
    scenario({ id: 'S-slow-glossary', name: 'Glossary still loads on a slow network', ok: false, screen: '/glossary', detail: String(err).split('\n')[0] });
  } finally {
    await context.close();
  }

  const context2 = await newContext(browser, {});
  const page2 = await context2.newPage();
  try {
    await page2.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    await page2.getByPlaceholder('you@example.com').focus();
    await page2.keyboard.press('Tab');
    const moved = await page2.evaluate(() => {
      const el = document.activeElement;
      return el && el.getAttribute('placeholder') !== 'you@example.com';
    });
    scenario({
      id: 'A-login-tab', name: 'Tab moves focus off the email field',
      ok: moved, screen: '/login', detail: moved ? 'focus moved' : 'focus stayed on the email field',
    });
  } catch (err) {
    scenario({ id: 'A-login-tab', name: 'Tab moves focus off the email field', ok: false, screen: '/login', detail: String(err).split('\n')[0] });
  } finally {
    await context2.close();
  }
}

function recomputeFromScreens(personas) {
  const cases = [];
  const home = personas.find((p) => p.id === 'homeUnset');
  if (home?.homeText) {
    const interest = home.homeText.match(/₹\s*([\d,]+)\/MO/);
    cases.push({ id: 'home-emi', kind: 'emi', principal: 2500000, annualRate: 0.085, months: 240, screen: 21696, tolerance: 2 });
    if (interest) cases.push({ id: 'home-interest', kind: 'interest', principal: 2500000, annualRate: 0.085, screen: Number(interest[1].replace(/,/g, '')) });
  }
  const nearWord = (text, word) => {
    const idx = text.toLowerCase().indexOf(word);
    if (idx < 0) return null;
    const slice = text.slice(Math.max(0, idx - 80), idx + 100);
    const found = [...slice.matchAll(/₹\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    return found.length ? found[found.length - 1] : null;
  };
  const card = personas.find((p) => p.id === 'cardMin');
  if (card?.homeText) {
    const screen = nearWord(card.homeText, 'minimum') || nearWord(card.homeText, 'card');
    if (screen) cases.push({ id: 'card-min-formula', kind: 'hdfc-min', balance: 90000, annualRate: 0.36, screen, tolerance: 2 });
  }
  const stack = personas.find((p) => p.id === 'stack');
  if (stack?.homeText) {
    const screen = nearWord(stack.homeText, 'minimum');
    if (screen) cases.push({ id: 'stack-card-min', kind: 'hdfc-min', balance: 150000, annualRate: 0.42, screen, tolerance: 2 });
  }
  if (!cases.length) return [];
  const py = spawnSync('/tmp/rd-venv/bin/python', ['e2e/user-scenarios/recompute.py'], {
    input: JSON.stringify(cases), cwd: '/workspace', encoding: 'utf8',
  });
  if (py.status !== 0) {
    scenario({ id: 'M-recompute', name: 'Independent EMI and minimum check', ok: false, detail: (py.stderr || py.stdout || 'python failed').slice(0, 300) });
    return [];
  }
  const report = JSON.parse(py.stdout);
  for (const row of report) {
    scenario({
      id: `M-${row.id}`, name: `Screen figure matches an independent calculation · ${row.id}`,
      ok: !!row.ok, screen: '/', detail: row.detail,
    });
  }
  return report;
}

function writeReport(personas) {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(`${OUT}/shots`, { recursive: true });
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const fieldList = [...fields.values()];
  const unused = fieldList.filter((f) => !f.filled && f.type !== 'hidden');
  const noEffect = fieldList.filter((f) => f.filled && f.effects.length > 0 && f.effects.every((e) => e === 'none' || e === 'disabled' || e === 'readonly'));
  const scenarioIds = [...new Set(fieldList.flatMap((f) => f.scenarios.filter((s) => s.startsWith('F-') || s.startsWith('P-') || s.startsWith('N-'))))];
  const header = ['field', 'screen', 'type', 'filled', 'persisted', 'effects', ...scenarioIds];
  const csv = [header.join(',')].concat(fieldList.map((f) => {
    const cells = [
      JSON.stringify(f.label),
      JSON.stringify(f.screen),
      f.type,
      f.filled ? '1' : '0',
      f.persisted == null ? '' : f.persisted ? 'yes' : 'no',
      JSON.stringify(f.effects.join('|')),
      ...scenarioIds.map((s) => (f.scenarios.includes(s) ? '1' : '0')),
    ];
    return cells.join(',');
  })).join('\n');
  writeFileSync(`${OUT}/field-matrix.csv`, csv);
  const payload = {
    generatedAt: new Date().toISOString(),
    scenarios: results.length,
    passed,
    failed: failed.length,
    personas: personas.map((p) => ({ id: p.id, ok: p.ok, email: p.email, error: p.error })),
    results,
    fields: fieldList,
    unused: unused.map((f) => ({ screen: f.screen, label: f.label, type: f.type })),
    noEffect: noEffect.map((f) => ({ screen: f.screen, label: f.label, type: f.type, effects: f.effects })),
    screenshots: shots,
  };
  writeFileSync(`${OUT}/last-run.json`, JSON.stringify(payload, null, 2));
  writeFileSync('/workspace/e2e/user-scenarios/last-run.json', JSON.stringify(payload));
  const lines = [
    `# User-scenario run`,
    ``,
    `${results.length} scenarios: ${passed} passed, ${failed.length} failed.`,
    ``,
    `## Failures`,
    ...failed.slice(0, 80).map((f) => `- ${f.id} (${f.screen || ''}): ${f.detail || f.name}`),
    ``,
    `## Fields never filled (${unused.length})`,
    ...unused.slice(0, 80).map((f) => `- ${f.screen} · ${f.label} (${f.type})`),
    ``,
    `## Fields filled with no visible effect (${noEffect.length})`,
    ...noEffect.slice(0, 80).map((f) => `- ${f.screen} · ${f.label} (${f.type})`),
    ``,
  ];
  writeFileSync(`${OUT}/REPORT.md`, lines.join('\n'));
  say(`\n${passed} passed, ${failed.length} failed, ${results.length} total`);
  say(`matrix ${fieldList.length} fields, unused ${unused.length}, no-effect ${noEffect.length}`);
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const item = q.shift();
      if (!item) return;
      await fn(item);
    }
  }));
}

async function main() {
  mkdirSync(OUT + '/shots', { recursive: true });
  mkdirSync('/tmp/rd-states', { recursive: true });
  writeFileSync(PDF, '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

  let personas = [
    { id: 'homeUnset', label: 'One home loan, monthly total not chosen', income: '80000', spend: '30000', budget: null, country: 'IN', loans: [{ kind: /^Home$/, balance: '2500000', rate: '8.5', emi: '21696', due: true }] },
    { id: 'stack', label: 'Card, personal loan and home loan, all spare cash', income: '120000', spend: '45000', budget: 'all', country: 'IN', loans: [
      { kind: /^Card$/, balance: '150000', rate: '42' },
      { kind: /^Personal$/, balance: '400000', rate: '14', emi: '10931', due: false },
      { kind: /^Home$/, balance: '2500000', rate: '8.6', emi: '21855', due: false },
    ] },
    { id: 'cardMin', label: 'Credit card, minimums only', income: '70000', spend: '28000', budget: 'min', country: 'IN', loans: [{ kind: /^Card$/, balance: '90000', rate: '36' }] },
    { id: 'near', label: 'Personal loan near closure', income: '90000', spend: '35000', budget: 'all', country: 'IN', loans: [{ kind: /^Personal$/, balance: '18000', rate: '18', emi: '6000', due: true }] },
    { id: 'empty', label: 'First run with no loans', income: '55000', spend: '22000', budget: null, country: 'IN', loans: [] },
    { id: 'us', label: 'US borrower, one car loan', income: '6500', spend: '2400', budget: 'all', country: 'US', loans: [{ kind: /^Car$/, balance: '18000', rate: '6.5', emi: '350', due: false }] },
    { id: 'behind', label: 'Personal loan marked behind', income: '60000', spend: '20000', budget: null, country: 'IN', behind: true, loans: [{ kind: /^Personal$/, balance: '200000', rate: '16', emi: '5000', due: true }] },
    { id: 'pension', label: 'Pension, small gold loan', income: '32000', spend: '18000', budget: 'min', country: 'IN', loans: [{ kind: /^Gold$/, balance: '50000', rate: '10', emi: '2200', due: true }] },
  ];

  const browser = await chromium.launch({ headless: true });
  try {
    const only = (process.env.PERSONAS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (only.length) personas = personas.filter((p) => only.includes(p.id));
    const extras = !process.env.SKIP_EXTRAS;
    for (const p of personas) await createPersona(browser, p);
    if (extras) {
      const odd = await onboardingFieldWalk(browser);
      personas.push(odd);
    }

    const jobs = [];
    for (const p of personas) {
      if (p.id === 'odd' && !p.ok) continue;
      for (const vp of VIEWPORTS) for (const [path, title] of ROUTES) jobs.push({ p, path, title, vp });
    }
    for (const p of personas.filter((x) => x.id === 'homeUnset' || x.id === 'stack')) {
      for (const path of TABLET_ROUTES) {
        const title = ROUTES.find((r) => r[0] === path)?.[1] || path;
        jobs.push({ p, path, title, vp: { name: 'tablet', width: 768, height: 1024 } });
      }
    }
    say(`route jobs ${jobs.length}`);
    await pool(jobs, 3, ({ p, path, title, vp }) => visitRoute(browser, p, path, title, vp));

    if (extras) {
      await chartAgrees(browser, personas.find((p) => p.id === 'homeUnset'));
      await chartAgrees(browser, personas.find((p) => p.id === 'stack'));
      recomputeFromScreens(personas);

      const lab = personas.find((p) => p.id === 'odd' && p.ok) || personas.find((p) => p.id === 'homeUnset');
      const fieldJobs = [];
      for (const target of FIELD_TARGETS) {
        const profiles = DEEP_PROFILES.has(target.id) ? PROFILES : ['normal', 'empty', 'invalid'];
        for (const profile of profiles) fieldJobs.push({ target, profile });
      }
      say(`field jobs ${fieldJobs.length}`);
      await pool(fieldJobs, 2, ({ target, profile }) => fieldScenario(browser, lab, target, profile));

      await persistChecks(browser, lab);
      await markAllPaid(browser, personas.find((p) => p.id === 'stack'));
      await timeTravel(browser, personas.find((p) => p.id === 'homeUnset'));
      await slowAndKeyboard(browser);
    }
  } finally {
    await browser.close();
    writeReport(personas);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (results.length < 300) {
    console.error(`only ${results.length} scenarios`);
    process.exitCode = 1;
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

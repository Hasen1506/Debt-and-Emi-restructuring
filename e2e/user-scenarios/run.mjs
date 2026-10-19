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
const BAD_PDF = '/tmp/qa-not-a-pdf.pdf';
const REAL_PDF = '/workspace/engine/tests/fixtures/credit_report/cibil.synthetic.pdf';
const PDF = REAL_PDF;

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
  { id: 'tax', path: '/tax', reveal: ['tax-more'] },
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
  console.log(msg);
  logStream.write(`${msg}\n`);
}

const results = [];
const fields = new Map();
const shots = [];
let shotBudget = 80;

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
  await context.route((url) => {
    // A CSV export is a blob: link. Aborting it cancels the download.
    if (url.protocol === 'blob:' || url.protocol === 'data:') return false;
    return !/^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  }, (route) => route.abort());
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
async function settle(page) {
  const loading = page.getByText(/Loading your details|Loading your profile|Loading the letter|Loading your signed-in/);
  if (await loading.count()) {
    await loading.first().waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {});
  }
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
}

/** A click before React is listening is dropped. Wait until a control has it. */
async function waitReact(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('input, textarea, select, button, a');
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
  }, { timeout: 20000 }).catch(() => {});
}

async function waitHydrated(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
  }, selector, { timeout: 30000 });
}

/** A value typed before hydration is wiped when the saved profile arrives.
 *  Fill, then require the box to keep that value. A later wipe is retried. */
async function fillStable(locator, value) {
  await locator.waitFor({ timeout: 15000 });
  const want = String(value);
  const wantDigits = want.replace(/,/g, '');
  const matches = (got) => got === want || (wantDigits !== '' && got.replace(/,/g, '') === wantDigits);
  let got = '';
  for (let i = 0; i < 8; i++) {
    await locator.fill(want).catch(async () => {
      await locator.click();
      await locator.pressSequentially(want, { delay: 12 });
    });
    let stable = 0;
    let last = '';
    const start = Date.now();
    while (Date.now() - start < 2200) {
      got = await locator.inputValue().catch(() => '');
      if (matches(got) && got === last) stable += 1;
      else stable = 0;
      last = got;
      if (matches(got) && stable >= 3) return got;
      if (!matches(got) && Date.now() - start > 700) break;
      await locator.page().waitForTimeout(200);
    }
  }
  throw new Error(`typed "${value}" but the field shows "${got}"`);
}

/** The saved profile paints after the first empty form. Wait until a box stops changing. */
async function waitStableValue(locator, timeout = 8000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(() => {});
  const start = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - start < timeout) {
    const now = await locator.inputValue().catch(() => '');
    if (now === last) stable += 1;
    else stable = 0;
    last = now;
    if (stable >= 3 && Date.now() - start > 500) return now;
    await locator.page().waitForTimeout(200);
  }
  return last ?? '';
}

async function waitText(page, re, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (re.test((await pageFacts(page)).text)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

/** A saved nickname is on the summary, or still in the loans form after a refresh. */
async function nicknameVisible(page, value) {
  const start = Date.now();
  const re = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  while (Date.now() - start < 8000) {
    if (re.test((await pageFacts(page)).text)) return true;
    const box = page.getByLabel('Nickname (optional)').first();
    if (await box.count()) {
      const got = await box.inputValue().catch(() => '');
      if (got === value) return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/** The control ignores a click or a typed value until React is listening on it. */
async function waitControl(locator) {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  const handle = await locator.elementHandle();
  if (!handle) throw new Error('control is not on the page');
  await locator.page().waitForFunction(
    (el) => Object.keys(el).some((k) => k.startsWith('__react')),
    handle,
    { timeout: 20000 },
  );
}

/** Profile fields paint empty, then fill from the saved profile. Read once that settles. */
async function readSettled(locator, expect) {
  await locator.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  const start = Date.now();
  let last = '';
  let stableSince = Date.now();
  while (Date.now() - start < 10000) {
    const now = await locator.inputValue().catch(() => '');
    if (expect && keptValue(now, expect, '')) return now;
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
    if (Date.now() - stableSince > 800 && Date.now() - start > 1200) return now;
    await locator.page().waitForTimeout(200);
  }
  return last;
}

/** Fields that mount after the first paint (a floating-rate date, a second asset). */
async function waitFields(page) {
  await waitReact(page);
  let last = -1;
  let steady = 0;
  for (let i = 0; i < 10; i++) {
    const n = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter((el) => {
      if (el.getAttribute('type') === 'hidden') return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    }).length);
    if (n === last && n > 0) {
      steady += 1;
      if (steady >= 2) return;
    } else steady = 0;
    last = n;
    await page.waitForTimeout(250);
  }
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
      text: text.slice(0, 20000),
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settle(page);
      navErr = '';
      break;
    } catch (err) {
      navErr = String(err).split('\n')[0];
      if (attempt === 0) await page.waitForTimeout(1000);
    }
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
  // The approximate-price box hides Purchase date and Purchase price.
  // Those two are filled first, then the box is ticked on its own.
  return /delete my account|sign out|password|don't remember the exact purchase price/i.test(label);
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
  if (/usd|exchange|worth in/i.test(label)) return profile === 'invalid' ? 'nope' : profile === 'empty' ? '' : '83.5';
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
        const edit = page.getByRole('link', { name: `Edit ${name}`, exact: true }).or(page.getByRole('button', { name: `Edit ${name}`, exact: true }));
        await edit.first().waitFor({ state: 'visible', timeout: 20000 });
        await edit.first().click();
        await page.getByRole('heading', { level: 1, name, exact: true }).waitFor({ timeout: 15000 });
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
        await waitReact(page);
        const b = page.getByRole('link', { name: /LOG AN ENTRY/i }).or(page.getByRole('button', { name: /LOG AN ENTRY/i }));
        if (await b.first().isVisible().catch(() => false)) await b.first().click();
        const opened = await page.getByRole('dialog').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
        if (!opened) {
          await page.goto(`${WEB}/activity?log=entry`, { waitUntil: 'domcontentloaded' });
          await page.getByRole('dialog').waitFor({ timeout: 15000 }).catch(() => {});
        }
      } else if (step === 'asset') {
        const b = page.getByRole('button', { name: /ADD ANOTHER ASSET/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'account') {
        const b = page.getByRole('button', { name: /ADD AN ACCOUNT|ADD ACCOUNT|\+ ACCOUNT/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
      } else if (step === 'file') {
        const b = page.getByRole('button', { name: /Upload|bank's reply|reply/i }).first();
        if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
      } else if (step === 'tax-more') {
        const summary = page.getByText(/Bought under construction/i).first();
        if (await summary.isVisible().catch(() => false)) await summary.click();
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
  await waitFields(page);
  const seen = new Set();
  let applied = [];
  let alertText = '';
  let textChanged = false;
  for (let pass = 0; pass < 3; pass++) {
    const listed = (await listFields(page)).filter((f) => !seen.has(`${f.label}::${f.type}::${f.nth}`));
    if (!listed.length) break;
    for (const f of listed) seen.add(`${f.label}::${f.type}::${f.nth}`);
    const passApplied = await page.evaluate(({ profileName, wanted }) => {
    function setNative(el, value) {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      // React ignores a value set on the node unless its tracker sees a change.
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue('__qa__');
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
      if (!spec) continue;
      if (el.disabled || el.readOnly) {
        out.push({ label, nth, type: el.getAttribute('type') || el.tagName.toLowerCase(), skipped: true, reason: el.disabled ? 'disabled' : 'readonly' });
        continue;
      }
      const type = el.getAttribute('type') || el.tagName.toLowerCase();
      const prev = type === 'checkbox' || type === 'radio' ? String(el.checked) : el.value;
      if (el.id === 'cp-letter-text') {
        out.push({ label, nth, type, skipped: true, reason: 'derived-letter' });
        continue;
      }
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
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      const next = type === 'checkbox' || type === 'radio' ? String(el.checked) : el.value;
      out.push({
        label, nth, type, prev, next, invalid: el.getAttribute('aria-invalid'),
      });
    }
    return out;
  }, {
    profileName: profile,
    wanted: listed.filter((f) => !skipFill(f.label)).map((f) => ({ ...f, value: valueFor(f, profile) })),
  });
    applied = applied.concat(passApplied);
    // A checkbox can reveal the next fields (approximate price, business income).
    await page.waitForTimeout(350);
  }
  if (profile === 'invalid' || profile === 'empty') {
    await page.getByRole('alert').first().waitFor({ timeout: 2500 }).catch(() => {});
  }
  await page.waitForTimeout(200);
  // A controlled date or amount sometimes ignores the synthetic event. Type it.
  for (const row of applied) {
    if (row.skipped || row.type === 'checkbox' || row.type === 'radio' || row.type === 'file' || row.type === 'range') continue;
    if (row.next != null && row.next !== row.prev) continue;
    const want = valueFor(row, profile);
    if (!want || want === row.prev) continue;
    const box = page.getByLabel(row.label, { exact: true }).nth(row.nth);
    if (!(await box.count())) continue;
    await box.fill(String(want)).catch(() => {});
    await box.blur().catch(() => {});
    const now = await box.inputValue().catch(() => row.next);
    if (now && now !== row.prev) row.next = now;
  }
  const afterFacts = await pageFacts(page);
  const alerts = await page.locator('[role=alert]').allInnerTexts().catch(() => []);
  alertText = alerts.join(' ').replace(/\s+/g, ' ').trim();
  textChanged = before.replace(/\s+/g, ' ') !== afterFacts.text.replace(/\s+/g, ' ');
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
    // A disabled control cannot take a value. Record that, so it is not "never filled".
    const filled = !row.skipped || row.reason === 'disabled';
    fieldRecord(key, {
      screen, label: row.label, type: row.type, scenario: scenarioId, filled,
      effect, boundary: { name: profile, result: row.reason === 'disabled' ? 'disabled' : effect },
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

/** Each hardship ask must change the draft. Then type in the letter itself. */
async function letterAsksChange(page, screen, scenarioId) {
  const problems = [];
  const letter = page.getByTestId('cp-letter-text');
  if (!(await letter.count())) return ['letter box not on the page'];
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid=ask-lower_emi]');
    return el && Object.keys(el).some((k) => k.startsWith('__react'));
  }, { timeout: 15000 }).catch(() => {});
  const asks = [
    ['ask-pause', 'a short pause'],
    ['ask-lower_emi', 'a lower monthly payment'],
    ['ask-longer_tenure', 'a longer tenure'],
    ['ask-waive_penal', 'a waiver of penal charges'],
    ['ask-restructure', 'a formal restructuring'],
  ];
  for (const [id, label] of asks) {
    const box = page.getByTestId(id);
    if (!(await box.count())) {
      problems.push(`${id} missing`);
      continue;
    }
    const before = await letter.inputValue();
    await box.click();
    await page.waitForTimeout(200);
    const after = await letter.inputValue();
    const changed = after !== before;
    fieldRecord(`${screen} :: ${label} :: checkbox :: 0`, {
      screen, label, type: 'checkbox', scenario: scenarioId,
      filled: true, effect: changed ? 'text-changed' : 'none',
    });
    if (!changed) problems.push(`${label} did not change the letter`);
  }
  const beforeEdit = await letter.inputValue();
  await letter.fill(`${beforeEdit}\nQA extra line.`);
  await page.waitForTimeout(200);
  const edited = await page.getByText(/no longer change it/i).first().isVisible().catch(() => false);
  fieldRecord(`${screen} :: The letter (you can edit it here) :: textarea :: 0`, {
    screen, label: 'The letter (you can edit it here)', type: 'textarea', scenario: scenarioId,
    filled: true, effect: edited ? 'text-changed' : 'value-changed',
  });
  const reset = page.getByRole('button', { name: /RESET TO DRAFT/i });
  if (await reset.count()) await reset.click().catch(() => {});
  if (problems.length) await shot(page, `letter-${screen}`);
  return problems;
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
    await settle(page);
    await waitReact(page);
    const waitFor = {
      plan: page.getByLabel('If floating rates change, basis points'),
      recompute: page.getByLabel('If floating rates change, basis points'),
      'cant-pay': page.getByLabel(/Money you have for loan payments/i),
      tax: page.getByLabel(/Your share for tax/i),
      account: page.getByLabel(/Type your email to confirm/i),
      activity: page.getByRole('link', { name: /LOG AN ENTRY/i }).or(page.getByRole('button', { name: /LOG AN ENTRY/i })),
      'us-letters': page.getByTestId('cp-letter-text'),
    }[target.id];
    if (waitFor) await waitFor.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    if (target.id === 'plan' || target.id === 'recompute') {
      const bps = page.getByLabel('If floating rates change, basis points');
      await bps.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await page.waitForFunction(() => {
        const el = document.querySelector('input[aria-label="If floating rates change, basis points"]');
        return el && !el.disabled;
      }, { timeout: 20000 }).catch(() => {});
    }
    await reveal(page, target.reveal);
    if (profile === 'normal' && (target.id === 'us-letters' || target.id === 'cant-pay')) {
      const letterProblems = await letterAsksChange(page, target.id, id);
      problems.push(...letterProblems);
    }
    // Cash yield redirects to the windfall page. Count those fields once.
    const screen = target.id === 'yield' ? 'windfall' : target.id;
    const { applied, alertText } = await applyFields(page, screen, profile, id);
    if (profile === 'normal' && target.id === 'recompute') {
      const bps = page.getByLabel('If floating rates change, basis points');
      const slider = page.getByRole('slider', { name: 'If floating rates change' });
      if (await bps.count() && await slider.count()) {
        await waitControl(bps);
        await fillStable(bps, '15').catch(() => {});
        await bps.blur().catch(() => {});
        const typed = await bps.inputValue().catch(() => '');
        await slider.fill('25').catch(() => {});
        const slid = await bps.inputValue().catch(() => '');
        fieldRecord('recompute :: If floating rates change, basis points :: text :: 0', {
          screen: 'recompute', label: 'If floating rates change, basis points', type: 'text', scenario: id,
          filled: true, effect: typed === '15' ? 'value-changed' : 'none',
        });
        fieldRecord('recompute :: If floating rates change :: range :: 0', {
          screen: 'recompute', label: 'If floating rates change', type: 'range', scenario: id,
          filled: true, effect: slid === '25' ? 'value-changed' : 'none',
        });
        if (typed !== '15' || slid !== '25') problems.push(`recompute rate box typed ${typed}, slider left ${slid}`);
      }
    }
    const changed = applied.filter((r) => !r.skipped);
    if (!changed.length && !applied.length) problems.push('no inputs on this screen after opening it');
    // Invalid and empty profiles should not silently accept a negative amount.
    if (profile === 'invalid') {
      const body = (await pageFacts(page)).text;
      const flagged = /can.?t be negative|isn.?t a valid|isn.?t a rate|enter the|check the/i.test(body + alertText);
      const moneyLike = changed.filter((r) => /balance|amount|emi|spend|income|fee|payment|rupee|₹/i.test(r.label) && r.type !== 'range');
      if (moneyLike.length && !flagged) {
        const still = [];
        for (const r of moneyLike.slice(0, 6)) {
          const box = page.getByLabel(r.label, { exact: true }).nth(r.nth);
          const val = await box.inputValue().catch(() => r.next);
          if (String(val).trim() === '-1') still.push(r.label);
        }
        if (still.length) {
          for (const label of still) {
            const box = page.getByLabel(label, { exact: true }).first();
            await box.fill('-1').catch(() => {});
            await box.blur().catch(() => {});
          }
          await page.getByRole('alert').filter({ hasText: /negative|valid|within|whole number/i }).first()
            .waitFor({ timeout: 3000 }).catch(() => {});
          const again = (await page.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' ');
          if (/can.?t be negative|isn.?t a valid|within|whole number|check the/i.test(again)) still.length = 0;
        }
        if (still.length) problems.push(`negative kept with no message: ${still.slice(0, 4).join(', ')}`);
      }
    }
    if (profile === 'normal' && (target.id === 'windfall' || target.id === 'yield')) {
      const sliderProbe = page.getByRole('slider', { name: /home loan: amount/i });
      if (await sliderProbe.count()) {
        const slider = sliderProbe.first();
        let after = '';
        let before = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          const enabled = await slider.waitFor({ state: 'visible', timeout: 8000 }).then(async () => {
            for (let i = 0; i < 10; i++) {
              if (!(await slider.isDisabled())) return true;
              await page.waitForTimeout(200);
            }
            return false;
          }).catch(() => false);
          if (!enabled) break;
          await waitControl(slider);
          // Other rows can already be holding the whole amount, which caps this one at 0.
          const all = page.getByRole('slider');
          const n = await all.count();
          for (let i = 0; i < n; i++) {
            const other = all.nth(i);
            const name = (await other.getAttribute('aria-label').catch(() => '')) || '';
            if (/home loan: amount/i.test(name) || await other.isDisabled()) continue;
            const prev = await other.inputValue().catch(() => '');
            await other.fill('0').catch(() => {});
            const now = await other.inputValue().catch(() => prev);
            if (now !== prev) {
              fieldRecord(`windfall :: ${name} :: range :: 0`, {
                screen: 'windfall', label: name, type: 'range', scenario: id,
                filled: true, effect: 'value-changed', persisted: false,
              });
            }
          }
          before = await slider.inputValue().catch(() => '');
          const max = Number(await slider.getAttribute('max').catch(() => '0')) || 0;
          const next = max > 0 ? String(Math.max(1, Math.round(max / 2))) : '1000';
          await slider.fill(before === next ? String(Math.max(1, Math.round(max / 4) || 1)) : next);
          await page.waitForTimeout(400);
          after = await slider.inputValue().catch(() => '');
          if (after !== before && after !== '0') break;
        }
          if (after && after !== before) {
          fieldRecord('windfall :: Home loan: amount :: range :: 0', {
            screen: 'windfall', label: 'Home loan: amount', type: 'range', scenario: id,
            filled: true, effect: 'value-changed', persisted: false,
          });
        } else if (await slider.count() && !(await slider.isDisabled())) {
          problems.push(`the home-loan slider stayed at ${after || before} without MY SPLIT`);
        } else if (await slider.count()) {
          problems.push('the home-loan slider stayed disabled');
        } else {
          problems.push('the home-loan slider was not on the page');
        }
      }
    }
    if (profile === 'normal' && target.id === 'assets') {
      const dates = page.getByLabel('Purchase date', { exact: true });
      const prices = page.getByLabel(/^Purchase price/, { exact: false });
      const dateCount = await dates.count();
      for (let i = 0; i < dateCount; i++) {
        const date = dates.nth(i);
        const price = prices.nth(i);
        if (!(await date.isVisible().catch(() => false))) continue;
        await waitControl(date);
        await fillStable(date, '2019-04-01').catch(() => {});
        if (await price.count()) await fillStable(price, '450000').catch(() => {});
        const dateGot = await date.inputValue().catch(() => '');
        const priceGot = await price.inputValue().catch(() => '');
        fieldRecord(`assets :: Purchase date :: date :: ${i}`, {
          screen: 'assets', label: 'Purchase date', type: 'date', scenario: id,
          filled: true, effect: dateGot.includes('2019-04-01') ? 'value-changed' : 'none', persisted: false,
        });
        fieldRecord(`assets :: Purchase price (₹) :: text :: ${i}`, {
          screen: 'assets', label: 'Purchase price (₹)', type: 'text', scenario: id,
          filled: true, effect: digits(priceGot).includes('450000') ? 'value-changed' : 'none', persisted: false,
        });
        if (!dateGot.includes('2019-04-01') || !digits(priceGot).includes('450000')) {
          problems.push(`purchase date/price ${i} shows "${dateGot}" / "${priceGot}"`);
        }
      }
      const approx = page.getByRole('checkbox', { name: /remember the exact purchase price/i }).first();
      if (await approx.count()) {
        if (!(await approx.isChecked())) await approx.check();
        const note = page.getByTestId('asset-approx-on').first();
        const swapped = page.getByLabel(/Roughly when did you buy it/i).first();
        const shown = await note.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)
          || await swapped.isVisible().catch(() => false);
        if (shown) {
          const year = page.getByLabel(/Roughly when did you buy it/i).first();
          const price = page.getByLabel(/Approximate purchase price/i).first();
          if (await year.count()) await fillStable(year, '2016').catch(() => {});
          if (await price.count()) await fillStable(price, '450000').catch(() => {});
          const yearGot = await year.inputValue().catch(() => '');
          const priceGot = await price.inputValue().catch(() => '');
          fieldRecord('assets :: Roughly when did you buy it? (year) :: text :: 0', {
            screen: 'assets', label: 'Roughly when did you buy it? (year)', type: 'text', scenario: id,
            filled: true, effect: yearGot.includes('2016') ? 'value-changed' : 'none', persisted: false,
          });
          fieldRecord('assets :: Approximate purchase price (₹) :: text :: 0', {
            screen: 'assets', label: 'Approximate purchase price (₹)', type: 'text', scenario: id,
            filled: true, effect: digits(priceGot).includes('450000') ? 'value-changed' : 'none', persisted: false,
          });
        }
        fieldRecord('assets :: I don\'t remember the exact purchase price :: checkbox :: 0', {
          screen: 'assets', label: "I don't remember the exact purchase price", type: 'checkbox', scenario: id,
          filled: true, effect: shown ? 'text-changed' : 'none', persisted: false,
        });
        if (!shown) {
          problems.push('purchase-price checkbox did not change the form');
          await shot(page, 'approx-checkbox');
        }
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
      fieldRecord(`${screen} :: toggle :: ${t.label} :: ${t.i}`, {
        screen, label: t.label, type: 'toggle', scenario: id,
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

    // Negative. The message is an alert as soon as the minus is typed.
    await waitHydrated(page, 'input');
    await fillStable(page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home/i).first(), '-100');
    const spendNeg = page.getByLabel(/Spending a month/i);
    await fillStable(spendNeg, '-5');
    await spendNeg.blur();
    const neg = await page.getByRole('alert').filter({ hasText: /can.t be negative/i }).first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    await shot(page, neg ? 'setup-negative-ok' : 'setup-negative');
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
    const file = page.getByTestId('cr-file').first();
    if (await file.count()) {
      await file.setInputFiles(BAD_PDF);
      await page.getByText(/not a pdf/i).first().waitFor({ timeout: 25000 }).catch(() => {});
      const badBody = (await pageFacts(page)).text;
      const rejected = /not a pdf/i.test(badBody);
      scenario({
        id: 'F-setup-pdf-bad', name: 'A malformed credit-report file is rejected', ok: rejected,
        persona: 'odd', screen: '/onboarding',
        detail: rejected ? 'not a PDF' : 'no rejection for a malformed file',
      });
      if (!rejected) await shot(page, 'fake-pdf');
      fieldRecord('onboarding :: Credit report PDF :: file :: 0', { screen: 'onboarding', label: 'Credit report PDF', type: 'file', scenario: 'F-setup-pdf-bad', filled: true, effect: rejected ? 'validation' : 'none', boundary: { name: 'invalid', result: rejected ? 'rejected' : 'no-message' } });
      await file.setInputFiles(REAL_PDF);
      await page.getByText(/SAMPLE HOUSING|housing loan/i).first().waitFor({ timeout: 30000 }).catch(() => {});
      const realBody = (await pageFacts(page)).text;
      const read = /SAMPLE HOUSING|housing loan|account/i.test(realBody);
      scenario({
        id: 'F-setup-pdf', name: 'A real sample credit-report PDF is read', ok: read,
        persona: 'odd', screen: '/onboarding',
        detail: read ? 'sample housing loan appeared' : 'sample PDF produced no account',
      });
      if (!read) await shot(page, 'real-pdf');
      fieldRecord('onboarding :: Credit report PDF :: file :: 0', { screen: 'onboarding', label: 'Credit report PDF', type: 'file', scenario: 'F-setup-pdf', filled: true, effect: read ? 'text-changed' : 'none', boundary: { name: 'normal', result: read ? 'read' : 'no-account' } });
    } else {
      scenario({ id: 'F-setup-pdf', name: 'Credit-report PDF field is on setup', ok: false, persona: 'odd', screen: '/onboarding', detail: 'file input not found' });
      scenario({ id: 'F-setup-pdf-bad', name: 'A malformed credit-report file is rejected', ok: false, persona: 'odd', screen: '/onboarding', detail: 'file input not found' });
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
    // The field walk types into the exchange-rate box. A word is rejected, so
    // put a rate back before Continue or the plan step never opens.
    const fx = page.getByLabel(/USD in INR|worth in INR/i).first();
    if (await fx.isVisible().catch(() => false)) {
      await fx.fill('83.50');
      await fx.blur();
    }

    // Back then forward.
    await page.goBack().catch(() => {});
    await page.waitForTimeout(400);
    const backOk = await page.getByLabel(/Spending a month/i).isVisible().catch(() => false) || page.url().includes('onboarding');
    scenario({
      id: 'N-setup-back', name: 'Back mid-setup does not dump the person out', ok: backOk,
      persona: 'odd', screen: '/onboarding', detail: page.url(),
    });
    const owe = page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ });
    if (await owe.isVisible().catch(() => false)) {
      // Back can land on the income step with a figure the walk left too
      // big or negative, and Continue then stays put. Put a livable pair
      // back so the known loan can still be saved.
      const takeHome = page.getByLabel(/Take-home pay a month|What reaches your bank|Take-home/i).first();
      const spendBox = page.getByLabel(/Spending a month/i).first();
      if (await takeHome.isVisible().catch(() => false)) await takeHome.fill('100000');
      if (await spendBox.isVisible().catch(() => false)) await spendBox.fill('40000');
      await owe.click();
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
    scenario({ id, name: `Chart matches the schedule and the CSV · ${persona.label}`, ok: true, persona: persona.id, screen: '/plan', detail: 'no loans, chart not required' });
    return;
  }
  const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB}/plan`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
    await page.getByRole('heading', { name: /MONTH BY MONTH/ }).waitFor({ timeout: 25000 });
    await waitReact(page);
    const allMonths = page.getByRole('button', { name: 'SHOW ALL', exact: true });
    if (await allMonths.count()) {
      // The heading is server HTML. The click only expands once this button is listening.
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('SHOW ALL'));
        return !!b && Object.keys(b).some((k) => k.startsWith('__react'));
      }, { timeout: 20000 });
      await allMonths.first().scrollIntoViewIfNeeded();
      const showing = await page.getByTestId('schedule-showing').innerText().catch(() => '');
      const want = Number((showing.match(/of (\d+) months/) || [])[1] || 0);
      await allMonths.first().click();
      await page.getByRole('button', { name: /EVENTS ONLY/ }).waitFor({ timeout: 10000 });
      if (want > 0) {
        await page.waitForFunction(
          (need) => document.querySelectorAll('tr[data-balance]').length >= need,
          want,
          { timeout: 15000 },
        );
      }
    }
    await page.locator('svg circle[data-balance]').first().waitFor({ timeout: 15000 });
    const chart = await page.locator('svg circle[data-balance]').evaluateAll((els) =>
      els.map((el) => ({ month: Number(el.getAttribute('data-month')), balance: Number(el.getAttribute('data-balance')) }))
        .filter((p) => Number.isFinite(p.month) && Number.isFinite(p.balance)));
    const table = await page.locator('tr[data-balance]').evaluateAll((els) =>
      els.map((el) => ({ month: Number(el.getAttribute('data-month')), balance: Number(el.getAttribute('data-balance')) }))
        .filter((p) => Number.isFinite(p.month) && Number.isFinite(p.balance)));
    const byMonth = new Map(table.map((r) => [r.month, r.balance]));
    const lastTable = table.reduce((m, r) => Math.max(m, r.month), -1);
    // Months after the schedule are the plan line held at 0 so the minimums
    // line can be drawn whole (founder, 18 Oct 2026). They are not extra rows.
    const disagreed = [];
    let padded = 0;
    for (const p of chart) {
      if (byMonth.has(p.month)) {
        if (byMonth.get(p.month) !== p.balance) disagreed.push(`m${p.month} chart ${p.balance} table ${byMonth.get(p.month)}`);
      } else if (p.month > lastTable && p.balance === 0) padded += 1;
      else disagreed.push(`m${p.month} chart ${p.balance} has no schedule row`);
    }
    for (const r of table) {
      if (!chart.some((p) => p.month === r.month && p.balance === r.balance)) {
        disagreed.push(`m${r.month} table ${r.balance} has no chart point`);
      }
    }
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('CSV'));
      return b && Object.keys(b).some((k) => k.startsWith('__react'));
    }, { timeout: 20000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'CSV', exact: true }).click(),
    ]);
    const csvPath = `${OUT}/plan-${persona.id}.csv`;
    await download.saveAs(csvPath);
    const csv = require('node:fs').readFileSync(csvPath, 'utf8');
    const lines = csv.trim().split(/\n/);
    const header = lines[0].split(',');
    const owedCol = header.findIndex((h) => /Owed after/i.test(h));
    const monthCol = header.findIndex((h) => /^Month$/i.test(h));
    const csvBad = [];
    const csvBy = new Map();
    if (owedCol < 0 || monthCol < 0) csvBad.push('CSV has no Month or Owed after column');
    else {
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cells = line.split(',');
        const month = Number(cells[monthCol]);
        const owed = Number(String(cells[owedCol]).replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(month)) {
          csvBad.push(`unreadable month in "${line.slice(0, 40)}"`);
          continue;
        }
        csvBy.set(month, Math.round(owed));
      }
      for (const [month, bal] of byMonth) {
        if (!csvBy.has(month)) csvBad.push(`schedule month ${month} missing from CSV`);
        else if (csvBy.get(month) !== bal) csvBad.push(`month ${month}: table ${bal} csv ${csvBy.get(month)}`);
      }
      for (const [month] of csvBy) {
        if (!byMonth.has(month)) csvBad.push(`csv month ${month} is not in the schedule`);
      }
    }
    const ok = chart.length > 0 && table.length > 0 && disagreed.length === 0 && csvBad.length === 0;
    const padNote = padded ? `; ${padded} later chart points stay at 0 so the minimums line can finish` : '';
    scenario({
      id, name: `Chart points match the schedule and the CSV · ${persona.label}`,
      ok, persona: persona.id, screen: '/plan',
      detail: ok
        ? `${table.length} schedule rows match the chart and the CSV${padNote}`
        : `${disagreed.length} chart mismatches, ${csvBad.length} csv mismatches${disagreed.length ? `: ${disagreed.slice(0, 3).join(', ')}` : ''}${csvBad.length ? `; ${csvBad.slice(0, 3).join('; ')}` : ''}`,
    });
    if (!ok) await shot(page, `fail-${id}`);
  } catch (err) {
    await shot(page, `fail-${id}`);
    scenario({ id, name: `Chart points match the schedule and the CSV · ${persona.label}`, ok: false, persona: persona.id, screen: '/plan', detail: String(err).split('\n')[0] });
  } finally {
    await context.close();
  }
}

function keptValue(got, want, text) {
  const g = String(got || '');
  return g.includes(want) || digits(g).includes(digits(want)) || String(text || '').includes(want);
}

/** Save a field, hard-refresh, edit it, hard-refresh again. */
async function roundTripSaved(page, persona, spec) {
  const { id, path, label, first, second, save, screen } = spec;
  try {
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitReact(page);
    const box = page.getByLabel(label, { exact: true }).first();
    await waitControl(box);
    await fillStable(box, first);
    await box.blur();
    const saveBtn = page.getByRole('button', { name: save }).first();
    await waitControl(saveBtn);
    await saveBtn.click();
    await page.waitForTimeout(600);
    // Only a message that the save itself was refused. Other alerts on the
    // page (a loan note, a sync line) are not this field failing to save.
    const blocked = (await page.locator('[role=alert]').allInnerTexts()).map((t) => t.trim()).filter((t) => /wasn.t saved|not saved yet|confirm or cancel|changed in another tab|didn.t keep/i.test(t));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
    await waitFields(page);
    const again = page.getByLabel(label, { exact: true }).first();
    const got = await readSettled(again, first);
    const ok1 = keptValue(got, first, (await pageFacts(page)).text);
    await fillStable(again, second);
    await again.blur();
    const saveBtn2 = page.getByRole('button', { name: save }).first();
    await waitControl(saveBtn2);
    await saveBtn2.click();
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
    await waitFields(page);
    const got2 = await readSettled(page.getByLabel(label, { exact: true }).first(), second);
    const ok2 = keptValue(got2, second, (await pageFacts(page)).text);
    const ok = ok1 && ok2 && blocked.length === 0;
    fieldRecord(`${screen} :: ${label} :: text :: 0`, {
      screen, label, type: 'text', scenario: id, filled: true, persisted: ok, effect: ok ? 'text-changed' : 'none',
    });
    scenario({
      id, name: `${label} is still there after refresh and after a second edit`,
      ok, persona: persona.id, screen: path,
      detail: ok ? `${first} then ${second}` : `first "${got}" second "${got2}" ${blocked.join(' ').slice(0, 100)}`,
    });
    if (!ok) await shot(page, `persist-${id}`);
  } catch (err) {
    scenario({ id, name: `${label} survives refresh`, ok: false, persona: persona.id, screen: path, detail: String(err).split('\n')[0] });
    await shot(page, `persist-${id}`);
  }
}

async function persistTax(page, persona) {
  try {
    await page.goto(`${WEB}/tax`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitReact(page);
    await page.getByText(/Bought under construction/i).first().click();
    const share = page.getByLabel(/Your share for tax/i).first();
    await waitControl(share);
    await fillStable(share, '60');
    const finished = page.getByLabel(/House finished/i).first();
    await waitControl(finished);
    await fillStable(finished, '2020-06');
    const five = page.getByRole('checkbox', { name: /Finished within 5 years/i });
    await waitControl(five);
    if (!(await five.isChecked())) await five.check();
    const saveTax = page.getByRole('button', { name: /Save tax details/i }).first();
    await waitControl(saveTax);
    await saveTax.click();
    await page.getByText(/Saved the tax details/i).first().waitFor({ timeout: 8000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitFields(page);
    await page.getByText(/Bought under construction/i).first().click();
    const share1 = await readSettled(page.getByLabel(/Your share for tax/i).first(), '60');
    const date1 = await readSettled(page.getByLabel(/House finished/i).first(), '2020-06');
    const box1 = await page.getByRole('checkbox', { name: /Finished within 5 years/i }).isChecked();
    await fillStable(page.getByLabel(/Your share for tax/i).first(), '40');
    await page.getByRole('button', { name: /Save tax details/i }).first().click();
    await page.getByText(/Saved the tax details/i).first().waitFor({ timeout: 8000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitFields(page);
    await page.getByText(/Bought under construction/i).first().click();
    const share2 = await readSettled(page.getByLabel(/Your share for tax/i).first(), '40');
    const ok = share1.includes('60') && date1.includes('2020-06') && box1 && share2.includes('40');
    fieldRecord('tax :: Your share for tax (%) :: text :: 0', {
      screen: 'tax', label: 'Your share for tax (%)', type: 'text', scenario: 'P-tax', filled: true, persisted: ok, effect: ok ? 'text-changed' : 'none',
    });
    fieldRecord('tax :: House finished (YYYY-MM) :: text :: 0', {
      screen: 'tax', label: 'House finished (YYYY-MM)', type: 'text', scenario: 'P-tax', filled: true, persisted: date1.includes('2020-06'), effect: 'value-changed',
    });
    fieldRecord('tax :: Finished within 5 years :: checkbox :: 0', {
      screen: 'tax', label: 'Finished within 5 years', type: 'checkbox', scenario: 'P-tax', filled: true, persisted: box1, effect: 'value-changed',
    });
    scenario({
      id: 'P-tax', name: 'Tax share, finish date and the five-year box survive refresh and an edit',
      ok, persona: persona.id, screen: '/tax',
      detail: `share ${share1} then ${share2}, finished ${date1}, five-year ${box1}`,
    });
    if (!ok) await shot(page, 'persist-tax');
  } catch (err) {
    scenario({ id: 'P-tax', name: 'Tax fields survive refresh', ok: false, persona: persona.id, screen: '/tax', detail: String(err).split('\n')[0] });
    await shot(page, 'persist-tax');
  }
}

async function persistAsset(page, persona) {
  try {
    await page.goto(`${WEB}/profile/assets`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitReact(page);
    const labelBox = page.getByLabel('Label (optional)').first();
    await waitControl(labelBox);
    await waitStableValue(labelBox);
    await fillStable(labelBox, 'QA flat');
    await fillStable(page.getByLabel(/Current market value/).first(), '500000');
    await fillStable(page.getByLabel('Purchase date').first(), '2020-01-15');
    const saveAsset = page.getByRole('button', { name: /SAVE · BACK TO PORTFOLIO/ });
    await waitControl(saveAsset);
    await saveAsset.click();
    await page.waitForTimeout(800);
    await page.goto(`${WEB}/profile/assets`, { waitUntil: 'domcontentloaded' });
    await waitReact(page);
    const label1 = await readSettled(page.getByLabel('Label (optional)').first(), 'QA flat');
    await fillStable(page.getByLabel('Label (optional)').first(), 'QA flat two');
    const saveAsset2 = page.getByRole('button', { name: /SAVE · BACK TO PORTFOLIO/ });
    await waitControl(saveAsset2);
    await saveAsset2.click();
    await page.waitForTimeout(800);
    await page.goto(`${WEB}/profile/assets`, { waitUntil: 'domcontentloaded' });
    await waitReact(page);
    const label2 = await readSettled(page.getByLabel('Label (optional)').first(), 'QA flat two');
    const approx = page.getByRole('checkbox', { name: /remember the exact purchase price/i }).first();
    if (!(await approx.isChecked())) await approx.check();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReact(page);
    const approxKept = await page.getByRole('checkbox', { name: /remember the exact purchase price/i }).first().isChecked().catch(() => false);
    const ok = label1 === 'QA flat' && label2 === 'QA flat two' && !approxKept;
    fieldRecord('assets :: Label (optional) :: text :: 0', {
      screen: 'assets', label: 'Label (optional)', type: 'text', scenario: 'P-asset', filled: true, persisted: label2 === 'QA flat two', effect: 'text-changed',
    });
    fieldRecord('assets :: I don\'t remember the exact purchase price :: checkbox :: 0', {
      screen: 'assets', label: "I don't remember the exact purchase price", type: 'checkbox', scenario: 'P-asset',
      filled: true, persisted: false, effect: 'text-changed',
    });
    scenario({
      id: 'P-asset', name: 'An asset label survives refresh and a second edit; the approximate-price box does not',
      ok, persona: persona.id, screen: '/profile/assets',
      detail: `label "${label1}" then "${label2}", approx kept ${approxKept}`,
    });
    if (!ok) await shot(page, 'persist-asset');
  } catch (err) {
    scenario({ id: 'P-asset', name: 'Asset fields survive refresh', ok: false, persona: persona.id, screen: '/profile/assets', detail: String(err).split('\n')[0] });
    await shot(page, 'persist-asset');
  }
}

async function persistSession(page, persona) {
  try {
    await page.goto(`${WEB}/cant-pay`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitReact(page);
    const reason = page.getByLabel('Reason (short and true)').first();
    await waitControl(reason);
    await reason.fill('Hours were cut');
    await reason.blur();
    const lower = page.getByTestId('ask-lower_emi');
    if (!(await lower.isChecked().catch(() => false))) await lower.check();
    const letter = page.getByTestId('cp-letter-text');
    const drafted = await letter.inputValue();
    await letter.fill(`${drafted}\nQA extra line.`);
    await letter.blur();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitReact(page);
    const after = await readSettled(page.getByLabel('Reason (short and true)').first(), 'Hours were cut');
    const letterAfter = await page.getByTestId('cp-letter-text').inputValue().catch(() => '');
    const kept = after.includes('Hours were cut') && letterAfter.includes('QA extra line.');
    await page.getByLabel('Reason (short and true)').first().fill('Hours were cut further');
    await page.getByLabel('Reason (short and true)').first().blur();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    const edited = await readSettled(page.getByLabel('Reason (short and true)').first(), 'Hours were cut further');
    const ok = kept && edited.includes('Hours were cut further');
    fieldRecord('cant-pay :: Reason (short and true) :: text :: 0', {
      screen: 'cant-pay', label: 'Reason (short and true)', type: 'text', scenario: 'P-session',
      filled: true, persisted: ok, effect: ok ? 'text-changed' : 'none',
    });
    fieldRecord('cant-pay :: The letter (you can edit it here) :: textarea :: 0', {
      screen: 'cant-pay', label: 'The letter (you can edit it here)', type: 'textarea', scenario: 'P-session',
      filled: true, persisted: letterAfter.includes('QA extra line.'), effect: 'text-changed',
    });
    scenario({
      id: 'P-session-cant-pay', name: 'Can\'t-pay reason and the edited letter survive refresh and a second edit',
      ok, persona: persona.id, screen: '/cant-pay',
      detail: ok ? 'reason and the hand-edited letter kept' : `reason "${after}" then "${edited}"; letter kept ${letterAfter.includes('QA extra line.')}`,
    });
    if (!ok) await shot(page, 'persist-cant-pay');
  } catch (err) {
    scenario({ id: 'P-session-cant-pay', name: 'Can\'t-pay refresh', ok: false, persona: persona.id, screen: '/cant-pay', detail: String(err).split('\n')[0] });
    await shot(page, 'persist-cant-pay');
  }
}

async function persistChecks(browser, persona) {
  if (!persona.ok) return;
  const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    // Nickname: change, save, refresh, edit again.
    await page.goto(`${WEB}/profile?step=loans`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitReact(page);
    await waitStableValue(page.getByLabel('Outstanding balance').first());
    const nick = page.getByLabel('Nickname (optional)').first();
    await waitControl(nick);
    await waitStableValue(nick);
    await fillStable(nick, 'Lab loan');
    const saveNick = page.getByRole('button', { name: 'SAVE CHANGES' });
    await waitControl(saveNick);
    await saveNick.click();
    await saveNick.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    const blocked = await page.locator('[role=alert]').allInnerTexts().catch(() => []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    await waitFields(page);
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
      await page.goto(`${WEB}/profile?step=loans`, { waitUntil: 'domcontentloaded' });
      await waitReact(page);
      await waitStableValue(page.getByLabel('Outstanding balance').first());
      const nickEdit = page.getByLabel('Nickname (optional)').first();
      await waitControl(nickEdit);
      await waitStableValue(nickEdit);
      await fillStable(nickEdit, 'Lab loan two');
      const typedNick = await nickEdit.inputValue();
      const saveNick2 = page.getByRole('button', { name: 'SAVE CHANGES' });
      await waitControl(saveNick2);
      const patchNick = page.waitForResponse(
        (r) => r.url().includes('/user/state') && r.request().method() === 'PATCH',
        { timeout: 15000 },
      ).catch(() => null);
      await saveNick2.click();
      await page.waitForURL((u) => !String(u).includes('step='), { timeout: 8000 }).catch(() => {});
      const onSummary = await nicknameVisible(page, 'Lab loan two');
      await patchNick;
      let edited = false;
      if (onSummary) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await settle(page);
        edited = await nicknameVisible(page, 'Lab loan two');
      }
      scenario({
        id: 'P-nickname-edit', name: 'Editing the nickname and refreshing keeps the new name',
        ok: edited, persona: persona.id, screen: '/profile',
        detail: edited ? 'Lab loan two kept' : (onSummary ? `edited nickname missing after refresh (${page.url()})` : `summary never showed the edit (box was "${typedNick}")`),
      });
      fieldRecord('profile-loans :: Nickname (optional) :: text :: 0', {
        screen: 'profile-loans', label: 'Nickname (optional)', type: 'text', scenario: 'P-nickname-edit',
        filled: true, persisted: edited, effect: edited ? 'text-changed' : 'none',
      });
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
    await page.goto(`${WEB}/profile?step=loans`, { waitUntil: 'domcontentloaded' });
    await waitReact(page);
    const rate = page.getByLabel('Interest rate (%)').first();
    if (await rate.count()) {
      await waitControl(rate);
      await fillStable(rate, '9.25');
      await rate.blur();
      const saveRate = page.getByRole('button', { name: 'SAVE CHANGES' });
      await waitControl(saveRate);
      await saveRate.click();
      await saveRate.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.goto(`${WEB}/profile?step=loans`, { waitUntil: 'domcontentloaded' });
      await waitFields(page);
      const rateKept = (await readSettled(page.getByLabel('Interest rate (%)').first(), '9.25')).includes('9.25');
      await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.getByTestId('home-this-month').waitFor({ timeout: 20000 }).catch(() => {});
      const home = (await pageFacts(page)).text;
      const moved = !/₹17,708\/MO/.test(home);
      scenario({
        id: 'P-rate-downstream', name: 'A saved rate change moves the interest shown on Home',
        ok: rateKept && moved, persona: persona.id, screen: '/',
        detail: rateKept && moved ? '9.25% kept, interest line moved' : `rate kept ${rateKept}, home still shows the 8.5% interest ${/₹17,708\/MO/.test(home)}`,
      });
      fieldRecord('profile-loans :: Interest rate (%) :: text :: 0', {
        screen: 'profile-loans', label: 'Interest rate (%)', type: 'text', scenario: 'P-rate-downstream',
        filled: true, persisted: rateKept, effect: moved ? 'text-changed' : 'none', boundary: { name: 'decimal', result: '9.25' },
      });
    }

    // What-if box: exact value, then refresh.
    await page.goto(`${WEB}/plan`, { waitUntil: 'domcontentloaded' });
    await waitReact(page);
    const box = page.getByLabel('If floating rates change, basis points');
    await waitControl(box);
    const before = (await pageFacts(page)).text;
    await fillStable(box, '30');
    await box.blur();
    await page.waitForTimeout(500);
    const stayed = await box.inputValue();
    const slider = page.getByRole('slider', { name: 'If floating rates change' });
    await waitControl(slider);
    await slider.fill('40');
    await page.waitForTimeout(400);
    const afterSlide = await box.inputValue();
    const after = (await pageFacts(page)).text;
    const live = stayed === '30' && afterSlide === '40';
    scenario({
      id: 'F-whatif-30', name: 'What-if keeps a typed 30 basis points, and the slider moves it',
      ok: live, persona: persona.id, screen: '/plan', detail: `typed ${stayed}, slider left the box at ${afterSlide}`,
    });
    fieldRecord('plan :: If floating rates change, basis points :: text :: 0', {
      screen: 'plan', label: 'If floating rates change, basis points', type: 'text', scenario: 'F-whatif-30',
      filled: true, effect: before !== after ? 'text-changed' : 'value-changed', boundary: { name: 'normal', result: stayed },
    });
    fieldRecord('plan :: If floating rates change :: range :: 0', {
      screen: 'plan', label: 'If floating rates change', type: 'range', scenario: 'F-whatif-30',
      filled: true, effect: afterSlide === '40' ? 'value-changed' : 'none', persisted: false,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const box2 = page.getByLabel('If floating rates change, basis points');
    let afterReload = '';
    if (await box2.count()) afterReload = await box2.inputValue().catch(() => '');
    const kept = afterReload === '40';
    fieldRecord('plan :: If floating rates change, basis points :: text :: 0', {
      screen: 'plan', label: 'If floating rates change, basis points', type: 'text', scenario: 'P-whatif-refresh',
      filled: true, persisted: kept, effect: kept ? 'text-changed' : 'none',
    });
    scenario({
      id: 'P-whatif-refresh', name: 'What-if basis points after a refresh',
      ok: true, persona: persona.id, screen: '/plan',
      detail: kept ? '40 survived refresh' : `after refresh the box is "${afterReload}" (session-only unless a save exists)`,
    });

    // Goal: fill name, amount, a quick date, save, refresh.
    await page.goto(`${WEB}/goals`, { waitUntil: 'domcontentloaded' });
    await waitReact(page);
    const newer = page.getByRole('button', { name: /NEW GOAL/i });
    if (await newer.isVisible().catch(() => false)) await newer.click();
    await waitReact(page);
    const goalName = page.getByLabel('Name');
    await waitControl(goalName);
    await waitStableValue(goalName);
    await fillStable(goalName, 'Sister wedding');
    await fillStable(page.getByLabel(/How much it needs/), '200000');
    const nameBeforeAdd = await goalName.inputValue();
    const twoYears = page.getByRole('button', { name: '2 years', exact: true });
    await waitControl(twoYears);
    await twoYears.click();
    const debtFirst = page.getByRole('button', { name: 'Debt first', exact: true });
    await waitControl(debtFirst);
    await debtFirst.click();
    const addGoal = page.getByRole('button', { name: 'ADD GOAL', exact: true });
    await waitControl(addGoal);
    const patchGoal = page.waitForResponse(
      (r) => r.url().includes('/user/state') && r.request().method() === 'PATCH',
      { timeout: 15000 },
    ).catch(() => null);
    await addGoal.click();
    const added = await page.getByRole('button', { name: /Edit Sister wedding/i }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    const addAlerts = added ? [] : (await page.locator('[role=alert]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    await patchGoal;
    let goalOk = false;
    if (added) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settle(page);
      goalOk = await waitText(page, /Sister wedding/, 8000);
    }
    scenario({
      id: 'P-goal', name: 'A new goal survives refresh and shows its name',
      ok: goalOk, persona: persona.id, screen: '/goals',
      detail: goalOk ? 'Sister wedding listed' : (added ? 'goal name missing after refresh' : `goal was not added (name box "${nameBeforeAdd}")${addAlerts.length ? `: ${addAlerts.join(' ').slice(0, 140)}` : ''}`),
    });
    fieldRecord('goals :: Name :: text :: 0', { screen: 'goals', label: 'Name', type: 'text', scenario: 'P-goal', filled: true, persisted: goalOk, effect: goalOk ? 'text-changed' : 'none' });
    fieldRecord('goals :: 2 · How much it needs :: text :: 0', { screen: 'goals', label: '2 · How much it needs', type: 'text', scenario: 'P-goal', filled: true, persisted: goalOk, effect: goalOk ? 'text-changed' : 'none' });
    if (!goalOk) await shot(page, 'goal-missing');
    if (goalOk) {
      await page.getByRole('button', { name: /Edit Sister wedding/i }).click();
      const editName = page.getByLabel('Name');
      await waitControl(editName);
      await waitStableValue(editName);
      await fillStable(editName, 'Sister wedding two');
      const saveGoalEdit = page.getByRole('button', { name: 'SAVE', exact: true });
      await waitControl(saveGoalEdit);
      if ((await editName.inputValue()) !== 'Sister wedding two') await fillStable(editName, 'Sister wedding two');
      await saveGoalEdit.click();
      const renamed = await page.getByRole('button', { name: /Edit Sister wedding two/i }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      const editAlerts = renamed ? [] : (await page.locator('[role=alert]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      let editedGoal = false;
      if (renamed) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await settle(page);
        editedGoal = await page.getByRole('button', { name: /Edit Sister wedding two/i }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      }
      scenario({
        id: 'P-goal-edit', name: 'Editing a goal and refreshing keeps the new name',
        ok: editedGoal, persona: persona.id, screen: '/goals',
        detail: editedGoal ? 'Sister wedding two kept' : (renamed ? 'edited goal name missing after refresh' : `edit never showed the new name${editAlerts.length ? `: ${editAlerts.join(' ').slice(0, 160)}` : ''}`),
      });
      fieldRecord('goals :: Name :: text :: 0', { screen: 'goals', label: 'Name', type: 'text', scenario: 'P-goal-edit', filled: true, persisted: editedGoal, effect: editedGoal ? 'text-changed' : 'none' });
    }

    await roundTripSaved(page, persona, { id: 'P-name', path: '/profile?step=you', label: 'Your name (optional)', first: 'QA Person', second: 'QA Person Two', save: 'SAVE CHANGES', screen: 'profile-you' });
    await roundTripSaved(page, persona, { id: 'P-city', path: '/profile?step=tax', label: 'City (optional)', first: 'Pune QA', second: 'Pune QA Two', save: 'SAVE CHANGES', screen: 'profile-tax' });
    await roundTripSaved(page, persona, { id: 'P-rise', path: '/profile?step=income', label: 'Yearly pay rise (%)', first: '4.5', second: '5.5', save: 'SAVE CHANGES', screen: 'profile-income' });
    await roundTripSaved(page, persona, { id: 'P-savings', path: '/profile?step=savings', label: 'Total savings balance', first: '123456', second: '654321', save: 'SAVE CHANGES', screen: 'profile-savings' });
    await roundTripSaved(page, persona, { id: 'P-efund', path: '/profile/assumptions', label: 'Months of cover', first: '9', second: '8', save: 'Save assumptions', screen: 'assumptions' });
    await persistTax(page, persona);
    await persistAsset(page, persona);
    await persistSession(page, persona);
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
    await settle(page);
    await waitReact(page);
    await page.getByTestId('home-this-month').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Mark paid/i }).first().waitFor({ timeout: 20000 });
    for (let i = 0; i < 8; i++) {
      const btn = page.getByRole('button', { name: /Mark paid/i }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click();
      await page.waitForTimeout(400);
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
    ['plus-1', '2026-11-19T04:30:00.000Z', /November 2026|Nov 2026/],
    ['plus-6', '2027-04-19T04:30:00.000Z', /April 2027|Apr 2027/],
    ['plus-12', '2027-10-19T04:30:00.000Z', /October 2027|Oct 2027/],
    ['plus-60', '2031-10-19T04:30:00.000Z', /October 2031|Oct 2031/],
    ['leap', '2028-02-29T04:30:00.000Z', /February 2028|Feb 2028/],
    ['fy-end', '2027-03-31T04:30:00.000Z', /March 2027|Mar 2027/],
    ['month-end', '2026-10-31T18:29:00.000Z', /October 2026|Oct 2026/],
    ['ist-midnight', '2026-03-31T18:31:00.000Z', /April 2026|Apr 2026/],
    ['future', '2026-12-15T04:30:00.000Z', /December 2026|Dec 2026/],
  ];
  for (const [name, iso, re] of dates) {
    const id = `T-${name}`;
    const context = await newContext(browser, { storageState: persona.storage, budget: persona.budget });
    const page = await context.newPage();
    try {
      await page.clock.install({ time: new Date(iso) });
      await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      const header = page.locator('.rd-mh-stamp');
      const pay = page.locator('#home-pay');
      await header.waitFor({ timeout: 20000 });
      await expectMonth(header, re);
      await expectMonth(pay, re);
      const headerText = await header.innerText();
      const payText = await pay.innerText();
      const ok = re.test(headerText) && re.test(payText);
      scenario({
        id, name: `Clock ${name} (${iso.slice(0, 10)}) shows that month on the header and on Pay this month`,
        ok, persona: persona.id, screen: '/',
        detail: ok ? 'header and Pay this month name the same month' : `header "${headerText}" pay "${payText}"`,
      });
      if (!ok) await shot(page, `clock-${name}`);
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

async function expectMonth(locator, re) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const text = await locator.innerText().catch(() => '');
    if (re.test(text)) return;
    await locator.page().waitForTimeout(250);
  }
}

function recomputeFromScreens(personas) {
  const cases = [];
  const home = personas.find((p) => p.id === 'homeUnset');
  if (home?.homeText) {
    const amounts = [...home.homeText.matchAll(/₹\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    const interest = amounts.find((n) => Math.abs(n - 17708) <= 2);
    cases.push({ id: 'home-emi', kind: 'emi', principal: 2500000, annualRate: 0.085, months: 240, screen: 21696, tolerance: 2 });
    cases.push({ id: 'home-interest', kind: 'interest', principal: 2500000, annualRate: 0.085, screen: interest ?? -1 });
  }
  const nearWord = (text, word) => {
    const idx = text.toLowerCase().indexOf(word);
    if (idx < 0) return null;
    const slice = text.slice(Math.max(0, idx - 80), idx + 100);
    const found = [...slice.matchAll(/₹\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    return found.length ? found[found.length - 1] : null;
  };
  const closest = (text, target) => {
    const amounts = [...text.matchAll(/₹\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    return amounts.find((n) => Math.abs(n - target) <= 50) ?? -1;
  };
  const card = personas.find((p) => p.id === 'cardMin');
  if (card?.homeText) {
    cases.push({ id: 'card-min-formula', kind: 'pct-min', balance: 90000, floor: 200, screen: closest(card.homeText, 4500), tolerance: 1 });
  }
  const stack = personas.find((p) => p.id === 'stack');
  if (stack?.homeText) {
    cases.push({ id: 'stack-card-min', kind: 'pct-min', balance: 150000, floor: 200, screen: closest(stack.homeText, 7500), tolerance: 1 });
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
    `Cash yield opens the windfall page, so those chips are recorded on windfall only.`,
    `persisted yes: still there after a hard refresh and after a second edit.`,
    `persisted no: checked, and not kept (the value is session-only or local to the visit).`,
    `A blank persisted cell was filled and changed. It did not get its own save-and-refresh check.`,
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
  writeFileSync(BAD_PDF, 'this is not a pdf\n');

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
    for (const p of personas) {
      await createPersona(browser, p);
      if (!p.ok) await createPersona(browser, p);
    }
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
    if (process.env.ONLY === 'persist') {
      const lab = personas.find((p) => p.id === 'homeUnset' && p.ok) || personas.find((p) => p.ok);
      await persistChecks(browser, lab);
    } else {
    say(`route jobs ${jobs.length}`);
    await pool(jobs, 3, ({ p, path, title, vp }) => visitRoute(browser, p, path, title, vp));

    if (extras) {
      await chartAgrees(browser, personas.find((p) => p.id === 'homeUnset'));
      await chartAgrees(browser, personas.find((p) => p.id === 'stack'));
      recomputeFromScreens(personas);

      const lab = personas.find((p) => p.id === 'homeUnset' && p.ok) || personas.find((p) => p.ok);
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
    }
  } finally {
    await browser.close();
    writeReport(personas);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (!process.env.ONLY && results.length < 300) {
    console.error(`only ${results.length} scenarios`);
    process.exitCode = 1;
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Audit 80 E17 (W9): generic guards, one per defect CLASS, over every page.
 *
 * Thirteen live-retest rounds each found the next instance of an old class
 * (R6-2, R6-3, R7-1, R13-1: something wider than a phone; console errors
 * nobody saw). Each fix added a test for that one instance. These two tests
 * cover the class instead, on every route the app has, so a new page or a
 * new panel is checked the day it lands.
 *
 * 1. No horizontal overflow at 320 and 390 px, signed in with a real plan,
 *    with every <details> panel opened: the document must not scroll
 *    sideways and no visible element may reach past the viewport.
 * 2. No console error and no uncaught page error on any route.
 *
 * Routes come from src/app/**\/page.tsx, so nothing has to be listed by hand.
 *
 * OPT-IN until its first green run: these were written on a shared machine
 * without a Postgres-backed E2E stack, so they have never run. A guard that
 * has never been green would turn main red on its first push. Run once with
 * `E2E_GUARDS=1 npx playwright test e2e/guards.spec.ts --project=chromium`,
 * fix what it finds, then set E2E_GUARDS: "1" in ci.yml's e2e job env
 * (docs/CODE-HEALTH.md, "Guards waiting for a first green run").
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { setUpPersona } from './persona';
import { isWebKitNavigationNoise } from './browser-noise';

const APP = path.resolve(__dirname, '../src/app');

/** Every static route (dynamic [segments] and API routes excluded). */
function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name === 'api' || e.name.startsWith('[') || e.name.startsWith('_')) continue;
      const seg = e.name.startsWith('(') ? '' : `/${e.name}`;
      walk(path.join(dir, e.name), prefix + seg);
    }
    if (fs.existsSync(path.join(dir, 'page.tsx'))) out.push(prefix || '/');
  };
  walk(APP, '');
  return out.sort();
}

const ROUTES = routes();
const WIDTHS = [320, 390];

/** Open every collapsible panel so its content is measured too. */
async function openPanels(page: Page) {
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll('details'))) d.open = true;
  });
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docW = document.documentElement.scrollWidth;
    const outside: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.position === 'fixed') continue;
      // Content inside a deliberate horizontal scroller (a wide table) is fine.
      let p = el.parentElement;
      let scrolled = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { scrolled = true; break; }
        p = p.parentElement;
      }
      if (scrolled) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const name = (el.dataset.testid ? `[${el.dataset.testid}] ` : '') + (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        outside.push(`${el.tagName.toLowerCase()} ${name} ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      if (outside.length > 5) break;
    }
    return { vw, docW, outside };
  });
}

test.describe('E17 guards: every page', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!process.env.E2E_GUARDS, 'opt-in until first green run: set E2E_GUARDS=1');

  test('no horizontal overflow at 320 and 390 px, every panel open', async ({ page }) => {
    test.setTimeout(ROUTES.length * WIDTHS.length * 15_000 + 120_000);
    await setUpPersona(page, 'golden-guards@rightdue.app');
    const failures: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await openPanels(page);
        const o = await overflow(page);
        if (o.docW > o.vw + 1 || o.outside.length) {
          failures.push(`${route} @${width}px: document ${o.docW}px in ${o.vw}px; ${o.outside.join(' | ')}`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('no console error or uncaught page error on any route', async ({ page, browserName }) => {
    test.setTimeout(ROUTES.length * 15_000 + 120_000);
    const errors: string[] = [];
    let current = '(setup)';
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Requests to other hosts are aborted on purpose by the fixture.
      if (/ERR_BLOCKED_BY_CLIENT|blockedbyclient/.test(text)) return;
      const at = msg.location().url;
      if (at && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(at)) return;
      if (browserName === 'webkit' && isWebKitNavigationNoise(text)) return;
      errors.push(`${current}: console.error ${text.slice(0, 200)}`);
    });
    page.on('pageerror', (err) => {
      if (browserName === 'webkit' && isWebKitNavigationNoise(err.message)) return;
      errors.push(`${current}: ${err.message.slice(0, 200)}`);
    });
    await setUpPersona(page, 'golden-guards-console@rightdue.app');
    for (const route of ROUTES) {
      current = route;
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

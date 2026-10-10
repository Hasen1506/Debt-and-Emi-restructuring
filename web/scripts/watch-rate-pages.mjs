// Watch the bank pages behind the Tier-A rate cards for changed rates.
//
//   node scripts/watch-rate-pages.mjs                       # compare, print what changed
//   node scripts/watch-rate-pages.mjs --report ../report.md # also append it to a Markdown checklist
//   node scripts/watch-rate-pages.mjs --accept              # record the pages as they are now
//
// Pages and what each showed when last accepted live in
// api/data/rate_pages.json. A bank page needs a browser (most fill their rate
// tables with JavaScript), so this runs Chromium through Playwright. It never
// edits a rate card: a page whose percentages changed is listed for a person
// to re-read, with the figures that appeared and the ones that went. Run with
// --accept once the cards are updated.
//
// PW_CHROMIUM_PATH picks a browser binary; HTTPS_PROXY and CA_SPKI route it
// through a proxy that re-signs TLS (a sandbox); CI needs neither.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'api/data/rate_pages.json');
const args = process.argv.slice(2);
const accept = args.includes('--accept');
const reportAt = args.includes('--report') ? path.resolve(args[args.indexOf('--report') + 1]) : null;

/** Every percentage a page shows, as sorted unique strings ("8.35", "45"). */
export function figures(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*%/g)) {
    const n = Number(m[1]);
    if (n >= 0.5 && n <= 60) out.add(String(n));
  }
  return [...out].sort((a, b) => Number(a) - Number(b));
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const launch = { executablePath: process.env.PW_CHROMIUM_PATH || undefined };
  if (process.env.HTTPS_PROXY && process.env.CA_SPKI) {
    launch.proxy = { server: process.env.HTTPS_PROXY };
    launch.args = [`--ignore-certificate-errors-spki-list=${process.env.CA_SPKI}`];
  }
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    locale: 'en-IN',
  });
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const p of data.pages) {
    const page = await ctx.newPage();
    let text = '';
    let problem = null;
    try {
      const res = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      text = await page.evaluate(() => document.body.innerText);
      if (!res || res.status() >= 400) problem = `HTTP ${res ? res.status() : 'no reply'}`;
      else if (/Page-Not-Found|page not found|404/i.test(page.url()) || text.length < 500) problem = 'page moved or empty';
      else if (figures(text).length === 0) problem = 'no rates on the page any more';
    } catch (e) {
      problem = String(e.message).split('\n')[0];
    }
    await page.close();
    const label = `${p.institution} ${p.product}`;
    if (problem) {
      lines.push(`Couldn't read the **${label}** page (${problem}): ${p.url}`);
      continue;
    }
    const now = figures(text);
    const before = data.seen[p.url]?.figures;
    if (accept || !before) {
      data.seen[p.url] = { figures: now, at: today };
      continue;
    }
    const added = now.filter((f) => !before.includes(f));
    const gone = before.filter((f) => !now.includes(f));
    if (added.length || gone.length) {
      lines.push(
        `**${label}** page changed since ${data.seen[p.url].at}` +
          (added.length ? `; now shows ${added.map((f) => f + '%').join(', ')}` : '') +
          (gone.length ? `; no longer shows ${gone.map((f) => f + '%').join(', ')}` : '') +
          `. Re-read it and update engine/rate_cards.py (or market-data.json): ${p.url}`,
      );
    }
  }
  await browser.close();
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');
  for (const l of lines) console.log('-', l);
  if (reportAt && lines.length) fs.appendFileSync(reportAt, lines.map((l) => `- [ ] ${l}\n`).join(''));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}

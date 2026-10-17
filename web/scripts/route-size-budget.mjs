#!/usr/bin/env node
// Audit 80 E21/E12 (W9): first-load JS per route, against a committed budget.
//
//   npm run build
//   node scripts/route-size-budget.mjs            # check (exit 1 over budget)
//   node scripts/route-size-budget.mjs --write    # re-baseline (say why in the PR)
//
// First-load JS = gzipped size of every chunk the route's HTML loads: the
// shared root chunks plus the route's own (from .next/app-build-manifest.json),
// which is what `next build` prints as "First Load JS". A route fails when it
// grows more than GROWTH_KB over its baseline, or goes over HARD_CAP_KB.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT = path.join(WEB, '.next');
const BUDGET = path.join(WEB, 'scripts', 'route-size-budget.json');
const GROWTH_KB = 10;
const HARD_CAP_KB = 300;

function gz(file) {
  return zlib.gzipSync(fs.readFileSync(path.join(NEXT, file)), { level: 9 }).length;
}

function measure() {
  const build = JSON.parse(fs.readFileSync(path.join(NEXT, 'build-manifest.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-build-manifest.json'), 'utf8'));
  const root = build.rootMainFiles || []; // polyfills load only in nomodule browsers
  const cache = new Map();
  const size = (f) => {
    if (!cache.has(f)) cache.set(f, f.endsWith('.js') ? gz(f) : 0);
    return cache.get(f);
  };
  const out = {};
  for (const [key, files] of Object.entries(app.pages)) {
    if (!key.endsWith('/page')) continue; // layouts and route handlers are counted inside pages
    const route = key.replace(/\/page$/, '') || '/';
    const all = new Set([...root, ...files]);
    out[route] = Math.round([...all].reduce((s, f) => s + size(f), 0) / 100) / 10; // kB (1000 B, as next build prints), 1 dp
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const sizes = measure();
if (process.argv.includes('--write')) {
  fs.writeFileSync(
    BUDGET,
    JSON.stringify({ _comment: `First-load JS (gzip kB) per route. Fails at +${GROWTH_KB} kB or over ${HARD_CAP_KB} kB. Re-baseline with --write and say why in the PR.`, routes: sizes }, null, 2) + '\n',
  );
  console.log(`wrote ${path.relative(WEB, BUDGET)} (${Object.keys(sizes).length} routes)`);
  process.exit(0);
}
const budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8')).routes;
let bad = 0;
const rows = [];
for (const [route, kb] of Object.entries(sizes)) {
  const base = budget[route];
  const delta = base == null ? null : Math.round((kb - base) * 10) / 10;
  rows.push(`${route.padEnd(40)} ${String(kb).padStart(7)} kB ${base == null ? '(new)' : `${delta >= 0 ? '+' : ''}${delta}`}`);
  if (kb > HARD_CAP_KB) {
    console.log(`::error::${route} loads ${kb} kB of JS (cap ${HARD_CAP_KB} kB)`);
    bad++;
  } else if (base != null && kb > base + GROWTH_KB) {
    console.log(`::error::${route} grew ${delta} kB to ${kb} kB (budget +${GROWTH_KB} kB over ${base}). Lazy-load something (next/dynamic) or re-baseline with a reason.`);
    bad++;
  }
}
console.log(rows.join('\n'));
fs.writeFileSync(path.join(WEB, '.route-sizes.json'), JSON.stringify(sizes, null, 2));
process.exit(bad ? 1 : 0);

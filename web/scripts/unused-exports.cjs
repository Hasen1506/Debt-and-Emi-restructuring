#!/usr/bin/env node
// Audit 80 E16 (W9): dead exports and never-imported files fail CI.
//
//   node scripts/unused-exports.cjs           # check (exit 1 on anything new)
//   node scripts/unused-exports.cjs --list    # print every finding
//
// An export counts as dead when its name appears in no other file under
// src/, tests/ or e2e/, and only once (its declaration) in its own file.
// "Test-only" exports (used by tests, never by the app) are reported but
// allowed: they are usually helpers kept for a differential test.
// A file counts as never imported when no other src file names it.
// Next.js convention files (page, layout, route, …) are exempt.
//
// Known findings live in scripts/unused-exports.allow.json and may only
// shrink: wire the feature in, or delete it, then remove its line.
'use strict';
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '..');
const ALLOW = path.join(__dirname, 'unused-exports.allow.json');
const NEXT_FILES = /^(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation|global-error|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)$/;
const NEXT_EXPORTS = /^(metadata|viewport|dynamic|dynamicParams|revalidate|fetchCache|preferredRegion|maxDuration|generateMetadata|generateViewport|generateStaticParams|runtime|config|middleware|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|register|onRequestError)$/;

function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|cjs|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

function scan() {
  const src = walk(path.join(WEB, 'src')).filter((f) => /\.tsx?$/.test(f));
  const others = [...walk(path.join(WEB, 'tests')), ...walk(path.join(WEB, 'e2e'))];
  const text = {};
  for (const f of [...src, ...others]) text[f] = fs.readFileSync(f, 'utf8');
  const rel = (f) => path.relative(WEB, f).split(path.sep).join('/');
  const dead = [];
  const testOnly = [];
  for (const f of src) {
    const sf = ts.createSourceFile(f, text[f], ts.ScriptTarget.Latest, true);
    const names = [];
    for (const s of sf.statements) {
      const mods = ts.canHaveModifiers(s) ? ts.getModifiers(s) || [] : [];
      if (!mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
      } else if (s.name && ts.isIdentifier(s.name)) names.push(s.name.text);
    }
    for (const n of names) {
      if (NEXT_EXPORTS.test(n)) continue;
      const re = new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`, 'g');
      const own = (text[f].match(re) || []).length;
      if (own > 1) continue;
      if (src.some((g) => g !== f && re.test(text[g]))) continue;
      (others.some((g) => re.test(text[g])) ? testOnly : dead).push(`${rel(f)}#${n}`);
    }
  }
  const orphans = src
    .filter((f) => {
      const base = path.basename(f).replace(/\.tsx?$/, '');
      if (NEXT_FILES.test(base) || f.endsWith('.d.ts')) return false;
      const re = new RegExp(`['"/]${base.replace(/[.]/g, '\\.')}['"]`);
      return !src.some((g) => g !== f && re.test(text[g]));
    })
    .map(rel);
  return { dead: dead.sort(), testOnly: testOnly.sort(), orphans: orphans.sort() };
}

function main() {
  const found = scan();
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify(found, null, 2));
    return 0;
  }
  if (process.argv.includes('--write-allow')) {
    fs.writeFileSync(ALLOW, JSON.stringify({ dead: found.dead, orphans: found.orphans }, null, 2) + '\n');
    console.log(`wrote ${path.relative(WEB, ALLOW)}`);
    return 0;
  }
  const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
  const newDead = found.dead.filter((x) => !allow.dead.includes(x));
  const newOrphans = found.orphans.filter((x) => !allow.orphans.includes(x));
  const gone = [...allow.dead.filter((x) => !found.dead.includes(x)), ...allow.orphans.filter((x) => !found.orphans.includes(x))];
  console.log(`dead exports: ${found.dead.length} (allow-listed ${allow.dead.length}); test-only exports: ${found.testOnly.length}; never-imported files: ${found.orphans.length}`);
  if (gone.length) console.log(`fixed, remove from unused-exports.allow.json: ${gone.join(', ')}`);
  for (const x of newDead) console.log(`::error::${x} is exported but used nowhere. Delete it, or use it.`);
  for (const x of newOrphans) console.log(`::error::${x} is imported by nothing. Mount it, or delete it.`);
  return newDead.length || newOrphans.length ? 1 : 0;
}

process.exit(main());

#!/usr/bin/env node
// Audit 80 E15/E12 (W9): split ProfileClient.tsx without changing behaviour.
//
//   node scripts/split-profile-client.cjs
//
// A codemod, not a hand edit, so it can be re-run on whatever version of
// ProfileClient.tsx is current (other branches edit that file too): restore
// the single-file version, run this, and the same split falls out.
//
// It moves the self-contained field components (each already its own
// top-level function) into src/app/profile/parts/<group>.tsx, verbatim.
// Imports are pruned per file; a helper or constant that a moved component
// needs and ProfileClient also uses goes to parts/shared.tsx. Nothing is
// renamed and no JSX changes, so the rendered output is byte-for-byte the
// same. The step bodies inside ProfileEditor stay where they are: pulling
// them out needs their state passed as props, which is a real refactor and
// is left for a reviewed PR.
'use strict';
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '../src/app/profile');
const SRC = path.join(DIR, 'ProfileClient.tsx');
const PARTS = path.join(DIR, 'parts');

// Which top-level declaration goes where. Anything not listed stays put
// unless a moved component needs it (then it goes to shared).
const GROUPS = {
  'chrome.tsx': ['BackLink', 'SectionTabs', 'SECTION_TAB', 'ProfileHeader'],
  'income-fields.tsx': ['GrossIncomeField', 'AdvancedTaxDetails'],
  'loan-fields.tsx': ['HikeScheduleEditor', 'TenureField', 'MinPaymentExplainer'],
  'savings-fields.tsx': ['EfLiquidityWarning', 'EfTierPicker', 'OtherBanksField'],
  'country-switch.tsx': ['CountrySwitchPanel'],
};
const SHARED = 'shared.tsx';
const MAIN = 'ProfileClient.tsx';

const text = fs.readFileSync(SRC, 'utf8');
const sf = ts.createSourceFile(SRC, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// ── imports of the original file ─────────────────────────────────────
const imports = []; // {spec, bindings:[{local, imported, isType}], typeOnly, defaultName}
const statements = []; // {names, node, text}
for (const s of sf.statements) {
  if (ts.isImportDeclaration(s)) {
    const spec = s.moduleSpecifier.text;
    const ic = s.importClause;
    const entry = { spec, typeOnly: !!ic?.isTypeOnly, bindings: [], defaultName: null, text: text.slice(s.getStart(), s.getEnd()) };
    if (ic?.name) entry.defaultName = ic.name.text;
    if (ic?.namedBindings && ts.isNamedImports(ic.namedBindings)) {
      for (const el of ic.namedBindings.elements)
        entry.bindings.push({ local: el.name.text, imported: el.propertyName?.text ?? null, isType: el.isTypeOnly });
    } else if (ic?.namedBindings) throw new Error(`namespace import not handled: ${spec}`);
    imports.push(entry);
    continue;
  }
  if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) continue; // 'use client'
  let names = [];
  if (ts.isVariableStatement(s)) names = s.declarationList.declarations.map((d) => d.name.text);
  else if (s.name) names = [s.name.text];
  else throw new Error(`unnamed top-level statement at ${sf.getLineAndCharacterOfPosition(s.getStart()).line + 1}`);
  statements.push({ names, node: s, text: text.slice(s.getFullStart(), s.getEnd()).replace(/^\n+/, '') });
}

function usedIdentifiers(node) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isQualifiedName(p) && p.right === n) ||
        ts.isJsxAttribute(p) ||
        ((ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === n);
      if (!isPropName) out.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

// ── assign statements to files ───────────────────────────────────────
const home = new Map(); // name -> file
for (const [file, names] of Object.entries(GROUPS)) for (const n of names) home.set(n, file);
for (const st of statements) if (!st.names.some((n) => home.has(n))) for (const n of st.names) home.set(n, MAIN);
for (const [, names] of Object.entries(GROUPS))
  for (const n of names) if (!statements.some((st) => st.names.includes(n))) throw new Error(`${n} not found in ProfileClient.tsx`);

// A MAIN declaration used by any moved file goes to shared (no import cycles).
let changed = true;
while (changed) {
  changed = false;
  for (const st of statements) {
    const f = home.get(st.names[0]);
    if (f === MAIN) continue;
    for (const id of usedIdentifiers(st.node)) {
      if (home.get(id) === MAIN && !st.names.includes(id)) {
        const owner = statements.find((s) => s.names.includes(id));
        for (const n of owner.names) home.set(n, SHARED);
        changed = true;
      }
    }
  }
}

const files = {};
for (const st of statements) {
  const f = home.get(st.names[0]);
  (files[f] = files[f] || []).push(st);
}

// ── build each file ───────────────────────────────────────────────────
const exportsNeeded = new Set();
const importPlan = {};
for (const [file, sts] of Object.entries(files)) {
  const declared = new Set(sts.flatMap((s) => s.names));
  const used = new Set();
  for (const s of sts) for (const id of usedIdentifiers(s.node)) used.add(id);
  const plan = { ext: [], local: {} };
  for (const imp of imports) {
    const b = imp.bindings.filter((x) => used.has(x.local) && !declared.has(x.local));
    const d = imp.defaultName && used.has(imp.defaultName) ? imp.defaultName : null;
    if (b.length || d) plan.ext.push({ ...imp, bindings: b, defaultName: d });
  }
  for (const id of used) {
    const h = home.get(id);
    if (!h || h === file || declared.has(id)) continue;
    if (file !== MAIN && h === MAIN) throw new Error(`${file} would import ${id} from ProfileClient (cycle)`);
    (plan.local[h] = plan.local[h] || new Set()).add(id);
    exportsNeeded.add(id);
  }
  importPlan[file] = plan;
}

function relSpec(spec, file) {
  if (!spec.startsWith('.')) return spec;
  if (file === MAIN) return spec;
  const abs = path.resolve(DIR, spec);
  let r = path.relative(PARTS, abs).split(path.sep).join('/');
  return r.startsWith('.') ? r : `./${r}`;
}
function localSpec(target, file) {
  const base = target.replace(/\.tsx$/, '');
  if (file === MAIN) return `./parts/${base}`;
  return `./${base}`;
}
function renderImports(file) {
  const plan = importPlan[file];
  const lines = [];
  for (const imp of plan.ext) {
    const orig = imports.find((x) => x.text === imp.text);
    if (imp.bindings.length === orig.bindings.length && imp.defaultName === orig.defaultName && relSpec(imp.spec, file) === imp.spec) {
      lines.push(imp.text); // unchanged import: keep its original formatting
      continue;
    }
    const parts = [];
    if (imp.defaultName) parts.push(imp.defaultName);
    if (imp.bindings.length) {
      const named = imp.bindings.map((x) => `${x.isType ? 'type ' : ''}${x.imported ? `${x.imported} as ` : ''}${x.local}`);
      const one = `{ ${named.join(', ')} }`;
      parts.push(one.length > 80 ? `{\n  ${named.join(',\n  ')},\n}` : one);
    }
    lines.push(`import ${imp.typeOnly ? 'type ' : ''}${parts.join(', ')} from '${relSpec(imp.spec, file)}';`);
  }
  for (const [target, ids] of Object.entries(plan.local).sort()) {
    const named = [...ids].sort().map((id) => {
      const st = statements.find((s) => s.names.includes(id));
      const isType = ts.isTypeAliasDeclaration(st.node) || ts.isInterfaceDeclaration(st.node);
      return `${isType ? 'type ' : ''}${id}`;
    });
    lines.push(`import { ${named.join(', ')} } from '${localSpec(target, file)}';`);
  }
  return lines.join('\n');
}
function renderBody(file) {
  return files[file]
    .map((st) => {
      let t = st.text;
      const exported = (ts.getModifiers(st.node) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported && st.names.some((n) => exportsNeeded.has(n))) {
        // insert `export ` before the declaration keyword (after any leading comment)
        const lead = st.node.getStart() - st.node.getFullStart() - (text.slice(st.node.getFullStart(), st.node.getEnd()).length - st.text.length);
        t = t.slice(0, lead) + 'export ' + t.slice(lead);
      }
      return t;
    })
    .join('\n\n');
}

fs.mkdirSync(PARTS, { recursive: true });
const header = (file) =>
  `'use client';\n\n// Split out of app/profile/ProfileClient.tsx by scripts/split-profile-client.cjs\n// (Audit 80 E15). Moved verbatim; edit here, not in ProfileClient.\n`;
const written = [];
for (const file of Object.keys(files)) {
  if (file === MAIN) continue;
  const out = `${header(file)}\n${renderImports(file)}\n\n${renderBody(file)}\n`;
  fs.writeFileSync(path.join(PARTS, file), out);
  written.push(`parts/${file} ${out.split('\n').length}`);
}
const mainOut = `'use client';\n\n${renderImports(MAIN)}\n\n${renderBody(MAIN)}\n`;
fs.writeFileSync(SRC, mainOut);
written.push(`ProfileClient.tsx ${mainOut.split('\n').length}`);
console.log(written.join('\n'));

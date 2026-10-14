// Label-in-name scanner (WCAG 2.5.3) for the whole app source.
//
// For every <button>, <a>, <Link>, <LBracket> (and any element with
// role="button"/"link") that sets aria-label= (or LBracket's label=) and has
// visible children, it works out the words a sighted user sees, including
// words inside nested elements and string literals in {cond ? 'A' : 'B'}
// expressions, and checks that some spoken-name alternative starts with them.
// Symbols (→ ↓ ×, punctuation) are ignored; a dynamic part ({p.name},
// ${fmtPct(x)}) ends the literal words that can be compared.
//
// R9's regex only looked at plain-text children, so it missed
// "WHY {pct}? ↓", "{cond ? 'ARCHIVE' : 'CANCEL GOAL'}", "OLD VS NEW REGIME, …→"
// and the strategy medallion's nested <small>PAYOFF ORDER</small>.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const WILD = '\u0000';

/** Read a balanced {...} starting at s[i] === '{'; returns index after '}'. */
function skipBraces(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') i = skipString(s, i);
    else if (c === '`') i = skipTemplate(s, i);
    else if (c === '/' && s[i + 1] === '*') i = s.indexOf('*/', i + 2) + 1;
    else if (c === '/' && s[i + 1] === '/') i = s.indexOf('\n', i);
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}
function skipString(s, i) {
  const q = s[i];
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === q) return i;
  }
  return s.length;
}
function skipTemplate(s, i) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '$' && s[i + 1] === '{') i = skipBraces(s, i + 1) - 1;
    else if (s[i] === '`') return i;
  }
  return s.length;
}
/** Index after the '>' that ends a tag starting at s[i] === '<'. */
function skipTag(s, i) {
  for (i++; i < s.length; i++) {
    const c = s[i];
    if (c === '{') i = skipBraces(s, i) - 1;
    else if (c === '"' || c === "'") i = skipString(s, i);
    else if (c === '>') return i + 1;
  }
  return s.length;
}

/** Alternatives (strings, WILD for dynamic parts) an expression can show. */
function exprAlternatives(e) {
  e = e.trim();
  if (!e || /^\/\*[\s\S]*\*\/$/.test(e)) return [''];
  let m;
  if ((m = /^'((?:[^'\\]|\\.)*)'$/.exec(e)) || (m = /^"((?:[^"\\]|\\.)*)"$/.exec(e))) return [m[1]];
  if (/^`[\s\S]*`$/.test(e) && skipTemplate(e, 0) === e.length - 1) return templateAlternatives(e.slice(1, -1));
  // cond ? A : B with literal (or template) branches.
  const t = splitTernary(e);
  if (t) return [...exprAlternatives(t[0]), ...exprAlternatives(t[1])];
  // cond && 'X'
  if ((m = /^[\s\S]*?&&\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[\s\S]*`)$/.exec(e))) return ['', ...exprAlternatives(m[1])];
  return [WILD];
}
/** Top-level `a ? b : c` → [b, c], or null. */
function splitTernary(e) {
  let depth = 0;
  let q = -1;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === "'" || c === '"') i = skipString(e, i);
    else if (c === '`') i = skipTemplate(e, i);
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === '?' && e[i + 1] !== '.' && e[i + 1] !== '?' && e[i - 1] !== '?') {
      if (q < 0) q = i;
    } else if (depth === 0 && c === ':' && q >= 0) {
      const a = e.slice(q + 1, i).trim();
      const b = e.slice(i + 1).trim();
      // A nested ternary in b is handled by recursion.
      return [a, b];
    }
  }
  return null;
}
function templateAlternatives(body) {
  let outs = [''];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      const end = skipBraces(body, i + 1);
      const alts = exprAlternatives(body.slice(i + 2, end - 1));
      outs = outs.flatMap((o) => alts.map((a) => o + a));
      i = end - 1;
    } else if (body[i] === '\\') {
      outs = outs.map((o) => o + body[i + 1]);
      i++;
    } else outs = outs.map((o) => o + body[i]);
    if (outs.length > 64) outs = outs.slice(0, 64);
  }
  return outs;
}

/** Visible-text alternatives of JSX children. */
function childrenAlternatives(c) {
  let outs = [''];
  const add = (alts) => {
    outs = outs.flatMap((o) => alts.map((a) => o + a));
    if (outs.length > 64) outs = outs.slice(0, 64);
  };
  for (let i = 0; i < c.length; ) {
    if (c[i] === '<') {
      const end = skipTag(c, i);
      // Block-ish separators read as a space.
      add([' ']);
      i = end;
    } else if (c[i] === '{') {
      const end = skipBraces(c, i);
      const inner = c.slice(i + 1, end - 1);
      add(/<[A-Za-z]/.test(inner) ? [WILD] : exprAlternatives(inner));
      i = end;
    } else {
      let j = i;
      while (j < c.length && c[j] !== '<' && c[j] !== '{') j++;
      add([c.slice(i, j).replace(/\s+/g, ' ')]);
      i = j;
    }
  }
  return outs;
}

/** Lowercase words up to the first dynamic part. */
function literalPrefix(s) {
  const cut = s.indexOf(WILD);
  const head = cut < 0 ? s : s.slice(0, cut);
  return {
    words: head.toLowerCase().replace(/[’']/g, '').replace(/&nbsp;|&middot;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(),
    dynamicAfter: cut >= 0,
  };
}

/** Find the matching close tag for an open tag at `start`. */
function findClose(s, tag, from) {
  const open = new RegExp(`<${tag}\\b`, 'g');
  const close = new RegExp(`</${tag}\\s*>`, 'g');
  let depth = 1;
  let i = from;
  for (;;) {
    close.lastIndex = i;
    const cm = close.exec(s);
    if (!cm) return -1;
    open.lastIndex = i;
    let om;
    while ((om = open.exec(s)) && om.index < cm.index) {
      const e = skipTag(s, om.index);
      if (s[e - 2] !== '/') depth++;
      open.lastIndex = e;
    }
    depth--;
    if (depth === 0) return cm.index;
    i = cm.index + cm[0].length;
  }
}

function attr(tagText, names) {
  for (const n of names) {
    const re = new RegExp(`(?:^|\\s)${n}=`, 'g');
    const m = re.exec(tagText);
    if (!m) continue;
    let i = m.index + m[0].length;
    if (tagText[i] === '"' || tagText[i] === "'") return [tagText.slice(i + 1, skipString(tagText, i))];
    if (tagText[i] === '{') return exprAlternatives(tagText.slice(i + 1, skipBraces(tagText, i) - 1));
  }
  return null;
}

/** Scan one file's source; returns [{line, visible, names, ok}]. */
function scanSource(s) {
  const out = [];
  const re = /<(button|a|Link|LBracket|span|div|label)\b/g;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[1];
    const end = skipTag(s, m.index);
    const tagText = s.slice(m.index + 1 + tag.length, end - 1);
    if (tagText.trimEnd().endsWith('/')) continue;
    if (!['button', 'a', 'Link', 'LBracket'].includes(tag) && !/role=["'{]+(button|link|menuitem|tab)\b/.test(tagText)) continue;
    const names = attr(tagText, tag === 'LBracket' ? ['label', 'aria-label'] : ['aria-label']);
    if (!names) continue;
    const close = findClose(s, tag, end);
    if (close < 0) continue;
    const visAlts = childrenAlternatives(s.slice(end, close));
    const nameAlts = names.map(literalPrefix);
    const line = s.slice(0, m.index).split('\n').length;
    for (const v of visAlts) {
      const vis = literalPrefix(v).words;
      if (!/[a-z]{2,}/.test(vis)) continue; // an icon ("i", "×", "+") or all-dynamic text
      const ok = nameAlts.some((n) => n.words.startsWith(vis));
      out.push({ line, visible: vis, names: nameAlts.map((n) => n.words + (n.dynamicAfter ? ' …' : '')), ok });
    }
  }
  return out;
}

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

function scanApp(root) {
  const results = [];
  for (const f of walk(root).filter((x) => x.endsWith('.tsx'))) {
    for (const r of scanSource(fs.readFileSync(f, 'utf8'))) results.push({ file: path.relative(root, f).split(path.sep).join('/'), ...r });
  }
  return results;
}

module.exports = { scanSource, scanApp, childrenAlternatives, exprAlternatives, literalPrefix };

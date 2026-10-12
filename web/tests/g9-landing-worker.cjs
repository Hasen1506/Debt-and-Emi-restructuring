// Grill #49: the Cloudflare landing Worker (deploy/cloudflare/landing-worker.mjs)
// serves welcome.html from the edge for signed-out visitors, wakes Render in
// the background, and never caches anything for signed-in users.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.resolve(__dirname, '../../deploy/cloudflare/landing-worker.mjs')).href);

function harness(originBody = '<html>landing</html>', originHeaders = { 'Content-Type': 'text/html; charset=utf-8' }) {
  const store = new Map();
  const calls = [];
  const waits = [];
  globalThis.caches = {
    default: {
      match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; },
      put: async (req, res) => { store.set(req.url, res.clone()); },
    },
  };
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url.endsWith('/api/health')) return new Response('{"ok":true}');
    return new Response(originBody, { status: 200, headers: originHeaders });
  };
  const ctx = { waitUntil: (p) => waits.push(p) };
  const settle = () => Promise.all(waits.splice(0));
  return { store, calls, ctx, settle };
}

const req = (p, init = {}, country = 'IN') => Object.assign(new Request(`https://rightdue.app${p}`, init), { cf: { country } });

test('first signed-out visit fills the cache, the next is served from the edge', async () => {
  const { default: worker } = await load();
  const h = harness();
  let res = await worker.fetch(req('/'), {}, h.ctx, () => 1000);
  assert.equal(res.headers.get('X-RightDue-Edge'), 'miss');
  assert.equal(await res.text(), '<html>landing</html>');
  await h.settle();
  assert.ok(h.calls.includes('https://rightdue.app/api/health'), 'Render is woken');

  h.calls.length = 0;
  res = await worker.fetch(req('/'), {}, h.ctx, () => 2000);
  assert.equal(res.headers.get('X-RightDue-Edge'), 'hit');
  assert.equal(await res.text(), '<html>landing</html>');
  await h.settle();
  assert.deepEqual(h.calls, ['https://rightdue.app/api/health'], 'a hit only wakes, never waits on the page');
});

test('a copy older than an hour is served at once and refreshed in the background', async () => {
  const { default: worker, REFRESH_AFTER_S } = await load();
  const h = harness();
  await worker.fetch(req('/welcome.html'), {}, h.ctx, () => 0);
  await h.settle();
  h.calls.length = 0;
  const res = await worker.fetch(req('/welcome.html'), {}, h.ctx, () => (REFRESH_AFTER_S + 5) * 1000);
  assert.equal(res.headers.get('X-RightDue-Edge'), 'stale');
  await h.settle();
  assert.ok(h.calls.includes('https://rightdue.app/welcome.html'));
});

test('signed-in visitors, query strings and other paths go straight to the app', async () => {
  const { default: worker, hasSession } = await load();
  for (const r of [
    req('/', { headers: { Cookie: 'rightdue_session=abc' } }),
    req('/', { headers: { Cookie: 'x=1; finoptima_session=abc' } }),
    req('/?country=US'),
    req('/plan'),
    req('/', { method: 'POST', body: 'x' }),
  ]) {
    const h = harness();
    const res = await worker.fetch(r, {}, h.ctx, () => 0);
    assert.equal(res.headers.get('X-RightDue-Edge'), null);
    assert.equal(h.store.size, 0);
  }
  assert.equal(hasSession('rightdue_session='), false, 'an emptied cookie is signed out');
});

test('the cache is kept per country bucket and never stores a Set-Cookie reply', async () => {
  const { default: worker, cacheKey } = await load();
  assert.notEqual(cacheKey(req('/', {}, 'IN')).url, cacheKey(req('/', {}, 'US')).url);
  assert.equal(cacheKey(req('/', {}, 'DE')).url, cacheKey(req('/', {}, 'FR')).url);
  const h = harness('<html>x</html>', { 'Content-Type': 'text/html', 'Set-Cookie': 'a=b' });
  await worker.fetch(req('/'), {}, h.ctx, () => 0);
  await h.settle();
  assert.equal(h.store.size, 0);
});

// The first paint holds its chunk scripts until the frame after the largest
// paint. These checks cover the rewrite and the response hook that sits
// outside Next's compression wrapper.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const ts = require('typescript');
const test = require('node:test');

const root = path.resolve(__dirname, '../src');
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    module._compile(output, file);
  };
}
const { rewriteDeferredHtml, createDeferState, pushDeferredHtml, installDeferredChunks } = require(path.join(root, 'lib/defer-chunks.ts'));

const PAGE = [
  '<!DOCTYPE html><html><head>',
  '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack.js"/>',
  '<link rel="preload" as="font" href="/fonts/ibm-plex-mono-400-latin.woff2"/>',
  '</head><body>',
  '<script src="/_next/static/chunks/main.js" async=""></script>',
  '<script src="/_next/static/chunks/webpack.js" id="_R_" async=""></script>',
  '<script src="/_next/static/chunks/polyfills.js" noModule=""></script>',
  '<script>requestAnimationFrame(function(){$RT=performance.now()});</script>',
  '<p>Pay ₹1,05,000</p>',
  '</body></html>',
].join('');

test('rewrite holds chunk scripts, leaves inline and noModule scripts, and releases once', () => {
  const out = rewriteDeferredHtml(PAGE, createDeferState());
  assert.equal(/<script\b[^>]*\ssrc="\/_next\/static\/chunks\/main\.js"/.test(out), false);
  assert.match(out, /<script type="application\/json" data-rd-src="\/_next\/static\/chunks\/main\.js"><\/script>/);
  assert.match(out, /data-rd-src="\/_next\/static\/chunks\/webpack\.js" data-rd-id="_R_"/);
  assert.match(out, /<script src="\/_next\/static\/chunks\/polyfills\.js" noModule=""><\/script>/);
  assert.match(out, /requestAnimationFrame\(function\(\)\{\$RT=performance\.now\(\)\}\)/);
  assert.equal(out.includes('as="script"'), false);
  assert.match(out, /as="font"/);
  assert.match(out, /Pay ₹1,05,000/);
  assert.equal(out.split('script[data-rd-src]').length, 2);
  assert.match(out, /largest-contentful-paint/);
  assert.match(out, /s\.async=false/);
  assert.match(out, /},500\)/);
  assert.match(out, /hold\.src="\/rd-hold"/);
  assert.match(out, /hold\.async=true/);
  const again = rewriteDeferredHtml(out, createDeferState());
  assert.equal(again.split('script[data-rd-src]').length, 2);
});

test('a script tag split across chunks is rewritten once', () => {
  const state = createDeferState();
  const parts = [
    '<html><body><p>₹1</p><script src="/_next/static/chu',
    'nks/main.js" async=""></script></body></html>',
  ];
  const out = pushDeferredHtml(parts[0], state, false) + pushDeferredHtml(parts[1], state, true);
  assert.equal(/<script\b[^>]*\ssrc="\/_next\/static\/chunks\/main\.js"/.test(out), false);
  assert.match(out, /data-rd-src="\/_next\/static\/chunks\/main\.js"/);
  assert.equal(out.split('script[data-rd-src]').length, 2);
});

test('the response hook rewrites HTML after an inner write wrapper is installed', async () => {
  installDeferredChunks();
  const html = '<html><body><script src="/_next/static/chunks/main.js" async=""></script></body></html>';
  const server = http.createServer(async (req, res) => {
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = function (chunk, enc, cb) { return origWrite(chunk, enc, cb); };
    res.end = function (chunk, enc, cb) { return origEnd(chunk, enc, cb); };
    await Promise.resolve();
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    });
    assert.match(body, /data-rd-src="\/_next\/static\/chunks\/main\.js"/);
    assert.equal(/<script\b[^>]*\ssrc="\/_next\/static\/chunks\/main\.js"/.test(body), false);
    assert.match(body, /largest-contentful-paint/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an already-gzipped HTML body is not rewritten as text', async () => {
  installDeferredChunks();
  const gz = zlib.gzipSync(Buffer.from('<html><body><p>₹1</p></body></html>'));
  const server = http.createServer(async (req, res) => {
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = function (chunk, enc, cb) { return origWrite(chunk, enc, cb); };
    res.end = function (chunk, enc, cb) { return origEnd(chunk, enc, cb); };
    await Promise.resolve();
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-encoding', 'gzip');
    res.end(gz);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/', headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
    assert.deepEqual(body, gz);
    assert.equal(zlib.gunzipSync(body).toString('utf8').includes('rd-hold'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

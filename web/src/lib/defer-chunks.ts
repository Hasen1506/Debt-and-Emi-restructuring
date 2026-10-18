/**
 * The app's scripts are hundreds of kilobytes. On a slow phone they share
 * the first response with the HTML, so the numbers cannot paint until the
 * scripts have also arrived. The HTML already contains the figures. Hold
 * the chunk scripts until the frame after the first paint, then load them
 * in order (async false, so the load event still waits for hydration).
 *
 * Inline scripts stay put: they reveal streamed server HTML and do not
 * download a file. noModule polyfills stay put: a modern browser ignores
 * them, and rewriting them would make it download them.
 */

// Start the chunk downloads on the frame after the last Largest Contentful
// Paint candidate. A fetch that starts after that paint is not part of the
// slow-phone replay of the first paint. async is set false before src so
// the scripts run in document order. A slow empty script (/rd-hold) is
// async: a parser-blocking script holds the web-font swap until it
// finishes, and that late swap becomes the largest paint, which pulls the
// chunks back into the replay. An async script still keeps the load event
// open until the chunks have run, so a click after load reaches a hydrated
// page. Half a second of quiet lets a font swap settle as the largest paint
// before the downloads start. The 2.5 s cap covers a browser with no
// Largest Contentful Paint entries.
const RELEASE = `<script>(function(){var hold=document.createElement("script");hold.async=true;hold.src="/rd-hold";document.head.appendChild(hold);var done=false;function release(){if(done)return;done=true;var nodes=[].slice.call(document.querySelectorAll("script[data-rd-src]"));for(var i=0;i<nodes.length;i++){var n=nodes[i];var s=document.createElement("script");s.async=false;var id=n.getAttribute("data-rd-id");if(id)s.id=id;s.src=n.getAttribute("data-rd-src");document.body.appendChild(s);if(n.parentNode)n.parentNode.removeChild(n);}}var token=0;function arm(){var my=++token;setTimeout(function(){if(my!==token)return;requestAnimationFrame(function(){requestAnimationFrame(function(){if(my!==token)return;release();});});},500);}try{new PerformanceObserver(function(){arm();}).observe({type:"largest-contentful-paint",buffered:true});}catch(e){}arm();setTimeout(release,2500);})();</script>`;

export interface DeferState {
  injected: boolean;
  carry: string;
  /** The body arrived already gzipped (a rewritten static file). Rewriting
   *  those bytes as text replaces the gzip header and the browser cannot
   *  decode the page. */
  passthrough: boolean;
}

export function createDeferState(): DeferState {
  return { injected: false, carry: '', passthrough: false };
}

/** True when `chunk` is a gzip member. A static rewrite can hand the
 *  already-compressed file to the response, and that must not be read as text. */
export function isGzipChunk(chunk: unknown): boolean {
  const buf = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : null;
  return !!buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** Rewrite one complete piece of HTML. `state.injected` records that the
 *  release script was inserted. */
export function rewriteDeferredHtml(html: string, state: DeferState): string {
  let out = html.replace(/<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="script")(?=[^>]*\bhref="\/_next\/static\/)[^>]*>/g, '');
  out = out.replace(/<script\b([^>]*?)\ssrc="(\/_next\/static\/[^"]+)"([^>]*)>\s*<\/script>/g, (full, before, src, after) => {
    const attrs = `${before}${after}`;
    if (/\bnoModule\b/.test(attrs)) return full;
    const id = attrs.match(/\bid="([^"]*)"/);
    return `<script type="application/json" data-rd-src="${src}"${id ? ` data-rd-id="${id[1]}"` : ''}></script>`;
  });
  if (!state.injected && out.includes('</body>') && !out.includes('script[data-rd-src]')) {
    out = out.replace('</body>', `${RELEASE}</body>`);
    state.injected = true;
  }
  return out;
}

/** Feed a response chunk. Holds back a trailing incomplete tag so a split
 *  `<script src` is rewritten once, not twice. */
export function pushDeferredHtml(chunk: string, state: DeferState, flush: boolean): string {
  state.carry += chunk;
  if (!flush) {
    const lastOpen = state.carry.lastIndexOf('<');
    const lastClose = state.carry.lastIndexOf('>');
    if (lastOpen > lastClose) {
      const safe = state.carry.slice(0, lastOpen);
      state.carry = state.carry.slice(lastOpen);
      return rewriteDeferredHtml(safe, state);
    }
  }
  const out = rewriteDeferredHtml(state.carry, state);
  state.carry = '';
  return out;
}

type WriteArgs = { chunk?: unknown; enc?: BufferEncoding; cb?: () => void };

function normalizeWrite(chunk?: unknown, enc?: unknown, cb?: unknown): WriteArgs {
  if (typeof chunk === 'function') return { cb: chunk as () => void };
  if (typeof enc === 'function') return { chunk, cb: enc as () => void };
  return {
    chunk,
    enc: typeof enc === 'string' ? (enc as BufferEncoding) : undefined,
    cb: typeof cb === 'function' ? (cb as () => void) : undefined,
  };
}

function decodeChunk(decoder: TextDecoder, chunk: unknown, enc: BufferEncoding | undefined, flush: boolean): string {
  if (chunk == null) return '';
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) return decoder.decode(chunk, { stream: !flush });
  return '';
}

/** Patch Node's HTTP server so production HTML is rewritten before Next's
 *  compression middleware gzips it. The middleware replaces write/end at the
 *  start of the request; this wraps those replacements once the handler
 *  reaches its first await, which is before any page body is written. */
export function installDeferredChunks(): void {
  // Loaded from instrumentation, which also runs in the edge bundle. The
  // http patch is Node-only.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  // The Node builtin, without a require() the page compiler would try to bundle.
  const http = (process as unknown as { getBuiltinModule(id: string): typeof import('http') }).getBuiltinModule('http');
  const serverProto = http.Server.prototype as typeof http.Server.prototype & { __rdDefer?: boolean };
  if (serverProto.__rdDefer) return;
  serverProto.__rdDefer = true;
  const origEmit = serverProto.emit as (this: unknown, event: string | symbol, ...args: unknown[]) => boolean;
  serverProto.emit = function (this: typeof serverProto, event: string | symbol, ...args: unknown[]) {
    const result = origEmit.apply(this, [event, ...args]);
    if (event !== 'request') return result;
    const res = args[1] as (import('node:http').ServerResponse & { __rdOuter?: boolean }) | undefined;
    if (!res || res.__rdOuter || typeof res.write !== 'function' || typeof res.end !== 'function') return result;
    res.__rdOuter = true;
    const innerWrite = res.write.bind(res);
    const innerEnd = res.end.bind(res);
    const state = createDeferState();
    const decoder = new TextDecoder('utf-8');
    const isHtml = () => String(res.getHeader('content-type') || '').includes('text/html');

    // Only a gzip member is left alone. Next sets Content-Encoding before
    // the plaintext is written, and that plaintext still has to be rewritten;
    // the compressor under us gzips the result. A static rewrite can instead
    // hand over the file's gzip bytes, which must pass through unchanged.
    const leaveAlone = (chunk: unknown) => {
      if (state.passthrough || isGzipChunk(chunk)) {
        state.passthrough = true;
        return true;
      }
      return false;
    };

    res.write = function (this: typeof res, chunk?: unknown, enc?: unknown, cb?: unknown) {
      const n = normalizeWrite(chunk, enc, cb);
      if (!isHtml() || leaveAlone(n.chunk)) return innerWrite(n.chunk as never, n.enc as never, n.cb as never);
      if (res.getHeader('content-length')) res.removeHeader('content-length');
      const out = pushDeferredHtml(decodeChunk(decoder, n.chunk, n.enc, false), state, false);
      return innerWrite(out, 'utf8', n.cb as never);
    } as typeof res.write;

    res.end = function (this: typeof res, chunk?: unknown, enc?: unknown, cb?: unknown) {
      const n = normalizeWrite(chunk, enc, cb);
      if (!isHtml() || leaveAlone(n.chunk)) {
        return n.chunk === undefined ? innerEnd(n.cb as never) : innerEnd(n.chunk as never, n.enc as never, n.cb as never);
      }
      if (res.getHeader('content-length')) res.removeHeader('content-length');
      const out = pushDeferredHtml(decodeChunk(decoder, n.chunk, n.enc, true), state, true);
      return innerEnd(out, 'utf8', n.cb as never);
    } as typeof res.end;
    return result;
  } as typeof serverProto.emit;
}

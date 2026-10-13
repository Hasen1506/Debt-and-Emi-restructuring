/**
 * The visitor's address for per-IP limits in Next.js route handlers, read the
 * same way as the API (api/client_ip.py, UX50 E-01).
 *
 * On Render every request passes Render's own Cloudflare edge, which writes
 * CF-Connecting-IP (a client-sent value is replaced), so that header is the
 * visitor whenever RENDER is set, or whatever header CLIENT_IP_HEADER names
 * ("none" turns it off). Otherwise X-Forwarded-For is read only as far back
 * as TRUSTED_PROXY_HOPS; with 0 there is no trusted address and every caller
 * shares one key ("local"), which is fine for local runs.
 * IPv6 addresses are keyed by their /64.
 */
type Env = Record<string, string | undefined>;

export function trustedHeader(env: Env = process.env): string | null {
  const raw = env.CLIENT_IP_HEADER;
  if (raw === undefined) return env.RENDER ? 'cf-connecting-ip' : null;
  const v = raw.trim().toLowerCase();
  return ['', 'none', 'off', '0', 'false'].includes(v) ? null : v;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** A bucket key for an address, or null when it isn't one. */
export function normaliseIp(raw: string): string | null {
  const a = raw.trim().replace(/^\[|\]$/g, '');
  if (IPV4.test(a)) return a;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped && IPV4.test(mapped[1])) return mapped[1];
  if (!/^[0-9a-f:]+$/i.test(a) || !a.includes(':') || (a.match(/::/g) ?? []).length > 1) return null;
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = a.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = a.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

export function clientIp(headers: Headers, env: Env = process.env): string {
  const header = trustedHeader(env);
  if (header) {
    const v = headers.get(header);
    if (v && !v.includes(',')) {
      const key = normaliseIp(v);
      if (key) return key;
    }
  }
  const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? '0', 10) || 0;
  const xff = headers.get('x-forwarded-for');
  if (hops > 0 && xff) {
    const chain = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (chain.length) {
      const pick = chain.length >= hops ? chain[chain.length - hops] : chain[0];
      return normaliseIp(pick) ?? pick;
    }
  }
  return 'local';
}

/** A small in-memory token bucket (one Node process on the free instance). */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; last: number }>();
  constructor(private perMinute: number, private burst: number, private now: () => number = Date.now) {}

  /** null when allowed, else seconds to wait. */
  take(key: string): number | null {
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, last: now };
    const tokens = Math.min(this.burst, b.tokens + ((now - b.last) / 60000) * this.perMinute);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, last: now });
      return Math.max(1, Math.ceil(((1 - tokens) * 60) / this.perMinute));
    }
    this.buckets.set(key, { tokens: tokens - 1, last: now });
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) if (now - v.last > 600000) this.buckets.delete(k);
    }
    return null;
  }

  reset(): void { this.buckets.clear(); }
}

import 'server-only';
import { createHash } from 'node:crypto';

/** Bounded, process-local reuse of pure calculations. No account reads/writes.
 * Every input (including strategy and goals) participates in the hashed key.
 * Changed inputs miss immediately; unchanged inputs expire after one minute.
 */
export function createEngineCache(ttlMs = 60000, limit = 32, now = Date.now) {
  const entries = new Map<string, { until: number; value: Promise<unknown> }>();
  return function cached<T>(operation: string, input: unknown, run: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(JSON.stringify([operation, input])).digest('hex');
    const previous = entries.get(key);
    if (previous && previous.until > now()) {
      entries.delete(key);
      entries.set(key, previous);
      return previous.value as Promise<T>;
    }
    entries.delete(key);
    const entry = { until: now() + ttlMs, value: Promise.resolve().then(run) as Promise<unknown> };
    entries.set(key, entry);
    while (entries.size > limit) entries.delete(entries.keys().next().value!);
    entry.value.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry.value as Promise<T>;
  };
}

/**
 * Sliding-window budget of fresh engine runs per requester (BUG_REPORT M10).
 *
 * Server-side engine calls carry INTERNAL_API_TOKEN, so the API's own rate
 * limiter does not see them. A client that changes its profile cookie on
 * every request misses the cache each time and could drive unlimited
 * /simulate, /baseline and /compare runs. Only cache misses are counted.
 */
export function createMissBudget(limit = 120, windowMs = 60000, now = Date.now, maxKeys = 2000) {
  const hits = new Map<string, number[]>();
  return function allow(key: string): boolean {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.delete(key);
    hits.set(key, recent);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
    return true;
  };
}

export class EngineBudgetExceeded extends Error {
  constructor() {
    super('Too many plan recalculations in a short time. Wait a minute and reload.');
    this.name = 'EngineBudgetExceeded';
  }
}

/** Who is asking: the session cookie (hashed) and the client address, when known. */
async function requesterKeys(): Promise<string[]> {
  try {
    const { cookies, headers } = await import('next/headers');
    const [c, h] = await Promise.all([cookies(), headers()]);
    const keys: string[] = [];
    const session = c.get('finoptima_session')?.value;
    if (session) keys.push('s:' + createHash('sha256').update(session).digest('hex').slice(0, 32));
    // Render appends the caller to X-Forwarded-For, so the last entry is the
    // one a client cannot forge; Cloudflare's header wins when present.
    const xff = (h.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const ip = h.get('cf-connecting-ip') ?? xff[xff.length - 1];
    if (ip) keys.push('ip:' + ip);
    return keys;
  } catch {
    return []; // Outside a request (build time): nothing to key on.
  }
}

const engineCache = createEngineCache();
const missBudget = createMissBudget();

export async function cachedEngineCall<T>(operation: string, input: unknown, run: () => Promise<T>): Promise<T> {
  const who = await requesterKeys();
  return engineCache(operation, input, () => {
    for (const key of who) if (!missBudget(key)) throw new EngineBudgetExceeded();
    return run();
  });
}

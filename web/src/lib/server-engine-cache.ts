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

export const cachedEngineCall = createEngineCache();

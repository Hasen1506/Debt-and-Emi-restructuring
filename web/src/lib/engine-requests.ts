/**
 * NEW-19 (live re-test 4): the browser's plan calculations, shared.
 *
 * Setup step 3, the Plan what-ifs and the tenure what-if each start a
 * /api/simulate, /api/baseline or /api/sensitivity/compare run when a choice
 * changes. On a 0.15-CPU host a burst of clicks queued several full runs
 * whose answers were thrown away. This module makes those calls:
 *
 * - de-duplicated: an identical request already in flight is joined, not
 *   sent again;
 * - remembered: an identical request answered in the last minute is
 *   answered again from memory (bounded, newest kept), so the minimums-only
 *   baseline is not re-run when only the strategy changed;
 * - cancellable: each caller passes its own AbortSignal. The shared fetch is
 *   aborted only when every caller waiting on it has gone, and a caller that
 *   aborted always gets an AbortError, never a late answer.
 *
 * Debouncing is the caller's job (PREVIEW_DEBOUNCE_MS).
 */

/** How long a choice must stay put before Setup's preview runs (ms). */
export const PREVIEW_DEBOUNCE_MS = 350;

/** JSON with object keys sorted, so the same body always gives the same key. */
export function stableKey(operation: string, body: unknown): string {
  const seen = new WeakSet<object>();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) throw new TypeError('circular request body');
    seen.add(v as object);
    let out: unknown;
    if (Array.isArray(v)) out = v.map((x) => (x === undefined ? null : norm(x)));
    else {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) o[k] = norm(x);
      }
      out = o;
    }
    seen.delete(v as object);
    return out;
  };
  return JSON.stringify([operation, norm(body)]);
}

export function abortError(): Error {
  try {
    return new DOMException('The request was replaced by a newer one.', 'AbortError');
  } catch {
    const e = new Error('The request was replaced by a newer one.');
    e.name = 'AbortError';
    return e;
  }
}

export function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

type InFlight = { promise: Promise<unknown>; controller: AbortController; waiting: number };

export function createSharedRequests(opts: { limit?: number; ttlMs?: number; now?: () => number } = {}) {
  const limit = opts.limit ?? 24;
  const ttlMs = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const settled = new Map<string, { until: number; value: unknown }>();
  const inFlight = new Map<string, InFlight>();
  const stats = { sent: 0, joined: 0, remembered: 0, aborted: 0 };

  function remember(key: string, value: unknown) {
    settled.delete(key);
    settled.set(key, { until: now() + ttlMs, value });
    while (settled.size > limit) settled.delete(settled.keys().next().value!);
  }

  function run<T>(
    operation: string,
    body: unknown,
    fetcher: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    const key = stableKey(operation, body);
    const hit = settled.get(key);
    if (hit && hit.until > now()) {
      settled.delete(key);
      settled.set(key, hit);
      stats.remembered++;
      return Promise.resolve(hit.value as T);
    }
    if (hit) settled.delete(key);

    let entry = inFlight.get(key);
    if (entry) stats.joined++;
    else {
      const controller = new AbortController();
      stats.sent++;
      const created: InFlight = { controller, waiting: 0, promise: Promise.resolve() };
      created.promise = Promise.resolve()
        .then(() => fetcher(controller.signal))
        .then(
          (value) => {
            if (inFlight.get(key) === created) inFlight.delete(key);
            if (!controller.signal.aborted) remember(key, value);
            return value;
          },
          (err) => {
            if (inFlight.get(key) === created) inFlight.delete(key);
            throw err;
          },
        );
      inFlight.set(key, created);
      entry = created;
    }
    const shared = entry;
    shared.waiting++;

    return new Promise<T>((resolve, reject) => {
      let done = false;
      const leave = () => {
        if (done) return;
        done = true;
        shared.waiting--;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (done) return;
        leave();
        stats.aborted++;
        if (shared.waiting <= 0 && inFlight.get(key) === shared) {
          inFlight.delete(key);
          shared.controller.abort();
        }
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort);
      shared.promise.then(
        (v) => {
          if (done) return;
          leave();
          resolve(v as T);
        },
        (e) => {
          if (done) return;
          leave();
          reject(e);
        },
      );
    });
  }

  return {
    run,
    stats,
    clear() {
      settled.clear();
    },
    get inFlightCount() {
      return inFlight.size;
    },
  };
}

/** The one the app's components share. */
export const engineRequests = createSharedRequests();

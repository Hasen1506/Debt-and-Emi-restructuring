/**
 * Moving one windfall slider takes the difference from the cushion (the
 * emergency-fund or one-month slice) and gives a reduction back to it.
 * Anything the cushion cannot hold stays unallocated. Other rows stay put.
 */
export function rebalanceCushion(
  prev: Record<string, number>,
  key: string,
  raw: number,
  cap: number,
  total: number,
  cushionKey: string | null,
  cushionCap: number,
): Record<string, number> {
  const next: Record<string, number> = { ...prev };
  const old = next[key] ?? 0;
  const nv = Math.max(0, Math.min(cap, Math.round(raw)));
  const delta = nv - old;
  if (cushionKey && cushionKey !== key) {
    const cOld = next[cushionKey] ?? 0;
    if (delta > 0) next[cushionKey] = Math.max(0, cOld - delta);
    else if (delta < 0) next[cushionKey] = Math.min(cushionCap, cOld - delta);
  }
  next[key] = nv;
  let over = Object.values(next).reduce((s, n) => s + (Number(n) || 0), 0) - total;
  if (over > 0.5) {
    const cut = Math.min(next[key] ?? 0, over);
    next[key] = (next[key] ?? 0) - cut;
    over -= cut;
    if (over > 0.5 && cushionKey && cushionKey !== key) {
      next[cushionKey] = Math.max(0, (next[cushionKey] ?? 0) - over);
    }
  }
  return next;
}

/**
 * Dates that say how current a quoted rate is.
 *
 * Accepts an ISO date ("2026-09-26"), a month ("2026-05") or a rate-card
 * label that starts with one ("2026-05 industry norms — confirm SoC").
 * Written with the shared short date ("26 Sep 2026"), never "Sept".
 */
import { formatIso } from './today';

/** "26 Sep 2026", "May 2026", or the text as given when it has no date. */
export function formatAsOf(raw: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw.trim());
  if (!m) return raw;
  return formatIso(m[0]);
}

/**
 * Dates that say how current a quoted rate is.
 *
 * Accepts an ISO date ("2026-09-26"), a month ("2026-05") or a rate-card
 * label that starts with one ("2026-05 industry norms — confirm SoC").
 * Month names are spelled out here: en-GB prints September as "Sept".
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Sep 2026", "May 2026", or the text as given when it has no date. */
export function formatAsOf(raw: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw.trim());
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return raw;
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

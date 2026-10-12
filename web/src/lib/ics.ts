/**
 * Calendar file (.ics, RFC 5545) for deadline dates: complaint replies,
 * the Ombudsman's last day, documents due back after a loan closes.
 * Works with no server and no account: the user adds the dates to their
 * own calendar, which then does the reminding. Each date is an all-day
 * event with an alert at 9 am the day before.
 */

export interface IcsEvent {
  /** Stable id so re-importing updates instead of duplicating. */
  uid: string;
  /** "YYYY-MM-DD". */
  day: string;
  title: string;
  description?: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function ymd(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`bad date: ${iso}`);
  return iso.replace(/-/g, '');
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildIcs(events: IcsEvent[], stamp: Date = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RightDue//Deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(e.uid)}@rightdue.app`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.day)}`,
      `DTEND;VALUE=DATE:${nextDay(e.day)}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(e.title)}`,
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Only dates still to come are worth a calendar entry. */
export function upcomingOnly<T extends { day: string; state?: string }>(items: T[], todayIso: string): T[] {
  return items.filter((i) => i.day >= todayIso && i.state !== 'done' && i.state !== 'missed');
}

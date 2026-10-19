'use client';

/** Add payment dates to Google Calendar or download an .ics for Apple. */
import type { LoanPayload } from '@/lib/api';
import { eventsForLoans, googleCalendarUrl, icsFor, type CalendarEvent } from '@/lib/calendar-ics';
import { L_T } from '@/components/ledger/primitives';

function download(events: CalendarEvent[], name: string) {
  const blob = new Blob([icsFor(events)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CalendarLinks({ loans, month }: { loans: LoanPayload[]; month: string }) {
  const events = eventsForLoans(loans, month);
  if (events.length === 0) return null;
  return (
    <div data-testid="calendar-links" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 12 }}>
      <button type="button" onClick={() => download(events, 'rightdue-payments.ics')} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', background: 'none', border: `1px solid ${L_T.ink}`, padding: '4px 8px', cursor: 'pointer' }}>
        ADD ALL TO CALENDAR (.ICS)
      </button>
      {events.length === 1 && (
        <a href={googleCalendarUrl(events[0])} target="_blank" rel="noreferrer">Google Calendar</a>
      )}
    </div>
  );
}

export function CalendarOne({ loan, month }: { loan: LoanPayload; month: string }) {
  const events = eventsForLoans([loan], month);
  if (events.length === 0) return null;
  const e = events[0];
  return (
    <span data-testid="calendar-one" style={{ display: 'inline-flex', gap: 8 }}>
      <a href={googleCalendarUrl(e)} target="_blank" rel="noreferrer">Google</a>
      <button type="button" onClick={() => download([e], 'rightdue-payment.ics')} style={{ fontFamily: 'inherit', fontSize: 12, background: 'none', border: 'none', padding: 0, color: L_T.accent, cursor: 'pointer' }}>
        Apple (.ics)
      </button>
    </span>
  );
}

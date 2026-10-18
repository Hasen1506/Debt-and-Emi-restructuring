'use client';

/**
 * Follow-ups on a complaint (grill #70a: "who does the follow-ups?"): the
 * dates go into the user's own calendar as an .ics file (always available,
 * no account needed), and, when the server has reminders on and the user
 * is signed in, by email: a week before, the day before and on the day of
 * each date they must act by, and the day after each date the lender had
 * to reply by (engine/reminders.py).
 */
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth';
import { buildIcs, upcomingOnly } from '@/lib/ics';
import { notifyApi, notifyFlags } from '@/lib/notify-client';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

export interface DatedItem { key: string; label: string; day: string; state?: string; note?: string }

export function DeadlineReminders({
  items,
  source,
  todayIso,
  title,
}: {
  items: DatedItem[];
  source: 'complaint' | 'closure';
  todayIso: string;
  /** "Loan Check complaint", for the calendar entries. */
  title: string;
}) {
  const session = useSession();
  const [email, setEmail] = useState(false);
  const [said, setSaid] = useState('');
  const upcoming = upcomingOnly(items, todayIso);

  useEffect(() => {
    if (session.status !== 'authed') return;
    void notifyFlags().then((f) => setEmail(f.deadline_reminders));
  }, [session.status]);

  if (upcoming.length === 0) return null;

  function download() {
    const ics = buildIcs(upcoming.map((i) => ({ uid: `${source}-${i.key}-${i.day}`, day: i.day, title: `${title}: ${i.label}`, description: i.note })));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `rightdue-${source}-dates.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
    setSaid('Open the file to add the dates to your calendar. Each one has an alert the evening before.');
  }

  async function remind() {
    try {
      const r = await notifyApi.reminders({ on: true, source, items: upcoming.map(({ key, label, day, state }) => ({ key, label, day, state })) });
      setSaid(r.next ? `Reminders on. The first one comes on ${r.next.send_on}.` : 'Reminders on.');
    } catch (e) {
      setSaid((e as Error).message);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-dense)', margin: '8px 0' }}>
      <button type="button" style={lPayBtn(false)} onClick={download}>ADD THESE DATES TO MY CALENDAR</button>
      {email && <button type="button" style={lPayBtn(false)} onClick={() => void remind()}>EMAIL ME BEFORE EACH DATE</button>}
      {said && <span role="status" style={{ flexBasis: '100%', color: L_T.inkSoft }}>{said}</span>}
    </div>
  );
}

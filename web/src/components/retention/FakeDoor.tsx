'use client';

/**
 * A18: a zero-revenue "fake door". It shows a paid idea marked "coming soon"
 * and counts two things on the server: that it was seen (once per device)
 * and that "Notify me" was tapped (once per device). No email, no payment,
 * nothing about the person; the founder kills the idea if fewer than 2% of
 * people who see it tap (api/funnel.py DOOR_KILL_BELOW).
 */
import { useEffect, useState } from 'react';
import { trackOnce } from '@/lib/funnel';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

export const DOORS = {
  letter: {
    title: 'Letter pack + bank-reply tracker, ₹299',
    body: 'Ready-to-send letters for this finding, the escalation to the RBI Ombudsman, and a tracker that counts the bank’s reply deadlines for you.',
  },
  plus: {
    title: 'RightDue Plus, ₹99/mo',
    body: 'Payday email, rate-move alerts after each RBI decision, and a consolidation check across your cards and loans.',
  },
} as const;

export function FakeDoor({ door }: { door: keyof typeof DOORS }) {
  const [tapped, setTapped] = useState(false);
  useEffect(() => { trackOnce(`door_${door}_shown`, `door_${door}_shown`); }, [door]);
  const d = DOORS[door];
  return (
    <aside aria-label={`${d.title} (coming soon)`} data-fake-door={door}
      style={{ marginTop: 12, padding: '10px 12px', border: `1px dashed ${L_T.ruleSoft}`, fontSize: 11, lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700 }}>{d.title} <span style={{ fontWeight: 400, color: L_T.muted }}>(coming soon)</span></div>
      <div style={{ color: L_T.inkSoft }}>{d.body}</div>
      {tapped ? (
        <p role="status" style={{ margin: '6px 0 0', color: L_T.positive }}>
          Noted. We only count the interest: no email taken, nothing charged. It will show up here if we build it.
        </p>
      ) : (
        <button type="button" style={{ ...lPayBtn(false), marginTop: 6 }}
          onClick={() => { trackOnce(`door_${door}_notify`, `door_${door}_notify`); setTapped(true); }}>
          NOTIFY ME
        </button>
      )}
    </aside>
  );
}

'use client';

/**
 * Answers the user gave from the payday email ("All paid", a "done"
 * reply, "Paid some", "Can't pay"), waiting on the server
 * (api/notify). Shown above Pay this month; nothing is recorded in
 * Activity until the user says so here.
 */
import { useEffect, useState } from 'react';
import { notifyApi, notifyFlags, type NotifyAnswer } from '@/lib/notify-client';
import { L_T, lPayBtn, lStrip } from '@/components/ledger/primitives';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export function EmailAnswers({ month, onMarkAllPaid }: { month: string; onMarkAllPaid: () => boolean }) {
  const [answers, setAnswers] = useState<NotifyAnswer[]>([]);
  const [said, setSaid] = useState('');

  useEffect(() => {
    let live = true;
    void notifyFlags().then((f) => {
      if (!f.payday_email) return;
      notifyApi.answers().then((r) => live && setAnswers(r.answers)).catch(() => {});
    });
    return () => { live = false; };
  }, []);

  const a = answers.find((x) => x.month === month) ?? answers[answers.length - 1];
  if (!a) return said ? <p role="status" style={{ fontSize: 'var(--fs-dense)', color: L_T.positive }}>{said}</p> : null;

  async function settle(text: string) {
    await notifyApi.applied(a!.id).catch(() => {});
    setAnswers((xs) => xs.filter((x) => x.id !== a!.id));
    setSaid(text);
  }

  const allPaid = a.kind === 'ack_all' || a.kind === 'reply_done';
  const cant = a.kind === 'ack_cant' || a.kind === 'reply_not';
  return (
    <div role="region" aria-label="Your answer from the payday email" style={{ margin: '0 0 12px', padding: '10px 12px', fontSize: 'var(--fs-dense)', lineHeight: 1.6, ...lStrip(cant ? 'negative' : 'accent') }}>
      {allPaid && (
        <>
          You told us by email on {dayLabel(a.day)} that you paid everything on the list.{' '}
          {a.month === month ? (
            <button type="button" style={lPayBtn(true)} onClick={() => { if (onMarkAllPaid()) void settle('Marked paid and recorded in Activity.'); }}>
              MARK THEM PAID
            </button>
          ) : (
            <span>That was for an earlier month; log it in Activity if it isn&apos;t there.</span>
          )}{' '}
          <button type="button" style={lPayBtn(false)} onClick={() => void settle('')}>NOT NOW</button>
        </>
      )}
      {a.kind === 'ack_some' && (
        <>
          You told us by email on {dayLabel(a.day)} that you paid some of it. Mark the ones that went out below.{' '}
          <button type="button" style={lPayBtn(false)} onClick={() => void settle('')}>OK</button>
        </>
      )}
      {cant && (
        <>
          You told us by email on {dayLabel(a.day)} that you can&apos;t pay everything this month. Pay the EMIs on secured
          loans and the card minimums first, and call the lender before the due date.{' '}
          <button type="button" style={lPayBtn(false)} onClick={() => void settle('')}>OK</button>
        </>
      )}
    </div>
  );
}

'use client';

/**
 * "Email me this list on payday" (grill #2): signed-in users only, and only
 * when the server has the payday email on (PAYDAY_EMAIL_ENABLED). While
 * it's on, opening Home refreshes the server's copy of the list once a day.
 */
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth';
import { notifyApi, notifyFlags } from '@/lib/notify-client';
import { SNAPSHOT_SENT_KEY, paydaySnapshot, rowsFingerprint, snapshotNeedsSend } from '@/lib/payday-snapshot';
import type { PayThisMonth } from '@/lib/pay-this-month';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

export function PaydayEmail({ data, country, todayIso }: { data: PayThisMonth; country: 'IN' | 'US'; todayIso: string }) {
  const session = useSession();
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState<boolean | null>(null);
  const [day, setDay] = useState('1');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status !== 'authed') return;
    let live = true;
    void notifyFlags().then(async (f) => {
      if (!f.payday_email || !live) return;
      setAvailable(true);
      try {
        const s = await notifyApi.settings();
        if (!live) return;
        setOn(s.payday.on);
        if (s.payday.day) setDay(String(s.payday.day));
        if (s.payday.on) {
          const snap = paydaySnapshot(data, country, todayIso);
          const fp = rowsFingerprint(snap);
          const last = window.localStorage.getItem(SNAPSHOT_SENT_KEY);
          if (snapshotNeedsSend(last, todayIso, fp)) {
            await notifyApi.payday({ on: true, day: s.payday.day, snapshot: snap });
            window.localStorage.setItem(SNAPSHOT_SENT_KEY, `${todayIso}|${fp}`);
          }
        }
      } catch { /* settings unavailable: stay hidden */ setAvailable(false); }
    });
    return () => { live = false; };
  }, [session.status, data, country, todayIso]);

  if (!available || on === null) return null;

  async function save(next: boolean) {
    setBusy(true);
    setErr('');
    try {
      const d = Number(day);
      await notifyApi.payday({ on: next, day: next ? d : null, snapshot: next ? paydaySnapshot(data, country, todayIso) : undefined });
      setOn(next);
      setMsg(next ? `On. You'll get this list by email on day ${d} of each month, in this order.` : 'Payday emails are off. The saved list was deleted.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="payday-email">
      {on ? (
        <>
          <span>Payday email: on, day {day} of each month. Tap &ldquo;All paid&rdquo; in it and we&apos;ll ask here before recording anything.</span>
          <button type="button" style={lPayBtn(false)} disabled={busy} onClick={() => void save(false)}>TURN OFF</button>
        </>
      ) : (
        <>
          <label>
            Email me this list on payday, day{' '}
            <select aria-label="Day your salary is paid" value={day} onChange={(e) => setDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
            </select>{' '}
            of the month
          </label>
          <button type="button" style={lPayBtn(true)} disabled={busy} onClick={() => void save(true)}>TURN ON</button>
          <span style={{ flexBasis: '100%', color: L_T.muted }}>
            The email has the names and amounts on this list, nothing else. RightDue can&apos;t see your bank, so the email asks you what went out.
          </span>
        </>
      )}
      {msg && <span role="status" style={{ flexBasis: '100%', color: L_T.positive }}>{msg}</span>}
      {err && <span role="alert" style={{ flexBasis: '100%', color: L_T.negative }}>{err}</span>}
    </div>
  );
}

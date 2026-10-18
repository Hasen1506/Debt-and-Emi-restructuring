'use client';

/**
 * A13: "Email me after each RBI decision" for repo-linked loans. Signed-in
 * users only, and only while the server has RATE_MOVE_EMAIL_ENABLED on.
 * The email (api/notify/routes.py, engine/rate_move.py) gives the two
 * numbers to check on the next statement (new EMI with the same end date,
 * or the same EMI with a longer/shorter tenure) and which is worth more.
 * Only the loans ticked here are sent: name, balance, rate, EMI, months left.
 */
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth';
import { notifyApi, notifyFlags } from '@/lib/notify-client';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

export interface RateWatchLoan { name: string; outstanding: number; rate: number; emi: number | null; monthsLeft: number | null; likelyRepo: boolean }

export function RateMoveEmail({ loans }: { loans: RateWatchLoan[] }) {
  const session = useSession();
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<boolean[]>(() => loans.map((l) => l.likelyRepo));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (session.status !== 'authed' || loans.length === 0) return;
    let live = true;
    void notifyFlags().then(async (f) => {
      if (!f.rate_move || !live) return;
      try {
        const s = await notifyApi.settings();
        if (!live) return;
        setOn(Boolean(s.rate_move?.on));
        setAvailable(true);
      } catch { setAvailable(false); }
    });
    return () => { live = false; };
  }, [session.status, loans.length]);

  if (!available || loans.length === 0) return null;

  async function save(next: boolean) {
    setErr('');
    const chosen = loans.filter((_, i) => picked[i]);
    if (next && chosen.length === 0) { setErr('Tick at least one loan linked to the RBI repo rate.'); return; }
    try {
      await notifyApi.rateMove({
        on: next,
        loans: next ? chosen.map((l) => ({ name: l.name, outstanding: l.outstanding, rate: l.rate, emi: l.emi, months_left: l.monthsLeft })) : [],
      });
      setOn(next);
      setMsg(next ? 'On. After each RBI decision we’ll email the EMI and tenure numbers to check on your statement.' : 'Rate-move emails are off. The loans we kept for them were deleted.');
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.6, color: L_T.inkSoft }} data-testid="rate-move-email">
      {on ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Rate-move email: on. You’ll hear from us after each RBI policy decision.</span>
          <button type="button" style={lPayBtn(false)} onClick={() => void save(false)}>TURN OFF</button>
        </div>
      ) : (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600 }}>Email me after each RBI rate decision: the new EMI or tenure to check, and the better choice</legend>
          {loans.map((l, i) => (
            <label key={i} style={{ display: 'block' }}>
              <input type="checkbox" checked={picked[i]} onChange={(e) => setPicked((p) => p.map((v, k) => (k === i ? e.target.checked : v)))} />{' '}
              {l.name} ({(l.rate * 100).toFixed(2)}%){l.likelyRepo ? '' : ' — tick only if your sanction letter says repo-linked (RLLR / EBLR)'}
            </label>
          ))}
          <button type="button" style={{ ...lPayBtn(true), marginTop: 6 }} onClick={() => void save(true)}>TURN ON</button>
          <span style={{ display: 'block', color: L_T.muted }}>We keep only these loans’ name, balance, rate, EMI and months left, for this email.</span>
        </fieldset>
      )}
      {msg && <span role="status" style={{ display: 'block', color: L_T.positive }}>{msg}</span>}
      {err && <span role="alert" style={{ display: 'block', color: L_T.negative }}>{err}</span>}
    </div>
  );
}

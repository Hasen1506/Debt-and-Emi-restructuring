'use client';

/**
 * "Welcome back: continue, or start fresh?" for a signed-out visitor whose
 * browser holds an earlier guest plan (live test #1, lib/guest-return).
 * Start fresh runs the same clean-up as signing out (server-sync's
 * clearAccountCache: profile cookies, activity, goals, every local slice),
 * then opens setup.
 */
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth';
import { loadProfileClient } from '@/lib/user-store';
import { ANSWERED_KEY, GUEST_COPY, LAST_SEEN_KEY, shouldAskGuest, sinceLabel } from '@/lib/guest-return';
import { L_MONO, L_T } from '@/components/ledger/primitives';

const AUTH_DISABLED = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true';

function readNumber(key: string, store: Storage): number | null {
  try {
    const v = store.getItem(key);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

export function GuestWelcomeBack() {
  const session = useSession();
  const [ask, setAsk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'loading') return;
    const now = Date.now();
    const lastSeen = readNumber(LAST_SEEN_KEY, localStorage);
    let answered = false;
    try { answered = sessionStorage.getItem(ANSWERED_KEY) != null; } catch { /* private mode */ }
    const show = shouldAskGuest({
      signedIn: session.status === 'authed',
      hasSavedProfile: loadProfileClient().isLive,
      lastSeenMs: lastSeen,
      nowMs: now,
      answeredThisTab: answered,
    });
    setSince(sinceLabel(lastSeen, now));
    setAsk(show);
    // A guest's visit counts as seen (signed in, nothing is stored: sign-out
    // must leave this browser empty).
    if (!show && session.status === 'anon') {
      try { localStorage.setItem(LAST_SEEN_KEY, String(now)); } catch { /* storage full */ }
    }
  }, [session.status]);

  if (!ask) return null;

  function answer(choice: 'continue' | 'fresh') {
    try {
      sessionStorage.setItem(ANSWERED_KEY, choice);
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch { /* private mode: the choice still applies to this page */ }
  }

  function onContinue() {
    answer('continue');
    setAsk(false);
  }

  async function onFresh() {
    const { clearAccountCache, clearPendingSync } = await import('@/lib/server-sync');
    clearAccountCache();
    clearPendingSync();
    answer('fresh');
    window.location.assign('/onboarding');
  }

  const btn = (primary: boolean) => ({
    fontFamily: L_MONO,
    fontSize: 'var(--fs-label)',
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '10px 16px',
    border: `1px solid ${L_T.ink}`,
    background: primary ? L_T.ink : 'transparent',
    color: primary ? L_T.bg : L_T.ink,
    cursor: 'pointer',
  });

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="guest-back-title"
      data-testid="guest-welcome-back"
      style={{ border: `2px solid ${L_T.ink}`, padding: '16px 18px', margin: '12px 0', background: L_T.paper }}
    >
      <h2 id="guest-back-title" style={{ margin: '0 0 6px', fontSize: 15, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {GUEST_COPY.title}
      </h2>
      <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
        {GUEST_COPY.body}
        {since && <> Last opened {since}.</>}
      </p>
      {!confirming ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" style={btn(true)} onClick={onContinue}>[ {GUEST_COPY.cont} ]</button>
          <button type="button" style={btn(false)} onClick={() => setConfirming(true)}>[ {GUEST_COPY.fresh} ]</button>
        </div>
      ) : (
        <div role="alertdialog" aria-label={GUEST_COPY.fresh} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: L_T.negative }}>{GUEST_COPY.confirm}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btn(true)} onClick={() => void onFresh()}>[ {GUEST_COPY.confirmYes} ]</button>
            <button type="button" style={btn(false)} onClick={() => setConfirming(false)}>[ {GUEST_COPY.confirmNo} ]</button>
          </div>
        </div>
      )}
      {!AUTH_DISABLED && <p style={{ margin: '10px 0 0', fontSize: 'var(--fs-small)', color: L_T.muted }}>{GUEST_COPY.note}</p>}
    </section>
  );
}

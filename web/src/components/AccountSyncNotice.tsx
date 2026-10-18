'use client';
/**
 * Whether the latest changes reached the account (live-test #2, #3, #27, #33).
 *
 * Every change is saved in this browser first; this line is only about the
 * copy in the account. It names the cause (signed out, offline, too large,
 * changed on another device…), when it last tried, and what happens next:
 * offline and server errors retry by themselves on a back-off, a signed-out
 * browser is sent to sign in, and a conflict lets the person choose which
 * copy to keep. "Retry now" shows that it is working and when it last ran.
 */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onSignInPage } from '@/lib/session-events';
import {
  flushPendingState,
  getSyncState,
  keepOtherDevice,
  keepThisDevice,
  pendingCount,
  REMOTE_APPLIED_EVENT,
  SYNC_CHANGED_EVENT,
  type SyncProblem,
  type SyncState,
} from '@/lib/server-sync';

/** Plain names for the parts of the account copy. */
const SLICE_NAMES: Record<string, string> = {
  profile: 'your profile (income, loans and tax)',
  activity: 'the payments you logged',
  goals: 'your goals',
  goal_contributions: 'goal savings',
  lifecycle: 'planned changes',
  strategy: 'the payoff order',
  payoff_rules: 'your payoff rules',
  cash_events: 'spare-cash entries',
  monthly_spend: 'monthly spending',
  decisions: 'decisions',
  decision_log: 'the decision log',
};

export function sliceList(slices: string[]): string {
  const names = slices.map((s) => SLICE_NAMES[s] ?? s.replace(/_/g, ' '));
  return names.length <= 1 ? (names[0] ?? 'some changes') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function clock(ms: number | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The words for each state. Exported for tests. */
export function syncMessage(state: SyncState, pending: number): string {
  if (state.status === 'pending') return 'Saved on this device. Sending it to your account…';
  const tried = state.lastAttemptAt ? ` Last tried ${clock(state.lastAttemptAt)}.` : '';
  const next = state.nextRetryAt ? ` Trying again at ${clock(state.nextRetryAt)}.` : '';
  const what = pending > 1 ? `${pending} changes are` : 'Your change is';
  const messages: Record<SyncProblem, string> = {
    signed_out: `${what} saved on this device, but you're signed out, so the copy in your account is older. Sign in again and they are sent.`,
    offline: `${what} saved on this device. The server couldn't be reached (no connection, or the free server is waking up, which takes up to a minute).${next}${tried}`,
    server: `${what} saved on this device. The server had an error and didn't store it.${next}${tried}`,
    too_large: `${what} saved on this device, but too large for your account (over 2 MB). Remove old entries, such as logged payments you no longer need.${tried}`,
    refused: `${what} saved on this device. The server refused it, so your account has the earlier copy. Reload the page, then save again.${tried}`,
    account_changed: `This tab was signed in to a different account than the one now signed in. Reload before saving; ${pending > 1 ? 'these changes stay' : 'the change stays'} on this device.`,
    conflict: `${capitalise(sliceList(state.conflictSlices ?? []))} changed on another device after this one loaded it. This device now shows that newer copy.`,
  };
  return messages[state.problem ?? 'offline'];
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AccountSyncNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<SyncState>(getSyncState);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setState(getSyncState());
    const remote = () => { if (!onSignInPage()) router.refresh(); };
    const online = () => { if (getSyncState().status === 'failed') void flushPendingState(); };
    window.addEventListener(SYNC_CHANGED_EVENT, update);
    window.addEventListener(REMOTE_APPLIED_EVENT, remote);
    window.addEventListener('online', online);
    update();
    return () => {
      window.removeEventListener(SYNC_CHANGED_EVENT, update);
      window.removeEventListener(REMOTE_APPLIED_EVENT, remote);
      window.removeEventListener('online', online);
    };
  }, [router]);
  if (state.status === 'saved') return null;
  const pending = pendingCount();
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const problem = state.status === 'failed' ? state.problem : undefined;
  const loginHref = `/login?next=${encodeURIComponent(pathname || '/')}`;
  return (
    <div
      className="app-shell"
      role={problem && problem !== 'offline' ? 'alert' : 'status'}
      aria-live="polite"
      data-sync-state={problem ?? state.status}
      style={{ marginTop: 12, fontSize: 13 }}
    >
      {busy ? 'Trying to reach your account…' : syncMessage(state, pending)}
      {problem === 'signed_out' && (
        <a className="l-hit" href={loginHref} style={{ marginLeft: 12 }}>Sign in again</a>
      )}
      {(problem === 'offline' || problem === 'server' || problem === 'refused' || problem === 'too_large') && (
        <button type="button" className="l-hit" disabled={busy} aria-busy={busy} onClick={() => run(flushPendingState)} style={{ marginLeft: 12 }}>
          {busy ? 'Retrying…' : 'Retry now'}
        </button>
      )}
      {problem === 'account_changed' && (
        <button type="button" className="l-hit" onClick={() => window.location.reload()} style={{ marginLeft: 12 }}>Reload</button>
      )}
      {problem === 'conflict' && (
        <>
          <button type="button" className="l-hit" disabled={busy} onClick={() => run(keepThisDevice)} style={{ marginLeft: 12 }}>
            Use this device&apos;s version instead
          </button>
          <button type="button" className="l-hit" disabled={busy} onClick={() => keepOtherDevice()} style={{ marginLeft: 12 }}>
            Keep the newer copy
          </button>
        </>
      )}
    </div>
  );
}

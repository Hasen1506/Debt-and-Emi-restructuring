'use client';

/**
 * Your data (grill #51): download what the server holds, delete the
 * account, or clear what this browser keeps. DPDP Act 2023 s.11 (access)
 * and s.12 (erasure); withdrawing consent should be as easy as giving it
 * (DPDP Rules 2025 r.3(c)(i)), so each action is one form on one page.
 */
import { useState } from 'react';
import { LBracket, LShell, L_T } from '@/components/ledger/primitives';
import { useSession } from '@/lib/auth';
import { clearLocalData, deleteMyAccount, downloadMyData } from '@/lib/account';
import { notifySessionChanged } from '@/lib/session-events';
import { PRIVACY_PATH } from '@/lib/privacy-facts';

const H2: React.CSSProperties = { margin: '22px 0 6px', fontSize: 14, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' };
const P: React.CSSProperties = { margin: '6px 0', fontSize: 'var(--fs-body)', lineHeight: 1.6 };
const INPUT: React.CSSProperties = {
  padding: '8px 10px', fontSize: 'var(--fs-body)', border: `1px solid ${L_T.ink}`, background: L_T.paper, color: L_T.ink, maxWidth: 360,
};
const BUTTON: React.CSSProperties = {
  padding: '8px 12px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-label)', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer', justifySelf: 'start',
};
const DANGER: React.CSSProperties = { ...BUTTON, background: 'var(--negative, #b42318)' };

async function forgetThisBrowser(): Promise<number> {
  // Drop queued saves first, so nothing is re-sent after the wipe.
  try {
    const { clearAccountCache, clearPendingSync } = await import('@/lib/server-sync');
    clearAccountCache();
    clearPendingSync();
  } catch { /* nothing queued */ }
  return clearLocalData();
}

export default function AccountDataPage() {
  const session = useSession();
  const [busy, setBusy] = useState<'export' | 'delete' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [understood, setUnderstood] = useState(false);

  async function onExport() {
    setBusy('export'); setError(null); setDone(null);
    try { await downloadMyData(); setDone('Your data file has been downloaded.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Your data could not be downloaded.'); }
    finally { setBusy(null); }
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    setBusy('delete'); setError(null); setDone(null);
    try {
      await deleteMyAccount(confirmEmail);
      await forgetThisBrowser();
      notifySessionChanged();
      setDone('Your account and everything saved with it have been deleted, and this browser has been cleared. You are signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your account could not be deleted. Nothing was removed.');
    } finally { setBusy(null); }
  }

  async function onClear() {
    if (!window.confirm('Clear every RightDue figure saved in this browser? Your account (if you have one) is not affected.')) return;
    setBusy('clear'); setError(null); setDone(null);
    try {
      const n = await forgetThisBrowser();
      setDone(n > 0 ? 'This browser no longer holds any RightDue data.' : 'This browser held no RightDue data.');
    } finally { setBusy(null); }
  }

  const signedIn = session.status === 'authed';
  const email = signedIn ? session.user.email : '';
  const canDelete = signedIn && understood && confirmEmail.trim().toLowerCase() === email.toLowerCase() && busy === null;

  return (
    <LShell>
      <section style={{ maxWidth: 680, display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: '0.08em' }}>YOUR DATA</h1>
        <p style={{ ...P, color: L_T.muted }}>
          See, download or delete what RightDue holds about you. What each item is and how long it is kept is in the{' '}
          <a href={PRIVACY_PATH}>privacy notice</a>.
        </p>

        {session.status === 'loading' && <p style={P}>Checking your sign-in…</p>}

        {session.status === 'anon' && !done && (
          <p style={P}>
            You are not signed in, so the server holds nothing of yours. <a href="/login?next=/account">Sign in</a> to
            download or delete an account&apos;s data.
          </p>
        )}

        {signedIn && !done?.startsWith('Your account') && (
          <>
            <h2 style={H2}>DOWNLOAD MY DATA</h2>
            <p style={P}>
              A file (JSON, a plain-text format any computer can open) with your account, your saved plan exactly as
              stored, and the record of your sign-ins. No codes or session keys are in it.
            </p>
            <button type="button" style={BUTTON} onClick={onExport} disabled={busy !== null}>
              {busy === 'export' ? 'Preparing…' : 'Download my data'}
            </button>

            <h2 style={H2}>DELETE MY ACCOUNT</h2>
            <p style={P}>
              Deletes, at once and for good: your account ({email}), your saved plan, every sign-in session on every device,
              and the record of sign-in codes sent to you. It can&apos;t be undone. Download your data first if you want a copy.
            </p>
            <form onSubmit={onDelete} style={{ display: 'grid', gap: 8 }}>
              <label style={{ ...P, display: 'grid', gap: 4 }}>
                Type your email to confirm
                <input
                  type="email"
                  autoComplete="off"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  style={INPUT}
                  aria-describedby="delete-note"
                />
              </label>
              <label style={{ ...P, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                I understand my account and saved plan will be deleted for good.
              </label>
              <button type="submit" style={{ ...DANGER, opacity: canDelete ? 1 : 0.45 }} disabled={!canDelete}>
                {busy === 'delete' ? 'Deleting…' : 'Delete my account and data'}
              </button>
              <p id="delete-note" style={{ ...P, color: L_T.muted }}>
                Anonymous lender reports you shared are not linked to your account, so they stay in the public tally.
              </p>
            </form>
          </>
        )}

        <h2 style={H2}>THIS BROWSER</h2>
        <p style={P}>
          RightDue keeps your plan in this browser too (cookies and local storage), so it works before you sign in. On a
          shared or family device, clear it when you are done.
        </p>
        <button type="button" style={BUTTON} onClick={onClear} disabled={busy !== null}>
          {busy === 'clear' ? 'Clearing…' : 'Clear data in this browser'}
        </button>

        {done && <p role="status" style={{ ...P, marginTop: 14 }}>{done}</p>}
        {error && <p role="alert" style={{ ...P, marginTop: 14, color: 'var(--negative, #b42318)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 18 }}>
          <LBracket href={PRIVACY_PATH}>PRIVACY NOTICE</LBracket>
          <LBracket href="/terms">TERMS</LBracket>
          <LBracket href="/">HOME</LBracket>
        </div>
      </section>
    </LShell>
  );
}

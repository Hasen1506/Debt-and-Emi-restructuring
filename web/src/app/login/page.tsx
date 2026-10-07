'use client';

/**
 * Sign-in via email + 6-digit code. Two phases in one page:
 *   1. Enter email      → POST /api/auth/request-otp
 *   2. Enter code       → POST /api/auth/verify-otp → cookie set → redirect
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
import { hydrateFromServer, prepareAccountCache, serializeClientState, syncSliceToServer } from '@/lib/server-sync';
import { notifySessionChanged } from '@/lib/session-events';
import { SIGN_IN_STARTING_MESSAGE } from '@/lib/auth-error';

// The free-plan API sleeps when idle and can take over a minute to start.
const STARTING_RETRIES = 3;
const STARTING_RETRY_DELAY_MS = 5000;

type Phase = 'email' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const redirectTo = next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';

  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Wake the API as soon as the page opens, so it is usually ready by the
  // time the email is typed. Best-effort: a failure here changes nothing.
  useEffect(() => {
    api.health().catch(() => {});
  }, []);

  /** Request a code, retrying only while the API is still starting. The proxy
   *  reports "starting" before it creates a code, so these retries never send
   *  a second email. */
  async function requestOtpWhenReady(address: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.requestOtp(address);
        return;
      } catch (err) {
        const starting = err instanceof Error && err.message === SIGN_IN_STARTING_MESSAGE;
        if (!starting || attempt >= STARTING_RETRIES) throw err;
        setInfo('Starting the sign-in service. This can take up to a minute the first time...');
        await new Promise(resolve => setTimeout(resolve, STARTING_RETRY_DELAY_MS));
      }
    }
  }

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await requestOtpWhenReady(email.trim().toLowerCase());
      setPhase('code');
      setInfo(`We sent a 6-digit code to ${email}. It expires in 10 minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await api.verifyOtp(email.trim().toLowerCase(), code.trim());
      prepareAccountCache(user.id);
      // Pull server state into cookies BEFORE navigating so middleware
      // doesn't redirect returning users to /onboarding.
      const hydrated = await hydrateFromServer();
      // New users (or first-time signups) have nothing on the server —
      // push their existing cookie state up if any.
      if (!hydrated) await migrateCookieStateIfNeeded();
      notifySessionChanged();
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed.';
      // Strip the "/api/auth/verify-otp → 400: " prefix from FastAPI's error.
      setError(msg.replace(/^\S+ → \d+: ?/, '') || 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * First-sign-in migration: if the server has no state for this user
   * but we have non-demo profile data in cookies (e.g. user filled
   * onboarding before signing up), push it up so it survives across
   * devices. Best-effort — failures don't block sign-in.
   */
  async function migrateCookieStateIfNeeded() {
    try {
      const current = await api.getUserState();
      if (current.data && Object.keys(current.data).length > 0) return;
      const cookieProfile = loadProfileClient();
      if (!cookieProfile.isLive) return;
      await Promise.all(Object.entries(serializeClientState(cookieProfile)).map(([slice, value]) => syncSliceToServer(slice, value)));
    } catch {
      // Server might be unreachable or session timing-of-cookie issues.
      // Acceptable: cookie still holds the data, next saveProfileClient
      // dual-write will sync.
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await api.requestOtp(email.trim().toLowerCase());
      setInfo(`New code sent to ${email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={card}>
      <h1 style={title}>Sign in</h1>
      <p style={subtitle}>
        We&rsquo;ll email you a 6-digit code. No passwords.
      </p>

      {phase === 'email' && (
        <form onSubmit={onRequest} style={form}>
          <label style={label}>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={input}
              placeholder="you@example.com"
            />
          </label>
          <button type="submit" disabled={submitting || !email} style={primary}>
            [ {submitting ? 'Sending…' : 'Send code'} ]
          </button>
        </form>
      )}

      {phase === 'code' && (
        <form onSubmit={onVerify} style={form}>
          <label style={label}>
            6-digit code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ ...input, letterSpacing: '0.4em', fontFamily: 'var(--font-mono)', fontSize: 20, textAlign: 'center' }}
              placeholder="••••••"
            />
          </label>
          <button type="submit" disabled={submitting || code.length !== 6} style={primary}>
            [ {submitting ? 'Verifying…' : 'Verify and sign in'} ]
          </button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
            <button type="button" onClick={() => { setPhase('email'); setCode(''); setError(null); setInfo(null); }} style={ghost}>
              [← Change email]
            </button>
            <button type="button" onClick={onResend} disabled={submitting} style={ghost}>
              [Resend code]
            </button>
          </div>
        </form>
      )}

      {info && <p style={infoText}>{info}</p>}
      {error && <p style={errorText}>{error}</p>}
    </section>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  maxWidth: 420,
  margin: '40px auto',
  padding: 28,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 0,
};
const title: React.CSSProperties = { margin: 0, fontSize: 22, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' };
const subtitle: React.CSSProperties = { color: 'var(--muted)', marginTop: 4, marginBottom: 20, fontSize: 14 };
const form: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--muted)' };
const input: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 15,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--canvas)',
  color: 'var(--ink)',
};
const primary: React.CSSProperties = {
  padding: '10px 14px',
  background: 'var(--ink)',
  color: 'var(--canvas)',
  border: 'none',
  borderRadius: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  padding: '6px 10px',
  background: 'transparent',
  color: 'var(--muted)',
  border: 'none',
  borderRadius: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const infoText: React.CSSProperties = { marginTop: 14, fontSize: 13, color: 'var(--muted)' };
const errorText: React.CSSProperties = { marginTop: 14, fontSize: 13, color: 'var(--negative, #c53030)' };

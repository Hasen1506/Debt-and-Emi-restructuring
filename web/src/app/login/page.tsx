'use client';

/**
 * Sign-in via email + 6-digit code. Two phases in one page:
 *   1. Enter email      → POST /api/auth/request-otp
 *   2. Enter code       → POST /api/auth/verify-otp → cookie set → redirect
 */

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
import { hydrateFromServer, prepareAccountCache, serializeClientState, syncSliceToServer } from '@/lib/server-sync';
import { SIGN_IN_STARTING_MESSAGE } from '@/lib/auth-error';
import { safeRedirect } from '@/lib/safe-redirect';
import { RESEND_COOLDOWN_S, wakeProgress } from '@/lib/wake-progress';
import { TURNSTILE_SITE_KEY, TurnstileBox } from '@/components/auth/Turnstile';
import { PRIVACY_PATH, TERMS_PATH } from '@/lib/privacy-facts';
import { GOOGLE_CONFIG_PATH, googleStartHref } from '@/lib/google-signin';
import { LOGIN_COPY, START_PREVIEW, START_STEPS, loginFrame } from '@/lib/login-frame';

// The free-plan API sleeps when idle and can take over a minute to start.
const STARTING_RETRIES = 12;
const STARTING_RETRY_DELAY_MS = 5000;

type Phase = 'email' | 'code';

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get('next');
  // B1: framed as step 1 of a free plan when on the way to Setup.
  const frame = loginFrame(next, params.get('start'));
  const copy = LOGIN_COPY[frame];
  const redirectTo = typeof window === 'undefined' ? '/' : safeRedirect(next, window.location.origin);

  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // When the current request started (ms), for the waking-up progress.
  const [busySince, setBusySince] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<'send' | 'verify'>('send');
  const [now, setNow] = useState(() => Date.now());
  // Resend becomes available again at this time (ms).
  const [resendAt, setResendAt] = useState(0);
  // Cloudflare Turnstile (only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set):
  // a token is single-use, so each request asks for a fresh one.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const needsTurnstile = Boolean(TURNSTILE_SITE_KEY);

  // Tick once a second while a request is pending or the resend cooldown runs.
  useEffect(() => {
    if (busySince === null && resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busySince, resendAt]);
  const wake = busySince === null ? null : wakeProgress(now - busySince, busyAction);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function startBusy(action: 'send' | 'verify') {
    setBusyAction(action);
    setBusySince(Date.now());
    setNow(Date.now());
    setSubmitting(true);
  }
  function endBusy() {
    setBusySince(null);
    setSubmitting(false);
  }

  // Wake the API as soon as the page opens, so it is usually ready by the
  // time the email is typed. Best-effort: a failure here changes nothing.
  useEffect(() => {
    api.health().catch(() => {});
  }, []);

  // Sign in with Google (live test #6): shown only when the server has it
  // switched on (GOOGLE_SIGNIN, api/auth/google.py). Off by default.
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(GOOGLE_CONFIG_PATH, { cache: 'no-store', credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((c: { enabled?: boolean }) => { if (live) setGoogleOn(c.enabled === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  // Back from Google: the session cookie is set; load the account's data as
  // after a code sign-in. An error comes back as ?google_error=.
  const googleDone = params.get('google') === '1';
  const googleError = params.get('google_error');
  useEffect(() => {
    if (googleError) setError(googleError);
  }, [googleError]);
  useEffect(() => {
    if (!googleDone) return;
    let live = true;
    startBusy('verify');
    api.me()
      .then((user) => (live ? finishSignIn(user.id) : undefined))
      .catch(() => { if (live) setError('Google sign-in did not finish. Try again, or use an email code.'); })
      .finally(() => { if (live) endBusy(); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleDone]);

  /** After any sign-in: this browser now belongs to `userId`; bring the
   *  account's data in (or push a guest's data up), then go on. */
  async function finishSignIn(userId: string) {
    prepareAccountCache(userId);
    // Pull server state into cookies BEFORE navigating so middleware
    // doesn't redirect returning users to /onboarding.
    const hydrated = await hydrateFromServer();
    // New users (or first-time signups) have nothing on the server —
    // push their existing cookie state up if any.
    if (!hydrated) await migrateCookieStateIfNeeded();
    // A full page load, not router.push: the router may hold a copy of the
    // destination fetched while signed out (for / that's the landing page),
    // and WebKit showed it instead of asking the server again.
    // No session-changed event first: the next page starts its own session
    // and hydration. The event made <SessionHydrator/> hydrate again and
    // router.refresh() this page; in Firefox this navigation cancels that
    // refresh's fetch, Next falls back to a browser navigation of /login
    // itself, and that replaced this one: signed in, but back on the
    // sign-in form (CI run 38488716548, account-persistence :61).
    window.location.assign(redirectTo);
  }

  /** Request a code, retrying only while the API is still starting. The proxy
   *  reports "starting" before it creates a code, so these retries never send
   *  a second email. */
  async function requestOtpWhenReady(address: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.requestOtp(address, turnstileToken ?? undefined);
        return;
      } catch (err) {
        const starting = err instanceof Error && err.message === SIGN_IN_STARTING_MESSAGE;
        if (!starting || attempt >= STARTING_RETRIES) throw err;
        await new Promise(resolve => setTimeout(resolve, STARTING_RETRY_DELAY_MS));
      }
    }
  }

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startBusy('send');
    try {
      await requestOtpWhenReady(email.trim().toLowerCase());
      setPhase('code');
      setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
      setInfo(`We sent a 6-digit code to ${email}. It expires in 10 minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      endBusy();
      if (needsTurnstile) setTurnstileReset((n) => n + 1);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startBusy('verify');
    try {
      const user = await api.verifyOtp(email.trim().toLowerCase(), code.trim());
      await finishSignIn(user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed.';
      // Strip the "/api/auth/verify-otp → 400: " prefix from FastAPI's error.
      const clean = msg.replace(/^\S+ → \d+: ?/, '') || 'Verification failed.';
      // UX50 C-12: say what to do, and put the cursor back on the code with
      // the wrong digits selected so typing replaces them.
      setError(/incorrect code/i.test(clean) ? 'Incorrect code. Check the latest email from RightDue, or send a new code below.' : clean);
      requestAnimationFrame(() => {
        codeRef.current?.focus();
        codeRef.current?.select();
      });
    } finally {
      endBusy();
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
    if (resendIn > 0) return;
    setError(null);
    setInfo(null);
    startBusy('send');
    try {
      await requestOtpWhenReady(email.trim().toLowerCase());
      setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
      setInfo(`New code sent to ${email}. It expires in 10 minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend.');
    } finally {
      endBusy();
      if (needsTurnstile) setTurnstileReset((n) => n + 1);
    }
  }

  return (
    <section style={card}>
      {frame === 'start' && (
        <ol aria-label="Steps to your plan" data-testid="login-stepper" style={stepper}>
          {START_STEPS.map((s, i) => (
            <li key={s} aria-current={i === 0 ? 'step' : undefined} style={{ ...stepItem, color: i === 0 ? 'var(--ink)' : 'var(--muted)', fontWeight: i === 0 ? 700 : 400 }}>
              {i + 1} {s}
            </li>
          ))}
        </ol>
      )}
      <h1 style={title} data-testid="login-title">{copy.title}</h1>
      <p style={subtitle} data-testid="login-sub">
        {phase === 'email' ? copy.sub : copy.code}
      </p>
      {frame === 'start' && phase === 'email' && (
        <div data-testid="login-preview" style={{ margin: '0 0 18px', fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>In about two minutes you&rsquo;ll see:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {START_PREVIEW.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      )}

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
          <TurnstileBox onToken={setTurnstileToken} resetKey={turnstileReset} />
          {/* DPDP Act 2023 s.5-6: the notice comes before consent, and consent
              is a clear action (the button says so). Grill #51. */}
          <p style={noticeText}>
            We keep your email, your sign-in records and the plan you save, only to run your account on any device.
            You can download or delete them any time. Read the <a href={PRIVACY_PATH}>privacy notice</a> and{' '}
            <a href={TERMS_PATH}>terms</a>.
          </p>
          <button
            type="submit"
            disabled={submitting || (needsTurnstile && !turnstileToken)}
            style={primaryStyle(submitting || (needsTurnstile && !turnstileToken))}
          >
            [ {submitting ? 'Sending…' : 'Agree and send code'} ]
          </button>
          {googleOn && (
            <>
              <div aria-hidden="true" style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.14em' }}>OR</div>
              <a
                href={googleStartHref(next)}
                data-testid="google-signin"
                style={{ ...primary, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', textAlign: 'center', textDecoration: 'none' }}
              >
                [ Continue with Google ]
              </a>
              <p style={{ ...infoText, marginTop: 0, fontSize: 11 }}>
                Google tells RightDue only your email address, which Google has checked is yours. Nothing else from your Google account is read or kept.
              </p>
            </>
          )}
        </form>
      )}

      {phase === 'code' && (
        <form onSubmit={onVerify} style={form}>
          <label style={label}>
            6-digit code
            <input
              type="text"
              ref={codeRef}
              aria-invalid={error ? true : undefined}
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
          <button type="submit" disabled={submitting || code.length !== 6} style={primaryStyle(submitting || code.length !== 6)}>
            [ {submitting ? 'Verifying…' : 'Verify and sign in'} ]
          </button>
          <TurnstileBox onToken={setTurnstileToken} resetKey={turnstileReset} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
            <button type="button" disabled={submitting} onClick={() => { setPhase('email'); setCode(''); setError(null); setInfo(null); }} style={{ ...ghost, opacity: submitting ? 0.5 : 1 }}>
              [← Change email]
            </button>
            <button type="button" onClick={onResend} disabled={submitting || resendIn > 0 || (needsTurnstile && !turnstileToken)} style={{ ...ghost, opacity: submitting || resendIn > 0 ? 0.5 : 1 }}>
              {resendIn > 0 ? `[Resend in ${resendIn}s]` : '[Resend code]'}
            </button>
          </div>
        </form>
      )}

      <p style={{ ...infoText, fontSize: 12 }} data-testid="login-cant-pay">
        Behind on a payment, or getting recovery calls? <a href="/cant-pay">Your rights and a letter to your lender</a>, no sign-in needed.
      </p>

      {wake?.show && (
        <div role="status" aria-live="polite" style={{ marginTop: 14 }}>
          <p style={{ ...infoText, marginTop: 0 }}>{wake.message}</p>
          <div
            role="progressbar"
            aria-label="Waking up the server"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={wake.pct}
            style={{ height: 4, background: 'var(--border)', marginTop: 6 }}
          >
            <div style={{ width: `${wake.pct}%`, height: '100%', background: 'var(--ink)', transition: 'width 1s linear' }} />
          </div>
        </div>
      )}
      {info && !wake?.show && <p style={infoText}>{info}</p>}
      {error && <p role="alert" style={errorText}>{error}</p>}
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
const stepper: React.CSSProperties = { listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: 0, margin: '0 0 12px', fontSize: 12, fontFamily: 'var(--font-mono)' };
const stepItem: React.CSSProperties = { whiteSpace: 'nowrap' };
const subtitle: React.CSSProperties = { color: 'var(--muted)', marginTop: 4, marginBottom: 20, fontSize: 14 };
const form: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--muted)' };
const input: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 16,
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
/** Disabled looks disabled (QA BUG-2: it was identical to enabled). */
function primaryStyle(disabled: boolean): React.CSSProperties {
  return disabled ? { ...primary, opacity: 0.45, cursor: 'not-allowed' } : primary;
}
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
const noticeText: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' };
const infoText: React.CSSProperties = { marginTop: 14, fontSize: 13, color: 'var(--muted)' };
const errorText: React.CSSProperties = { marginTop: 14, fontSize: 13, color: 'var(--negative, #c53030)' };

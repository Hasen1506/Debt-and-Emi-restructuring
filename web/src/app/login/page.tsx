'use client';

/**
 * Sign-in via email + 6-digit code. Two phases in one page:
 *   1. Enter email      → POST /api/auth/request-otp
 *   2. Enter code       → POST /api/auth/verify-otp → cookie set → redirect
 *
 * Themed via CSS variables on <html data-theme>; works across all 3 skins
 * without per-skin variants.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { loadProfileClient, serializeProfileForServer } from '@/lib/user-store';

type Phase = 'email' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('next') || '/';

  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await api.requestOtp(email.trim().toLowerCase());
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
      await api.verifyOtp(email.trim().toLowerCase(), code.trim());
      await migrateCookieStateIfNeeded();
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
      await api.putUserState(serializeProfileForServer(cookieProfile));
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
            {submitting ? 'Sending…' : 'Send code'}
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
            {submitting ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
            <button type="button" onClick={() => { setPhase('email'); setCode(''); setError(null); setInfo(null); }} style={ghost}>
              ← Change email
            </button>
            <button type="button" onClick={onResend} disabled={submitting} style={ghost}>
              Resend code
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
  borderRadius: 8,
};
const title: React.CSSProperties = { margin: 0, fontSize: 22 };
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
  outline: 'none',
};
const primary: React.CSSProperties = {
  padding: '10px 14px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  padding: '6px 10px',
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
};
const infoText: React.CSSProperties = { marginTop: 14, fontSize: 13, color: 'var(--muted)' };
const errorText: React.CSSProperties = { marginTop: 14, fontSize: 13, color: 'var(--negative, #c53030)' };

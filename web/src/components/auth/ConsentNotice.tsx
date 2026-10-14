'use client';
/**
 * One-tap re-consent (audit80 D2/D12). Shown to a signed-in account whose
 * latest agreement is for an older privacy notice or terms (or that was
 * made before the consent record existed): GET /api/auth/me says
 * consent_required. Agreeing records "re-given" with the versions shown;
 * the alternative is the Your data page (download, delete = withdraw).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { agreeToCurrent } from '@/lib/consent';
import { onSignInPage, SESSION_CHANGED_EVENT } from '@/lib/session-events';
import { ACCOUNT_PATH, NOTICE_LAST_UPDATED, PRIVACY_PATH, TERMS_PATH } from '@/lib/privacy-facts';

export function ConsentNotice() {
  const [needed, setNeeded] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true') return;
    let live = true;
    const check = () => {
      if (onSignInPage()) return;
      api.me().then((u) => { if (live) setNeeded(u.consent_required === true); }).catch(() => { if (live) setNeeded(false); });
    };
    check();
    window.addEventListener(SESSION_CHANGED_EVENT, check);
    return () => { live = false; window.removeEventListener(SESSION_CHANGED_EVENT, check); };
  }, []);

  if (!needed) return null;

  async function agree() {
    setBusy(true); setError(null);
    try { await agreeToCurrent(adult); setNeeded(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Your agreement could not be saved.'); }
    finally { setBusy(false); }
  }

  return (
    <section role="region" aria-label="Updated privacy notice" data-testid="consent-notice"
      style={{ border: '1px solid var(--ink)', background: 'var(--card, transparent)', padding: '12px 14px', margin: '12px auto', maxWidth: 760, fontSize: 13, lineHeight: 1.5 }}>
      <p style={{ margin: 0 }}>
        We updated our <a href={PRIVACY_PATH}>privacy notice</a> and <a href={TERMS_PATH}>terms</a> ({NOTICE_LAST_UPDATED}).
        Please read them and agree to keep using your account. If you don&apos;t agree, you can download or delete your
        data on the <a href={ACCOUNT_PATH}>Your data</a> page.
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} data-testid="consent-age" />
        I am 18 or older.
      </label>
      <button type="button" onClick={agree} disabled={!adult || busy} data-testid="consent-agree"
        style={{ marginTop: 8, padding: '8px 12px', background: 'var(--ink)', color: 'var(--canvas)', border: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: adult && !busy ? 'pointer' : 'not-allowed', opacity: adult && !busy ? 1 : 0.45 }}>
        {busy ? 'Saving…' : 'I agree'}
      </button>
      {error && <p role="alert" style={{ margin: '8px 0 0', color: 'var(--negative, #b42318)' }}>{error}</p>}
    </section>
  );
}

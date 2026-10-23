'use client';

/** A read-only link for a spouse or family member. The owner can hide each
 *  loan and can turn the link off. Nothing on the shared page can be edited. */
import { useEffect, useState } from 'react';
import { api, type ShareLinkState } from '@/lib/api';
import { L_T } from '@/components/ledger/primitives';

const P: React.CSSProperties = { margin: '6px 0', fontSize: 13, lineHeight: 1.6 };
const BUTTON: React.CSSProperties = {
  padding: '8px 12px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: 'var(--font-mono)',
  fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer', justifySelf: 'start',
};

export function FamilyShare() {
  const [link, setLink] = useState<ShareLinkState | null>(null);
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    let live = true;
    api.getShareLink().then((row) => {
      if (!live) return;
      setLink(row);
      setHide(!!row.hide_loans);
    }).catch(() => { if (live) setLink({ active: false }); });
    return () => { live = false; };
  }, []);
  useEffect(() => setOrigin(window.location.origin), []);

  async function save(nextHide: boolean) {
    setBusy(true);
    setSaid('');
    try {
      const row = await api.saveShareLink(nextHide);
      setLink(row);
      setHide(!!row.hide_loans);
      setSaid(row.active ? 'Link ready. Anyone with it can look, and cannot change the plan.' : '');
      void import('@/lib/change-log').then(({ recordChange }) =>
        recordChange({ kind: 'settings', what: 'Family share link', after: nextHide ? 'on, loans hidden' : 'on' }),
      );
    } catch {
      setSaid('The link could not be saved. You are still signed in to this page.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setSaid('');
    try {
      await api.revokeShareLink();
      setLink({ active: false });
      setSaid('Link turned off. The old address no longer opens the plan.');
      void import('@/lib/change-log').then(({ recordChange }) =>
        recordChange({ kind: 'settings', what: 'Family share link', before: 'on', after: 'off' }),
      );
    } catch {
      setSaid('The link could not be turned off.');
    } finally {
      setBusy(false);
    }
  }

  const href = link?.path ? `${origin}${link.path}` : '';
  return (
    <section aria-labelledby="family-share-h" data-testid="family-share">
      <h2 id="family-share-h" style={{ margin: '22px 0 6px', fontSize: 14, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>FAMILY LINK</h2>
      <p style={P}>
        {/* Worded for both countries: reading the profile here for the
            country pulled the whole profile store into /account. */}
        A read-only page for a spouse or family member. It shows the debt-free date and, unless you hide them, each loan’s name, balance and
        monthly payment. It never shows your email, tax ID or account numbers. You can turn it off, and the old address stops working.
      </p>
      {link?.active && href && (
        <p style={P}>
          <a href={href} data-testid="family-share-url">{href}</a>
        </p>
      )}
      <label style={{ ...P, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" data-testid="family-share-hide" checked={hide} onChange={(e) => setHide(e.target.checked)} />
        Hide each loan’s name and balance
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" style={BUTTON} data-testid="family-share-save" disabled={busy || link === null} onClick={() => save(hide)}>
          {busy ? 'Saving…' : link?.active ? 'Update the link' : 'Create a link'}
        </button>
        {link?.active && (
          <button type="button" style={{ ...BUTTON, background: 'transparent', color: L_T.ink, border: `1px solid ${L_T.ink}` }} data-testid="family-share-revoke" disabled={busy} onClick={revoke}>
            Turn the link off
          </button>
        )}
      </div>
      {said && <p role="status" style={P}>{said}</p>}
    </section>
  );
}

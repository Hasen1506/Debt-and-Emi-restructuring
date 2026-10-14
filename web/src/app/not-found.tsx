import Link from 'next/link';
import { cookies } from 'next/headers';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { L_MONO, L_T } from '@/components/ledger/primitives';

// Live re-test 6B R6B-6: the 404 had the generic site title.
export const metadata: Metadata = { title: 'Page not found · RightDue' };

/** A missing page keeps the app's header and offers a way back (live QA:
 *  /tax was a bare 404). UX50 A-14: signed-out visitors now reach it too
 *  (unknown paths no longer bounce to sign-in), so the way out depends on
 *  who's looking; the old /tax-only line is gone; the
 *  way-out links are full-size tap targets. */
export default async function NotFound() {
  const signedIn = Boolean((await cookies()).get('rightdue_session'));
  const btn: CSSProperties = {
    display: 'inline-block',
    fontFamily: L_MONO,
    fontWeight: 700,
    fontSize: 'var(--fs-label)',
    letterSpacing: '0.1em',
    padding: '12px 18px',
    border: `1px solid ${L_T.ink}`,
    background: L_T.ink,
    color: L_T.bg,
    textDecoration: 'none',
  };
  const link: CSSProperties = { display: 'inline-block', padding: '12px 0', fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', color: L_T.ink };
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 640, fontFamily: L_MONO }} data-testid="not-found">
      <h1 style={{ margin: 0, fontSize: 20, letterSpacing: '0.08em' }}>PAGE NOT FOUND</h1>
      <p style={{ margin: 0, color: L_T.muted, fontSize: 'var(--fs-body)' }}>
        This link doesn&apos;t go anywhere. It may be old or mistyped.
      </p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {signedIn ? (
          <Link href="/" style={btn}>[ GO TO HOME → ]</Link>
        ) : (
          // A full load: signed out, / is the static landing (a rewrite in
          // the middleware), which a client-side Link can't render.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/" style={btn}>[ BACK TO RIGHTDUE → ]</a>
        )}
        <Link href="/glossary" style={link}>[GLOSSARY]</Link>
        {!signedIn && <Link href="/tools/loan-check" style={link}>[LOAN CHECK]</Link>}
      </div>
    </div>
  );
}

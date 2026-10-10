import { LBracket, LShell, L_T } from '@/components/ledger/primitives';

/** A missing page keeps the app's header and offers a way back (live QA:
 *  /tax was a bare 404). */
export default function NotFound() {
  return (
    <LShell>
      <div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: '0.08em' }}>PAGE NOT FOUND</h1>
        <p style={{ margin: 0, color: L_T.muted, fontSize: 13 }}>
          There&apos;s no page at this address. Tax settings are in Profile; everything else is in the menu above.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <LBracket href="/">HOME</LBracket>
          <LBracket href="/profile">PROFILE</LBracket>
          <LBracket href="/plan">PLAN</LBracket>
        </div>
      </div>
    </LShell>
  );
}

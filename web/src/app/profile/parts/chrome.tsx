'use client';

// Split out of app/profile/ProfileClient.tsx by scripts/split-profile-client.cjs
// (Audit 80 E15). Moved verbatim; edit here, not in ProfileClient.

import { LBracket, L_T } from '@/components/ledger/primitives';
import { PROFILE_SECTIONS } from '@/components/profile/ProfileSummary';

/** "← Back to Plan": the page the user opened Profile from. */
export function BackLink({ back }: { back: { href: string; name: string } }) {
  return (
    <div>
      <LBracket href={back.href} style={{ fontSize: 12 }}>{`← BACK TO ${back.name.toUpperCase()}`}</LBracket>
    </div>
  );
}

/** Every part of the profile, one tap away while editing; the first
 *  shows the whole profile again. Moving between parts keeps edits. */
export function SectionTabs({ step, onOpen, onAll }: { step: number; onOpen: (n: number) => void; onAll: () => void }) {
  const tab = (on: boolean): React.CSSProperties => ({
    fontFamily: 'inherit',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '8px 12px',
    minHeight: 36,
    border: `1px solid ${on ? L_T.ink : L_T.ruleSoft}`,
    background: on ? L_T.ink : L_T.paper,
    color: on ? L_T.bg : L_T.ink,
    fontWeight: on ? 700 : 500,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  });
  return (
    <nav aria-label="Parts of your profile" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button type="button" style={tab(false)} onClick={onAll}>
        ← WHOLE PROFILE
      </button>
      {PROFILE_SECTIONS.map((name, n) => (
        <button key={name} type="button" style={tab(n === step)} aria-current={n === step ? 'step' : undefined} onClick={() => onOpen(n)}>
          {SECTION_TAB[n] ?? name}
        </button>
      ))}
      <a href="/profile/assets" style={tab(false)}>WHAT YOU OWN</a>
      <a href="/profile/assumptions" style={tab(false)}>ASSUMPTIONS</a>
    </nav>
  );
}

const SECTION_TAB = ['YOU', 'COUNTRY AND TAX', 'INCOME', 'LOANS', 'SAVINGS AND BANKS'];

export function ProfileHeader({ title, editing, children }: { title: string; editing?: boolean; children: React.ReactNode }) {
  return (
    <header>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>
        PROFILE{editing ? ' · EDIT' : ''}
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>{title}</h1>
      <p style={{ color: L_T.inkSoft, fontSize: 13, margin: '8px 0 0', lineHeight: 1.6 }}>{children}</p>
    </header>
  );
}

import { loadCurrentProfileServer } from '@/lib/user-store';
import { glossaryFor, GLOSSARY } from '@/lib/glossary';
import { LShell, L_T } from '@/components/ledger/primitives';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Glossary · RightDue' };

/** /glossary: every technical term the app uses, in plain words (grill #43). */
export const dynamic = 'force-dynamic';

export default async function GlossaryPage() {
  const profile = await loadCurrentProfileServer().catch(() => null);
  // Signed out or before setup: every term, both countries.
  const entries = profile?.isLive ? glossaryFor(profile.user.country) : Object.entries(GLOSSARY);
  return (
    <LShell>
      <header style={{ marginBottom: 18, maxWidth: 820 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>GLOSSARY · PLAIN WORDS</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>What the words mean</h1>
        <p style={{ color: L_T.inkSoft, fontSize: 13, margin: '8px 0 0', lineHeight: 1.6 }}>
          Every technical term in RightDue, in 30 words or fewer. Tap a dotted word anywhere in the app to see its line here.
        </p>
      </header>
      <dl style={{ margin: 0, maxWidth: 820 }}>
        {entries.map(([key, e]) => (
          <div key={key} id={key} style={{ padding: '10px 0', borderBottom: `1px dashed ${L_T.ruleSoft}` }}>
            <dt style={{ fontWeight: 700, fontSize: 13 }}>{e.term}</dt>
            <dd style={{ margin: '4px 0 0', color: L_T.inkSoft, fontSize: 13, lineHeight: 1.6 }}>{e.plain}</dd>
          </div>
        ))}
      </dl>
    </LShell>
  );
}

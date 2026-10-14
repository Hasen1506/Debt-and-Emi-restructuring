'use client';

/**
 * Tools (REDESIGN R5.3): one row per question, under the goals. A tool
 * for one country, or for NRIs, is shown only to the people it's for.
 *
 * `ToolStrip` is the short form: the questions as buttons, at the foot of
 * Home ("Something came up?") and of each tool ("Other tools"), so the
 * tools are found from where people already are, not only from Goals.
 */

import type { Country } from '@/lib/api';
import { toolsFor } from '@/lib/tools';
import { LSectionHeader, L_T } from '@/components/ledger/primitives';

type ToolUser = { country: Country; is_nri_us?: boolean };

export function ToolsList({ user }: { user: ToolUser }) {
  const tools = toolsFor(user);
  return (
    <section id="tools" aria-labelledby="tools-h" style={{ scrollMarginTop: 24 }}>
      <LSectionHeader>
        <span id="tools-h">Tools · {tools.length}</span>
      </LSectionHeader>
      <p style={{ margin: '0 0 10px', fontSize: 'var(--fs-dense)', lineHeight: 1.6, color: L_T.inkSoft }}>
        Each answers one question against your own plan. Nothing changes until you choose to add it.{' '}
        <a href="/glossary" style={{ color: L_T.accent }}>What the terms mean</a>
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {tools.map((t) => (
          <li key={t.id}>
            {/* The whole row opens the tool: a small OPEN at the far
                right was easy to miss. */}
            <a
              href={t.href}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 16,
                rowGap: 4,
                padding: '12px 14px',
                border: `1px solid ${L_T.ink}`,
                background: L_T.paper,
                color: L_T.ink,
                textDecoration: 'none',
              }}
            >
              <span style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', color: L_T.muted }}>{t.name.toUpperCase()}</span>
                <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>{t.question}</span>
              </span>
              <span style={{ flex: '2 1 280px', color: L_T.inkSoft, fontSize: 'var(--fs-dense)', lineHeight: 1.5 }}>{t.sub}</span>
              <span aria-hidden="true" style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', color: L_T.accent }}>
                OPEN →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The tools as a row of buttons; `except` leaves out the one open. */
export function ToolStrip({ user, title, except }: { user: ToolUser; title: string; except?: string }) {
  const tools = toolsFor(user).filter((t) => t.id !== except);
  if (tools.length === 0) return null;
  return (
    <nav aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LSectionHeader right={<a href="/goals#tools" style={{ color: L_T.accent, fontSize: 'var(--fs-small)' }}><span aria-hidden="true">[</span>ALL TOOLS →<span aria-hidden="true">]</span></a>}>
        {title}
      </LSectionHeader>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tools.map((t) => (
          <li key={t.id}>
            <a
              href={t.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 36,
                padding: '8px 12px',
                border: `1px solid ${L_T.ink}`,
                background: L_T.paper,
                color: L_T.ink,
                fontSize: 'var(--fs-body)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {t.question}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

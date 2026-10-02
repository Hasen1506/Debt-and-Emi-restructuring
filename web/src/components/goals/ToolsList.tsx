'use client';

/**
 * Tools (REDESIGN R5.3): one row per question, under the goals. A tool
 * for one country, or for NRIs, is shown only to the people it's for.
 */

import type { Country } from '@/lib/api';
import { toolsFor } from '@/lib/tools';
import { LBracket, LSectionHeader, L_T } from '@/components/ledger/primitives';

export function ToolsList({ user }: { user: { country: Country; is_nri_us?: boolean } }) {
  const tools = toolsFor(user);
  return (
    <section id="tools" aria-labelledby="tools-h" style={{ scrollMarginTop: 24 }}>
      <LSectionHeader>
        <span id="tools-h">Tools · one question each</span>
      </LSectionHeader>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12 }}>
        {tools.map((t) => (
          <li
            key={t.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              columnGap: 16,
              rowGap: 2,
              padding: '11px 0',
              borderBottom: `1px dashed ${L_T.faint}`,
            }}
          >
            <a href={t.href} className="l-hit" style={{ flex: '1 1 260px', fontWeight: 700, color: L_T.ink, textDecoration: 'none' }}>
              {t.question}
            </a>
            <span style={{ flex: '2 1 300px', color: L_T.muted, fontSize: 11, lineHeight: 1.5 }}>{t.sub}</span>
            <LBracket accent href={t.href} label={`Open ${t.name}`}>
              OPEN →
            </LBracket>
          </li>
        ))}
      </ul>
    </section>
  );
}

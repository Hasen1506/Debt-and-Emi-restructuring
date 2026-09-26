/**
 * Tools index — one row per tool, each links to the standalone route.
 *
 * Matches the ledger prototype §4.8: dashed-row table with §id · name ·
 * question · sub · [OPEN →]. Table layout works for every theme because
 * a flat list of decision-tools is the cleanest possible UI; no
 * accordion, no in-place expansion, no "where did I land" confusion.
 */

import { TOOLS } from '@/lib/tools';
import { LedgerToolsIndex } from '@/components/ledger/LedgerToolsIndex';
import { loadThemeServer } from '@/lib/theme';

export default async function ToolsPage() {
  const theme = await loadThemeServer();
  if (theme === 'ledger')
    return (
      <>
        <h1 className="sr-only">Tools</h1>
        <LedgerToolsIndex tools={TOOLS} />
      </>
    );

  // Existing + Editorial fall back to a simple non-ledger list while the
  // new design rolls out — same data, slightly looser typography.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h1 className="h1">Tools</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Single-decision modules — each answers one question with one number
          and one chart.
        </p>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TOOLS.map((t) => (
          <a
            key={t.id}
            href={t.href}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              textDecoration: 'none',
              color: 'var(--ink)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {t.question}
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  marginTop: 6,
                }}
              >
                {t.sub}
              </div>
            </div>
            <span
              aria-hidden
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              [open →]
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

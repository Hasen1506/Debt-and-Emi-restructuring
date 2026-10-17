/**
 * Assets & tax (audit 80+ A3/A20, founder 14 Oct 2026: "make Portfolio +
 * Tax one section"). Both pages open with this: the section name and two
 * tabs, What you own (/portfolio) and Tax (/tax). The masthead lights
 * "More" for both (lib/app-nav.ts).
 */
import Link from 'next/link';
import { ASSETS_TAX_TABS } from '@/lib/app-nav';
import { L_T } from '@/components/ledger/primitives';

export function AssetsTaxNav({ current }: { current: '/portfolio' | '/tax' }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-label)', letterSpacing: '0.12em', textTransform: 'uppercase', color: L_T.muted, marginBottom: 8 }}>
        Assets &amp; tax
      </div>
      <nav aria-label="Assets and tax" style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${L_T.ink}`, flexWrap: 'wrap' }}>
        {ASSETS_TAX_TABS.map((t) => {
          const on = t.href === current;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? 'page' : undefined}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                fontWeight: on ? 700 : 500,
                letterSpacing: '0.06em',
                padding: '8px 14px',
                marginBottom: -2,
                color: on ? L_T.bg : L_T.ink,
                background: on ? L_T.ink : 'transparent',
                border: `2px solid ${L_T.ink}`,
                borderLeft: t.href === ASSETS_TAX_TABS[0].href ? `2px solid ${L_T.ink}` : 'none',
                textDecoration: 'none',
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

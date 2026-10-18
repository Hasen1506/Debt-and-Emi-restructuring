'use client';
/** UX2 #23: Profile > Appearance. Light is the default; Dark is only on when
 *  chosen here, and sticks in this browser (UI revert 18 Oct 2026). */
import { useEffect, useState } from 'react';
import { LChip, LChipRow } from '@/components/ledger/primitives';
import { applyTheme, readTheme, type ThemePref } from '@/lib/theme';

const OPTIONS: { v: ThemePref; label: string }[] = [
  { v: 'light', label: 'LIGHT' },
  { v: 'dark', label: 'DARK' },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref | null>(null);
  useEffect(() => setPref(readTheme()), []);
  return (
    <LChipRow label="Appearance">
      {OPTIONS.map(({ v, label }) => (
        <LChip key={v} on={pref === v} onClick={() => { applyTheme(v); setPref(v); }}>
          {label}
        </LChip>
      ))}
    </LChipRow>
  );
}

/** Keeps a chosen Dark on <html> after React takes over the page: hydration
 *  can drop the data-theme THEME_SCRIPT set before the first paint (seen
 *  18 Oct 2026: dark for a moment, then light). Light needs nothing. */
export function ThemeKeeper() {
  useEffect(() => {
    const root = document.documentElement;
    const keep = () => {
      if (readTheme() === 'dark' && root.getAttribute('data-theme') !== 'dark') root.setAttribute('data-theme', 'dark');
    };
    keep();
    const mo = new MutationObserver(keep);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return null;
}

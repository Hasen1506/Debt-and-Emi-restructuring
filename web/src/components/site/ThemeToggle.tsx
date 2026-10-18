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

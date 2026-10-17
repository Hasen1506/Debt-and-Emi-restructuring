'use client';
/** UX2 #23: Profile > Appearance. System (the default) follows the phone or
 *  computer's dark-mode setting; Light or Dark sticks in this browser. */
import { useEffect, useState } from 'react';
import { LChip, LChipRow } from '@/components/ledger/primitives';
import { applyTheme, readTheme, type ThemePref } from '@/lib/theme';

const OPTIONS: { v: ThemePref; label: string }[] = [
  { v: 'system', label: 'AS MY DEVICE' },
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

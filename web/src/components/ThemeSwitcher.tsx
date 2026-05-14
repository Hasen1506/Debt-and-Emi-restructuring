'use client';

import { useEffect, useState } from 'react';
import {
  readThemeClient,
  writeThemeClient,
  THEMES,
  THEME_LABEL,
  THEME_DESCRIPTION,
  type ThemeName,
} from '@/lib/theme';

/**
 * Three-pill toggle. Server renders the right-hand side with the initial
 * theme from the cookie (passed in via props), the client takes over after
 * hydration so user clicks update the cookie + `<html data-theme>` instantly.
 */
export function ThemeSwitcher({ initial }: { initial: ThemeName }) {
  const [theme, setTheme] = useState<ThemeName>(initial);

  // After hydration, sync with the actual cookie (defensive — if a different
  // tab changed the theme since SSR, we pick up the latest value).
  useEffect(() => {
    const live = readThemeClient();
    if (live !== theme) setTheme(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (next: ThemeName) => {
    if (next === theme) return;
    setTheme(next);
    writeThemeClient(next);
  };

  return (
    <div
      role="group"
      aria-label="Theme"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-pill, 999px)',
        padding: 2,
        background: 'var(--card)',
      }}
    >
      {THEMES.map((t) => {
        const active = t === theme;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            title={THEME_DESCRIPTION[t]}
            aria-pressed={active}
            style={{
              border: 'none',
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              borderRadius: 'var(--radius-pill, 999px)',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--muted)',
              cursor: 'pointer',
              transition: 'background 120ms, color 120ms',
            }}
          >
            {THEME_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Theme system — global aesthetic switcher.
 *
 * Three themes coexist:
 *  - 'ledger' — Direction D (IBM Plex Mono everywhere, no rounded corners) — DEFAULT
 *  - 'existing' — the original FinOptima look (warm beige, terracotta, Inter)
 *  - 'editorial' — Direction A (cream paper, Spectral serif, marginalia)
 *
 * The active theme is stored in a cookie so the server-rendered HTML can
 * paint with the correct `<html data-theme>` attribute on first byte — no
 * theme flicker. Pattern mirrors `user-store.ts`.
 *
 * Pages that need different LAYOUTS per theme (Home, Plan, Debts, Insights)
 * read `loadThemeServer()` and switch components. Pages that only need
 * different TYPOGRAPHY/COLORS (Onboarding, Tools) reference CSS tokens
 * that are themselves theme-scoped via `[data-theme="..."]` in globals.css.
 */

export type ThemeName = 'existing' | 'editorial' | 'ledger';

// Ledger is the canonical FinOptima look; the other two stay as toggle options.
export const THEMES: ThemeName[] = ['ledger', 'existing', 'editorial'];
export const DEFAULT_THEME: ThemeName = 'ledger';
const COOKIE_NAME = 'finoptima_theme';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isTheme(v: string | null | undefined): v is ThemeName {
  return v === 'existing' || v === 'editorial' || v === 'ledger';
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readThemeClient(): ThemeName {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const v = match ? decodeURIComponent(match[1]) : null;
  return isTheme(v) ? v : DEFAULT_THEME;
}

export function writeThemeClient(theme: ThemeName) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${theme}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  // Update the live DOM so the change is visible without a full reload.
  document.documentElement.dataset.theme = theme;
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadThemeServer(): Promise<ThemeName> {
  const { cookies } = await import('next/headers');
  const v = cookies().get(COOKIE_NAME)?.value;
  return isTheme(v) ? v : DEFAULT_THEME;
}

export const THEME_LABEL: Record<ThemeName, string> = {
  existing: 'Default',
  editorial: 'Editorial',
  ledger: 'Ledger',
};

export const THEME_DESCRIPTION: Record<ThemeName, string> = {
  existing: 'Calm utility — warm cards, terracotta accent',
  editorial: 'A letter from an advisor — serif, marginalia, generous whitespace',
  ledger: 'Printed bank statement — monospace, dense tables, no rounded corners',
};

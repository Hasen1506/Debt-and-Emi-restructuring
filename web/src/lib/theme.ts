/**
 * UX2 #23 dark mode, opt-in (UI revert 18 Oct 2026): the page is light unless
 * Profile > Appearance chose Dark, kept in this browser. The system's
 * dark-mode setting is not followed. THEME_SCRIPT runs inline in <head>
 * (app/layout.tsx) and sets <html data-theme="dark"> before the first paint,
 * so a chosen dark page never flashes light. The colours themselves are the
 * tokens in styles/globals.css.
 */
export type ThemePref = 'light' | 'dark';
export const THEME_KEY = 'rightdue_theme';

export const THEME_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}`;

export function readTheme(): ThemePref {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  try {
    if (pref === 'dark') localStorage.setItem(THEME_KEY, 'dark');
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* private mode: the choice lasts until the page is closed */
  }
}

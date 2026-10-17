/**
 * UX2 #23 dark mode: follow the system (prefers-color-scheme), or the choice
 * made in Profile > Appearance, kept in this browser. THEME_SCRIPT runs
 * inline in <head> (app/layout.tsx) and sets <html data-theme> before the
 * first paint, so a dark page never flashes light. The colours themselves
 * are the tokens in styles/globals.css.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = 'rightdue_theme';

export const THEME_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode: the choice lasts until the page is closed */
  }
}

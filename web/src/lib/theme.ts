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

// When Dark is chosen the script also watches <html> until the page has
// loaded: hydration can drop data-theme before ThemeKeeper mounts, and the
// observer puts it back in the same frame, so there is no light flash.
export const THEME_SCRIPT =
  `try{var k=${JSON.stringify(THEME_KEY)},r=document.documentElement;` +
  `if(localStorage.getItem(k)==='dark'){r.setAttribute('data-theme','dark');` +
  `if(typeof MutationObserver!=='undefined'){var o=new MutationObserver(function(){` +
  `if(localStorage.getItem(k)==='dark'&&r.getAttribute('data-theme')!=='dark')r.setAttribute('data-theme','dark')});` +
  `o.observe(r,{attributes:true,attributeFilter:['data-theme']});` +
  `addEventListener('load',function(){setTimeout(function(){o.disconnect()},1000)})}}}catch(e){}`;

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

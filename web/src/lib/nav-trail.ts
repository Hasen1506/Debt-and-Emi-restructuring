/**
 * Where the user was before this page, for a "Back to Plan" link. The
 * masthead records each in-app page as it opens; a page reads the one
 * before it. Kept for the tab only (sessionStorage), and every read and
 * write survives storage being blocked.
 */
import { TOOLS } from './tools';

const KEY = 'rightdue_trail';

interface Trail {
  prev: string | null;
  cur: string | null;
}

function read(): Trail {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as Trail) : null;
    return { prev: t?.prev ?? null, cur: t?.cur ?? null };
  } catch {
    return { prev: null, cur: null };
  }
}

/** Called by the masthead when a page opens. A new search on the same
 *  page (Profile's ?step=) is not a new page. */
export function recordPage(href: string): void {
  const t = read();
  const path = (s: string | null) => (s ? s.split('?')[0] : null);
  const next: Trail = path(t.cur) === path(href) ? { prev: t.prev, cur: href } : { prev: t.cur, cur: href };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: no back link */
  }
}

/** The page's name as the back link says it: "Plan", "Spare cash". */
export function pageName(href: string): string | null {
  const path = href.split(/[?#]/)[0];
  if (path === '/' || path === '') return 'Home';
  if (path.startsWith('/plan')) return 'Plan';
  if (path.startsWith('/activity')) return 'Activity';
  if (path.startsWith('/goals') || path === '/tools') return 'Goals and tools';
  if (path.startsWith('/tools/')) return TOOLS.find((t) => path.startsWith(t.href))?.name ?? 'the tool';
  if (path.startsWith('/portfolio')) return 'Portfolio';
  return null;
}

/** The page before this one, unless it is a page under `except`
 *  (Profile's back link never points at Profile). */
export function previousPage(except: string): { href: string; name: string } | null {
  const { prev } = read();
  if (!prev || prev.split('?')[0].startsWith(except)) return null;
  const name = pageName(prev);
  return name ? { href: prev, name } : null;
}

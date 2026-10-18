/**
 * UX2 #23: the text of the last Home and Plan this browser showed, kept for
 * public/offline.html, which shows it read-only and "as of" its time. Only
 * a page that has finished loading is kept (nothing marked aria-busy), and
 * controls are left out, so it reads as a statement, not a working page.
 */
export const SNAPSHOT_KEY = 'rightdue_offline_snapshot';
const MAX_CHARS = 12_000;

export interface PageSnapshot { at: string; text: string }

/** Keep `path`'s <main> text. False when the page is still loading or empty. */
export function snapshotMain(path: string, doc: Document, storage: Storage, now: Date = new Date()): boolean {
  const main = doc.querySelector('main');
  if (!main || main.querySelector('[aria-busy="true"]')) return false;
  const copy = main.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('button, input, select, textarea, nav, script, style, [aria-hidden="true"], .sr-only, [data-print="hide"]').forEach((n) => n.remove());
  // Laid out off-screen for a moment, so innerText keeps the line breaks.
  copy.style.cssText = 'position:absolute;left:-99999px;top:0;width:720px';
  copy.removeAttribute('id');
  doc.body.appendChild(copy);
  const raw = copy.innerText || copy.textContent || '';
  copy.remove();
  const text = raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS);
  if (!text) return false;
  try {
    const all = JSON.parse(storage.getItem(SNAPSHOT_KEY) || '{}') as Record<string, PageSnapshot>;
    all[path] = { at: now.toISOString(), text };
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

'use client';
/**
 * Say a tool's answer to a screen reader (backlog #26). A live region
 * only speaks when its text changes while it's already on the page, and a
 * tool's answer box mounts with the answer in it, so it was never read
 * out. One polite region lives on <body> for the whole visit; each answer
 * is written into it.
 */
const ID = 'rd-announcer';

function region(): HTMLElement {
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';
    document.body.appendChild(el);
  }
  return el;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Announce `text` once the input settles (typing re-runs a tool on every
 *  key; only the answer the user stops at is read). */
export function announce(text: string, delayMs = 600): void {
  if (typeof document === 'undefined') return;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const el = region();
    // Same text twice in a row is still read: clear, then set.
    el.textContent = '';
    setTimeout(() => {
      el.textContent = t;
    }, 50);
  }, delayMs);
}

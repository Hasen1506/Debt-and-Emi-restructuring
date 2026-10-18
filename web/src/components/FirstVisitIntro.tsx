'use client';

/**
 * The "what this page is for" sentence each tab opened with (Audit 80 B22).
 * A returning user already knows, and it pushed the answer ~120 px down on
 * a phone, so it shows on the first visit to that page only (remembered in
 * this browser).
 *
 * Integration (E10 layout shift): it used to render nothing until mounted,
 * then appear on a first visit, moving Home down (CLS 0.09 of the 0.1
 * budget at 390 px). Now it is always in the server HTML and the inline
 * <head> script (lib/intro-seen) hides the seen ones before the first paint;
 * leaving the page adds the same rule, so an in-app return hides it too.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { INTRO_SEEN_PREFIX, INTRO_STYLE_ID, introHideRule } from '@/lib/intro-seen';

export { INTRO_SEEN_PREFIX };

export function FirstVisitIntro({ id, children, style }: { id: string; children: ReactNode; style?: CSSProperties }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(INTRO_SEEN_PREFIX + id, '1');
    } catch {
      /* storage blocked: it shows again next time */
    }
    return () => {
      try {
        let el = document.getElementById(INTRO_STYLE_ID);
        if (!el) {
          el = document.createElement('style');
          el.id = INTRO_STYLE_ID;
          document.head.appendChild(el);
        }
        const rule = introHideRule(id);
        if (!el.textContent?.includes(rule)) el.textContent = (el.textContent ?? '') + rule;
      } catch {
        /* no DOM: nothing to hide */
      }
    };
  }, [id]);
  return (
    <p data-testid={`intro-${id}`} data-intro={id} style={style}>
      {children}
    </p>
  );
}

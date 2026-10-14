'use client';

/**
 * The "what this page is for" sentence each tab opened with (Audit 80 B22).
 * A returning user already knows, and it pushed the answer ~120 px down on
 * a phone, so it shows on the first visit to that page only (remembered in
 * this browser). It renders nothing until mounted, so a return visit never
 * paints it and then removes it.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

export const INTRO_SEEN_PREFIX = 'rd_intro_seen_';

export function FirstVisitIntro({ id, children, style }: { id: string; children: ReactNode; style?: CSSProperties }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const k = INTRO_SEEN_PREFIX + id;
      if (!window.localStorage.getItem(k)) {
        setShow(true);
        window.localStorage.setItem(k, '1');
      }
    } catch {
      /* storage blocked: stay quiet */
    }
  }, [id]);
  if (!show) return null;
  return (
    <p data-testid={`intro-${id}`} style={style}>
      {children}
    </p>
  );
}

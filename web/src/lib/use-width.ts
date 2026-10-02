'use client';

import { useEffect, useState } from 'react';

/** Width of an element in CSS pixels, `fallback` until it has been measured.
 *  Pass the returned callback as the element's `ref`. */
export function useWidth(fallback: number): [number, (el: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(fallback);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [width, setEl];
}

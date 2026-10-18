/**
 * W7 (audit 80+, B5 / E10 / E13): measurements the visual-system tests
 * assert on, shared by e2e/visual-system.spec.ts and the before/after
 * report run (UI_METRICS_OUT=<file> writes them as JSON).
 *
 * - textStats: visible text characters by computed font size, the audit's
 *   crawl.cjs stats() (share of characters at or under 12px and under
 *   11px), plus the share of letters drawn in capitals (text-transform or
 *   all-caps source) and the share set in a monospace family.
 * - overflow: does the page scroll sideways (document wider than the
 *   viewport)?
 * - layout shift: the sum of layout-shift entries without recent input
 *   (the CLS the browser reports), from a buffered PerformanceObserver
 *   installed before the page's own scripts.
 */
import type { Page } from '@playwright/test';

export interface TextStats {
  chars: number;
  le12: number;
  lt11: number;
  caps: number;
  mono: number;
}

export async function textStats(page: Page): Promise<TextStats> {
  return page.evaluate(() => {
    const out = { chars: 0, le12: 0, lt11: 0, caps: 0, mono: 0, letters: 0 };
    const main = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n.textContent ?? '').replace(/\s+/g, '');
      if (!text) continue;
      const el = n.parentElement;
      if (!el) continue;
      if (el.closest('[aria-hidden="true"], .sr-only, script, style, noscript')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const size = parseFloat(cs.fontSize);
      const len = text.length;
      out.chars += len;
      if (size <= 12) out.le12 += len;
      if (size < 11) out.lt11 += len;
      if (/mono/i.test(cs.fontFamily.split(',')[0])) out.mono += len;
      const letters = text.replace(/[^A-Za-z]/g, '');
      out.letters += letters.length;
      if (cs.textTransform === 'uppercase') out.caps += letters.length;
      else out.caps += letters.replace(/[^A-Z]/g, '').length > 0 && letters === letters.toUpperCase() && letters.length >= 2 ? letters.length : 0;
    }
    const pct = (v: number, of: number) => (of ? Math.round((v / of) * 1000) / 10 : 0);
    return { chars: out.chars, le12: pct(out.le12, out.chars), lt11: pct(out.lt11, out.chars), caps: pct(out.caps, out.letters), mono: pct(out.mono, out.chars) };
  });
}

/** Wider than the viewport, by how many CSS px (0 = no sideways scroll). */
export async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

/** Call before page.goto: records layout shifts from the first paint. */
export async function watchLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __rdCls: number; __rdShifts: Array<{ v: number; t: number; src: string[] }> };
    w.__rdCls = 0;
    w.__rdShifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; startTime: number; sources?: Array<{ node?: Node | null }> }>) {
          if (e.hadRecentInput) continue;
          w.__rdCls += e.value;
          w.__rdShifts.push({
            v: Math.round(e.value * 1000) / 1000,
            t: Math.round(e.startTime),
            src: (e.sources ?? []).map((s) => {
              const el = s.node as Element | null | undefined;
              if (!el || !('tagName' in el)) return '?';
              return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''}`;
            }),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      /* layout-shift is Chromium-only */
    }
  });
}

export async function layoutShift(page: Page): Promise<{ cls: number; shifts: Array<{ v: number; t: number; src: string[] }> }> {
  return page.evaluate(() => {
    const w = window as unknown as { __rdCls?: number; __rdShifts?: Array<{ v: number; t: number; src: string[] }> };
    return { cls: Math.round((w.__rdCls ?? 0) * 1000) / 1000, shifts: w.__rdShifts ?? [] };
  });
}

/** Slow 4G and 4x CPU, as the audit's perf2.cjs (Chromium only). */
export async function throttle(page: Page): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    return true;
  } catch {
    return false;
  }
}

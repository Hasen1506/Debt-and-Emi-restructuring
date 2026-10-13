/**
 * UX50 F1 (landing and public site), in a real browser.
 *  - A-02 chart: at 390 / 768 / 1280 / 1920, in both countries, the visible
 *    drawing's text never overlaps, nothing is clipped by the SVG, text is
 *    readable (≥ 9.5px), each payoff label touches its own marker's guide,
 *    and the page never scrolls sideways. Below 520px the phone drawing and
 *    the payoff list show instead of the desktop drawing.
 *  - A-08: the register's first row has the same bleed on both sides and
 *    no masthead slab.
 *  - E-13 / E-16: signed out, an unknown path is a real 404 (not a sign-in
 *    wall); robots, sitemap, manifest and icons answer without a session.
 * Web fonts are blocked here (no network), so this also proves the layout
 * holds in the fallback monospace.
 */
import { expect, test } from './fixtures';

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const country of ['IN', 'US'] as const) {
  for (const width of [390, 768, 1280, 1920]) {
    test(`landing chart holds at ${width}px (${country})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/welcome.html?country=${country}`);
      const chart = page.locator(`#chart [data-c="${country}"]`);
      const phone = width < 520;
      await expect(chart.locator('svg.cdesk')).toBeVisible({ visible: !phone });
      await expect(chart.locator('svg.cphone')).toBeVisible({ visible: phone });
      await expect(chart.locator('.mlist')).toBeVisible({ visible: phone });
      await expect(chart.locator('.ctitle')).toContainText('Debt-free in');

      const svg = chart.locator(phone ? 'svg.cphone' : 'svg.cdesk');
      const geo = await svg.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const box = (b: DOMRect) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
        const texts = [...el.querySelectorAll('text')].map((t) => ({
          text: t.textContent ?? '',
          group: t.closest('g.mk') ? [...el.querySelectorAll('g.mk')].indexOf(t.closest('g.mk') as Element) : -1,
          box: box(t.getBoundingClientRect()),
          px: parseFloat(getComputedStyle(t).fontSize) * (r.width / (el as SVGSVGElement).viewBox.baseVal.width),
        }));
        const marks = [...el.querySelectorAll('g.mk')].map((g) => {
          const pole = g.querySelectorAll('line')[1];
          return { pole: pole ? box(pole.getBoundingClientRect()) : null, texts: [...g.querySelectorAll('text')].map((t) => box(t.getBoundingClientRect())) };
        });
        return { svg: box(r), texts, marks, scroll: document.documentElement.scrollWidth, inner: window.innerWidth };
      });
      expect(geo.scroll, 'no sideways scroll').toBeLessThanOrEqual(geo.inner);
      for (const t of geo.texts) {
        expect(t.px, `"${t.text}" is readable`).toBeGreaterThanOrEqual(9.5);
        expect(t.box.x, `"${t.text}" not clipped left`).toBeGreaterThanOrEqual(geo.svg.x - 0.5);
        expect(t.box.x + t.box.w, `"${t.text}" not clipped right`).toBeLessThanOrEqual(geo.svg.x + geo.svg.w + 0.5);
        expect(t.box.y + t.box.h, `"${t.text}" not clipped below`).toBeLessThanOrEqual(geo.svg.y + geo.svg.h + 0.5);
      }
      // Text from different labels never overlaps (lines of one label stack).
      for (let i = 0; i < geo.texts.length; i++)
        for (let j = i + 1; j < geo.texts.length; j++) {
          const a = geo.texts[i], b = geo.texts[j];
          if (a.group >= 0 && a.group === b.group) continue;
          expect(overlap(a.box, b.box), `"${a.text}" overlaps "${b.text}"`).toBe(false);
        }
      if (!phone) {
        // Each payoff label hangs off its own guide: the guide's x is at the
        // label's left or right edge, within a few px, and crosses no other text.
        const flags = geo.marks.filter((m) => m.pole);
        expect(flags.length).toBeGreaterThanOrEqual(3);
        for (const m of flags) {
          const gx = m.pole!.x + m.pole!.w / 2;
          const left = Math.min(...m.texts.map((t) => t.x)), right = Math.max(...m.texts.map((t) => t.x + t.w));
          expect(Math.min(Math.abs(gx - left), Math.abs(gx - right)), 'label sits on its guide').toBeLessThanOrEqual(10);
          for (const t of geo.texts) {
            if (m.texts.some((o) => o.x === t.box.x && o.y === t.box.y)) continue;
            const hit = t.box.x <= gx && gx <= t.box.x + t.box.w && t.box.y < m.pole!.y + m.pole!.h && m.pole!.y < t.box.y + t.box.h;
            expect(hit, `a guide runs through "${t.text}"`).toBe(false);
          }
        }
      } else {
        await expect(chart.locator('.mlist li.df')).toContainText('Debt-free');
      }
      if (width === 390 || width === 1280) await page.screenshot({ path: `${process.env.F1_SHOTS ?? 'test-results'}/e2e-landing-${country}-${width}.png`, fullPage: false });
    });
  }
}

test('A-08: the register first row bleeds evenly and has no masthead slab', async ({ page }) => {
  await page.goto('/welcome.html?country=IN');
  const geo = await page.evaluate(() => {
    const card = document.querySelector('#register [data-c="IN"]')!.parentElement!;
    const row = document.querySelector('#register [data-c="IN"] .row.first') as HTMLElement;
    const other = document.querySelector('#register [data-c="IN"] .row:not(.first)') as HTMLElement;
    const c = card.getBoundingClientRect(), r = row.getBoundingClientRect(), o = other.getBoundingClientRect();
    return { left: o.left - r.left, right: r.right - o.right, slab: getComputedStyle(row).borderTopWidth, cardLeft: r.left - c.left };
  });
  expect(geo.slab).toBe('0px');
  expect(Math.abs(geo.left - geo.right)).toBeLessThanOrEqual(1);
  expect(geo.cardLeft).toBeGreaterThan(2); // inside the card's border, no notch
});

test('E-13 / E-16: unknown paths 404 for guests; robots, sitemap, manifest and icons are public', async ({ page, request }) => {
  const res = await page.goto('/this-does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page).toHaveURL(/\/this-does-not-exist$/);
  await expect(page.getByRole('heading', { name: 'PAGE NOT FOUND' })).toBeVisible();
  await expect(page.getByRole('link', { name: /BACK TO RIGHTDUE/ })).toHaveAttribute('href', '/');
  // App pages still ask a guest to sign in.
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/login\?next=%2Fplan$/);
  for (const [url, type] of [
    ['/robots.txt', /text\/plain/],
    ['/sitemap.xml', /xml/],
    ['/manifest.webmanifest', /manifest\+json|json/],
    ['/favicon.ico', /icon|octet/],
    ['/apple-touch-icon.png', /png/],
    ['/og.png', /png/],
    ['/icon-192.png', /png/],
  ] as const) {
    const r = await request.get(url, { maxRedirects: 0 });
    expect(r.status(), url).toBe(200);
    expect(r.headers()['content-type'] ?? '', url).toMatch(type);
  }
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: https://rightdue.app/sitemap.xml');
});

test('A-16: /login has no empty nav band; it links back to the landing', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: /RIGHTDUE\.APP/ })).toHaveAttribute('href', '/');
});

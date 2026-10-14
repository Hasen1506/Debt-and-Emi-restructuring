/**
 * CI FLAKES 2 (2026-10-14): a figure typed before the page hydrates is kept.
 *
 * WebKit's live-test-findings L#19 sometimes waited 120 s for
 * "I DID THIS · LOG IT": Playwright filled "Amount, after tax" into the
 * server-rendered box before React hydrated it, so no onChange ran, the
 * amount state stayed '', and the next re-render emptied the box (the failure
 * snapshot showed the box focused and empty). A person typing on a slow phone
 * lost the number the same way. Field now adopts what was typed on mount
 * (components/ToolPrimitives.tsx).
 *
 * This holds the page's scripts until the amount is typed, so the box is
 * filled before hydration every time, not just when WebKit is slow.
 */
import { expect, test } from './fixtures';
import { setUpPersona } from './persona';

test('a figure typed before the page hydrates is kept (spare cash, CI FLAKES 2)', async ({ page }) => {
  await setUpPersona(page, 'golden-ci-flakes2@rightdue.app');

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const chunks = '**/_next/static/chunks/**';
  await page.route(chunks, async (route) => {
    await gate;
    await route.continue();
  });
  // Next's scripts are async, so the server-rendered form is there at
  // DOMContentLoaded while hydration waits on the held chunks.
  await page.goto('/tools/windfall', { waitUntil: 'domcontentloaded' });
  const box = page.getByLabel('Amount, after tax');
  await box.fill('50000');
  release();
  await page.unroute(chunks);

  // Hydrated and kept: the box regroups the digits, the split is worked out
  // and the log button shows.
  await expect(box).toHaveValue('50,000');
  await page.getByRole('button', { name: /I DID THIS · LOG IT/ }).click();
  await expect(page.getByText("Got another ₹50,000? Here's where it would go next")).toBeVisible();
});

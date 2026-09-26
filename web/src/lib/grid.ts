/**
 * Grid columns that stay side by side on wide screens and stack on phones.
 *
 * Up to `n` equal columns; a column never gets narrower than `minPx`, so on
 * a 390 px phone a 3-up row becomes 1 or 2 rows instead of pushing the page
 * sideways. `gapPx` should be at least the grid's gap, or one fewer column
 * than `n` fits on wide screens.
 */
export function fitColumns(n: number, minPx: number, gapPx = 16): string {
  if (n <= 1) return 'minmax(0, 1fr)';
  return `repeat(auto-fit, minmax(min(100%, max(${minPx}px, calc((100% - ${(n - 1) * gapPx}px) / ${n}))), 1fr))`;
}

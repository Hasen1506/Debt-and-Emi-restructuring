/**
 * The three payoff strategies as personas (design/strategy-personas, archived: docs/ARCHIVE.md).
 *
 * The art is authored once, in public/art/personas.svg: a 480×240 scene
 * per strategy (the Profile cards, drawn at their 2:1) and a 40×40
 * medallion (the masthead). Each piece here points into that file, so
 * the browser fetches it once.
 *
 * Persona colours stay inside the art; the rest of the app stays Ledger.
 */
import type { StrategyName } from '@/lib/strategy';

const ART = '/art/personas.svg';

export interface PersonaInfo {
  name: string;
  /** Two or three words under the name, in capitals. */
  tag: string;
  /** Who's in the picture. */
  figure: string;
  /** How it orders the debts, as the engine does it. */
  rule: string;
  /** What it feels like to follow. */
  feel: string;
}

export const PERSONA: Record<StrategyName, PersonaInfo> = {
  avalanche: {
    name: 'Avalanche',
    // Plain words under the name (sprint G10, grill #78).
    tag: 'CHEAPEST PATH',
    figure: 'Sisyphus pushing a boulder up to the summit',
    // The engine orders by what the next payment saves (marginal cost),
    // which is the highest rate unless a fee, tax break or lock-in changes it.
    rule: 'Where extra money saves the most interest first: usually the highest rate.',
    feel: 'The hard climb, and the least interest.',
  },
  rules: {
    name: 'Your rules',
    tag: 'YOUR OWN ORDER',
    figure: 'Atlas on the ridge, a boulder in one hand and a snowball in the other',
    rule: 'Your own order: pinned loans, small balances, then the highest rate.',
    feel: 'Your call, with its cost against Avalanche shown.',
  },
  snowball: {
    name: 'Snowball',
    tag: 'SMALLEST FIRST',
    figure: 'A snowball let go at the top, growing as it rolls downhill',
    rule: 'Smallest balance first.',
    feel: 'Debts close sooner; it costs more interest.',
  },
};

/** The full scene; a box that isn't 2:1 crops it rather than letterboxing. */
export function PersonaScene({ strategy, height = 160 }: { strategy: StrategyName; height?: number | string }) {
  return (
    <svg
      viewBox="0 0 480 240"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={PERSONA[strategy].figure}
      style={{ display: 'block', width: '100%', height }}
    >
      <use href={`${ART}#scene-${strategy}`} width="480" height="240" />
    </svg>
  );
}

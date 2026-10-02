/**
 * The three payoff strategies as personas (design/strategy-personas).
 *
 * The art is authored once, in public/art/personas.svg: a 480×320 scene
 * per strategy (the Profile triptych), a 40×40 medallion (the masthead)
 * and a 24×24 glyph. Each piece here points into that file, so the
 * browser fetches it once and every size draws the same picture.
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
    tag: 'UPHILL',
    figure: 'Sisyphus, pushing uphill',
    rule: 'Highest rate first.',
    feel: 'The hard climb, and the least interest.',
  },
  hybrid: {
    name: 'Hybrid',
    tag: 'THE RIDGE',
    figure: 'Atlas at the ridge',
    rule: 'Small balances first for a quick win, then the highest rate.',
    feel: 'A win early, then the maths.',
  },
  snowball: {
    name: 'Snowball',
    tag: 'DOWNHILL',
    figure: 'A boulder rolling downhill',
    rule: 'Smallest balance first.',
    feel: 'Debts close sooner; it costs more interest.',
  },
};

/** The full scene, cropped to fill its box. */
export function PersonaScene({ strategy, height = 160 }: { strategy: StrategyName; height?: number | string }) {
  return (
    <svg
      viewBox="0 0 480 320"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={PERSONA[strategy].figure}
      style={{ display: 'block', width: '100%', height }}
    >
      <use href={`${ART}#scene-${strategy}`} width="480" height="320" />
    </svg>
  );
}

/** The small square scene for the masthead. */
export function PersonaMedallion({ strategy, size = 40 }: { strategy: StrategyName; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden style={{ display: 'block', flex: 'none' }}>
      <use href={`${ART}#med-${strategy}`} width="40" height="40" />
    </svg>
  );
}

/** A one-colour icon (takes the text colour). */
export function PersonaGlyph({ strategy, size = 24 }: { strategy: StrategyName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: 'block', flex: 'none' }}>
      <use href={`${ART}#glyph-${strategy}`} width="24" height="24" />
    </svg>
  );
}

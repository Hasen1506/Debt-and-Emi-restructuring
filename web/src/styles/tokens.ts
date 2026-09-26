/**
 * Design tokens — extends the existing mobile wireframe palette.
 * Source: wireframes-home.html :root variables.
 *
 * Used by Tailwind-free CSS (CSS variables) and any chart code that needs
 * to pull from the same palette as the layout.
 */

export const tokens = {
  color: {
    ink: '#1a1a1a',
    muted: '#6b6b6b',
    soft: '#9a9a9a',
    border: '#cfcfcf',
    dash: '#b8b8b8',
    card: '#ffffff',
    canvas: '#f0eee9',
    accent: '#ab4f30',            // warm terracotta (darkened for 4.5:1 text contrast) — primary CTA + key chart line
    accentMuted: '#e8a892',
    positive: '#2d6a4f',          // savings / good news
    negative: '#a23b3b',           // high-rate debt / warning
    softBg: '#f3efe9',
    calmBg: '#ffffff',
    overwhelmedBg: '#faf6f0',     // alternate mode background (more cards / dense info)
  },
  font: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '14px',
    pill: '999px',
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '14px',
    lg: '18px',
    xl: '24px',
    '2xl': '32px',
  },
  shadow: {
    card: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.05)',
    elev: '0 4px 12px rgba(0,0,0,0.06)',
  },
  // Chart-specific palette (Visx)
  chart: {
    primary: '#ab4f30',
    secondary: '#2d6a4f',
    tertiary: '#6b6b6b',
    grid: 'rgba(0,0,0,0.08)',
    axis: '#9a9a9a',
    text: '#1a1a1a',
    series: ['#ab4f30', '#2d6a4f', '#3b6ea2', '#a23b3b', '#7a5d3a', '#5a4a2a'],
  },
} as const;

export type Tokens = typeof tokens;

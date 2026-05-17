import type { ThemeName } from './theme';

/**
 * Single source of truth for primary nav structure across themes. Routes,
 * order, and item count are identical for every theme — only the visible
 * label changes so each theme keeps its voice without shifting the user's
 * mental map. Edit here, every header picks it up.
 */

export interface NavItem {
  route: string;
  labels: Record<ThemeName, string>;
}

// Top-level nav restructure: Home → Snapshot (the / route becomes the
// at-a-glance landing instead of a generic home), Debts is dropped from
// nav (still reachable via direct URL — managed inside Portfolio + Plan),
// Portfolio is added as a real top-level tab so the assets surface isn't
// buried under /onboarding, and Setup → Settings to read as ongoing
// preferences rather than a one-time wizard.
export const NAV_ITEMS: readonly NavItem[] = [
  { route: '/',           labels: { editorial: 'The view',    ledger: 'SNAPSHOT',  existing: 'Snapshot'  } },
  { route: '/plan',       labels: { editorial: 'The path',    ledger: 'PLAN',      existing: 'Plan'      } },
  { route: '/tools',      labels: { editorial: 'Decisions',   ledger: 'TOOLS',     existing: 'Tools'     } },
  { route: '/portfolio',  labels: { editorial: 'Holdings',    ledger: 'PORTFOLIO', existing: 'Portfolio' } },
  { route: '/insights',   labels: { editorial: 'Archive',     ledger: 'INSIGHTS',  existing: 'Insights'  } },
  { route: '/onboarding', labels: { editorial: 'Preferences', ledger: 'SETTINGS',  existing: 'Settings'  } },
];

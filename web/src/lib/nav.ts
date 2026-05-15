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

export const NAV_ITEMS: readonly NavItem[] = [
  { route: '/',           labels: { editorial: 'The letter',  ledger: 'LEDGER',   existing: 'Home'     } },
  { route: '/plan',       labels: { editorial: 'The path',    ledger: 'PLAN',     existing: 'Plan'     } },
  { route: '/debts',      labels: { editorial: 'Your debts',  ledger: 'DEBTS',    existing: 'Debts'    } },
  { route: '/tools',      labels: { editorial: 'Decisions',   ledger: 'TOOLS',    existing: 'Tools'    } },
  { route: '/insights',   labels: { editorial: 'Archive',     ledger: 'INSIGHTS', existing: 'Insights' } },
  { route: '/onboarding', labels: { editorial: 'Setup',       ledger: 'SETUP',    existing: 'Setup'    } },
];

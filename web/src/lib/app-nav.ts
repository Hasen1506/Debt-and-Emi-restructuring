/**
 * The app's navigation (audit 80+ B26 / A20, founder's decision 14 Oct
 * 2026: keep every feature — RightDue is a finance super-app — but
 * declutter).
 *
 * Four core tabs, one per reason to open the app most weeks: what to pay
 * (Home), when am I done / what if (Plan), what happened (Activity), my
 * details (Profile). Everything else sits behind one "More" button:
 * Goals & tools, Assets & tax (Portfolio and Tax merged into one section),
 * advance tax, each tool, Can't pay, the glossary and your data. NRI tools
 * show only for someone who said they live in the US with loans in India
 * (lib/tools.ts toolsFor). Pages that aren't tabs light up the tab they
 * belong to; every page under More lights More.
 */
import type { Country } from './api';
import { isToolPage } from './nav-trail';
import { toolsFor } from './tools';

export type LedgerSection = 'home' | 'plan' | 'activity' | 'profile' | 'more';

export interface NavLink {
  label: string;
  href: string;
  /** One line under the link in the More menu. */
  sub?: string;
}

export const CORE_TABS: Array<NavLink & { key: Exclude<LedgerSection, 'more'> }> = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'plan', label: 'Plan', href: '/plan' },
  { key: 'activity', label: 'Activity', href: '/activity' },
  { key: 'profile', label: 'Profile', href: '/profile' },
];

/** Portfolio and Tax are one section: "Assets & tax" (Vijay, 14 Oct 2026). */
export const ASSETS_TAX_TABS: NavLink[] = [
  { label: 'What you own', href: '/portfolio' },
  { label: 'Tax', href: '/tax' },
];

export interface MoreGroup {
  title: string;
  links: NavLink[];
}

export interface NavUser {
  country: Country;
  is_nri_us?: boolean;
}

/** What the More menu holds for this person, in groups. */
export function moreGroups(user: NavUser): MoreGroup[] {
  const india = user.country === 'IN';
  return [
    {
      title: 'Money',
      links: [
        { label: 'Goals & tools', href: '/goals', sub: 'What you’re saving for, and how much goes to it' },
        { label: 'Assets & tax', href: '/portfolio', sub: 'What you own, and tax on your loans' },
        { label: 'Advance tax', href: '/plan#advance-tax-h', sub: india ? 'Instalments for income without TDS' : 'Quarterly estimated tax' },
      ],
    },
    {
      title: 'Tools',
      links: [
        ...toolsFor(user).map((t) => ({ label: t.name, href: t.href, sub: t.question })),
        // Audit 80+ A19 (W4): the public page on the RBI's latest repo decision; India only.
        ...(india ? [{ label: 'RBI rate decision', href: '/rbi-decision', sub: 'What the latest repo move does to your EMI' }] : []),
      ],
    },
    {
      title: 'Help',
      links: [
        { label: 'Can’t pay this month', href: '/cant-pay', sub: india ? 'Your rights and a letter to the bank' : 'What to ask your lender' },
        { label: 'Glossary', href: '/glossary', sub: 'Plain words for loan terms' },
        { label: 'Your data', href: '/account', sub: 'Download or delete it' },
      ],
    },
  ];
}

export function sectionFromPath(path: string): LedgerSection | null {
  const p = path.split(/[?#]/)[0];
  if (p.startsWith('/plan')) return 'plan';
  if (p.startsWith('/activity')) return 'activity';
  if (
    p.startsWith('/goals') ||
    p.startsWith('/rbi-decision') ||
    p === '/tools' ||
    isToolPage(p) ||
    p.startsWith('/portfolio') ||
    p.startsWith('/profile/assets') ||
    p.startsWith('/tax') ||
    p.startsWith('/cant-pay') ||
    p.startsWith('/glossary') ||
    p.startsWith('/account')
  ) {
    return 'more';
  }
  if (p.startsWith('/onboarding') || p.startsWith('/profile')) return 'profile';
  if (p === '/' || p === '') return 'home';
  // A page outside the app (e.g. /login, a 404) lights no tab.
  return null;
}

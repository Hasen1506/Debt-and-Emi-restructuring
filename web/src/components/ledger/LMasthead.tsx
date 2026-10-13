'use client';

/**
 * LMasthead — the page-top slab + nav row.
 *
 * Per spec §3:
 *  - 6px ink top slab
 *  - row 1: RightDue wordmark + today's date and time
 *  - ASCII rule
 *  - row 2: bracketed nav, locale pin on the right
 *  - ASCII rule
 *
 * `section` highlights the active nav item.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LRule, LBracket, L_T, L_MONO } from './primitives';
import { getCountryToday } from '@/lib/today';
import { SessionIndicator } from '@/components/chrome/SessionIndicator';
import { StrategyMedallion } from '@/components/personas/StrategyMedallion';
import type { Country } from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import { isToolPage, recordPage } from '@/lib/nav-trail';

export type LedgerSection = 'home' | 'plan' | 'activity' | 'goals' | 'portfolio' | 'profile';

// Six tabs, one per reason to open the app: what to pay (Home), when am
// I done / what if (Plan), what happened (Activity), something came up
// (Goals & Tools), what I own (Portfolio, its own tab since sprint G10:
// the founder kept it as part of the finance super-app), my details
// (Profile). Pages that aren't tabs light up the tab they belong to.
export const NAV: Array<[label: string, key: LedgerSection, href: string]> = [
  ['HOME', 'home', '/'],
  ['PLAN', 'plan', '/plan'],
  ['ACTIVITY', 'activity', '/activity'],
  ['GOALS & TOOLS', 'goals', '/goals'],
  ['PORTFOLIO', 'portfolio', '/portfolio'],
  ['PROFILE', 'profile', '/profile'],
];

export function sectionFromPath(path: string): LedgerSection | null {
  if (path.startsWith('/plan')) return 'plan';
  if (path.startsWith('/activity')) return 'activity';
  if (path.startsWith('/goals') || path === '/tools' || isToolPage(path)) return 'goals';
  // What you own, and the form that adds to it.
  if (path.startsWith('/portfolio') || path.startsWith('/profile/assets')) return 'portfolio';
  if (
    path.startsWith('/onboarding') ||
    path.startsWith('/profile') ||
    path.startsWith('/tax')
  ) {
    return 'profile';
  }
  if (path === '/' || path === '') return 'home';
  // A page outside the app (e.g. /login, a 404) lights no tab.
  return null;
}

/** Pages a signed-out visitor sees: the app's own menu, payoff-strategy
 *  switch and country pin are hidden there (live QA BUG-3/4/8). */
export function isSignedOutPage(path: string): boolean {
  return path === '/login' || path.startsWith('/login/') || path === '/welcome.html';
}

function stamp(country: Country): string {
  const d = getCountryToday(country);
  return d
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    .toUpperCase();
}

function tzLabel(country: Country): string {
  return country === 'IN' ? 'IST' : 'ET';
}

function timeNow(country: Country): string {
  const tz = country === 'IN' ? 'Asia/Kolkata' : 'America/New_York';
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** `strategy` shows the payoff strategy's medallion; left out when
 *  there is no debt to order. */
export function LMasthead({
  country,
  strategy,
  sameOrder,
}: {
  country: Country;
  strategy?: StrategyName | null;
  /** The one order all three strategies pay the debts in, when they agree. */
  sameOrder?: string[] | null;
}) {
  const path = usePathname() || '/';
  const section = sectionFromPath(path);
  const signedOutPage = isSignedOutPage(path);
  const [time, setTime] = useState<string>('');
  // Remembers this page so the next one can offer a way back to it.
  useEffect(() => {
    recordPage(path + window.location.search);
  }, [path]);
  useEffect(() => {
    setTime(timeNow(country));
    const t = setInterval(() => setTime(timeNow(country)), 60_000);
    return () => clearInterval(t);
  }, [country]);

  // Which country's tax and rates the plan uses; Profile changes it.
  const localePin = country === 'IN' ? 'INDIA · ₹' : 'USA · $';

  return (
    <header
      style={{
        borderTop: `6px solid ${L_T.ink}`,
        padding: '14px clamp(16px, 4vw, 32px) 0',
        background: L_T.bg,
        fontFamily: L_MONO,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.18em',
          }}
        >
          RightDue
        </div>
        <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.1em' }}>
          {stamp(country)} · {time || '--:--'} {tzLabel(country)}
        </div>
      </div>
      <div style={{ margin: '8px 0 0' }}>
        <LRule length={300} />
      </div>
      <nav
        aria-label="Main"
        style={{
          display: 'flex',
          gap: 'clamp(8px, 2.4vw, 22px)',
          padding: '8px 0',
          // Wraps rather than scrolls: a scrolling row clipped the
          // strategy medallion's menu.
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {!signedOutPage && NAV.map(([label, key, href]) => (
          <LBracket
            key={key}
            active={section === key}
            current={section === key}
            href={href}
            style={{ letterSpacing: 'var(--nav-tracking, 0.14em)' }}
          >
            {label}
          </LBracket>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
          {!signedOutPage && strategy && <StrategyMedallion strategy={strategy} sameOrder={sameOrder ?? null} />}
          {!signedOutPage && (
            <LBracket href="/profile?step=country" label={`Country: ${country === 'IN' ? 'India' : 'USA'}. Change it in Profile`}>{localePin}</LBracket>
          )}
          {/* On /login itself a "[SIGN IN]" link would point at this page. */}
          {path !== '/login' && <SessionIndicator />}
        </span>
      </nav>
      <LRule length={300} />
    </header>
  );
}

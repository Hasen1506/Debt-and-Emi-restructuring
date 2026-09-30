'use client';

/**
 * LMasthead — the page-top slab + nav row.
 *
 * Per spec §3:
 *  - 6px ink top slab
 *  - row 1: RightDue / LEDGER wordmark + STMT timestamp
 *  - ASCII rule
 *  - row 2: bracketed nav, locale pin on the right
 *  - ASCII rule
 *
 * `section` highlights the active nav item. `stmt` is the per-screen
 * statement number — defaults to #1138 (Home); other screens pass
 * #1138-PLAN, §8a-WINDFALL, etc.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LRule, LBracket, L_T, L_MONO } from './primitives';
import { getCountryToday } from '@/lib/today';
import { SessionIndicator } from '@/components/chrome/SessionIndicator';
import type { Country } from '@/lib/api';

export type LedgerSection =
  | 'home'
  | 'plan'
  | 'debts'
  | 'tools'
  | 'insights'
  | 'setup'
  | 'goals'
  | 'portfolio'
  | 'decisions';

// Every top-level page is one click away. Goals and Portfolio had no
// link here, and "LEDGER" / "NOTES" named the skin, not the page.
const NAV: Array<[label: string, key: LedgerSection, href: string]> = [
  ['HOME', 'home', '/'],
  ['PLAN', 'plan', '/plan'],
  ['DEBTS', 'debts', '/debts'],
  ['GOALS', 'goals', '/goals'],
  ['PORTFOLIO', 'portfolio', '/portfolio'],
  ['TOOLS', 'tools', '/tools'],
  ['ACTIVITY', 'insights', '/insights'],
  ['SETUP', 'setup', '/onboarding'],
];

function sectionFromPath(path: string): LedgerSection {
  if (path === '/' || path === '') return 'home';
  if (path.startsWith('/plan')) return 'plan';
  if (path.startsWith('/debts')) return 'debts';
  if (path.startsWith('/tools')) return 'tools';
  if (path.startsWith('/insights')) return 'insights';
  if (path.startsWith('/onboarding')) return 'setup';
  if (path.startsWith('/goals')) return 'goals';
  if (path.startsWith('/portfolio')) return 'portfolio';
  if (path.startsWith('/decisions')) return 'decisions';
  return 'home';
}

function stmtFromPath(path: string): string {
  if (path === '/' || path === '') return '#1138';
  if (path.startsWith('/plan')) return '#1138-PLAN';
  if (path.startsWith('/debts')) return '#1138-DEBTS';
  if (path.startsWith('/insights')) return '#1138-NOTES';
  if (path.startsWith('/onboarding')) return '#SETUP';
  if (path.startsWith('/tools/')) {
    const slug = path.split('/')[2]?.toUpperCase() ?? '';
    return slug ? `§${slug}` : '#TOOLS';
  }
  if (path.startsWith('/tools')) return '#TOOLS';
  if (path.startsWith('/goals')) return '#1138-GOALS';
  if (path.startsWith('/portfolio')) return '#1138-HOLD';
  if (path.startsWith('/decisions')) return '#1138-DEC';
  return '#1138';
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

export function LMasthead({ country }: { country: Country }) {
  const path = usePathname() || '/';
  const section = sectionFromPath(path);
  const stmt = stmtFromPath(path);
  const [time, setTime] = useState<string>('');
  useEffect(() => {
    setTime(timeNow(country));
    const t = setInterval(() => setTime(timeNow(country)), 60_000);
    return () => clearInterval(t);
  }, [country]);

  const localePin = country === 'IN' ? 'IN · ₹' : 'US · $';

  return (
    <header
      style={{
        borderTop: `6px solid ${L_T.ink}`,
        padding: '14px 32px 0',
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
          <span style={{ color: L_T.muted, fontWeight: 400 }}> / LEDGER</span>
        </div>
        <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.1em' }}>
          {stamp(country)} · {time || '--:--'} {tzLabel(country)} · STMT {stmt}
        </div>
      </div>
      <div style={{ margin: '8px 0 0' }}>
        <LRule length={300} />
      </div>
      <nav
        aria-label="Main"
        style={{
          display: 'flex',
          gap: 22,
          padding: '8px 0',
          overflowX: 'auto',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {NAV.map(([label, key, href]) => (
          <LBracket key={key} active={section === key} href={href}>
            {label}
          </LBracket>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <LBracket>{localePin}</LBracket>
          <SessionIndicator />
        </span>
      </nav>
      <LRule length={300} />
    </header>
  );
}

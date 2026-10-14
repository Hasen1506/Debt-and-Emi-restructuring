'use client';

/**
 * LMasthead — the page-top slab + nav row.
 *
 * Per spec §3:
 *  - 6px ink top slab
 *  - row 1: RightDue wordmark + today's date and time
 *  - ASCII rule
 *  - row 2: bracketed nav, payoff order, locale pin on the right
 *  - ASCII rule
 *
 * Audit 80+ B26 / A20 (founder's decision 14 Oct 2026): four core tabs
 * (Home, Plan, Activity, Profile) and a "+ More" button that opens the
 * rest (lib/app-nav.ts). B20: the payoff order is a labelled text control
 * (PayoffOrderSwitch), not the persona medallion.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LRule, LBracket, L_T, L_MONO } from './primitives';
import { getCountryToday } from '@/lib/today';
import { SessionIndicator } from '@/components/chrome/SessionIndicator';
import { PayoffOrderSwitch } from '@/components/chrome/PayoffOrderSwitch';
import type { Country } from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import { recordPage } from '@/lib/nav-trail';
import { CORE_TABS, moreGroups, sectionFromPath, type NavUser } from '@/lib/app-nav';

export { sectionFromPath } from '@/lib/app-nav';
export type { LedgerSection } from '@/lib/app-nav';

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

const TAB_STYLE = { fontSize: 13, letterSpacing: 'var(--nav-tracking, 0.12em)', textTransform: 'uppercase' } as const;

/** `strategy` shows the payoff order switch; left out when there is no
 *  debt to order. */
export function LMasthead({
  country,
  strategy,
  sameOrder,
  navUser,
}: {
  country: Country;
  strategy?: StrategyName | null;
  /** The one order all three strategies pay the debts in, when they agree. */
  sameOrder?: string[] | null;
  /** What decides the More menu's tools (country, NRI). */
  navUser?: NavUser;
}) {
  const path = usePathname() || '/';
  const section = sectionFromPath(path);
  const signedOutPage = isSignedOutPage(path);
  const [time, setTime] = useState<string>('');
  // Live re-test 2 NEW-17: on a phone the nav, strategy, country and
  // sign-in sit behind one MENU button, so the header is one row (it was
  // 204 px and four rows at 390). Closes on navigation and on Escape.
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
  }, [path]);
  useEffect(() => {
    if (!menuOpen && !moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (moreOpen) {
        setMoreOpen(false);
        document.getElementById('rd-more-button')?.focus();
      } else {
        setMenuOpen(false);
        document.getElementById('rd-menu-button')?.focus();
      }
    };
    const away = (e: MouseEvent) => {
      if (moreOpen && moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', away);
    };
  }, [menuOpen, moreOpen]);
  const hasMenu = !signedOutPage;
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
  const groups = moreGroups(navUser ?? { country });

  return (
    <header
      className="rd-masthead"
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
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.18em',
          }}
        >
          RightDue
        </div>
        <div className="rd-mh-stamp" style={{ fontSize: 'var(--fs-label)', color: L_T.muted, letterSpacing: '0.1em' }}>
          {stamp(country)} · {time || '--:--'} {tzLabel(country)}
        </div>
        {hasMenu && (
          <button
            id="rd-menu-button"
            type="button"
            className="rd-mh-menu"
            aria-expanded={menuOpen}
            aria-controls="rd-main-nav"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              fontFamily: L_MONO,
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              background: 'transparent',
              border: 'none',
              color: L_T.ink,
              padding: '6px 0 6px 8px',
              minHeight: 32,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">[{menuOpen ? '✕ ' : '☰ '}</span>
            {menuOpen ? 'Close' : 'Menu'}
            <span aria-hidden="true">]</span>
          </button>
        )}
      </div>
      {/* Live re-test 3 R3-5: !important on align-items, or the nav's inline
          alignItems:center wins and centres the page links in the open menu. */}
      <style>{`.rd-mh-menu{display:none}
.rd-more-panel{position:absolute;top:calc(100% + 6px);left:0;z-index:40;width:min(680px,calc(100vw - 32px));background:${L_T.bg};border:1.5px solid ${L_T.ink};box-shadow:4px 4px 0 ${L_T.ink};padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px 22px}
.rd-more-panel[hidden]{display:none !important}
.rd-more-panel a{display:block;color:${L_T.ink};text-decoration:none;padding:4px 0}
.rd-more-panel a:hover .rd-more-name{text-decoration:underline;text-decoration-color:${L_T.accent}}
@media (max-width: 640px){
  .rd-masthead{padding-top:8px !important}
  .rd-mh-stamp,.rd-mh-rule1{display:none !important}
  .rd-mh-menu{display:inline-block}
  .rd-mh-nav[data-menu="true"]{display:none !important}
  .rd-mh-nav[data-menu="true"][data-open="true"]{display:flex !important;flex-direction:column !important;align-items:stretch !important;gap:0 !important}
  .rd-mh-nav[data-open="true"] > a.l-hit,.rd-mh-nav[data-open="true"] .rd-more > button{display:block !important;width:100%;text-align:left;padding:12px 0 !important;font-size:15px !important;border-bottom:1px solid var(--rule-soft, #d8d6cd) !important}
  .rd-more-panel{position:static;width:100%;box-shadow:none;border:none;border-bottom:1px solid var(--rule-soft, #d8d6cd);padding:8px 0 12px 12px;grid-template-columns:1fr}
  .rd-mh-nav[data-open="true"] .rd-mh-extras{margin-left:0 !important;justify-content:flex-start !important;padding-top:12px;gap:12px !important}
  .rd-mh-nav[data-open="true"] .rd-session-who{max-width:100% !important;white-space:normal !important;overflow-wrap:anywhere;flex-basis:100%}
}`}</style>
      <div className="rd-mh-rule1" style={{ margin: '8px 0 0' }}>
        <LRule length={300} />
      </div>
      <nav
        id="rd-main-nav"
        aria-label="Main"
        className="rd-mh-nav"
        data-menu={hasMenu ? 'true' : 'false'}
        data-open={menuOpen ? 'true' : 'false'}
        style={{
          display: 'flex',
          gap: 'clamp(8px, 2.4vw, 22px)',
          padding: '8px 0',
          // Wraps rather than scrolls: a scrolling row clipped the menus.
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {/* UX50 A-16: /login had an empty band between two rules; it now
            holds the way back to the landing. */}
        {/* No prefetch: a signed-out prefetch of / is the landing rewrite,
            which sets the landing's country cookie after sign-out. */}
        {path === '/login' && <LBracket href="/" prefetch={false}>← RIGHTDUE.APP</LBracket>}
        {!signedOutPage &&
          CORE_TABS.map((t) => (
            <LBracket key={t.key} active={section === t.key} current={section === t.key} href={t.href} style={TAB_STYLE}>
              {t.label}
            </LBracket>
          ))}
        {!signedOutPage && (
          <div ref={moreRef} className="rd-more" style={{ position: 'relative' }}>
            <button
              id="rd-more-button"
              type="button"
              aria-expanded={moreOpen}
              aria-controls="rd-more-panel"
              data-current={section === 'more' ? 'true' : 'false'}
              onClick={() => setMoreOpen((v) => !v)}
              className="l-hit"
              style={{
                fontFamily: L_MONO,
                ...TAB_STYLE,
                color: section === 'more' ? L_T.ink : L_T.muted,
                fontWeight: section === 'more' ? 700 : 500,
                textDecoration: section === 'more' ? 'underline' : 'none',
                textUnderlineOffset: 4,
                textDecorationColor: L_T.accent,
                textDecorationThickness: 2,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}
            >
              <span aria-hidden="true">[+ </span>
              More
              <span aria-hidden="true">{moreOpen ? ' ▴]' : ' ▾]'}</span>
            </button>
            <div id="rd-more-panel" className="rd-more-panel" hidden={!moreOpen}>
              {groups.map((g) => (
                <section key={g.title} aria-labelledby={`rd-more-${g.title}`}>
                  <h2
                    id={`rd-more-${g.title}`}
                    style={{ margin: '0 0 4px', fontSize: 'var(--fs-label)', letterSpacing: '0.12em', textTransform: 'uppercase', color: L_T.muted, fontWeight: 600 }}
                  >
                    {g.title}
                  </h2>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {g.links.map((l) => (
                      <li key={l.href + l.label}>
                        <Link href={l.href} aria-current={path === l.href.split('#')[0] ? 'page' : undefined}>
                          <span className="rd-more-name" style={{ display: 'block', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                            {l.label}
                          </span>
                          {l.sub && (
                            <span style={{ display: 'block', fontSize: 'var(--fs-small)', color: L_T.muted, fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>{l.sub}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
        <span className="rd-mh-extras" style={{ marginLeft: 'auto', display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
          {!signedOutPage && strategy && <PayoffOrderSwitch strategy={strategy} sameOrder={sameOrder ?? null} />}
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

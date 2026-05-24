'use client';

/**
 * Ledger Notes — the engine's commentary, newspaper-column style.
 *
 * Pulls a handful of derived notes from the saved profile + activity log
 * (no engine round-trip). Each entry: metadata strip (NO. · DATE ·
 * eyebrow · tags), 20px caps title, 12px body, [OPEN FULL NOTE →]
 * bracket. Dashed dividers between entries.
 *
 * The activity ledger (where users log "I paid X to Kotak") still lives
 * below these notes — Notes is read-only commentary, ActivityLedger is
 * the input surface. The deep-link from BudgetMonthCard
 * (/insights#activity-ledger) lands directly on it.
 */

import { useMemo } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import type { StrategyName } from '@/lib/strategy';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { formatCurrency } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { getCountryToday } from '@/lib/today';
import { ActivityLedger } from './ActivityLedger';
import {
  LShell,
  LSectionHeader,
  LCli,
  LBracket,
  LRule,
  L_T,
  L_MONO,
} from '@/components/ledger/primitives';

interface Note {
  date: string;
  eyebrow: string;
  title: string;
  body: string;
  tags: string[];
}

function buildNotes(profile: StoredProfile): Note[] {
  const m = deriveMetrics(profile);
  const ccy = userDefaultCurrency(profile.user.country);
  const fc = (v: string | number) => formatCurrency(v, ccy);
  const today = getCountryToday(profile.user.country);
  const dateLabel = today.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const notes: Note[] = [];

  if (m.loudest) {
    const loudest = m.loudest;
    const bank = loudest.loan.bank || 'your highest-rate lender';
    const spread = loudest.effective.sub(loudest.nominal);
    if (spread.gt(new Decimal('0.01'))) {
      notes.push({
        date: dateLabel,
        eyebrow: 'RATES',
        title: `Real ${bank} rate is ${fmtPct(loudest.effective)}`,
        body: `Published rate ${fmtPct(loudest.nominal)} becomes ${fmtPct(loudest.effective)} once GST + processing + insurance are folded in. At a balance of ${fc(loudest.outstanding.toString())} that is the friction point — every other prepayment loses to closing this line.`,
        tags: ['rates', loudest.loan.loan_type.replace('_', '-'), 'effective'],
      });
    } else {
      notes.push({
        date: dateLabel,
        eyebrow: 'WATCH',
        title: `${bank.toUpperCase()} is your loudest debt`,
        body: `Highest effective APR in the portfolio at ${fmtPct(loudest.effective)}. Until it is closer to clear, every surplus rupee should chase this one — every other allocation underperforms.`,
        tags: ['avalanche', 'priority'],
      });
    }
  }

  const homeLoan = m.loans.find((l) => l.loan.loan_type === 'home_loan');
  if (homeLoan && profile.user.country === 'IN') {
    const annualInt = new Decimal(homeLoan.loan.outstanding || 0).mul(
      new Decimal(homeLoan.loan.nominal_rate || 0),
    );
    const shieldValue = annualInt.mul(new Decimal(profile.marginalRate || 0));
    if (shieldValue.gt(1000)) {
      notes.push({
        date: dateLabel,
        eyebrow: 'TAX',
        title: `Your Sec 24 shield is worth ${fc(shieldValue.toFixed(0))}/yr`,
        body: `At your marginal rate, the home-loan interest deduction brings the effective cost from ${fmtPct(homeLoan.nominal)} down to ${fmtPct(homeLoan.effective)}. Factored into avalanche ordering — without it the home loan would queue earlier.`,
        tags: ['Sec 24', 'tax', 'home-loan'],
      });
    }
  }

  const floating = m.loans.filter((l) => l.loan.rate_type === 'floating');
  if (floating.length > 0) {
    notes.push({
      date: dateLabel,
      eyebrow: 'KNOW THIS',
      title: 'No-cost EMI is rarely zero-cost',
      body: 'Most no-cost EMI lines repackage interest as a one-shot processing fee. The real APR ends up at 14–18% once that fee is amortised across the tenure. If you see "0% interest", check the brochure for "convenience fee" or "processing fee" before signing.',
      tags: ['credit', 'fees', 'borrow-with-eyes-open'],
    });
  }

  if (m.totalOutstanding.gt(0) && m.surplus.gt(0)) {
    notes.push({
      date: dateLabel,
      eyebrow: 'MILESTONE',
      title: `Surplus of ${fc(m.surplus.toString())}/mo is what the engine routes`,
      body: `Income minus fixed expenses minus scheduled EMIs leaves ${fc(m.surplus.toString())} that the plan rotates through the priority loan each month. Anything you log on the activity ledger above this baseline gets bonus-routed too.`,
      tags: ['surplus', 'allocation'],
    });
  }

  return notes;
}

export function LedgerInsights({
  profile,
  strategy: _strategy,
}: {
  profile: StoredProfile;
  strategy: StrategyName;
}) {
  const notes = useMemo(() => buildNotes(profile), [profile]);

  return (
    <LShell>
      <main
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontFamily: L_MONO,
        }}
      >
        <section>
          <LCli>
            NOTES · ENGINE OUTPUT · {notes.length} ENTRIES · LAST UPDATED{' '}
            {getCountryToday(profile.user.country)
              .toDateString()
              .toUpperCase()}
          </LCli>
          <LRule length={300} />
        </section>

        {notes.length === 0 && (
          <section style={{ fontSize: 12, color: L_T.muted, padding: '24px 0' }}>
            $ NO NOTES YET · add loans on{' '}
            <LBracket href="/onboarding">[SETUP]</LBracket> to surface engine
            commentary.
          </section>
        )}

        {notes.map((n, i) => (
          <section
            key={i}
            style={{
              paddingBottom: 18,
              borderBottom:
                i < notes.length - 1 ? `1px dashed ${L_T.faint}` : 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 14,
                fontSize: 10,
                color: L_T.muted,
                letterSpacing: '0.12em',
                marginBottom: 10,
                flexWrap: 'wrap',
              }}
            >
              <span>NO. {String(i + 1).padStart(3, '0')}</span>
              <span>· {n.date.toUpperCase()}</span>
              <span style={{ color: L_T.accent, fontWeight: 700 }}>· {n.eyebrow}</span>
              <span style={{ marginLeft: 'auto' }}>
                {n.tags.map((t) => `#${t}`).join('  ')}
              </span>
            </div>
            <h2
              style={{
                fontFamily: L_MONO,
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                marginBottom: 8,
                lineHeight: 1.25,
              }}
            >
              {n.title.toUpperCase()}
            </h2>
            <p style={{ fontSize: 12, color: L_T.ink, lineHeight: 1.7 }}>{n.body}</p>
            <div style={{ marginTop: 10 }}>
              <LBracket>OPEN FULL NOTE →</LBracket>
            </div>
          </section>
        ))}

        {/* Activity ledger — input surface for "I actually paid X". Lives
         *  below the notes so the deep-link /insights#activity-ledger
         *  lands here. */}
        <section>
          <LSectionHeader>ACTUALS · ACTIVITY LEDGER</LSectionHeader>
          <ActivityLedger user={profile.user} variant="ledger" />
        </section>
      </main>
    </LShell>
  );
}

'use client';

/**
 * Plan's notes (REDESIGN R3.4, from the design's Notes tab): what the
 * plan takes into account that no number on Plan or Home says — at most
 * three, each with its working:
 *   • prepaying vs a safe saving rate, after tax
 *   • the tax a home loan's interest saves (or doesn't, under India's new
 *     regime; or below the US standard deduction)
 *   • a pay rise that moves you into a higher tax bracket
 * The notes Activity used to carry (the real rate of the dearest loan,
 * the monthly surplus) are on Home now; a generic no-cost-EMI tip went.
 */
import type { ReactNode } from 'react';
import Decimal from 'decimal.js';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole } from '@/lib/api';
import { computeBreakdown, fmt as fmtPct } from '@/lib/effective-apr';
import { userMarginalCosts } from '@/lib/marginal-cost';
import { usMortgageShieldShare } from '@/lib/deductions';
import { compareToLoan, formatAsOf, pct, safeBenchmarks } from '@/lib/invest-vs-prepay';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { loanToUserDecimal } from '@/lib/currency';
import { LBracket, LMathBlock, LSectionHeader, L_T } from '@/components/ledger/primitives';

interface Note {
  eyebrow: string;
  title: string;
  body: ReactNode;
  math?: Array<{ k: string; v: string; note?: string; tone?: 'pos' | 'neg' }>;
  link?: { href: string; label: string };
}

/** "HDFC credit card" or "credit card" — for mid-sentence use; `cap` it
 *  to start a line. The lender keeps its own capitals. */
function loanName(l: PlanData['user']['loans'][number]): string {
  const t = LOAN_TYPE_NAME[l.loan_type];
  const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
  return bank ? `${bank} ${t}` : t;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function buildNotes(plan: PlanData): Note[] {
  const { user } = plan;
  const ccy = plan.displayCurrency;
  const regime = user.country === 'IN' ? user.tax_regime : undefined;
  const itemises = usMortgageShieldShare(user);
  // What each loan costs a year (lib/marginal-cost): the figure the plan
  // ranks and weighs prepaying by. `b` keeps the average tax saving, for the
  // yearly amount the Tax note quotes.
  const openIdx = user.loans.map((_, i) => i).filter((i) => Number(user.loans[i].outstanding || 0) > 0 && (user.loans[i].planned_effective_month ?? 1) <= 1);
  const costs = userMarginalCosts(user, plan.marginalRate, openIdx);
  const ranked = openIdx
    .filter((i) => costs.has(i))
    .map((i) => ({ loan: user.loans[i], mc: costs.get(i)!, b: computeBreakdown(user.loans[i], plan.marginalRate, user.country, regime, itemises) }))
    .sort((a, b) => b.mc.orderKey.cmp(a.mc.orderKey));
  const notes: Note[] = [];

  // 1. Prepay or put it aside: the dearest loan against the best safe rate.
  const top = ranked[0];
  if (top) {
    const vehicles = safeBenchmarks(user.country, plan.marginalRate);
    const r = compareToLoan(top.mc.annualCost, vehicles);
    const best = r.bestVehicle;
    const gap = pct(r.spreadPct.abs());
    notes.push({
      eyebrow: 'PREPAY OR SAVE',
      title:
        r.verdict === 'prepay'
          ? `Paying off the ${loanName(top.loan)} earns ${gap} a year more than ${best.name}`
          : r.verdict === 'invest_safe'
            ? `${best.name} earns ${gap} a year more than paying off the ${loanName(top.loan)}`
            : `Paying off the ${loanName(top.loan)} and ${best.name} come out about even`,
      body:
        r.verdict === 'prepay'
          ? "What you save on the loan is certain; a saving rate can fall. That's why the plan puts spare cash on this loan. If you'd rather keep some cash to hand first, set a monthly total for debts or an emergency fund at the top of the plan."
          : r.verdict === 'invest_safe'
            ? 'This loan is cheap enough that a safe saving rate beats it after tax. The plan still pays it down; the tool shows what parking the cash instead would do.'
            : 'Within half a point either way. Paying the loan is certain; saving keeps the cash to hand.',
      math: [
        { k: `${cap(loanName(top.loan))}, cost a year`, v: fmtPct(top.mc.annualCost), note: 'compounded monthly, after tax' },
        {
          k: `${best.name}, after tax`,
          v: pct(best.afterTaxEffective),
          note: `${pct(best.nominalRate)} quoted · as of ${formatAsOf(best.asOf)}`,
        },
        { k: 'Difference', v: `${r.spreadPct.gte(0) ? '' : '−'}${gap} a year`, tone: r.verdict === 'prepay' ? 'pos' : undefined },
      ],
      link: { href: '/tools/invest-vs-prepay', label: 'COMPARE WITH SHARES AND FUNDS →' },
    });
  }

  // 2. The tax a home loan's interest saves.
  const home = ranked.find(({ loan }) => loan.loan_type === 'home_loan');
  if (home) {
    const shield = home.b.lines.find((l) => l.label === 'Tax shield')?.value ?? new Decimal(0);
    const yearly = loanToUserDecimal(
      new Decimal(home.loan.outstanding).mul(shield), home.loan, user.country, user.fx_to_user_currency,
    );
    const name = loanName(home.loan);
    if (yearly && yearly.gt(1000)) {
      notes.push({
        eyebrow: 'TAX',
        title:
          user.country === 'IN'
            ? `The ${name}'s interest saves about ${formatCurrencyWhole(yearly.toFixed(0), ccy)} of tax a year (Sec 24)`
            : `The ${name}'s interest saves about ${formatCurrencyWhole(yearly.toFixed(0), ccy)} of tax a year`,
        // At the cap (old regime, interest over ₹2 lakh) the next rupee of
        // interest saves no tax, so paying early gives none up.
        body: home.mc.taxBenefit.gt(0)
          ? 'Paying it early gives that saving up, so it costs less than its rate and the plan pays it off after dearer loans.'
          : 'Your interest is already over the yearly cap, so paying early gives up none of that saving: the plan counts the loan at its full rate.',
        math: [
          { k: 'Interest, compounded monthly', v: fmtPct(home.mc.interest) },
          { k: 'Less the tax break an early payment gives up', v: `−${fmtPct(home.mc.taxBenefit)}`, tone: 'pos' },
          { k: 'What it costs a year', v: fmtPct(home.mc.annualCost) },
        ],
      });
    } else if (user.country === 'IN' && (user.tax_regime ?? 'new') === 'new' && (home.loan.property_use ?? 'self_occupied') === 'self_occupied') {
      notes.push({
        eyebrow: 'TAX',
        title: `No tax saving on the ${name} under the new regime`,
        body: `The new regime has no Sec 24(b) deduction for a home you live in, so the loan costs its full ${fmtPct(home.mc.annualCost)} a year. The old regime allows up to ₹2 lakh of interest a year; whether it suits you depends on your other deductions.`,
      });
    } else if (user.country === 'US' && itemises.lte(0)) {
      notes.push({
        eyebrow: 'TAX',
        title: `The ${name}'s interest doesn't lower your tax`,
        body: 'Your itemised deductions come to less than the standard deduction, so the plan counts the mortgage at its full rate.',
      });
    }
  }

  // 3. A pay rise that crosses into a higher bracket.
  const t = plan.bracketTransitions[0];
  if (t) {
    notes.push({
      eyebrow: 'TAX BRACKET',
      title: `Pay rises take you from the ${(t.from.marginalRate * 100).toFixed(0)}% to the ${(t.to.marginalRate * 100).toFixed(0)}% bracket in year ${t.year}`,
      body: `At about ${formatCurrencyWhole(t.incomeAtTransition.toFixed(0), ccy)} a year. Each rise above that keeps less after tax, which the plan allows for.${plan.bracketTransitions.length > 1 ? ` ${plan.bracketTransitions.length - 1} more change${plan.bracketTransitions.length > 2 ? 's' : ''} later in the plan.` : ''}`,
    });
  }

  return notes.slice(0, 3);
}

export function PlanNotes({ plan }: { plan: PlanData }) {
  const notes = buildNotes(plan);
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="plan-notes-h" id="notes" style={{ scrollMarginTop: 16 }}>
      <LSectionHeader>
        <span id="plan-notes-h">Notes · {notes.length}</span>
      </LSectionHeader>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {notes.map((n, i) => (
          <li
            key={i}
            style={{
              padding: '12px 0 14px',
              borderBottom: i < notes.length - 1 ? `1px dashed ${L_T.ruleSoft}` : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.accent, fontWeight: 700 }}>
              {String(i + 1).padStart(2, '0')} · {n.eyebrow}
            </span>
            <strong style={{ fontSize: 13, lineHeight: 1.45 }}>{n.title}</strong>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: L_T.inkSoft }}>{n.body}</p>
            {n.math && (
              <div style={{ maxWidth: 560 }}>
                <LMathBlock rows={n.math} />
              </div>
            )}
            {n.link && (
              <span>
                <LBracket href={n.link.href}>{n.link.label}</LBracket>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Life-template expansion — given a high-level life goal ("FIRE by
 * 35", "Buy a home in 5 years", "Child education at age 18"),
 * produce a chain of atomic goals + lifecycle events that compose
 * into the actual plan.
 *
 * Why: the user asks "I want to retire by 35 and clear debts first" —
 * one sentence. Three goals + two lifecycle events fall out of it.
 * Authoring those one by one is friction; templates do the
 * decomposition.
 *
 * Templates are pure expansion — they don't persist their own state.
 * Once expanded, the resulting Goal[] is added to the goals slice via
 * writeGoalsClient. Users can then edit individual goals freely.
 */

import type { Goal } from './goals';
import { applyPresetDefaults, blankGoal } from './goals';

export type TemplateKind =
  | 'fire'
  | 'buy_home'
  | 'child_education'
  | 'business_launch'
  | 'comfortable_retirement';

export interface TemplateInput {
  kind: TemplateKind;
  /** User's current age in years. Used to date life-stage goals. */
  currentAge?: number;
  /** Target age for the life event (retire-by, downpayment-by, etc.). */
  targetAge?: number;
  /** Final target amount the user wants the corpus to hit, in user
   *  currency. Optional — templates supply a sensible default tied to
   *  income/expenses if omitted. */
  targetAmount?: number;
  /** Monthly expenses (used to size FIRE corpus via the 25× rule). */
  monthlyExpenses?: number;
}

export interface TemplateOutput {
  goals: Goal[];
  /** Narrative the UI shows after expansion — "Added 3 goals: …". */
  summary: string;
  /** Caveats / assumptions the user should know — surfaced beneath
   *  the summary so the decomposition is auditable. */
  caveats: string[];
}

/** Months from "now" until the user is `targetAge` years old. */
function monthsUntilAge(currentAge: number, targetAge: number): number {
  if (!Number.isFinite(currentAge) || !Number.isFinite(targetAge)) return 0;
  return Math.max(0, (targetAge - currentAge) * 12);
}

function targetMonthFromNow(monthsAhead: number, today: Date = new Date()): string {
  const t = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

// ─── Expansion ─────────────────────────────────────────────────────────────

export function expandTemplate(input: TemplateInput): TemplateOutput {
  switch (input.kind) {
    case 'fire':
      return expandFire(input);
    case 'buy_home':
      return expandBuyHome(input);
    case 'child_education':
      return expandChildEducation(input);
    case 'business_launch':
      return expandBusinessLaunch(input);
    case 'comfortable_retirement':
      return expandRetirement(input);
  }
}

function expandFire(input: TemplateInput): TemplateOutput {
  const currentAge = input.currentAge ?? 30;
  const targetAge = input.targetAge ?? 35;
  const monthlyExpenses = input.monthlyExpenses ?? 50000;
  const months = monthsUntilAge(currentAge, targetAge);

  // 25× annual expenses — the canonical FIRE corpus rule. Tight for IN
  // (higher inflation), generous for US. User can edit each leg after.
  const corpus = input.targetAmount ?? monthlyExpenses * 12 * 25;

  // Three legs: clear debts before retirement target, build the corpus,
  // and a 1× annual cushion for the year before pulling the trigger.
  const debtFreeMonth = Math.floor(months * 0.6);
  const corpusMonth = months;
  const cushionMonth = Math.max(1, months - 12);

  const debtFree = applyPresetDefaults(blankGoal('custom'), 'custom');
  debtFree.label = 'Debts fully cleared (FIRE prerequisite)';
  debtFree.targetMonth = targetMonthFromNow(debtFreeMonth);
  debtFree.amount = '0';
  debtFree.priorityBump = true;

  const corpusGoal = applyPresetDefaults(blankGoal('custom'), 'custom');
  corpusGoal.label = `FIRE corpus (25× annual expenses)`;
  corpusGoal.amount = String(Math.round(corpus));
  corpusGoal.targetMonth = targetMonthFromNow(corpusMonth);
  corpusGoal.priorityBump = true;
  corpusGoal.bufferPct = '0.10';
  corpusGoal.fundingSources = ['surplus', 'liquidation'];

  const cushion = applyPresetDefaults(blankGoal('custom'), 'custom');
  cushion.label = '1 year living-expense cushion';
  cushion.amount = String(Math.round(monthlyExpenses * 12));
  cushion.targetMonth = targetMonthFromNow(cushionMonth);
  cushion.priorityBump = true;
  cushion.fundingSources = ['surplus', 'liquidation'];

  return {
    goals: [debtFree, corpusGoal, cushion],
    summary: `Added 3 goals: debts cleared by month ${debtFreeMonth}, FIRE corpus of ${Math.round(corpus / 1e5)}L by month ${corpusMonth}, 1-year cushion by month ${cushionMonth}.`,
    caveats: [
      '25× annual expenses is the FIRE rule of thumb (4% safe withdrawal). Adjust the corpus amount if your inflation assumption differs.',
      'Buffer for FIRE corpus is 10% — conservative because corpus shortfall is unrecoverable post-retirement.',
      'Pre-empt is ON for the cushion goal — once you stop working, you cannot rebuild EF from income.',
    ],
  };
}

function expandBuyHome(input: TemplateInput): TemplateOutput {
  const monthsAhead = (input.targetAge && input.currentAge
    ? monthsUntilAge(input.currentAge, input.targetAge)
    : 60); // default 5 years
  // 20% downpayment on the target home value (a common minimum to
  // skip PMI in US / lock favourable rate in IN).
  const homeValue = input.targetAmount ?? 5_000_000;
  const downpayment = homeValue * 0.2;

  const dp = applyPresetDefaults(blankGoal('downpayment'), 'downpayment');
  dp.label = `Home downpayment (${Math.round(homeValue / 1e5)}L target)`;
  dp.amount = String(Math.round(downpayment));
  dp.targetMonth = targetMonthFromNow(monthsAhead);

  const closingCosts = applyPresetDefaults(blankGoal('custom'), 'custom');
  closingCosts.label = 'Closing costs + stamp duty';
  closingCosts.amount = String(Math.round(homeValue * 0.05));
  closingCosts.targetMonth = targetMonthFromNow(monthsAhead);
  closingCosts.priorityBump = true;
  closingCosts.bufferPct = '0.10';
  closingCosts.fundingSources = ['surplus'];

  return {
    goals: [dp, closingCosts],
    summary: `Added 2 goals: 20% downpayment of ${Math.round(downpayment / 1e5)}L + closing costs ${Math.round((homeValue * 0.05) / 1e5)}L, both by month ${monthsAhead}.`,
    caveats: [
      'Downpayment assumes 20% of target home value. Banks may require more for first-time buyers; less in some EMI plans.',
      'Closing costs estimated at 5% (stamp duty 4-7% in IN, ~3% in US after lender credits). Edit per state.',
      'Liquidation is the second-tier source. Personal loans for downpayment are excluded — they reduce your eligible loan amount with most lenders.',
    ],
  };
}

function expandChildEducation(input: TemplateInput): TemplateOutput {
  const currentAge = input.currentAge ?? 5; // child's age
  const collegeAge = input.targetAge ?? 18;
  const months = monthsUntilAge(currentAge, collegeAge);
  const tuition = input.targetAmount ?? 4_000_000; // 4-year IN private engg / US in-state

  const corpus = applyPresetDefaults(blankGoal('education'), 'education');
  corpus.label = `College fund (${Math.round(tuition / 1e5)}L 4-year tuition)`;
  corpus.amount = String(Math.round(tuition));
  corpus.targetMonth = targetMonthFromNow(months);

  return {
    goals: [corpus],
    summary: `Added 1 goal: college fund of ${Math.round(tuition / 1e5)}L by month ${months}.`,
    caveats: [
      'Tuition default is a 4-year private-engineering / US in-state estimate. Adjust per institution tier.',
      'Education-loan tier is enabled — Sec 80E (IN) makes the interest deductible.',
      'EF is NOT tapped — kid education and emergency reserve are separate envelopes.',
    ],
  };
}

function expandBusinessLaunch(input: TemplateInput): TemplateOutput {
  const monthsAhead = input.targetAge && input.currentAge
    ? monthsUntilAge(input.currentAge, input.targetAge)
    : 24;
  const seed = input.targetAmount ?? 1_500_000;
  const runway = (input.monthlyExpenses ?? 75000) * 12;

  const seedGoal = applyPresetDefaults(blankGoal('business_seed'), 'business_seed');
  seedGoal.label = 'Business seed capital';
  seedGoal.amount = String(Math.round(seed));
  seedGoal.targetMonth = targetMonthFromNow(monthsAhead);

  const runwayGoal = applyPresetDefaults(blankGoal('custom'), 'custom');
  runwayGoal.label = '12-month personal runway';
  runwayGoal.amount = String(Math.round(runway));
  runwayGoal.targetMonth = targetMonthFromNow(monthsAhead);
  runwayGoal.priorityBump = true;
  runwayGoal.bufferPct = '0.20';
  runwayGoal.fundingSources = ['surplus', 'liquidation'];

  return {
    goals: [seedGoal, runwayGoal],
    summary: `Added 2 goals: seed capital ${Math.round(seed / 1e5)}L + 12-month runway ${Math.round(runway / 1e5)}L, both by month ${monthsAhead}.`,
    caveats: [
      'Runway is sized at 12 months of current expenses — adjust if you expect lifestyle changes during the bootstrap year.',
      'Seed capital allows new_loan as a tier; business loans typically need 2yr ITR + collateral.',
      'EF stays separate — business and personal reserve should not co-mingle.',
    ],
  };
}

function expandRetirement(input: TemplateInput): TemplateOutput {
  const currentAge = input.currentAge ?? 35;
  const retireAge = input.targetAge ?? 60;
  const monthlyExpenses = input.monthlyExpenses ?? 60000;
  const months = monthsUntilAge(currentAge, retireAge);

  // Comfortable (not lean) retirement — 30× annual expenses to handle
  // longer post-retirement horizon than FIRE's 25× rule.
  const corpus = input.targetAmount ?? monthlyExpenses * 12 * 30;

  const corpusGoal = applyPresetDefaults(blankGoal('custom'), 'custom');
  corpusGoal.label = `Retirement corpus (30× annual expenses)`;
  corpusGoal.amount = String(Math.round(corpus));
  corpusGoal.targetMonth = targetMonthFromNow(months);
  corpusGoal.priorityBump = true;
  corpusGoal.bufferPct = '0.15';
  corpusGoal.fundingSources = ['surplus', 'liquidation'];

  return {
    goals: [corpusGoal],
    summary: `Added 1 goal: retirement corpus ${Math.round(corpus / 1e7)}Cr by month ${months}.`,
    caveats: [
      '30× annual expenses targets a comfortable (not lean-FIRE) retirement. Adjust if you expect downsized lifestyle.',
      '15% buffer covers healthcare-cost growth outpacing CPI — well-supported by US Medicare-actuarial data.',
      'Long horizons compound — even small surplus-redirect from debt-prepay can dramatically change corpus growth.',
    ],
  };
}

// ─── Catalogue (for the picker UI) ─────────────────────────────────────────

export const TEMPLATE_CATALOGUE: { kind: TemplateKind; label: string; description: string }[] = [
  {
    kind: 'fire',
    label: 'FIRE — retire early',
    description: 'Clears debt first, builds 25× corpus, adds a 1-year cushion.',
  },
  {
    kind: 'buy_home',
    label: 'Buy a home',
    description: '20% downpayment goal + closing-costs goal, both dated to your target month.',
  },
  {
    kind: 'child_education',
    label: 'Child education',
    description: 'College fund timed to the child reaching 18. Education-loan tier enabled.',
  },
  {
    kind: 'business_launch',
    label: 'Launch a business',
    description: 'Seed capital + 12-month personal runway — both critical, EF untouched.',
  },
  {
    kind: 'comfortable_retirement',
    label: 'Comfortable retirement',
    description: '30× corpus by your target retire-age. Conservative buffer.',
  },
];

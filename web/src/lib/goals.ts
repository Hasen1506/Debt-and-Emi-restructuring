/**
 * Goal events — finite-horizon savings targets the user wants to meet
 * by a specific date (birthday, travel, wedding, business seed,
 * downpayment, child education, medical, custom).
 *
 * Distinct from LifecycleEvent (salary / rate resets) and from EF
 * target (open-ended reserve). A goal has:
 *   • amount + target_date — what you need by when
 *   • kind — preset for default buffer + funding sources
 *   • priorityBump — single user override; when true, the goal is
 *     funded ahead of goals with earlier target dates. Replaces the
 *     old 3-tier critical/important/discretionary model. Defaults
 *     baked per kind (medical / wedding default to bumped).
 *   • orderIndex — stable within-group ordering set by the drag UI
 *   • funding_sources — which buckets the achievability checker may
 *     tap (surplus / ef / liquidation / new_loan)
 *
 * Storage: localStorage + cookie digest for server-side /plan.
 * Engine: receives per-goal payload via /api/simulate `goals` field;
 * runs serial-fill per month with goal-expiry awareness and returns
 * per-goal fill rates in `goal_finals`.
 */

import { persistGoalSlices, type GoalSliceWrite } from './persist-goal-slices';

export type GoalKind =
  | 'birthday'
  | 'travel'
  | 'wedding'
  | 'education'
  | 'business_seed'
  | 'downpayment'
  | 'medical'
  | 'custom';

export type GoalFundingSource =
  | 'surplus'
  | 'ef'
  | 'liquidation'
  | 'new_loan';

export interface Goal {
  id: string;
  kind: GoalKind;
  /** User-facing label. For presets we suggest a default; custom requires
   *  the user to author one. */
  label: string;
  /** Target amount in user's residence currency, decimal string. */
  amount: string;
  /** Target date as YYYY-MM (we work month-granularity for plan math). */
  targetMonth: string;
  /** Set automatically on first save; ISO date. */
  createdAt: string;
  /** Funding-source allowlist. Defaults baked per kind; user can
   *  toggle. The achievability checker only proposes from the allowed
   *  set, so users who never want a new loan can disable that source. */
  fundingSources: GoalFundingSource[];
  /** Single explicit priority override — when true, this goal is
   *  funded ahead of goals with earlier target dates. Defaults baked
   *  per kind (medical / wedding default to true). Edited via a single
   *  toggle on /goals, or set implicitly when the user drags this goal
   *  above an earlier-dated one on /plan. */
  priorityBump: boolean;
  /** Soft-buffer percentage applied on top of `amount` so the user
   *  arrives with cushion. Defaults baked per kind (travel 10%,
   *  wedding 15%, medical 25% to account for ER surcharges). */
  bufferPct: string;
  /** Optional within-group ordering (lower = earlier). When set, the
   *  user has dragged this goal into a specific slot among its
   *  same-bump-state peers. Null/undefined falls back to target-date
   *  ordering. */
  orderIndex?: number;
  /** Deferred-start: 0-based sim-month before which engine routes 0
   *  to this goal. Lets the user "park" a short-needed goal until
   *  later in the timeline so debt prepay gets the full surplus
   *  until funding kicks in. Stored as a YYYY-MM month for UI
   *  legibility; converted to a sim-month index at engine-call time.
   *  Undefined preserves the legacy "start at month 0" behavior. */
  fundingStartMonth?: string;
  /** When true (the default), the app auto-recomputes fundingStartMonth
   *  after each /simulate response to keep the goal optimally deferred
   *  (max debt prepay until funding kicks in). When false, the user
   *  has explicitly clicked "Start saving now" — fundingStartMonth is
   *  treated as fixed and not auto-overwritten. Pre-existing goals
   *  without the flag default to true (opt-in for legacy data). */
  autoDefer?: boolean;
  /** Whether the target date can be slipped. 'hard' (wedding,
   *  admission deadline, court-ordered medical) means the date is
   *  locked — the shortfall-lever UI hides the "extend by N months"
   *  option and surfaces only lower-target / increase-surplus / tap
   *  lump-sum. 'soft' (default) means the date is preferred but
   *  movable; all levers apply. Optional for legacy data — undefined
   *  is treated as 'soft'. */
  deadlineKind?: 'hard' | 'soft';
  /** Open unless cancelled (stopped short) or archived (funded and put
   *  away). A closed goal keeps what was saved but leaves the plan. */
  status?: GoalStatus;
  /** ISO date the goal was cancelled or archived. */
  closedAt?: string;
  /** Where the money for it is kept. Informational: Goals warns when
   *  the place doesn't suit how soon the money is needed. */
  keptIn?: GoalKeptIn;
  /** How the plan funds it (roadmap PR F, lib/goal-funding). New goals
   *  start "debt first"; a goal saved before this has none and keeps
   *  the run-rate to its date ('schedule'). */
  fundingRule?: GoalFundingRule;
}

export type GoalFundingRuleKind = 'schedule' | 'fixed' | 'surplus_pct' | 'after_debt';
export interface GoalFundingRule {
  kind: GoalFundingRuleKind;
  /** fixed: amount a month, decimal string. */
  amount?: string;
  /** surplus_pct: share of spare cash, decimal string 0–1. */
  pct?: string;
  /** after_debt: the loan's position in user.loans; null = every high-interest loan. */
  afterLoanIndex?: number | null;
}

/** "Debt first": the default for a new goal. */
export const DEBT_FIRST: GoalFundingRule = { kind: 'after_debt', afterLoanIndex: null };

export type GoalStatus = 'active' | 'cancelled' | 'archived';
export type GoalKeptIn = 'savings' | 'fd' | 'debt_fund' | 'equity' | 'none';

export const KEPT_IN_LABEL: Record<GoalKeptIn, string> = {
  savings: 'Savings account',
  fd: 'Fixed deposit',
  debt_fund: 'Debt or liquid fund',
  equity: 'Shares or equity fund',
  none: 'Nowhere yet',
};

/** A goal the plan still saves for. */
/** What a goal's amount needs, or null when it is fine. */
export const GOAL_AMOUNT_ERROR = 'Enter how much it needs, e.g. 15L.';
export function goalAmountError(amount: string): string | null {
  return Number(amount) > 0 ? null : GOAL_AMOUNT_ERROR;
}

/**
 * Re-test 12 O-4: the amount box's own message once the person has left it.
 * A figure that reads as 0 (or less) is flagged then, not only at ADD; a
 * box left blank isn't (tabbing past it isn't a mistake yet).
 */
export function goalAmountBlurError(amount: string, left: boolean): string | null {
  if (!left || amount.trim() === '') return null;
  return goalAmountError(amount);
}

export function isOpenGoal(g: Goal): boolean {
  return !g.status || g.status === 'active';
}

// ─── Presets ───────────────────────────────────────────────────────────────

interface PresetDefaults {
  label: string;
  bufferPct: string;
  priorityBump: boolean;
  fundingSources: GoalFundingSource[];
  description: string;
  /** Whether the kind defaults to a hard or soft deadline. User can
   *  flip per-goal via the deadline toggle. */
  deadlineKind: 'hard' | 'soft';
}

export const GOAL_PRESETS: Record<GoalKind, PresetDefaults> = {
  birthday: {
    label: 'Birthday party',
    bufferPct: '0.05',
    priorityBump: false,
    fundingSources: ['surplus'],
    description:
      'Short-horizon, low-stakes. Surplus-only is enough; never tap EF for it.',
    deadlineKind: 'hard',
  },
  travel: {
    label: 'Travel / trip',
    bufferPct: '0.10',
    priorityBump: false,
    fundingSources: ['surplus', 'liquidation'],
    description:
      '10% buffer for in-trip surprises. Liquidation allowed for users with surplus assets they’d rather convert.',
    deadlineKind: 'soft',
  },
  wedding: {
    label: 'Wedding',
    bufferPct: '0.15',
    priorityBump: false,
    fundingSources: ['surplus', 'ef', 'liquidation', 'new_loan'],
    description:
      'High-stakes, fixed-date. Buffer is 15%. Not bumped by default — natural date order usually suffices; flip the bump toggle if it must override a longer-horizon goal.',
    deadlineKind: 'hard',
  },
  education: {
    label: 'Child education',
    bufferPct: '0.10',
    priorityBump: false,
    fundingSources: ['surplus', 'liquidation', 'new_loan'],
    description:
      'Long-horizon, often partially covered by education-loan tax breaks. Not bumped by default — the long horizon means date order is usually right.',
    deadlineKind: 'hard',
  },
  business_seed: {
    label: 'Business seed capital',
    bufferPct: '0.20',
    priorityBump: false,
    fundingSources: ['surplus', 'liquidation', 'new_loan'],
    description:
      '20% buffer for working-capital surprises. EF off-limits — runway needs its own pool.',
    deadlineKind: 'soft',
  },
  downpayment: {
    label: 'Home down payment',
    bufferPct: '0.05',
    priorityBump: false,
    fundingSources: ['surplus', 'liquidation'],
    description:
      'Big-ticket, well-defined. No new loans (the home loan itself is the financing); liquidation is the fallback.',
    deadlineKind: 'soft',
  },
  medical: {
    label: 'Medical reserve',
    bufferPct: '0.25',
    priorityBump: true,
    fundingSources: ['surplus', 'ef', 'liquidation', 'new_loan'],
    description:
      'Highest buffer (25%). Bumped by default — this is exactly what the EF exists for, but goals with target_date model the explicit case.',
    deadlineKind: 'soft',
  },
  custom: {
    label: '',
    bufferPct: '0',
    priorityBump: false,
    fundingSources: ['surplus'],
    description: 'Free-form goal — you set the label and the funding rules.',
    deadlineKind: 'soft',
  },
};

// ─── Persistence ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'rightdue_goals';
const DIGEST_COOKIE = 'rightdue_goals_digest';

function safeParse(raw: string | null): Goal[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isValidShape).map(migrateLegacy);
  } catch {
    return [];
  }
}

/**
 * Convert legacy goal shapes to the current model:
 *   • Old `priority: 'critical' | 'important' | 'discretionary'` →
 *     `priorityBump: true` for critical, false for others.
 *   • Old `preemptsEf: boolean` → folded into priorityBump (true wins).
 *
 * The legacy fields are dropped from the returned object so subsequent
 * writes don't carry the old shape forward. Idempotent — already-new
 * goals pass through unchanged.
 */
function migrateLegacy(g: unknown): Goal {
  const raw = g as Goal & {
    priority?: 'critical' | 'important' | 'discretionary' | 'standard';
    preemptsEf?: boolean;
  };
  // priorityBump may already exist (new shape) — respect it.
  if (typeof raw.priorityBump === 'boolean') {
    const { priority, preemptsEf, ...rest } = raw;
    return rest as Goal;
  }
  const wasCritical = raw.priority === 'critical';
  const wasPreempt = raw.preemptsEf === true;
  const { priority, preemptsEf, ...rest } = raw;
  return {
    ...rest,
    priorityBump: wasCritical || wasPreempt,
  } as Goal;
}

function isValidShape(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const g = v as Partial<Goal>;
  return (
    typeof g.id === 'string' &&
    typeof g.kind === 'string' &&
    typeof g.label === 'string' &&
    typeof g.amount === 'string' &&
    typeof g.targetMonth === 'string'
  );
}

export function readGoalsClient(): Goal[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function writeGoalsClient(goals: Goal[]) {
  if (typeof localStorage === 'undefined') return;
  persistGoalSlices([goalSliceWrite(goals)]);
}

export function goalSliceWrite(goals: Goal[]): GoalSliceWrite {
  // Run inputs through migrateLegacy. Most callers already work with
  // already-migrated objects (they came from readGoalsClient), but the
  // decisions-log undo path can hand us a snapshot that was logged
  // pre-refactor. Migrating here guarantees localStorage + cookie never
  // carry the legacy `priority`/`preemptsEf` fields forward.
  const migrated = goals.map(migrateLegacy);
  const sorted = migrated.sort(compareGoalsForOrder);
  // Cookie digest carries enough per-goal info for /plan's server
  // render to build the engine payload without going through
  // localStorage. Includes `priorityBump` + `orderIndex` so the
  // engine sees the same ordering the user sees.
  // Cancelled and archived goals leave the plan.
  const digest = sorted.filter(isOpenGoal).map((g) => ({
    id: g.id,
    targetMonth: g.targetMonth,
    amount: g.amount,
    bufferPct: g.bufferPct,
    priorityBump: g.priorityBump,
    orderIndex: g.orderIndex,
    fundingStartMonth: g.fundingStartMonth,
    autoDefer: g.autoDefer,
    fundingRule: g.fundingRule,
  }));
  const value = btoa(JSON.stringify(digest));
  return { key: STORAGE_KEY, cookie: DIGEST_COOKIE, digest: value, value: sorted, slice: 'goals' };
}

/** Stable ordering used by both localStorage persistence and the cookie
 *  digest. Bumped goals first; within each group, user-set orderIndex
 *  first, then target date, then createdAt as a tiebreak. */
export function compareGoalsForOrder(a: Goal, b: Goal): number {
  const bumpA = a.priorityBump ? 0 : 1;
  const bumpB = b.priorityBump ? 0 : 1;
  if (bumpA !== bumpB) return bumpA - bumpB;
  const orderA = a.orderIndex ?? Number.POSITIVE_INFINITY;
  const orderB = b.orderIndex ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  if (a.targetMonth !== b.targetMonth) {
    return a.targetMonth.localeCompare(b.targetMonth);
  }
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

// ─── Cookie digest (server side) ───────────────────────────────────────────

/** Cookie row shape. Older cookies (pre-migration) may carry the old
 *  priority/preemptsEf fields — `parseDigestCookie` derives priorityBump
 *  from them so a stale cookie still hydrates. */
interface GoalDigestRow {
  id?: string;
  targetMonth: string;
  amount?: string;
  bufferPct?: string;
  priorityBump?: boolean;
  orderIndex?: number;
  /** Deferred-start (YYYY-MM). When present, engine routes 0 to this
   *  goal until this month. Lets the user park the goal until later
   *  so debt prepay gets the full surplus until funding kicks in. */
  fundingStartMonth?: string;
  /** Auto-defer flag — see Goal.autoDefer. Undefined in the cookie
   *  falls back to true on read (default-on for legacy goals). */
  autoDefer?: boolean;
  /** Funding rule (roadmap PR F); absent = 'schedule'. */
  fundingRule?: GoalFundingRule;
  // Legacy fields kept for migration; not written going forward.
  priority?: 'critical' | 'important' | 'discretionary' | 'standard';
  preemptsEf?: boolean;
}

function parseDigestCookie(raw: string | undefined): GoalDigestRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64').toString('utf8'),
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is GoalDigestRow =>
          r && typeof r === 'object' && typeof r.targetMonth === 'string',
      )
      .map((r) => {
        if (typeof r.priorityBump === 'boolean') return r;
        // Derive from legacy fields.
        return {
          ...r,
          priorityBump: r.priority === 'critical' || r.preemptsEf === true,
        };
      });
  } catch {
    return [];
  }
}

/** Per-goal input shape the engine takes — mirrors api.GoalIn. */
export interface GoalSimulateInput {
  id: string;
  target_month_index: number;
  required_amount: string;
  saved_so_far: string;
  priority_bump: boolean;
  order_index: number | null;
  funding_start_month_index: number | null;
  funding_rule?: GoalFundingRuleKind;
  funding_amount?: string | null;
  funding_pct?: string | null;
  after_loan_index?: number | null;
}

/** The engine's funding-rule fields for a goal; a missing or half-filled
 *  rule is 'schedule' (the run-rate to the date). */
export function fundingRuleForEngine(rule: GoalFundingRule | undefined): Pick<GoalSimulateInput, 'funding_rule' | 'funding_amount' | 'funding_pct' | 'after_loan_index'> {
  if (rule?.kind === 'fixed' && Number(rule.amount) > 0) return { funding_rule: 'fixed', funding_amount: Number(rule.amount).toFixed(2) };
  if (rule?.kind === 'surplus_pct' && Number(rule.pct) > 0 && Number(rule.pct) <= 1) return { funding_rule: 'surplus_pct', funding_pct: String(Number(rule.pct)) };
  if (rule?.kind === 'after_debt') return { funding_rule: 'after_debt', after_loan_index: typeof rule.afterLoanIndex === 'number' && rule.afterLoanIndex >= 0 ? rule.afterLoanIndex : null };
  return { funding_rule: 'schedule' };
}

/** The engine payload for open goals with an amount and a future date,
 *  from Goal objects (client) or cookie rows (server). */
export function goalsForSimulate(
  rows: { id?: string; targetMonth: string; amount?: string; bufferPct?: string; priorityBump?: boolean; orderIndex?: number; fundingStartMonth?: string; fundingRule?: GoalFundingRule }[],
  today: Date,
  currentlySaved: Record<string, number> = {},
): GoalSimulateInput[] {
  return rows
    .filter((r) => typeof r.id === 'string' && typeof r.amount === 'string' && Number(r.amount) > 0)
    .map((r) => {
      const base = Number(r.amount || '0');
      const buf = Number(r.bufferPct || '0');
      const required = base * (1 + (Number.isFinite(buf) ? buf : 0));
      const targetIdx = targetMonthIndex(r.targetMonth, today);
      const rawFundingStart =
        typeof r.fundingStartMonth === 'string' && r.fundingStartMonth.length >= 7
          ? targetMonthIndex(r.fundingStartMonth, today)
          : null;
      const rule = fundingRuleForEngine(r.fundingRule);
      // A deferred start only applies to the run-rate rule; the others
      // say when to save themselves. Dropped when it has slid past the date.
      const fundingStart =
        rule.funding_rule === 'schedule' && rawFundingStart !== null && targetIdx > 0 && rawFundingStart >= 0 && rawFundingStart < targetIdx
          ? rawFundingStart
          : null;
      return {
        id: r.id!,
        target_month_index: targetIdx,
        required_amount: required.toFixed(2),
        saved_so_far: (currentlySaved[r.id!] ?? 0).toFixed(2),
        priority_bump: r.priorityBump === true,
        order_index: typeof r.orderIndex === 'number' ? r.orderIndex : null,
        funding_start_month_index: fundingStart,
        ...rule,
      };
    })
    .filter((g) => g.target_month_index > 0);
}

function targetMonthIndex(goalTargetMonth: string, today: Date): number {
  const y = Number(goalTargetMonth.slice(0, 4));
  const m = Number(goalTargetMonth.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  const target = new Date(y, m - 1, 1);
  const diff =
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth());
  return Math.max(0, diff);
}

/**
 * Server-side: build the per-goal payload the engine consumes. Reads
 * the cookie digest, translates each active goal into the simulator's
 * `GoalIn` shape, and returns the list.
 *
 * Engine runs serial-fill per month with goal-expiry awareness —
 * goals stop draining surplus once their target month is reached,
 * which client-side constant-outflow can't model.
 *
 * `currentlySaved` is sourced from the goal-contributions ledger when
 * present (`readContributionTotalsServer`); falls back to 0 for goals
 * without entries. Empty digest → empty list.
 */
export async function goalsForSimulateServer(
  today: Date = new Date(),
  currentlySaved: Record<string, number> = {},
): Promise<GoalSimulateInput[]> {
  const { cookies } = await import('next/headers');
  const raw = (await cookies()).get(DIGEST_COOKIE)?.value;
  const rows = parseDigestCookie(raw);
  return goalsForSimulate(rows, today, currentlySaved);
}

// ─── Factories ─────────────────────────────────────────────────────────────

export function newGoalId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankGoal(kind: GoalKind = 'custom'): Goal {
  const p = GOAL_PRESETS[kind];
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth() + 6, 1);
  const ty = target.getFullYear();
  const tm = String(target.getMonth() + 1).padStart(2, '0');
  return {
    id: newGoalId(),
    kind,
    label: p.label,
    amount: '',
    targetMonth: `${ty}-${tm}`,
    createdAt: new Date().toISOString(),
    fundingSources: [...p.fundingSources],
    priorityBump: p.priorityBump,
    bufferPct: p.bufferPct,
    deadlineKind: p.deadlineKind,
    // Debt first unless the user picks another rule (roadmap PR F).
    fundingRule: { ...DEBT_FIRST },
  };
}

export function applyPresetDefaults(goal: Goal, kind: GoalKind): Goal {
  const p = GOAL_PRESETS[kind];
  return {
    ...goal,
    kind,
    label: goal.label || p.label,
    fundingSources: [...p.fundingSources],
    priorityBump: p.priorityBump,
    bufferPct: p.bufferPct,
    deadlineKind: p.deadlineKind,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Months between today and the goal's target_month. Returns 0 for
 *  past / today targets. */
export function monthsUntil(goal: Goal, today: Date = new Date()): number {
  const y = Number(goal.targetMonth.slice(0, 4));
  const m = Number(goal.targetMonth.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  const target = new Date(y, m - 1, 1);
  const diff =
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth());
  return diff > 0 ? diff : 0;
}

/** Required-with-buffer amount the engine + achievability check fund
 *  against. */
export function fundedAmount(goal: Goal): number {
  const base = Number(goal.amount || '0');
  const buf = Number(goal.bufferPct || '0');
  if (!Number.isFinite(base) || base <= 0) return 0;
  return base * (1 + (Number.isFinite(buf) ? buf : 0));
}

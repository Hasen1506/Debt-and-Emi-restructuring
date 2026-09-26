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

import { syncSliceToServer } from './server-sync';

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
    label: 'Home downpayment',
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

const STORAGE_KEY = 'finoptima_goals';
const DIGEST_COOKIE = 'finoptima_goals_digest';

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
  // Run inputs through migrateLegacy. Most callers already work with
  // already-migrated objects (they came from readGoalsClient), but the
  // decisions-log undo path can hand us a snapshot that was logged
  // pre-refactor. Migrating here guarantees localStorage + cookie never
  // carry the legacy `priority`/`preemptsEf` fields forward.
  const migrated = goals.map(migrateLegacy);
  const sorted = migrated.sort(compareGoalsForOrder);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  // Cookie digest carries enough per-goal info for /plan's server
  // render to build the engine payload without going through
  // localStorage. Includes `priorityBump` + `orderIndex` so the
  // engine sees the same ordering the user sees.
  if (typeof document !== 'undefined') {
    const digest = sorted.map((g) => ({
      id: g.id,
      targetMonth: g.targetMonth,
      amount: g.amount,
      bufferPct: g.bufferPct,
      priorityBump: g.priorityBump,
      orderIndex: g.orderIndex,
      fundingStartMonth: g.fundingStartMonth,
      autoDefer: g.autoDefer,
    }));
    const value = btoa(JSON.stringify(digest));
    document.cookie = `${DIGEST_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
  void syncSliceToServer('goals', sorted);
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
  const raw = cookies().get(DIGEST_COOKIE)?.value;
  const rows = parseDigestCookie(raw);
  return rows
    // A goal with no amount yet has nothing for the plan to fund.
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
      // Defense-in-depth alongside the API-side validator: a stale
      // cookie can carry a fundingStartMonth that has slid past the
      // targetMonth (target moved earlier, or the user left the tab
      // open across a long window). Drop the deferred-start in that
      // case so the request validates instead of 422-ing the whole
      // /plan render. The UI's auto-defer effect will recompute a
      // valid index on next interaction.
      const fundingStart =
        rawFundingStart !== null &&
        targetIdx > 0 &&
        rawFundingStart >= 0 &&
        rawFundingStart < targetIdx
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
      };
    })
    .filter((g) => g.target_month_index > 0);
}

export async function readGoalsServer(): Promise<Goal[]> {
  // No server-side reads yet — slice persistence happens client-first
  // via syncSliceToServer. Server pages that need goals can re-hydrate
  // via the profile API once auth lands. Pre-auth: empty.
  return [];
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

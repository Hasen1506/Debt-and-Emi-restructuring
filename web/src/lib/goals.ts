/**
 * Goal events — finite-horizon savings targets the user wants to meet
 * by a specific date (birthday, travel, wedding, business seed,
 * downpayment, child education, medical, custom).
 *
 * Distinct from LifecycleEvent (salary / rate resets that change the
 * baseline) and from EF target (open-ended reserve). A goal has:
 *   • amount + target_date — what you need by when
 *   • kind — preset for default tax/buffer rules, or 'custom'
 *   • priority — 'critical' overrides EF diversion; 'standard' coexists
 *   • preempts_ef — when true and a shortfall exists, EF top-up pauses
 *     so surplus routes to the goal first
 *   • funding_sources — which buckets the achievability checker may
 *     tap (surplus / ef / liquidation / new_loan)
 *
 * Storage: cookie + server sync (mirrors lifecycle-events.ts).
 * Engine: not yet consumed directly — surplus / EF diversion is
 * computed pre-engine in `achievability.ts` and rendered. A future
 * pass can wire goal-funded months into the simulator's surplus stream.
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

export type GoalPriority = 'critical' | 'standard';

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
  /** Whether this goal pre-empts the EF waterfall. Critical goals
   *  (medical, urgent business) usually do; birthday usually doesn't. */
  preemptsEf: boolean;
  /** Funding-source allowlist. Defaults baked per kind; user can
   *  toggle. The achievability checker only proposes from the allowed
   *  set, so users who never want a new loan can disable that source. */
  fundingSources: GoalFundingSource[];
  /** Priority chip displayed on the goal card and used to break ties
   *  when multiple goals contend for the same surplus month. */
  priority: GoalPriority;
  /** Soft-buffer percentage applied on top of `amount` so the user
   *  arrives with cushion. Defaults baked per kind (travel 10%,
   *  wedding 15%, medical 25% to account for ER surcharges). */
  bufferPct: string;
}

// ─── Presets ───────────────────────────────────────────────────────────────

interface PresetDefaults {
  label: string;
  bufferPct: string;
  preemptsEf: boolean;
  priority: GoalPriority;
  fundingSources: GoalFundingSource[];
  description: string;
}

export const GOAL_PRESETS: Record<GoalKind, PresetDefaults> = {
  birthday: {
    label: 'Birthday party',
    bufferPct: '0.05',
    preemptsEf: false,
    priority: 'standard',
    fundingSources: ['surplus'],
    description:
      'Short-horizon, low-stakes goal. Surplus-only is enough; never tap EF for it.',
  },
  travel: {
    label: 'Travel / trip',
    bufferPct: '0.10',
    preemptsEf: false,
    priority: 'standard',
    fundingSources: ['surplus', 'liquidation'],
    description:
      "10% buffer for in-trip surprises. Liquidation allowed for users with optimisable surplus assets they'd rather convert.",
  },
  wedding: {
    label: 'Wedding',
    bufferPct: '0.15',
    preemptsEf: true,
    priority: 'critical',
    fundingSources: ['surplus', 'ef', 'liquidation', 'new_loan'],
    description:
      'High-stakes, fixed-date. EF pre-empt is on by default — most users would rather rebuild EF after than miss the date.',
  },
  education: {
    label: 'Child education',
    bufferPct: '0.10',
    preemptsEf: false,
    priority: 'critical',
    fundingSources: ['surplus', 'liquidation', 'new_loan'],
    description:
      'Long-horizon, often partially covered by education-loan tax breaks. EF stays intact; new_loan tier is the education-loan path.',
  },
  business_seed: {
    label: 'Business seed capital',
    bufferPct: '0.20',
    preemptsEf: false,
    priority: 'standard',
    fundingSources: ['surplus', 'liquidation', 'new_loan'],
    description:
      '20% buffer for working-capital surprises. EF off-limits — runway needs its own pool.',
  },
  downpayment: {
    label: 'Home downpayment',
    bufferPct: '0.05',
    preemptsEf: false,
    priority: 'critical',
    fundingSources: ['surplus', 'liquidation'],
    description:
      'Big-ticket, well-defined. No new loans (the home loan itself is the financing); liquidation is the second tier.',
  },
  medical: {
    label: 'Medical reserve',
    bufferPct: '0.25',
    preemptsEf: true,
    priority: 'critical',
    fundingSources: ['surplus', 'ef', 'liquidation', 'new_loan'],
    description:
      'Highest buffer (25%). EF pre-empt on; this is exactly the kind of thing the EF exists for, but goals with target_date model the explicit case.',
  },
  custom: {
    label: '',
    bufferPct: '0',
    preemptsEf: false,
    priority: 'standard',
    fundingSources: ['surplus'],
    description: 'Free-form goal — you set the label and the funding rules.',
  },
};

// ─── Persistence ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'finoptima_goals';

function safeParse(raw: string | null): Goal[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isValid);
  } catch {
    return [];
  }
}

function isValid(v: unknown): v is Goal {
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  // Also mirror a tiny digest to a cookie so the server-rendered /plan
  // can react to "is any active goal pre-empting EF?" without a full
  // server-side goals store. The cookie holds a base64'd JSON array of
  // {targetMonth, preemptsEf} pairs — enough for the EF-pause check.
  if (typeof document !== 'undefined') {
    const digest = goals.map((g) => ({
      targetMonth: g.targetMonth,
      preemptsEf: g.preemptsEf,
    }));
    const value = btoa(JSON.stringify(digest));
    document.cookie = `${DIGEST_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
  void syncSliceToServer('goals', goals);
}

const DIGEST_COOKIE = 'finoptima_goals_digest';

/** Server-side: does the user have any active (target month in the
 *  future) goal with preemptsEf=true? When true, /plan suspends EF
 *  top-up by forcing ef_top_up_rate=0 for that horizon. */
export async function anyActivePreemptingGoalServer(
  today: Date = new Date(),
): Promise<boolean> {
  const { cookies } = await import('next/headers');
  const raw = cookies().get(DIGEST_COOKIE)?.value;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64').toString('utf8'),
    ) as { targetMonth: string; preemptsEf: boolean }[];
    return parsed.some((g) => {
      if (!g.preemptsEf) return false;
      const y = Number(g.targetMonth.slice(0, 4));
      const m = Number(g.targetMonth.slice(5, 7));
      if (!Number.isFinite(y) || !Number.isFinite(m)) return false;
      const target = new Date(y, m - 1, 1);
      return target.getTime() >= today.getTime();
    });
  } catch {
    return false;
  }
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
    preemptsEf: p.preemptsEf,
    fundingSources: [...p.fundingSources],
    priority: p.priority,
    bufferPct: p.bufferPct,
  };
}

export function applyPresetDefaults(goal: Goal, kind: GoalKind): Goal {
  const p = GOAL_PRESETS[kind];
  return {
    ...goal,
    kind,
    label: goal.label || p.label,
    preemptsEf: p.preemptsEf,
    fundingSources: [...p.fundingSources],
    priority: p.priority,
    bufferPct: p.bufferPct,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Months between today and the goal's target_month, inclusive of the
 *  current month. Returns 0 for past / today targets. */
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

/** Required-with-buffer amount the achievability check should fund. */
export function fundedAmount(goal: Goal): number {
  const base = Number(goal.amount || '0');
  const buf = Number(goal.bufferPct || '0');
  if (!Number.isFinite(base) || base <= 0) return 0;
  return base * (1 + (Number.isFinite(buf) ? buf : 0));
}

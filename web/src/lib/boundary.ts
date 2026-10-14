/**
 * Audit 80 E19 (W9): runtime checks where data crosses into the app.
 *
 * TypeScript types are promises, not checks: `res.json() as T` believes
 * whatever the server sent. When the API renames a field, drops one, or a
 * Decimal arrives as a number, the screen shows NaN or a blank instead of an
 * error anyone sees. These parsers check the shape of the main plan
 * responses (the numbers the user reads) against the same contract the API's
 * pydantic models enforce (api/tests/test_property_schema_roundtrip.py checks
 * the Python side).
 *
 * Hand-written, no dependency (zod/valibot would add ~12-50 kB to every page).
 * A parser never changes the value: it returns it unchanged when the shape
 * holds. On a mismatch it reports ONCE per endpoint (console.error, which the
 * E2E console guard turns into a failing test) and still returns the value,
 * so a drift degrades exactly as before but is no longer silent.
 * Use `strict: true` (tests) to throw instead.
 */
import type { AuthUser, CompareResponse, SimulateResponse } from './api';

export class BoundaryError extends Error {
  constructor(public readonly where: string, public readonly problems: string[]) {
    super(`${where}: response does not match its contract: ${problems.slice(0, 5).join('; ')}`);
    this.name = 'BoundaryError';
  }
}

type Obj = Record<string, unknown>;
type Check = (v: unknown, at: string, out: string[]) => void;

/** A Decimal as the API serialises it: "123", "-4.50", "0E-25". */
const DECIMAL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const decimal: Check = (v, at, out) => {
  if (typeof v !== 'string' || !DECIMAL.test(v)) out.push(`${at} should be a decimal string, got ${JSON.stringify(v)?.slice(0, 30)}`);
};
const int: Check = (v, at, out) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) out.push(`${at} should be a whole number, got ${JSON.stringify(v)?.slice(0, 30)}`);
};
const bool: Check = (v, at, out) => {
  if (typeof v !== 'boolean') out.push(`${at} should be true/false, got ${JSON.stringify(v)?.slice(0, 30)}`);
};
const str: Check = (v, at, out) => {
  if (typeof v !== 'string') out.push(`${at} should be text, got ${JSON.stringify(v)?.slice(0, 30)}`);
};
const nullable = (c: Check): Check => (v, at, out) => { if (v !== null) c(v, at, out); };
const decimalMap: Check = (v, at, out) => {
  if (!isObj(v)) { out.push(`${at} should be an object`); return; }
  for (const [k, x] of Object.entries(v)) decimal(x, `${at}.${k}`, out);
};

/** Required keys must be present; optional keys may be absent or undefined. */
function shape(req: Record<string, Check>, opt: Record<string, Check> = {}): Check {
  return (v, at, out) => {
    if (!isObj(v)) { out.push(`${at} should be an object`); return; }
    for (const [k, c] of Object.entries(req)) {
      if (!(k in v)) out.push(`${at}.${k} is missing`);
      else c(v[k], `${at}.${k}`, out);
    }
    for (const [k, c] of Object.entries(opt)) if (v[k] !== undefined) c(v[k], `${at}.${k}`, out);
  };
}
const listOf = (c: Check, sample = Infinity): Check => (v, at, out) => {
  if (!Array.isArray(v)) { out.push(`${at} should be a list`); return; }
  // Long trajectories: check every row, but stop collecting after a few problems.
  for (let i = 0; i < v.length && i < sample && out.length < 20; i++) c(v[i], `${at}[${i}]`, out);
};

const trajectoryPoint: Check = shape(
  { month: int, balance: decimal, interest_paid: decimal, invested: decimal },
  {
    payments_by_loan_index: decimalMap, balances_by_currency: decimalMap, balances_by_loan_index: decimalMap,
    available_surplus: decimal, goal_contributions: decimalMap, total_paid: decimal, extra_paid: decimal,
    shortfall: decimal, gap_debt: decimal, gap_interest: decimal, gap_borrowed: decimal, gap_repaid: decimal,
    gap_from_savings: decimal,
  },
);

const simulate: Check = shape(
  {
    debt_free_month: nullable(int), total_interest_paid: decimal, total_invested: decimal,
    trajectory: listOf(trajectoryPoint), months_in_horizon: int,
  },
  {
    never_clears: bool, grows_without_limit: bool, trajectory_cut_month: nullable(int), shortfall: decimal,
    total_gap_interest: decimal, gap_rate: nullable(decimal), gap_rate_basis: nullable(str),
    non_amortising: listOf(shape({ loan_index: int, monthly_interest: decimal, scheduled_emi: decimal })),
    gap_closed: nullable(shape({ cut: decimal, debt_free_month: nullable(int), total_interest_paid: decimal })),
    surplus_allocation: nullable(shape({ surplus: decimal, goal_slice: decimal, ef_slice: decimal, debt_slice: decimal, ef_preempted: bool, ef_split: decimal })),
    goal_finals: listOf(shape({ goal_id: str, required: decimal, saved_at_target: decimal, fill_rate: decimal, target_reached: bool, funded: bool })),
  },
);

const compare: Check = shape(
  {
    baseline_debt_free_month: nullable(int), scenario_debt_free_month: nullable(int),
    months_pulled_forward: decimal, interest_saved: decimal, extra_invested: decimal,
  },
  {
    baseline_never_clears: bool, scenario_never_clears: bool, scenario_grows_without_limit: bool,
    scenario_trajectory: nullable(listOf(trajectoryPoint)), scenario_trajectory_cut_month: nullable(int),
    baseline_total_interest: nullable(decimal), scenario_total_interest: nullable(decimal),
    baseline_shortfall: nullable(decimal), scenario_shortfall: nullable(decimal),
    tenure_old_emi: nullable(decimal), tenure_new_emi: nullable(decimal),
    tenure_old_months: nullable(int), tenure_new_months: nullable(int),
  },
);

const authUser: Check = shape({ id: str, email: str }, { display_name: nullable(str) });

/** Problems found in `value` for this contract ([] when it holds). */
export function problemsIn(contract: 'simulate' | 'compare' | 'auth_user' | 'trajectory_point', value: unknown): string[] {
  const c = { simulate, compare, auth_user: authUser, trajectory_point: trajectoryPoint }[contract];
  const out: string[] = [];
  c(value, contract, out);
  return out;
}

const reported = new Set<string>();

function checked<T>(contract: Parameters<typeof problemsIn>[0], where: string, value: unknown, strict: boolean): T {
  const problems = problemsIn(contract, value);
  if (problems.length) {
    if (strict) throw new BoundaryError(where, problems);
    if (!reported.has(where)) {
      reported.add(where);
      console.error(new BoundaryError(where, problems).message);
    }
  }
  return value as T;
}

export interface ParseOptions { strict?: boolean }

export const parseSimulateResponse = (where: string, v: unknown, o: ParseOptions = {}) =>
  checked<SimulateResponse>('simulate', where, v, !!o.strict);
export const parseCompareResponse = (v: unknown, o: ParseOptions = {}) =>
  checked<CompareResponse>('compare', '/api/sensitivity/compare', v, !!o.strict);
export const parseAuthUser = (v: unknown, o: ParseOptions = {}) =>
  checked<AuthUser>('auth_user', '/api/auth/verify-otp', v, !!o.strict);

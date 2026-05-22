/**
 * Plan horizon — fixed at 1200 months (100 years).
 *
 * Previously derived dynamically as max(240, longest_loan_tenure+12,
 * goal_target+12) capped at 600. That added complexity (the same value
 * had to be recomputed in three places, threaded through PlanData, and
 * surfaced as "Beyond N yrs" copy in three plan variants) without any
 * upside the user cared about: every meaningful output (debt-free
 * month, goal-achieve months, retirement age) lands inside the first
 * 30-40 years anyway, and the schedule is presented as "key clearance
 * dates → expand to monthly detail," not as a horizon length.
 *
 * Hardcoding to 1200 lets the engine simulate well past any realistic
 * lifecycle event without anyone having to think about the number, and
 * removes the per-route deriveHorizonMonths call.
 */

export const HORIZON_MONTHS = 1200;

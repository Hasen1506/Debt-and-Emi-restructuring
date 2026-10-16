/**
 * Setup progress that survives Back, Forward and a reload (UX50 B-10).
 *
 * Android's back gesture on step 2 or 3 used to leave Setup for the page
 * before it, and reopening /onboarding showed an empty step 1: two minutes
 * of KFS numbers gone. Now each step has its own history entry
 * (`?step=you|loans|plan`), and what has been typed is kept in this
 * browser's localStorage until the plan is saved or the user signs out
 * (UX2-6: it was this tab's sessionStorage, so a new tab days later started
 * empty under "Saved in this browser").
 *
 * Pure helpers here; QuickSetup wires them to state and history.
 */

export const SETUP_DRAFT_KEY = 'rightdue_setup_draft';
/** A draft older than this is dropped rather than restored: 30 days. */
export const SETUP_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Editing a saved profile: a draft older than 6 hours may predate changes made in Profile since. */
export const SETUP_EDIT_DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
type DraftStores = { localStorage: Storage; sessionStorage: Storage };

/** The saved draft text: this browser's, else one an older build left in this tab. */
export function readDraftText(w: DraftStores = window): string | null {
  return w.localStorage.getItem(SETUP_DRAFT_KEY) ?? w.sessionStorage.getItem(SETUP_DRAFT_KEY);
}

/** Forget the draft (plan saved, draft expired, or signed out). */
export function dropDraft(w: DraftStores = window): void {
  try {
    w.localStorage.removeItem(SETUP_DRAFT_KEY);
    w.sessionStorage.removeItem(SETUP_DRAFT_KEY);
  } catch {
    /* private mode */
  }
}
export const STEP_PARAMS = ['you', 'loans', 'plan'] as const;

export function stepToParam(step: number): string {
  return STEP_PARAMS[Math.max(0, Math.min(STEP_PARAMS.length - 1, step))];
}

/** The step a `?step=` value names, or null when it names none. */
export function stepFromParam(value: string | null | undefined): number | null {
  if (!value) return null;
  const i = (STEP_PARAMS as readonly string[]).indexOf(value);
  return i >= 0 ? i : null;
}

/** The same URL with `?step=` set to this step (other params kept). */
export function urlWithStep(href: string, step: number): string {
  const u = new URL(href);
  u.searchParams.set('step', stepToParam(step));
  return u.pathname + u.search + u.hash;
}

export interface SetupDraft<T = Record<string, unknown>> {
  v: 1;
  savedAt: number;
  step: number;
  state: T;
}

export function serializeDraft<T>(state: T, step: number, nowMs: number): string {
  const d: SetupDraft<T> = { v: 1, savedAt: nowMs, step, state };
  return JSON.stringify(d);
}

/** The draft, if it parses, is version 1 and is recent enough; else null. */
export function parseDraft<T = Record<string, unknown>>(raw: string | null, nowMs: number, maxAgeMs = SETUP_DRAFT_MAX_AGE_MS): SetupDraft<T> | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SetupDraft<T>;
    if (!d || d.v !== 1 || typeof d.savedAt !== 'number' || typeof d.state !== 'object' || d.state == null) return null;
    if (nowMs - d.savedAt > maxAgeMs || d.savedAt > nowMs + 60_000) return null;
    const step = stepFromParam(stepToParam(Number(d.step) || 0)) ?? 0;
    return { ...d, step };
  } catch {
    return null;
  }
}

/**
 * Spending on step 1 (UX50 B-35). A blank box used to count as ₹0, and the
 * plan then sent all of the take-home to the loans: a harmful instruction
 * for anyone who skipped the field. Blank is now an error; a typed 0 needs
 * an explicit "yes, ₹0" before the plan uses it.
 */
export type SpendCheck = 'ok' | 'blank' | 'invalid' | 'zero-unconfirmed';

export function checkSpend(value: string, zeroConfirmed: boolean): SpendCheck {
  const v = value.trim();
  if (v === '') return 'blank';
  if (!/^\d*\.?\d+$/.test(v)) return 'invalid';
  if (Number(v) === 0 && !zeroConfirmed) return 'zero-unconfirmed';
  return 'ok';
}

export const SPEND_COPY = {
  blank: 'Enter about how much you spend a month: rent, bills, food and travel. A rough number is fine.',
  invalid: 'Type a number, like 35000.',
  zero: (sym: string) => `${sym}0 spending? The plan will send everything left after EMIs to your loans.`,
  zeroConfirm: (sym: string) => `Yes, ${sym}0 is right`,
  halfHint: 'Not sure? About half of the take-home is a common starting point:',
};

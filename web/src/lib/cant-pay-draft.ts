/**
 * Can't-pay answers (India and the US hardship letter).
 *
 * Written to localStorage on every change, so a hard refresh in this
 * browser keeps them even when the network is down. When someone is
 * signed in, the same object is the `cant_pay` slice of the account, so
 * a new visit on another device gets it back. What-if and the tool
 * calculators are not stored here.
 */
import type { HardshipAsk } from '@/lib/distress-triage';
import { syncSliceToServer } from '@/lib/server-sync';

export const CANT_PAY_KEY = 'rightdue_cant_pay';
export const CANT_PAY_SLICE = 'cant_pay';

export interface LetterDraft {
  loanKey?: string;
  lender?: string;
  name?: string;
  reason?: string;
  canPay?: string;
  account?: string;
  asks?: HardshipAsk[];
  /** The letter as the person typed it. Absent: the draft follows the fields. */
  edited?: string;
}

export interface CostDraft {
  loanKey?: string;
  months?: string;
  penal?: string;
  bounce?: string;
  autoDebit?: boolean;
}

export interface AgentDraft {
  open?: boolean;
  loanKey?: string;
  lender?: string;
  name?: string;
  account?: string;
  when?: string;
  what?: string;
  agent?: string;
}

export interface IndiaDraft {
  available?: string;
  /** Public page: the kind of loan the letter is about. */
  loanType?: string;
  cost?: CostDraft;
  letter?: LetterDraft;
  agent?: AgentDraft;
}

export interface UsDraft {
  available?: string;
  loanType?: string;
  letter?: LetterDraft;
}

export interface CantPayDraft {
  in?: IndiaDraft;
  us?: UsDraft;
}

type Part = 'in' | 'us';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCantPayDraft(): CantPayDraft {
  const raw = storage()?.getItem(CANT_PAY_KEY);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as CantPayDraft;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function remember(next: CantPayDraft, _sync: 'soon' | 'now' = 'now'): void {
  try {
    storage()?.setItem(CANT_PAY_KEY, JSON.stringify(next));
  } catch {
    /* A full disk keeps the page usable; the account copy is unchanged. */
  }
  // Straight away, not after a pause: a refresh in the same moment must
  // still find this copy queued for the account. A frozen test clock never
  // fires a timer, and a real refresh inside that pause used to load the
  // account's older copy over what was just typed.
  if (typeof window === 'undefined') return;
  void syncSliceToServer(CANT_PAY_SLICE, next);
}

/** Drop an empty hand-edit so the next visit follows the fields again. */
function cleanLetter(letter: LetterDraft): LetterDraft {
  const next = { ...letter };
  if (!next.edited) delete next.edited;
  return next;
}

export function saveIndia(patch: IndiaDraft, sync: 'soon' | 'now' = 'soon'): void {
  const cur = readCantPayDraft();
  const prev = cur.in ?? {};
  const letter = patch.letter ? cleanLetter({ ...prev.letter, ...patch.letter }) : prev.letter;
  const cost = patch.cost ? { ...prev.cost, ...patch.cost } : prev.cost;
  const agent = patch.agent ? { ...prev.agent, ...patch.agent } : prev.agent;
  remember({
    ...cur,
    in: {
      ...prev,
      ...patch,
      ...(letter ? { letter } : {}),
      ...(cost ? { cost } : {}),
      ...(agent ? { agent } : {}),
    },
  }, sync);
}

export function saveUs(patch: UsDraft, sync: 'soon' | 'now' = 'soon'): void {
  const cur = readCantPayDraft();
  const prev = cur.us ?? {};
  const letter = patch.letter ? cleanLetter({ ...prev.letter, ...patch.letter }) : prev.letter;
  remember({ ...cur, us: { ...prev, ...patch, ...(letter ? { letter } : {}) } }, sync);
}

/** Forget one country's answers, on this device and in the account. */
export function clearCantPay(part: Part): void {
  const cur = readCantPayDraft();
  const next = { ...cur };
  delete next[part];
  remember(next, 'now');
}

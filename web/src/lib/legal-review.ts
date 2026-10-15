/**
 * Which public texts still wait for a lawyer's read (founder decision,
 * 15 Oct 2026): the Can't pay page ships public, but every letter, and the
 * privacy notice / terms changes, carry a small "Draft — pending legal
 * review" marker until counsel signs them off. The marker never blocks use.
 *
 * One place: each id here has a row in docs/FOUNDER-RECORDS.md
 * ("Needs your sign-off / verify"); web/tests/r2-web-records.cjs fails if
 * one side names an id the other doesn't. When counsel signs one off, set it
 * to 'signed_off' here and mark the row done there; the marker disappears.
 */
export type ReviewStatus = 'pending' | 'signed_off';

export const LEGAL_REVIEW = {
  /** India + US hardship-request letter (Can't pay, signed in and public). */
  'letter-hardship': 'pending',
  /** India recovery-agent complaint (Can't pay). */
  'letter-recovery-agent': 'pending',
  /** Loan Check A11: EMI or tenure changed without the choice (18 Aug 2023 circular). */
  'letter-rate-reset': 'pending',
  /** US letters page: hardship (12 CFR 1006.6 note), FCBA billing error, RESPA notice of error. */
  'letter-us': 'pending',
  /** Privacy notice changes of 15 Oct 2026 (emails, funnel, consent records, contact addresses). */
  'privacy-notice-2026-10-15': 'pending',
  /** Terms changes of 15 Oct 2026 (emails, Chennai forum + US$15 cap for US users). */
  'terms-2026-10-15': 'pending',
} as const satisfies Record<string, ReviewStatus>;

export type ReviewId = keyof typeof LEGAL_REVIEW;

export const DRAFT_MARKER_TEXT = 'Draft — pending legal review';

export function isPendingReview(id: ReviewId): boolean {
  return (LEGAL_REVIEW[id] as ReviewStatus) !== 'signed_off';
}

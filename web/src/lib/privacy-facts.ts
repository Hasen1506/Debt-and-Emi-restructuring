/**
 * One place for the facts the privacy notice and terms state (grill #51),
 * so a change (a new grievance address, a move of region) is made once and
 * tested (tests/g8-security-privacy.cjs). Every legal reference below was
 * read from the primary text on meity.gov.in on 12 Oct 2026:
 *   DPDP Act 2023 (Act 22 of 2023):
 *     https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
 *   DPDP Rules 2025 (G.S.R. 846(E), 13 Nov 2025, published 14 Nov 2025):
 *     https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
 *   Commencement of the Act (G.S.R. 843(E), 14 Nov 2025):
 *     https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
 * Not legal advice; no lawyer has reviewed this notice (docs/BOTTLENECKS.md).
 */

/** audit80 D2: the version the sign-in page sends with "Agree and send
 *  code"; the server stores it in consent_events. Change BOTH this and
 *  api/privacy_facts.py (a test fails if they differ). A new version makes
 *  every signed-in user agree again once (GET /api/auth/me consent_required). */
export const NOTICE_VERSION = '2026-10-14';
export const TERMS_VERSION = '2026-10-14';
export const NOTICE_LAST_UPDATED = '14 October 2026';

/** Who decides why and how the data is used (the "Data Fiduciary"). */
export const DATA_FIDUCIARY = {
  name: 'RightDue',
  operatedBy: 'Vijeya Hasen K H, founder (a sole proprietorship registered in India)',
  website: 'https://rightdue.app',
};

/** DPDP Rules 2025 r.9 and r.14: a published contact who can answer
 *  questions about processing and handle grievances. Founder decision on a
 *  dedicated alias (answers G8). */
export const GRIEVANCE_CONTACT = {
  name: 'Vijeya Hasen K H',
  role: 'Founder; handles privacy questions and grievances',
  email: 'vijeya@rightdue.app',
};

/** r.14(3): grievances answered within a period not exceeding 90 days.
 *  audit80 D12: one promise on both pages, well inside that limit. */
export const GRIEVANCE_REPLY_DAYS_MAX = 30;
/** The legal ceiling the promise sits under (DPDP Rules 2025 r.14(3)). */
export const GRIEVANCE_REPLY_DAYS_LEGAL_MAX = 90;

/** Where the server copy lives (docs/region-colocation.md). */
export const STORAGE = {
  database: 'Neon Postgres, AWS Asia Pacific (Singapore) region',
  appServer: 'Render, Oregon (USA) region',
  // UX50 E-10: DNS points straight at Render; our own Cloudflare zone is not
  // in the path. Render's edge is operated by Cloudflare, so name that.
  network: "Render's content network (operated by Cloudflare) carries traffic to rightdue.app",
  email: 'Resend, an email delivery service based in the USA, sends sign-in codes',
};

export const RETENTION = {
  signInRecordsDays: 365,
  /** audit80 D6: sign-in records, consent record and access log of a
   *  deleted account (founder decision, rank 12). */
  deletedAccountRecordsDays: 365,
  accessLogDays: 365,
  /** Neon Free's point-in-time restore window (docs/RUNBOOK.md §2). */
  databaseRestoreHours: 6,
  /** Encrypted nightly backups, longest kept: 14 daily + 8 weekly copies,
   *  the oldest at most 55 days old (docs/BACKUPS.md §2, db-backup.yml). */
  backupDays: 56,
  sessionDays: 30,
  signInCodeMinutes: 10,
  rateCounterHours: 24,
  outcomeClientHashDays: 2,
};

/** audit80 D5: every service that handles personal data for us, with when
 *  it is in use. The export (api/privacy_facts.py PROCESSORS) lists the
 *  same names; a test fails if one side names a service the other doesn't.
 *  `when` is shown in the notice; 'always' entries are in use today. */
export const PROCESSORS: { who: string; role: string; data: string; when: 'always' | string }[] = [
  { who: 'Neon', role: 'database host, AWS Asia Pacific (Singapore)', data: 'your account, saved plan, sign-in, consent and access records, payday-email settings', when: 'always' },
  { who: 'Render', role: 'app server, Oregon (USA)', data: 'requests while they are processed, including a credit report or KFS PDF you upload (read once, not stored)', when: 'always' },
  { who: 'Cloudflare', role: "network in front of rightdue.app (it operates Render's edge)", data: 'requests in transit', when: 'always' },
  { who: 'Resend', role: 'email delivery (USA)', data: 'your email address and sign-in codes', when: 'always' },
  { who: 'Google Fonts', role: 'page font, loaded by your browser', data: 'your IP address when the font loads', when: 'always' },
  { who: 'Yahoo Finance', role: 'share prices for the portfolio tool', data: 'ticker symbols only, never who asked', when: 'always' },
  { who: 'Resend (payday emails)', role: 'email delivery (USA)', data: 'the payday reminder you switch on: lender names and payment amounts', when: 'only if you switch payday emails on' },
  { who: 'Sentry', role: 'error reports (USA)', data: 'error details with digits masked; none of your figures, email or address', when: 'only when we switch it on' },
  { who: 'Cloudflare Turnstile', role: 'check on the sign-in page that you are a person', data: 'your IP address and browser signals, during the check', when: 'only when we switch it on' },
  { who: 'Google sign-in', role: 'optional sign-in', data: 'your email address, as Google verified it', when: 'only if you choose Continue with Google' },
];

export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';
export const ACCOUNT_PATH = '/account';

/** The Data Protection Board of India, for complaints (Act s.13(3), s.27). */
export const BOARD = {
  name: 'Data Protection Board of India',
  note: 'established by the Central Government under section 18 of the Act',
};

export const SOURCES = {
  act: 'https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf',
  rules: 'https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf',
  commencement: 'https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf',
};

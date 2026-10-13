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

export const NOTICE_VERSION = '2026-10-12';
export const NOTICE_LAST_UPDATED = '12 October 2026';

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

/** r.14(3): grievances answered within a period not exceeding 90 days. */
export const GRIEVANCE_REPLY_DAYS_MAX = 90;

/** Where the server copy lives (docs/region-colocation.md). */
export const STORAGE = {
  database: 'Neon Postgres, AWS Asia Pacific (Singapore) region',
  appServer: 'Render, Oregon (USA) region',
  network: 'Cloudflare, which carries traffic to rightdue.app through its worldwide network',
  email: 'Resend, an email delivery service based in the USA, sends sign-in codes',
};

export const RETENTION = {
  signInRecordsDays: 365,
  sessionDays: 30,
  signInCodeMinutes: 10,
  rateCounterHours: 24,
  outcomeClientHashDays: 2,
};

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

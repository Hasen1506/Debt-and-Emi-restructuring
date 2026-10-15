# Privacy, data rights and retention

Grill #51, sprint G8 (12 Oct 2026); updated 14 Oct 2026 for audit 80+
Section D (D2-D8, D12, D21, D24, D25). What RightDue stores, why, for how long,
and how a user sees or deletes it. The user-facing version is the notice at
`/privacy` (`web/src/app/privacy/page.tsx`, facts in
`web/src/lib/privacy-facts.ts`). Not legal advice: no lawyer has checked this
(docs/BOTTLENECKS.md, "Legal review").

## The law, as read from the primary text

| Instrument | Source (meity.gov.in, read 12 Oct 2026) |
| --- | --- |
| Digital Personal Data Protection Act, 2023 (Act 22 of 2023, assented 11 Aug 2023) | https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf |
| DPDP Rules, 2025 (G.S.R. 846(E), dated 13 Nov 2025, published 14 Nov 2025) | https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf |
| Commencement of the Act (G.S.R. 843(E), 14 Nov 2025) | https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf |
| Corrigendum to the Rules (16 Dec 2025) | listed at https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa (not read in full) |

**When it applies.** Rules 1, 2 and 17–21 (the Board) took effect on
publication; rule 4 (Consent Managers) one year later; rules 3, 5–16, 22 and
23 eighteen months later (rule 1(2)–(4)), i.e. from **14 May 2027**. The
commencement notification does the same for the Act: s.6(9) and s.27(1)(d)
after one year; ss.3–5, 6(1)–(8) and (10), 7–17, 27 (rest), 28–34, 36, 37 and
44(2) after eighteen months. RightDue follows them now.

**What we built against each duty.**

| Duty | Where in the law | What RightDue does |
| --- | --- | --- |
| Notice before consent: itemised data, purpose, how to withdraw, use rights, complain to the Board | Act s.5(1); Rules r.3 | `/privacy`, linked on the sign-in form above the "Agree and send code" button |
| Consent is a clear affirmative action, limited to the data needed | Act s.6(1) | The button names the action; we ask only for an email to sign in |
| Prove what was agreed, to which version, when | Act s.6(10) (burden of proof on the Fiduciary) | `consent_events` row at every sign-in that creates an account or re-agrees: notice + terms versions (`NOTICE_VERSION`/`TERMS_VERSION`, same in `api/privacy_facts.py` and `web/src/lib/privacy-facts.ts`), purpose, 18+ tick, channel, time (D2) |
| Re-consent when the notice or terms change | Act s.5, s.6 | `/api/auth/me` returns `consent_required` when the latest agreement is for an older version; the app shows a one-tap notice (`ConsentNotice.tsx`, D2/D12). Change emails go only to accounts that agreed to an older version |
| Withdrawal as easy as giving consent | Act s.6(4); Rules r.3(c)(i) | One form on `/account`: type the email, confirm |
| Reasonable security safeguards | Act s.8(5); Rules r.6 | HttpOnly session cookie, keyed HMAC of sign-in codes (`OTP_HASH_KEY`, fallback `INTERNAL_API_TOKEN`, D25) and hashed session keys, HTTPS + HSTS preload, CSP and frame-ancestors (grill #58, D23), rate limits (grill #59, D13), PDF parse limits (D15), no query strings in request logs (D24) |
| Visibility of access through logs, kept a year | Rules r.6(1)(c), (e) | `access_log`: one row per saved-plan read/write, export, delete, device sign-out, consent change; account id, action, route, outcome, time, never figures or IPs (D8) |
| Backups for continued processing | Rules r.6(1)(d) | Nightly encrypted `pg_dump` with a restore test; weekly restore drill; stored in a private GitHub repo, 14 daily + 8 weekly copies (D14, docs/BACKUPS.md). **Not yet running**: the founder has to add four secrets |
| Device control | Rules r.6(1)(a)-(b) | `/account` lists signed-in devices (coarse "Chrome on Android" label, no IP) with sign-out one / sign-out everywhere (D21) |
| Breach intimation to each user and to the Board (72 h detailed report) | Act s.8(6); Rules r.7 | Process in "Breach" below; nothing automated |
| Erase on withdrawal / when purpose ends | Act s.8(7), s.12(3) | `POST /api/auth/account/delete` |
| Publish a contact who can answer data questions | Act s.8(9); Rules r.9 | `GRIEVANCE_CONTACT` in privacy-facts.ts |
| Grievance redressal, reply within 90 days | Act s.13; Rules r.14(3) | Email to the contact; notice promises at most 90 days |
| Summary of data + who it was shared with | Act s.11(1)(a)-(b) | `GET /api/auth/account/export` (format v2: account, saved plan, sign-in sessions with device labels, sign-in codes sent, consent history, payday-email setting, access log, processor list; D5) |
| Correction | Act s.12(2) | Profile editing |
| Nomination | Act s.14; Rules r.14(4) | By email to the contact (no form yet) |
| Children: verifiable parental consent | Act s.9; Rules r.10 | RightDue is 18+ only (notice and terms); a required "I am 18 or older" tick on sign-in, stored in `consent_events.age_confirmed` (D7). A self-declaration, not verification |
| Notice in English or an Eighth Schedule language, at the user's option | Act s.5(3) | **Not done**: English only (founder decision, answers G8) |
| One year of processing logs | Rules r.6(1)(e), r.8(3) | Sign-in records kept 365 days (below) |
| Cross-border transfer allowed unless the Government restricts a country | Act s.16; Rules r.15 | Data is in Singapore and the USA; no restriction notified as of 12 Oct 2026. Co-locating the app in Singapore: docs/region-colocation.md (D9) |

Rule 8(1) and the Third Schedule (erase after three years of inactivity) apply
only to e-commerce entities and social media intermediaries with at least two
crore (20 million) registered users in India, and online gaming
intermediaries with at least fifty lakh (5 million), so not to RightDue.

## What each table holds

| Table | Contents | Kept |
| --- | --- | --- |
| `users` | email, display name, created, last sign-in. Created only when a code is **verified** (grill #59), never on a request | until the account is deleted |
| `user_state` | the saved plan (JSON blob: loans, income, goals, activity…) | until deleted |
| `sessions` | SHA-256 of the session key, created/expires/revoked, coarse device label from the user agent (no IP), last seen | 365 days after expiry or sign-out |
| `otp_challenges` | email, keyed HMAC of the code (blanked once used or expired), sent/expires/used, wrong guesses, a keyed network hash (D13), whether it was for an existing account | 365 days after sent |
| `consent_events` | account id, email, given / re-given / withdrawn, notice + terms versions, purpose, 18+ tick, channel, time | while the account exists; 365 days after withdrawal (deletion) |
| `access_log` | account id (not a foreign key), action, route template, outcome, time | 365 days after the access, also for a deleted account |
| `auth_log_tombstones` | for a deleted account only: email, kind (code / session), started/used/ended, wrong guesses, deleted at. No code or session hash | 365 days after deletion |
| `otp_codes` | LEGACY codes keyed by user, from before grill #59; nothing writes it | 365 days, then empty |
| `rate_buckets` | keyed HMAC of the client address + route + hour, a count | a day after the hour ends |
| `outcome_reports` (api/outcomes_store.py) | anonymous lender outcomes, not linked to an account; keyed hash of the address for the daily limit | hash wiped after 2 days |

Settings: `AUTH_LOG_RETENTION_DAYS` (default 365). The purge
(`api/auth/retention.py`) runs at API start and then at most every 6 hours from
the sign-in route; the free plan has no scheduler and both are cheap.

**Deleting an account** removes `user_state`, every `sessions` row, every
`otp_challenges`/`otp_codes` row for the email, and the `users` row, in one
transaction, then clears the cookie. Rule 8(3)'s one-year log duty (from May
2027) is met by what stays for 365 days: `auth_log_tombstones` (when codes
were sent and sessions ran, no secrets), the `access_log` rows and a
"withdrawn" `consent_events` row (D6). The browser then wipes every
`finoptima_*` / `rightdue_*` cookie, localStorage key and IndexedDB database
(`web/src/lib/account.ts`).

**Copies in the browser (D16, D21).** Pages render a guest's plan on the
server from readable `rightdue_*` cookies and localStorage. For a signed-in
account those copies are a cache of the server copy: since 14 Oct 2026 they
are written with a 30-day lifetime (the sign-in's `SESSION_TTL`) instead of a
year (`web/src/lib/readable-cookie-age.ts`), and they are wiped when a
session ends, whether by sign-out, revoke or simple expiry (an `auth/me` 401
for a known account). A guest's copy keeps a year because it is the only
copy. Still open (RUNBOOK §9, E-09b): stop mirroring account data into
script-readable storage at all, and a nonce CSP without `'unsafe-inline'`.

**Request logs (D24).** The container's access log prints the path only
(`api/request_log.py`; uvicorn's own access log is off), so a credit score in
`?score=` or a token in `?t=` never reaches Render's logs. `REQUEST_LOG=off`
silences it. Render keeps service logs for a short window and nothing is
streamed out.

## Processors (Act s.8(2): "Data Processors")

Neon (database, AWS Singapore), Render (app server, Oregon), Cloudflare (DNS,
proxy, Turnstile when on), Resend (email, USA), Sentry (error reports, only
when `SENTRY_DSN` is set; scrubbed, see api/observability.py), Google Fonts
(the browser fetches the font). s.8(2) asks for a valid contract with each,
and Rules r.6(1)(f) for contract terms on safeguards: their standard
terms/DPAs apply; nobody has signed anything specific (BOTTLENECKS).
**Founder action (D8):** accept each published DPA (Neon, Render, Resend,
Cloudflare, Sentry if on), save a copy, and list them with dates on one page
here. Create `privacy@rightdue.app` and make it the grievance contact.

## Breach (Rules r.7)

1. On becoming aware: write down what, when, how much, which users.
2. Email each affected user without delay: what happened, likely consequences,
   what we did, what they can do, who to contact (r.7(1)(a)–(e)).
3. Tell the Data Protection Board without delay, and send the detailed report
   within 72 hours (r.7(2)(b)).
4. Rotate secrets (`DATABASE_URL` password, `RESEND_API_KEY`,
   `INTERNAL_API_TOKEN`, `OUTCOMES_IP_KEY`); revoke all sessions
   (`UPDATE sessions SET revoked_at = now()`).

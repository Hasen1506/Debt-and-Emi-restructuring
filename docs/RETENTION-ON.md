# Turning on retention emails and the funnel (for Vijay)

Everything here ships **off**. Nothing is emailed and nothing is counted until
you flip the switches below. Do them in order; each step says how to check it.

## Why the emails are off today

The code is in, and Resend's DNS records for rightdue.app (DKIM, SPF, DMARC)
already exist, so mail *can* be sent. What's missing is settings: the feature
flags are false and the secrets the emails need (for signed links and for the
daily scheduler) were never set.

## Before you start: the Resend limit (staying on Free)

Decision 15 Oct 2026: stay on **Resend Free** (no $20/month Pro). Free =
**100 emails a day and 3,000 a month**, and *everything* counts: sign-in
codes, payday emails, deadline reminders, rate-move emails, and every reply
Resend receives for us (resend.com/pricing, read 15 Oct 2026).

So the app keeps **one shared budget** for all of them (api/notify/budget.py):

- **95 a day** by default (`RESEND_DAILY_LIMIT`), five under Resend's 100 so a
  reply or a retry never tips us over; **3,000 a month** (`RESEND_MONTHLY_LIMIT`).
- **Sign-in codes always come first.** They are never refused by this
  budget (only by their own per-address and new-sign-up limits), and the
  daily run holds back room for codes still to come that day: 20, or as
  many as were sent yesterday if that was more (`RESEND_CODE_RESERVE`).
- **Reminder emails take what is left.** On a normal day that is
  95 − 20 = **75 notification emails**.
- **Nobody is skipped, only delayed.** What doesn't fit today goes out on the
  next run, in a fair order: **deadline reminders first** (a missed
  Ombudsman or billing-dispute date loses a right), then payday and
  rate-move emails, **oldest first**. A late reminder is reworded for the day
  it actually goes ("Tomorrow…", not "In 7 days…").
- **Monthly guard:** notifications also stop before the month's 3,000 runs
  out, keeping enough for sign-in codes for the rest of the month (20 a day,
  or this month's average if higher).

### When Free stops being enough (the math)

Assumptions (estimates, not measurements): someone with emails on gets
1 payday email a month, about 0.3 other emails a month (a rate-move email
after each RBI change, a few deadline reminders while a complaint is open),
and needs about 1.5 sign-in codes a month (sessions last 30 days).

- **Daily:** payday emails bunch on the same days (the 1st and the last
  working day are common salary days). A payday email may go out on payday
  or up to 3 days late, so the busiest payday can absorb about
  4 days × 75 = **~300 payday emails**. If roughly half of people are paid on
  the same day, that is about **600 people with payday emails on**.
- **Monthly:** 3,000 ÷ (1.5 codes + 1.3 notifications) ≈ **1,000 active users
  with emails on** (about 2,000 who only sign in).

**Free is enough until roughly 300 people share one payday, or about 1,000
monthly active users with emails on, whichever comes first.** You will see it
coming: `/api/notify/status` shows `monthly_room` and today's room, and the
Notifications workflow log prints `deferred` counts. When `deferred` is
non-zero on payday two months running, move to Pro and set
`RESEND_DAILY_LIMIT=0` and `RESEND_MONTHLY_LIMIT=50000` on Render.

## Step 1. Render: the `rightdue` service's Environment

The app is one Render service now (`rightdue`, Docker: Next.js and FastAPI in
one container). Render → `rightdue` → Environment → add:

| Name | Value |
|---|---|
| `NOTIFY_SIGNING_KEY` | a new random string, 32+ characters (e.g. `openssl rand -hex 32`) |
| `NOTIFY_CRON_SECRET` | another new random string, 16+ characters (`openssl rand -hex 24`). Keep it: GitHub and cron-job.org need the same value |
| `PUBLIC_APP_URL` | `https://rightdue.app` |
| `PAYDAY_EMAIL_ENABLED` | `true` |
| `DEADLINE_REMINDERS_ENABLED` | `true` |
| `RATE_MOVE_EMAIL_ENABLED` | `true` (the email after each RBI repo decision) |

Also check `RESEND_FROM` is an address on rightdue.app, e.g.
`RightDue <hello@rightdue.app>` (an `onboarding@resend.dev` address only
delivers to you). Save → Render redeploys.

You can turn the three features on one at a time; each flag is independent.

**Check:** ask the server what is still missing (names only, never values):

```bash
curl -H "Authorization: Bearer <NOTIFY_CRON_SECRET>" https://<api host>/api/notify/status
```

`"missing": []` means ready. `budget.allowance_today` shows how many
notification emails may go out today (`daily_room`, `monthly_room`,
`codes_today` and `code_reserve_left` show why).

## Step 2. The daily send (09:00 IST)

Use **both**; the server lets only one run at a time (the second gets 409), and
each email goes once per month / per RBI decision, so nobody gets two.

**GitHub** (repo → Settings → Secrets and variables → Actions):
- Variables: `NOTIFY_ENABLED` = `true`, `PUBLIC_APP_URL` = `https://rightdue.app`
- Secret: `NOTIFY_CRON_SECRET` = the same value as on Render

The workflow "Notifications" runs daily at 09:00 IST. GitHub sometimes starts
it an hour late, and if it fails it opens a GitHub issue "Notification job
failed" so you hear about it.

**cron-job.org** (on time, and wakes the free Render instance):
- URL: `https://<api host>/api/notify/run`, method **POST**
- Header: `Authorization: Bearer <NOTIFY_CRON_SECRET>`
- Schedule: every day 09:00, timezone Asia/Kolkata

**Check:** GitHub → Actions → Notifications → "Run workflow". The log prints
how many were sent, how many were deferred by the daily cap, and rate-move
counts.

## Step 3. Privacy notice

The notice and terms already describe payday / deadline / rate-move emails
and the counts-only funnel (round 2, 15 Oct 2026), shown on the pages with a
"Draft — pending legal review" marker. Before turning emails or the funnel
on: get counsel's sign-off (docs/FOUNDER-RECORDS.md, "Needs your sign-off"),
then bump `NOTICE_VERSION` / `TERMS_VERSION` in **both**
`web/src/lib/privacy-facts.ts` and `api/privacy_facts.py` so every signed-in
user agrees to the new version once.

## Step 4 (optional). Counts-only funnel and fake doors

Shows where people drop off in Setup, and whether anyone wants the ₹299
letter pack or ₹99/month Plus before you build them.

- Render `rightdue`: `FUNNEL_ENABLED=true`, `FUNNEL_ADMIN_SECRET` = a new random string
- Render `rightdue`: `NEXT_PUBLIC_FUNNEL=1`. This one is compiled into the page, so after
  setting it use **Manual Deploy → Clear build cache & deploy** (the Dockerfile passes it
  to the build since round 2; before that it never reached the page).

Read it:

```bash
curl -H "Authorization: Bearer <FUNNEL_ADMIN_SECRET>" "https://<api host>/api/funnel/admin?days=30"
```

Fake-door rule: after 50 people have seen a door, if fewer than 2% tapped
"notify me", drop the idea (the admin read says which doors to kill).

## Turning it off again

Set the flag to `false` (or remove it) on Render. With every flag off the
email routes answer 404 and the opt-ins disappear from the app. To stop the
schedule too, set the GitHub variable `NOTIFY_ENABLED` to `false` and pause the
cron-job.org job.

## Render environment variables, in plain words

All on the one `rightdue` service. "Build" = compiled into the page: after
changing it use **Clear build cache & deploy**. Everything else takes effect on
the next deploy (Render redeploys when you save).

**Needed to run at all**

| Name | What it does |
|---|---|
| `DATABASE_URL` | Where accounts and saved plans live (Neon Postgres). |
| `RESEND_API_KEY` | Lets the app send email through Resend (sign-in codes and everything else). |
| `RESEND_FROM` | The "From" address, e.g. `RightDue <signin@rightdue.app>`. A resend.dev address only reaches you. |
| `WEB_ORIGIN` | The site's own address(es), e.g. `https://rightdue.app`, so sign-in forms posted from elsewhere are refused. |
| `INTERNAL_API_TOKEN` | Generated by Render. The page server's own calls to the API skip rate limits; also the fallback key for sign-in code hashes. |
| `OUTCOMES_IP_KEY` | Generated. Scrambles visitor addresses before counting reports per day. |
| `COOKIE_SECURE` = `1`, `COOKIE_SAMESITE` = `lax` | Sign-in cookie only over HTTPS, not sent from other sites. |
| `TRUSTED_PROXY_HOPS` = `3` | How to find the visitor's real address behind Render's network (for rate limits). |
| `NEXT_PUBLIC_DISABLE_AUTH` (build) | `false` for real accounts. `true` only for a local trial. |

**Emails (all off until set)**

| Name | What it does |
|---|---|
| `PAYDAY_EMAIL_ENABLED` | `true` = people can switch on the payday email. |
| `DEADLINE_REMINDERS_ENABLED` | `true` = reminders before complaint and closure-letter dates. |
| `RATE_MOVE_EMAIL_ENABLED` | `true` = the email after an RBI repo-rate change. |
| `NOTIFY_SIGNING_KEY` | Secret that signs the links in emails ("All paid", unsubscribe) so they can't be forged. |
| `NOTIFY_CRON_SECRET` | Password the daily scheduler sends; the same value goes in GitHub and cron-job.org. |
| `PUBLIC_APP_URL` | `https://rightdue.app`; used to build links in emails. |
| `RESEND_DAILY_LIMIT` | Shared daily email budget. Default 95 (Free). `0` = no daily limit (Pro). |
| `RESEND_MONTHLY_LIMIT` | Shared monthly budget. Default 3000 on Free. `50000` on Pro; `0` = none. |
| `RESEND_CODE_RESERVE` | Emails a day held back for sign-in codes before reminders get any. Default 20. |
| `NOTIFY_DAILY_CAP` | Optional extra ceiling on reminder emails a day. Usually leave unset. |
| `PAYDAY_REPLY_INBOUND`, `NOTIFY_REPLY_TO`, `RESEND_WEBHOOK_SECRET` | Optional: let people reply "done" to the payday email. Each reply also counts against Resend's limit. |

**Sign-in and safety (each off while empty)**

| Name | What it does |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build) + `TURNSTILE_SECRET_KEY` | Cloudflare's "are you a person" check before a code is sent. Set both or neither. |
| `OTP_HASH_KEY` | Secret used to scramble stored sign-in codes. Empty = uses `INTERNAL_API_TOKEN`. |
| `OTP_GLOBAL_DAILY_CAP` | Most codes a day to *new* addresses (default 60). Existing accounts are never blocked by it. |
| `OTP_NEW_PER_NETWORK_DAILY`, `OTP_ACCOUNT_DAILY_CAP` | Codes a day per connection for new sign-ups (5), per existing account (5). |
| `GOOGLE_SIGNIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | "Continue with Google". Off unless `GOOGLE_SIGNIN=1` and all three are set. |
| `SENTRY_DSN` | Where scrubbed error reports go. Empty = none sent. |
| `ALLOW_SCHEMA_DRIFT` | Emergency only: start even if the database tables don't match the code. Never leave on. |

**Measurement and product switches**

| Name | What it does |
|---|---|
| `FUNNEL_ENABLED` + `FUNNEL_ADMIN_SECRET` | Counts-only funnel (daily totals, no user id or address) and the password to read it. |
| `NEXT_PUBLIC_FUNNEL` (build) | `1` = the page sends the funnel counts. |
| `SCORECARD_MODE` | `hidden` (default): lender figures held back; `verified` / `labelled` show them. |
| `LIQUIDATION_RANKER` | `on` turns on the "which asset to sell" ranking. Off by founder decision (sell-to-repay stays a calculator). |

**Tuning (leave unset unless something is wrong):** `RATE_LIMITS`, `RATE_LIMIT_STORE`,
`RATE_BUCKET_KEY`, `RATES_FEED`, `REQUEST_LOG`, `MAX_BODY_BYTES`, `ENGINE_CACHE_SIZE`,
`AUTH_LOG_RETENTION_DAYS`, `CLIENT_IP_HEADER`, `SENTRY_ENVIRONMENT`, `OUTCOMES_DATABASE_URL`,
`ADMIN_RATE_UPDATE_TOKEN`. Each one's default is in the code next to where it is read.

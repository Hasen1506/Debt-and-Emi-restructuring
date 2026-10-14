# Turning on retention emails and the funnel (for Vijay)

Everything here ships **off**. Nothing is emailed and nothing is counted until
you flip the switches below. Do them in order; each step says how to check it.

## Why the emails are off today

The code is in, and Resend's DNS records for rightdue.app (DKIM, SPF, DMARC)
already exist, so mail *can* be sent. What's missing is settings: the feature
flags are false and the secrets the emails need (for signed links and for the
daily scheduler) were never set.

## Before you start: the Resend limit

Resend Free = **100 emails a day, 3,000 a month**, and sign-in codes use the
same allowance. Sign-in codes are capped at `OTP_GLOBAL_DAILY_CAP` (default 90)
so people can always log in. Reminder emails only get what is left:
**100 − 90 = 10 a day** by default. Anyone not emailed today because of the cap
is emailed on a later run (nobody is skipped, only delayed).

Pick one:
- **Stay on Free**: set `OTP_GLOBAL_DAILY_CAP=60` on Render → reminders get
  about 40 a day. Fine while you have a few hundred users.
- **Resend Pro** ($20/month, 50,000/month, no daily cap): set
  `RESEND_DAILY_LIMIT=0` on Render. Optional: `NOTIFY_DAILY_CAP=500` as a safety
  limit.

## Step 1. Render: the API service's Environment

Render → the API service → Environment → add:

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
notification emails may go out today.

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

Before turning on, add to the privacy notice: payday / deadline / rate-move
emails are opt-in; for them we keep the loan names, amounts, rate, EMI and
months left the user ticked, until they turn the email off (then deleted);
the funnel (step 4) keeps only daily totals, no user id or IP.

## Step 4 (optional). Counts-only funnel and fake doors

Shows where people drop off in Setup, and whether anyone wants the ₹299
letter pack or ₹99/month Plus before you build them.

- Render API service: `FUNNEL_ENABLED=true`, `FUNNEL_ADMIN_SECRET` = a new random string
- Render web service: `NEXT_PUBLIC_FUNNEL=1` (build-time: redeploy the web service after setting it)

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

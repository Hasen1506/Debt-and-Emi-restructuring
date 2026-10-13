# Payday email: "pay these, in this order" (grill #2, add #3)

Off by default. Turn on with `PAYDAY_EMAIL_ENABLED=true` (DEPLOY.md, "Notifications").

## The loop

1. A signed-in user turns it on under Home's "Pay this month" and picks the day their salary arrives (1 to 31; a 31 in a 30-day month means the 30th, as payroll does).
2. The app sends the server this month's payment list: name, amount, kind (EMI, minimum, extra, pays it off, fund, goals) and a card's due day. Nothing else: no balances, no account numbers, no UPI IDs. Opening Home refreshes it at most once a day.
3. On payday a scheduler calls `POST /api/notify/run`. The email lists the payments in order, with the total, and says plainly that RightDue can't see the bank. If the list is more than 40 days old it says so and asks the user to open the app first.
4. The user taps "All paid", "Paid some of it" or "I can't pay this month". The link opens a confirm page; nothing is recorded until they press the button (mail scanners open links by themselves).
5. Next time they open Home, "Pay this month" shows the answer: "You told us by email on 1 Nov that you paid everything. MARK THEM PAID / NOT NOW". Only that tap writes to Activity. "Can't pay" shows what to protect first (L4's triage expands this).
6. Optional: reply "done" to the email (`PAYDAY_REPLY_INBOUND=true`). Resend receives the reply and calls a webhook. It counts only if the webhook signature checks out, it went to that user's reply code, the From is the subscriber's own address with DKIM or DMARC passing, and the first line the user typed says done (or says not paid). The quoted email below never counts.

## Measuring it (D30 / D60)

`GET /api/notify/metrics` (scheduler secret) returns, among people who opted in, the share who did something on days 30–59 (D30) and 60–89 (D60) after opting in: a tap in the email, a "done" reply, or opening Home signed in (the list refresh). Receiving an email doesn't count. Users opted in fewer than 30 (60) days ago aren't in the denominator yet. Nothing else is tracked.

## Cost

Resend's free plan sends 3,000 emails a month, 100 a day; Pro is $20 a month for 50,000 (resend.com/pricing, read 12 Oct 2026). Inbound replies count against the same quota. One payday email per user per month plus a few reminders fits the free plan up to roughly 2,000 users, but the 100-a-day cap bites first if many users share a payday (the 1st): above about 100 users on one day, move to Pro.

## Scheduling

`.github/workflows/notify.yml` runs once a day at 03:30 UTC (09:00 IST), only when the repository variable `NOTIFY_ENABLED` is `true`, and calls the endpoint with the secret. It also wakes the free Render instance. Each run is one curl, well under a minute of Actions time. Each user's "today" is their own country's date (India: Asia/Kolkata; US: America/New_York). 03:30 UTC is 09:00 in India and 22:30–23:30 the evening before in New York, so a US user gets the email late on the evening of payday. If US users opt in, add a second run at about 13:00 UTC (morning in New York).

## Privacy

What is stored per user: the payday day, the latest list (names, amounts, kinds), the reminder dates, what was sent and their answers. "Turn off" in any email (one click, RFC 8058 headers) deletes the list and the reminder dates. `NotifyStore.forget(user_id)` deletes everything and must be called from account deletion (G8 owns that route).

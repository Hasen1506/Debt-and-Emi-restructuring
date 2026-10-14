# Founder answers — Audit 80+ (14 Oct 2026)

Plain-language answers to every open question in Vijay's notes on Audit 80+
(`work/vijay-responses.md`, from his handwritten notes of 14 Oct 2026), plus a
ranked list of what would differentiate RightDue most.

Where another workstream of this fix built the answer, it says so (W1 engine,
W2 tax, W3 product cards, W4 Loan Check and rates, W5 reminders and
measurement, W6 onboarding/copy, W7 navigation, W8 trust/ops, W9 bloat,
W10 personas). Branch names are `hark/a80-wNN-*`; nothing is merged, pushed or
deployed yet. Sources were opened on 14 Oct 2026 unless a date is given.

---

## Part 1 — The top-of-notes asks

### 1. "Address the remaining engine work (Section C)"
W1 owns it and has built: tenure-first on a rate rise for Indian loans (C1:
the ₹50 L, 8.5%, 240-month repro now keeps the ₹43,391 EMI and runs longer
instead of jumping to ₹46,498), bullet and gold loans that mature (C2),
end-of-contract residuals cleared (C3/C6), lock-ins that run down (C4), cash
held during a lock-in paid in when it ends (C5), a credit limit on gap
borrowing (C11), rates up to 1,000% with a confirm (C12), card minimums from
the interest actually charged (C13), flat-rate conversion on the original
tenure (C15), a ₹500 / 0.5% tolerance before the order changes (C18) and
clearer CSV columns (C19). The tax items (C7–C10, C14, C16, C17, C20–C22) sit
with W2. Founder calls W1 needs: the tenure-extension ceiling (proposed: home
loans up to 360 months from today, others only to a lender limit you enter),
the default gap credit limit (proposed: 3 months of take-home), and the
rounding threshold.

### 2. "What else would massively differentiate, while still building what competitors have?"
See **Part 4** (ranked list of 10).

### 3. "Set it up" (founder / ops setup)
Nothing in production was changed by any agent. The setup list you need to do
yourself, collected from W5 and W8:
- **Emails (payday, deadline, rate-move):** on Render set
  `PAYDAY_EMAIL_ENABLED`, `DEADLINE_REMINDERS_ENABLED`,
  `RATE_MOVE_EMAIL_ENABLED`, `NOTIFY_SIGNING_KEY` (32+ chars),
  `NOTIFY_CRON_SECRET` (16+), `PUBLIC_APP_URL`; on GitHub set var
  `NOTIFY_ENABLED`, secret `NOTIFY_CRON_SECRET`, var `PUBLIC_APP_URL`; confirm
  `RESEND_FROM` uses rightdue.app (DKIM/SPF/DMARC already exist). Trigger: a
  cron-job.org call at 09:00 IST to `POST /api/notify/run`.
- **Backups:** a read-only Neon role as `DATABASE_URL` for the job,
  `BACKUP_AGE_RECIPIENT` (encryption key), a Cloudflare R2 bucket with a
  14-day lifecycle (`BACKUP_S3_BUCKET`, endpoint, keys). Until then the nightly
  job now goes **red** on purpose.
- **Sign-in protection:** Turnstile site + secret keys (W8 made the global cap
  apply only to new sign-ups so nobody can lock everyone out).
- **Monitoring:** `SENTRY_DSN`, an uptime monitor; branch protection +
  auto-merge + "deploy after CI" on Render; GitHub secret scanning.
- **Optional:** `OTP_HASH_KEY`; your own Cloudflare zone so robots.txt and the
  landing page don't say "Disallow" while Render Free sleeps; a
  `privacy@rightdue.app` inbox.

### 4. "Turn reminders/backups on, and explain WHY backups aren't being taken"
**Why no backups (W8 found it):** the backup workflow's config step exits
"success" when `DATABASE_URL` is empty. Every later step is then skipped, so
the run shows green while dumping nothing. Even when a dump did run, there was
no bucket configured to keep it, so it was thrown away. W8 changed it to fail
loudly (`scripts/backup_preflight.sh`), restore each backup into a Postgres 17
container as a test, open an issue on failure, and added a restore drill
script. It turns green once you add the secrets above. Render Free's own
"rollback" covers only the last 2 deploys and is not a database backup.

**Why reminders aren't live:** the code is built but the production flags are
off (live `GET /api/notify/flags` returned all `false` on 14 Oct) and the
secrets above are not set. "Remind me next month" only hid the prompt in that
browser; W5 renamed it "Hide until next month" and built the real opt-in
email. **Resend free tier** is 100 emails/day and 3,000/month, *shared with
sign-in codes* (https://resend.com/pricing). W5 reserves room for sign-in
codes and caps notification emails (default 10/day, `NOTIFY_DAILY_CAP`).
Above roughly 10 opt-ins a day you need Resend Pro (US$20/month, 50,000
emails) or a lower sign-in-code cap (~60/day).

### 5. "What causes the ~110k-line bloat? How do we clear it?"
From W9's count: about **70.7k lines of real production code**, 14.8k comment
lines, 7k blank lines and ~18k lines of Python tests. Things that were not
product code: generated test fixtures `engine/tests/fixtures/*_cases.json`
(40,688 lines — now marked generated; proposal: generate them in CI instead of
committing them), `design/` mock-ups (8,582 lines, removed), planning and
round-history docs (~4.5k, moved out with `docs/ARCHIVE.md` listing how to
restore each), one-off audit scripts (~900, removed), 46 unused TypeScript
exports (deleted), and `ProfileClient.tsx` (4,093 → 2,805 lines, split into
parts). About 50 round-named web tests (8.9k lines) can retire once W9's
generic guard tests replace them. Tracked lines went 198,261 → 184,798 so far.
Test *results* are not committed (W9 added ignores for generated output).

---

## Part 2 — Section A, item by item

### "Banks didn't pass the cut" — do people actually face this? Won't every bank pass cuts on?
**Yes, people face it, and no, not every loan gets the cut automatically.**
- Since 1 Oct 2019, banks must link every *new* floating-rate retail loan to an
  external benchmark (usually the repo rate) and reset it at least once every
  3 months (RBI, 4 Sep 2019,
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11677). RBI did this
  *because* the older MCLR system "has not been satisfactory" at passing on
  rate changes (RBI press release,
  https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=48070).
- **Who can miss out:**
  1. **Old loans still on MCLR, base rate or BPLR.** RBI let them "continue
     till repayment or renewal" (same circular). About **30.2% of floating-rate
     loans were still on MCLR at end-March 2026** (RBI, prid 63049, via W4).
     These move slowly and only at their own reset dates.
  2. **NBFC and housing-finance-company loans.** The external-benchmark rule
     is for banks; HFCs/NBFCs price off their own internal "prime lending
     rate", which they change when they choose.
  3. **Spread creep.** The bank can't change the credit-risk part of the
     spread unless your credit profile changes substantially, and other parts
     only once in 3 years (same circular). Mistakes here are real.
  4. **Reset lag:** a cut applies only at your loan's reset date, so a
     quarterly reset can delay it up to 3 months.
  5. **Fixed or "hybrid" loans** don't move at all until the fixed period
     ends.
- **Proof that it goes wrong:** RBI's 18 Aug 2023 reset circular was issued
  after customer grievances about resets
  (https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529), and RBI has
  fined banks over interest-rate rules (DCB Bank prid 57520, Punjab & Sind
  Bank 53805, Indian Bank 60305, Nainital Bank 59770; collected by W4).
- **Why it matters now:** RBI *raised* the repo rate to 5.50% on 7 Oct 2026
  (prid 63742). So the question this quarter is the reverse: "my EMI or
  tenure just went up — was it done right and did they give me the choice?".
  W4 rebuilt Loan Check around that (see A11).

### A3 — "Business folks can use it too. Is tax working, accurate, and in the UI? If not, merge Portfolio + Tax."
- **Accuracy:** the audit hand-checked the tax arithmetic (both regimes, 87A
  rebate, surcharge, cess, 24(b), 80E, US §221) and it matched. What was wrong
  is that some *paths* disagree with each other: the ₹2 L house-property
  set-off counted twice with two homes (C7), "sunk" fees still used in three
  places (C8), a life event quietly lowering your tax bracket (C9), 80C on
  home-loan principal never reaching the order (C10), and the plan not
  following the regime-comparison result (C21). W2 is fixing these.
- **Integration:** the Tax page and the plan don't share one view today. W7
  merged Portfolio + Tax into **one "Assets & tax" section** behind the "+"
  menu, as you asked.
- **Business owners:** today the app treats business income like a salary (a
  fixed monthly figure plus a growth rate). W10 added an engine module for
  seasonal/lumpy income (see A20) and the persona suite includes a business
  owner. The advance-tax rules for businesses are in A20 below.

### A4 — Is "prepay / invest / split" the best possible prompt?
No: three buttons with no numbers is not the best. W3 built the better
version: once only debt under ~10% is left, show a **slider from 0–100% to the
loan**, and for each split show the **debt-free date and the money in hand at
that date**, plus the one number that decides it: the **break-even return**
(what an investment must earn after tax to beat prepaying). For an 8.6% home
loan that's about **9.0% under the new regime** and **6.7% under the old
regime with 24(b)**. No default is chosen, no product or security type is
named (SEBI-safe; see D1). Founder call: confirm the ~10% threshold.

### A6 — Is the engine accurate for how consolidation actually works? How is card → personal-loan consolidation even possible?
- **How it works in India:** there's no product that "moves" a card balance.
  You take a new loan — a personal loan, a "loan on card" from the same
  issuer, or a top-up on a home loan — and use it to pay the card in full. The
  card stays open with a ₹0 balance; you now repay a fixed EMI with an end
  date, instead of a minimum that's mostly interest + 18% GST.
- **What it really costs (W3 models all of it):** processing fee **plus 18%
  GST on the fee**; the loan's own interest has no GST, card interest does; a
  fixed-rate personal loan may carry a foreclosure charge (RBI's 2 Jul 2025
  pre-payment directions ban it only on *floating*-rate loans to individuals
  for non-business purposes,
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0); the
  Key Facts Statement must show the all-in APR and stay valid 3 working days
  so you can compare (RBI 15 Apr 2024,
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663). Credit
  score: a hard enquiry costs a little; lower card utilisation helps.
- **Is "a tool" the best format?** No — W3 made it a **"Cheaper way to carry
  this" card** that appears on its own for any revolving card over 30%, using
  your quote or, without one, the middle of what banks actually charged last
  quarter (never the "from 9.99%" floor), with "We don't arrange loans and no
  lender pays us." The in-app explainer uses the text above.

### A7 — US stays. What would it take to replicate ChatGPT Finances / Undebt.it (bank sync etc.)?
- **US:** both use an aggregator. ChatGPT Finances uses Plaid (balances,
  transactions, investments, liabilities;
  https://openai.com/index/personal-finance-chatgpt). Undebt.it added bank
  sync through SimpleFIN (12 Sep 2026, per the audit). To match it you need:
  an aggregator contract (Plaid needs a company and a security review;
  SimpleFIN is cheaper and user-paid), a liabilities feed that maps card APR,
  minimum and statement balance into RightDue's loan model, token storage
  that meets the aggregator's security rules, and a privacy notice update.
  Weeks of engineering after the contract, not days.
- **India:** the equivalent, Account Aggregator, **can't do it today**: AA
  still carries no loan or credit-card data (Sahamati circular, 4 Sep 2026,
  deposit types only), and an app must be regulated by RBI/SEBI/IRDAI/PFRDA to
  receive AA data at all (RBI NBFC-AA Master Direction para 3(12),
  https://rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=12936). The repo's
  `docs/ACCOUNT_AGGREGATOR.md` has the full route. Realistic India path: the
  credit-report PDF import (shipped), statement forwarding to an address,
  pasted SMS, and later — after incorporating — a consumer-consented bureau
  pull under RBI's CIC Directions 2025 para 24.
- What you can match without sync: financial memory (the saved profile
  already is one), weekly/monthly updates (W5's payday email), manual entry
  (exists), and a credit-report refresh.

### A8 — How would the verifier work when every LLM gives a different answer?
It never compares one AI's text with another, and it never asks a model. W5
built `engine/advice_check.py` + `POST /api/advice-check`: it splits the
pasted text into sentences, pulls out only **checkable claims** with fixed
patterns (a loan's rate, an EMI, "pay X first", "prepaying costs a fee",
reduce tenure vs EMI, card minimum due, "move card debt to a loan", "invest
instead", the repo rate), **recomputes each from your own numbers and RBI
rules**, and marks each **agree / disagree / can't check**, with the reason.
Anything it can't read is listed as "not checked", never guessed. Same text
in, same verdicts out; nothing stored. So different AIs giving different
answers is the *point*: each gets checked against the same facts.

### A9 — Store the CRED positioning, or market this way?
Both. Stored here for reference, and recommended for the landing page:
> "CRED pays your bills. RightDue tells you how much extra to pay, on which
> card or loan, and when a new loan is a bad idea — and no lender pays us."

Why it works: CRED now autopays every card (launched 12 Jun 2026) and runs a
lending funnel (Cash by CRED); RightDue's opening is the step after paying and
the neutrality a lender-paid app can't claim (audit A9,
https://newsroom.cred.club/cred-adds-multibill-payment-and-autopay-to-simplify-credit-card-bill-payments).

### A10 — How does Sure reduce loan interest? Could we close that gap (voice, etc.)? Too much user info?
- **What Sure does** (App Store listing, Vittancial Technovations,
  https://apps.apple.com/in/app/sure-credit-monitor/id6741203867): it pulls
  your credit report, compares your rate with what "people with your score"
  pay, and its **team hand-holds a home-loan balance transfer** to another
  lender — reviews describe 8.65% → 7.2% (ICICI → HDFC) plus a top-up, and
  help negotiating with the existing bank. Its newest release (Oct 2026) adds
  "SureWay: start investing alongside your loans". It is paid by lenders when
  a transfer closes, which is why "transfer" is always the answer.
- **The gap RightDue can close without becoming a lender's agent:** most of
  the saving comes from **asking your own bank first** (a rate-conversion /
  switch to repo-linked for a fee), which a lender-paid app has no reason to
  push. RightDue can do it as a **guided script**: "Call/visit, say this,
  ask for the conversion fee in writing, here's the letter if they refuse,
  here's the Internal Ombudsman → RBI Ombudsman chain." W4's MCLR→EBLR switch
  saving and reset-choice letter are the engine for it.
- **Voice (ElevenLabs or similar):** useful for the distressed — a calm voice
  explaining rights at 9 pm — but start with **text + WhatsApp-shareable
  scripts**, and add voice to the *public* "Can't pay" page as read-aloud.
  A voice agent that phones banks for users is a different business (call
  recording consent, DPDP, impersonation risk). Info needed: just the loan
  type, lender type, rate and benchmark — no more than Loan Check already
  asks.

### A11 — Usefulness and failure points of the hike-cycle Loan Check; Polymarket odds
- **Useful because:** after the 7 Oct hike every repo-linked borrower's EMI
  or tenure changes within one reset. RBI requires the lender to offer "an
  enhancement in EMI or elongation of tenor or for a combination of both"
  (18 Aug 2023 circular). W4 shows: the new EMI *or* the extra months and
  what each costs (₹50 L at 7.90 → 8.15%, 240 m: EMI ₹41,511 → ₹42,290, or
  +12 months costing ₹3,00,896 more), whether you're still on MCLR and what a
  switch saves, whether the hike was passed faster than past cuts, and a
  letter if the EMI was raised without offering the choice.
- **Failure points:** (1) we don't know the user's exact spread or reset date
  unless they enter it or upload the sanction letter/KFS — W4 asks; (2) NBFC
  and HFC loans follow their own PLR, so the "should have moved by" date is
  softer; (3) the bank's choice letter may arrive by email the user never
  read — we must not accuse the bank, only say "if you weren't offered…";
  (4) rate data goes stale if the cron that reads RBI's page breaks (see
  A21).
- **Odds:** W4 recommends **not showing prediction-market odds in India**. The
  Promotion and Regulation of Online Gaming Act 2025 (in force 1 May 2026)
  bans real-money betting platforms and Polymarket was blocked in India in
  May 2026; showing its odds to Indian users is a legal and trust risk. If you
  ever show them (e.g. US only), roll to the soonest open market each time a
  meeting passes (Kalshi `KXCBDECISIONINDIA`, Polymarket
  "reserve-bank-of-india-decision"). Instead the MPC page shows **three
  scenarios: no change, +0.25%, +0.50%** — no probabilities.

### A12 — Why isn't the reminder live? Do it.
Answered in Part 1, item 4. W5 built the opt-in payday email, rename, budget
and run lock; going live needs your env vars.

### A13 — Tenure lengthening vs EMI increase: show impact and the best step
W1 makes tenure-first the default and W5's rate-move email shows both: e.g.
₹50 L at 8.5% → 8.75%, 240 m: EMI ₹43,391 → ₹44,186 at the same end date, or
+13 months. **Paying the ₹794 more each month saves about ₹3.49 L of
interest.** The recommended step (W1's founder decision): *keep the bank's
longer tenure (lower risk if money gets tight) and prepay the difference when
you can afford it* — you get the interest saving with the flexibility to
stop.

### A15 — What is the "counts-only funnel"?
A way to know how many people reach each step **without tracking any
person**. The server keeps only daily totals: "setup started: 41", "plan
saved: 23", "came back in month 2: 9", "Loan Check found ≥ ₹5,000: 4". No
user id, IP, cookie or device fingerprint is stored with a count, so there's
nothing personal to protect or disclose. W5 built it (`api/funnel.py`,
flags `FUNNEL_ENABLED` + `NEXT_PUBLIC_FUNNEL=1`, admin read with
`FUNNEL_ADMIN_SECRET`). US is still counted (not cut).

### A17 — Is the hardship/closure letter template universal, or should it be personalised?
It should be personalised, and mostly is: the letter fills in lender, loan
type, account, amounts and dates, and the rule cited depends on the lender
type (bank vs NBFC/HFC) and the loan type. Two improvements recommended:
(1) a short "what I can pay and from when" line the user edits (lenders
respond to a concrete offer), and (2) a Tamil/Hindi/other regional-language copy for the user to read, with the
English letter as the one sent. W6 is making the read-only rules and
template public on `/cant-pay`.

### A18 — What is an OPC? What's the "consolidation check"?
- **OPC = One Person Company**: a private limited company with a single
  member (Companies Act 2013 s.2(62),
  https://ca2013.com/section-262-one-person-company). You get limited
  liability and a separate legal entity while being the only owner; you must
  name a nominee, the member must be an Indian citizen resident in India, and
  an OPC can't do NBFC-type investment activity (Companies (Incorporation)
  Rules 2014 r.3). The earlier founder answer said you'd want one before
  charging money; an OPC or private limited company is also what a bureau or
  aggregator partnership would need later.
- **Consolidation check** = the "Cheaper way to carry this" card from A6, as
  part of the ₹99/month "RightDue Plus" fake door: "would moving this card to
  a loan save you money, after fee + GST?".

### A19 — How often should the MPC page update?
On **every MPC decision day** (6 a year; RBI publishes the schedule) within
an hour of the press release, plus **one weekly check** that confirms nothing
changed and stamps the "as of" date. W4 designed `policy-rates.yml` that way.
More often adds nothing: the repo rate only changes at an MPC (or a rare
off-cycle meeting, which the weekly check catches).

### A20 — "+" menu instead of cutting; are tax/advance-tax sections accurate for businesses, career switches, salary shifts, expense swings?
- **"+" menu:** W7 built it: core tabs Home / Plan / Activity / Profile, and
  "+ More" opens Goals & tools, Assets & tax, Advance tax, the tools, Can't
  pay, Glossary, Your data (NRI only if you chose NRI).
- **Advance tax for businesses — what the law says** (Income-tax Act 2025, in
  force 1 Apr 2026): you owe advance tax if the year's tax after TDS is
  **₹10,000 or more** (s.404); the normal schedule is 15% by 15 June, 45% by
  15 Sept, 75% by 15 Dec, 100% by 15 March (s.408(1),
  https://indiacode.ecourtsindia.com/income-tax-act-2025/section/408/). A
  business or professional on the **presumptive scheme** (old 44AD/44ADA, now
  s.58) pays **100% in one go by 15 March** (s.408(2); CBDT FAQ,
  https://www.incometaxindia.gov.in/documents/d/guest/faq-on-advance-tax).
  Payments up to 31 March count as advance tax. Shortfalls cost interest
  (s.424/425, old 234B/234C). A resident senior citizen with no business
  income pays none.
- **What the app does today:** the advance-tax panel assumes everyone pays
  quarterly on an even income, so a presumptive-scheme business is shown
  three instalments it doesn't owe, and a lumpy-income business is told to
  pay on income it hasn't earned yet. The law lets you pay on *estimated
  current income*, so a business with a big Q4 legitimately pays more later.
  **Fix (W2 owns the tax panel):** a "presumptive scheme" switch → one
  instalment on 15 March; and instalments computed from income-to-date for
  irregular earners. Recorded as a strict expected-failure in the W10 persona
  suite until W2 lands it.
- **Career switch / salary shift / irregular income — what W10 built in the
  engine** (`engine/income_scenarios.py`): seasonal business income (a
  month-by-month pattern that repeats each year), a career switch (a gap of
  no income, then a new salary), and a salary shift (a % change from a month,
  on top of past hikes). It also fixed a defect: a salary reset in the same
  month as the annual hike got the hike applied on top of the new figure. The
  plan uses the month-by-month income, so the shortfall months show up as
  gaps instead of being averaged away. Expense swings: the engine has
  inflation and one-off events; a monthly expense pattern uses the same
  mechanism later.

### A21 — Where to fetch rates accurately; does it need a cron?
Yes, a scheduled job, and only from primary sources (W4, `docs/RATES.md`):
- **Repo rate:** RBI's monetary-policy press releases (rbi.org.in), on MPC
  days + weekly.
- **What banks actually charge:** each bank's published quarterly
  disclosure of the range and mean rate charged (required by RBI/2014-15/422),
  already read by `engine/rate_disclosures.py` and its workflow.
- **MCLR/EBLR:** each bank's own rates page, monthly.
- **Never** "industry norms" or a lender's "from X%" floor as the user's rate:
  W4 deleted the unsourced figures and labels anything weaker "typical,
  unverified", kept out of Loan Check.

### Cut list
1. **US — let it be.** Kept. The audit's point stands that US marketing is
   up against two free tools with bank sync; W6 keeps the toggle but the hero
   leads with India.
2. **Portfolio behind "+"** — done by W7 (merged with Tax).
3. **NRI: verify accuracy, show only to NRIs, handle India ↔ NRI moves.**
   W10 checked and fixed:
   - The NRI prepay comparison ignored the rupee's slide and the cost of
     sending money; the audit persona went from "saves 8.84%" to **about 4.5%
     a year in USD terms** once both are counted, with a USD savings
     alternative beside it (E5; World Bank remittance-cost data,
     https://remittanceprices.worldbank.org/corridor/United-States/India).
   - NRIs were wrongly offered the 20%-with-indexation option on property
     bought before 23 Jul 2024; that choice is for **residents only**
     (Income Tax Department,
     https://www.incometaxindia.gov.in/w/tax-on-long-term-capital-gains%E2%80%8B).
   - Setup no longer races the exchange rate (E6). NRI screens show only when
     you chose NRI.
   - **India → NRI and back** is now a profile event with a residency check
     under s.6 of the 2025 Act (182 days; or 60/120 days + 365 in four years;
     a citizen leaving for a job abroad is tested on 182 only; deemed
     resident above ₹15 L Indian income if untaxed elsewhere,
     https://indiacode.ecourtsindia.com/income-tax-act-2025/section/6/) and a
     checklist: resident savings account becomes NRO; rupee loans can
     continue, paid from NRE/NRO/FCNR or inward remittance (RBI Master
     Direction — Borrowing and Lending,
     https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10191);
     NRO interest has 30% TDS unless you file for the treaty rate (15% for
     the US with a TRC + Form 10F); on return, NRE becomes resident or RFC,
     FCNR runs to maturity (RBI FAQ,
     https://www.rbi.org.in/SCRIPTs/FAQDisplay.aspx?Id=52). From the move
     month the plan pays EMIs in rupees bought with the new currency.
4. **Sell to repay — "if registered as an LLC/other, could we not be
   liable?" Keep it as a calculator.**
   - **Short answer: no, a company doesn't remove the liability.** SEBI's
     rule is that "no person shall act as an investment adviser … unless he
     has obtained a certificate of registration", and "investment advice"
     *includes financial planning* (SEBI IA Regulations 2013 reg. 3(1) and
     2(1)(l),
     https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1740726382475.pdf).
     "Person" covers companies and LLPs — the regulations have separate
     registration rules for a body corporate and an LLP. An OPC/LLP limits
     your *personal* liability for the business's debts; it doesn't make
     unregistered advice legal, and directors can still be pursued. (India's
     equivalent of a US LLC is an LLP or a private limited company.)
   - **What reduces the risk is what the tool says**, not who owns it. W10
     rebuilt it as a **calculator of one sale the user picks**: sale price →
     selling costs → capital-gains tax (for resident property bought before
     23 Jul 2024, *both* the 12.5% and the 20%-with-indexation figures) → net
     money → how much debt that clears → the yearly interest that debt was
     costing. It **never says "sell" or "keep"**, and the old "rank your
     holdings by what to sell" route is switched off (flag
     `LIQUIDATION_RANKER`, off by default; frozen, not deleted). Land, flats,
     gold, shares and mutual funds all go through the same tax engine.
     Counsel review is still recommended before any paid tier.
5. **Goals stay; diversion programmable.** W3 built: divert until a date, a
   monthly cap, pause when savings fall below a floor, and after debt clears a
   fixed amount or a % of the freed money.

### Add list
- **Card → personal loan consolidation possible? how? explain in-app:** yes —
  see A6; W3's card carries the explainer.
- **Rate-hike guard:** see A11 (W4) and A13 (W5 email).
- **"Don't sign that" — for top-up offers, compared against what?** W3
  compares by **purpose**: a top-up to clear debt is compared with keeping
  your current plan (does the all-in APR, fee + GST included, beat the debts
  it pays off?); a top-up to spend is compared with saving up for it, using
  savings you already have, and a typical personal-loan rate from banks'
  published means — plus a line if total EMIs would pass 50% of take-home.

### Fun / unique — "What's the NOC/closure-letter requirement and fees?"
When you fully repay a secured loan, the lender must **release all original
property documents and remove any registered charge within 30 days**; you
choose to collect them from the branch where the loan was serviced or another
office that has them. If the lender is late for reasons that are its fault,
it must pay you **₹5,000 for each day of delay**; if documents are lost it
must help you get certified copies and gets 30 more days (RBI, 13 Sep 2023,
https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12535, for releases
due on or after 1 Dec 2023; since 28 Nov 2025 the same text sits in RBI's
Responsible Business Conduct Directions 2025 for banks,
https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13140, and for
NBFCs/HFCs). At a commercial bank, pledged gold comes back on the day you
repay and no later than 7 working days, ₹5,000 a day if the bank is at fault.
A credit card must be closed within **7 working days** of the request once
dues are clear, or the issuer pays **₹500 per calendar day**
(https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13155). **Fees:** the RBI text sets the deadline and the compensation but no fee
for the release; we found no rule that lets a lender charge for handing back
your own documents, and no-dues/NOC letters are normally free. Some lenders
charge for a duplicate NOC or courier, so the letter asks for any charge in
writing. (We did not find an RBI line that expressly bans a fee — say
"normally free", not "illegal to charge".) RightDue's
`engine/closure_letter.py` already generates the letter with these dates.

---

## Part 3 — Things decided or left for you
- No prediction-market odds in India (A11).
- MPC page: decision days + weekly (A19).
- Sell to repay stays a calculator; ranker off; counsel before charging (cut 4).
- NRI shown only to NRIs; residency move is a profile event (cut 3).
- Advance-tax presumptive switch and irregular-income instalments: W2 to
  build; W10's persona suite holds strict expected-failures until it lands.
- Choose: Resend Pro vs lower sign-in-code cap; tenure-extension ceiling;
  gap credit-limit default; A4 threshold (~10%).

---

## Part 4 — Differentiation proposals (ranked)

Ranked by (money a user finds or avoids losing) × (how hard it is for
ChatGPT, CRED or a lender-paid app to copy) ÷ build effort. All sit on
engines that already exist.

1. **"Where we disagree with a plain calculator, and what it's worth in ₹"**
   as the spine of Home and Step 3 (W3 built the engine). Generic tools
   can't show a receipt for a 24(b) flip, a fee-driven reorder or a missed
   reset. When it's ₹0, say so and switch to watching.
2. **Rate-hike guard + reset-choice letter** (W4/W5). Timely for every
   repo-linked borrower until at least the 2–4 Dec 2026 MPC; ends with a
   letter citing the 18 Aug 2023 circular if the choice wasn't offered.
3. **"Ask your own bank first" script** — the neutral counter to Sure:
   rate conversion / MCLR→EBLR switch fee vs saving, the exact words to use,
   then the balance-transfer maths only if the bank says no. A lender-paid
   app never leads with "stay".
4. **Verifier: "paste any advice — an AI, a bank RM, an app — we check it
   against your loans and RBI rules"** (W5). Turns ChatGPT from a competitor
   into a source of traffic; deterministic, so it can't hallucinate.
5. **Cheaper way to carry a card** (W3): one card, a rupee figure, fee + GST
   counted, "no lender pays us". The moment people screenshot.
6. **"Don't sign that"** (W3): check a no-cost EMI or top-up offer against
   your own plan *before* signing, using the KFS APR the lender must give
   you and its 3-day validity.
7. **Payday ritual + email** (W5): 60 seconds a month — paste the SMS, the
   months counter moves ("34 → 31"), a share card only after real progress.
   This is the retention loop; nothing else matters if users don't return.
8. **Loan-cleared moment**: NOC/closure letter with the 30-day and
   ₹5,000-a-day rule, a deadline tracker, and the freed EMI rolling into the
   next loan; a "Beat your bank" tally when a letter gets a reply.
9. **Irregular-income and life-change planning** (W10 engine + W2 tax):
   seasonal business income, a career gap, a move abroad, with advance tax on
   the right schedule. No Indian debt app plans month-by-month for a
   shop-owner or a freelancer.
10. **Statement forwarding address + credit-report refresh** (the India
    "sync" that needs no licence): forward the card statement email, the plan
    updates; re-upload the free Experian report quarterly. Competitor parity
    with bank sync, built from what India allows today.

Things deliberately *not* proposed: more payoff orders, more tabs, decimals,
odds, or anything that names a security or a lender.

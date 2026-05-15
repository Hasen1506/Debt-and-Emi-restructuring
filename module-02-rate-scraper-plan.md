# Rate Scraper Plan — Path B of the rate-data work

**Status:** Draft, not yet implemented.
**Owner:** Hasen (product) + TBD (data ops).
**Pairs with:** `module-02-design-spec.md`, `engine/rate_cards.py`, `web/src/lib/rate-cards.json`.

This is the plan for moving FinOptima off hand-seeded rate cards onto
live data scraped from bank sites and RBI feeds, on a daily refresh
schedule, with the user-facing app never paying scrape latency.

Path A (surfacing existing rate-card data in the UI) is already
shipped. The wrapper at `web/src/lib/rate-cards.ts` will keep working
unchanged once scrapers begin writing to `rate-cards.json`.

---

## 1 · Goal

Replace the hand-seeded rate ranges in `engine/rate_cards.py` with values
verified within the last 24 hours, automatically, for ≥ Tier-A banks
(6 IN + 5 US), without ever blocking a user request on a scrape.

**Non-goals:**

- Scraping per-user offers (e.g. pre-approved rates inside online
  banking). We're only after **published rate cards** — the rack rates
  every bank lists on a public page.
- Scraping anything that requires login.
- Real-time intra-day refresh. RBI moves on MPC calendar; bank cards
  refresh quarterly at most. Daily is plenty.
- US bank data accuracy parity. Phase 1 focuses on Tier-A IN.

---

## 2 · Architecture

```
                            ┌────────────────────────────────┐
                            │  GitHub Actions cron (UTC)     │
                            │  0 0 * * *  (5:30 IST daily)   │
                            └──────────────┬─────────────────┘
                                           │
                          ┌────────────────┴───────────────────┐
                          │  scripts/scrape/run.py             │
                          │  • Loops sources in priority order │
                          │  • Each source has its own scraper │
                          │  • Aggregates results in memory    │
                          └────────────────┬───────────────────┘
                                           │
                       ┌───────────────────┼────────────────────┐
                       ▼                   ▼                    ▼
            ┌─────────────────┐ ┌─────────────────┐  ┌─────────────────┐
            │ rbi_repo.py     │ │ scrape_sbi.py   │  │ scrape_hdfc.py  │
            │ (RBI MPC page)  │ │ (sbi.co.in/...)│  │ (hdfcbank.com)  │
            └─────────────────┘ └─────────────────┘  └─────────────────┘
                       │                   │                    │
                       └───────────────────┼────────────────────┘
                                           ▼
                          ┌────────────────────────────────────┐
                          │ Validation gate                    │
                          │ • Schema check                     │
                          │ • Range sanity (e.g. home_loan <   │
                          │   25%, card_apr > 12%)             │
                          │ • Day-over-day drift < 30%         │
                          │ Failing values → quarantine, keep  │
                          │ previous good value                │
                          └────────────────┬───────────────────┘
                                           ▼
                          ┌────────────────────────────────────┐
                          │ Write web/src/lib/rate-cards.json  │
                          │ + git commit "Rate refresh YYYY-   │
                          │   MM-DD" if anything changed       │
                          └────────────────┬───────────────────┘
                                           ▼
                          ┌────────────────────────────────────┐
                          │ Render auto-deploys on the commit  │
                          │ (or app simply reads the new JSON  │
                          │  on next request — already SSR'd)  │
                          └────────────────────────────────────┘
```

**Key properties:**

- **User requests never trigger a scrape.** The user-facing path reads
  `rate-cards.json` from the bundle/SSR, instant.
- **Failure is graceful.** If a scraper breaks, the JSON keeps the last
  good value for that institution × product. The rest of the file still
  refreshes.
- **Audit trail is free.** Every refresh is a git commit, so we can
  `git blame rate-cards.json` to see when SBI home loans moved from
  7.55% to 7.45%.
- **Easy migration to a DB later.** When sub-daily refresh matters (it
  doesn't yet), swap the JSON write for a Postgres/Redis write and
  point the frontend at an API endpoint. Zero application logic
  changes.

---

## 3 · Source inventory

For each source we need: canonical URL, format (HTML/PDF/JSON), update
cadence, scraper notes, legal status. The verification of canonical
URLs is **pre-work** for whoever implements — don't assume the URLs
below are stable.

### 3.1 Indian banks — Tier A (priority 1)

| Bank | Products to scrape | Page format (typical) | Notes |
|---|---|---|---|
| SBI | home, personal, auto, card | HTML rate-card sub-pages | Largest, most stable. Card APR comes from a separate "fees & charges" doc. |
| HDFC Bank | home, personal, auto, card | HTML + PDFs for some products | Card APR is a published number, not a range |
| ICICI Bank | home, personal, auto, card | HTML rate matrix | Has explicit Cibil-banded slabs that we'll need to median |
| Axis Bank | home, personal, auto, card | HTML | Watch for "starting from" language — pull the matrix, not the marketing number |
| Kotak Mahindra | home, personal, auto, card | HTML | Smaller product matrix |
| PNB | home, personal, auto | HTML | No card range published — leave card_card null |

### 3.2 Indian banks — Tier B (priority 2)

10 banks already in `INDIA_TIER_B`. Hand-seeded values are
extrapolations from Tier-A peers. Scraping these is lower priority —
the engine flags them `is_indicative=True`. Defer to Phase 1.5.

### 3.3 Indian banks — Tier C (priority 3, defer)

14 SFBs / NBFCs / smaller banks. Static is fine.

### 3.4 RBI feed (priority 1)

| Feed | URL pattern | Use case |
|---|---|---|
| MPC press releases | rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx | Repo rate, MSF, reverse repo — needed for floating-rate reset estimates |
| Sectoral lending data | dbie.rbi.org.in | Optional — aggregate housing-loan rate as sanity check |
| Notification index | rbi.org.in/Scripts/NotificationUser.aspx | Triggers re-scrape when a rate-related circular drops |

**RBI scraping is special:** the page format is fragile but the *cadence*
is predictable (MPC meets six times a year on published dates). Run
RBI scraper daily, but **also** add a webhook-like trigger:
"if today is in the announced MPC calendar list, run the full pipeline
within 30 minutes of the scheduled press release time."

### 3.5 US banks — Tier A (priority 4)

15 banks in `USA_TIER_A`. Defer to Phase 2 — current values are stale
but the user base is IN-first.

---

## 4 · Per-source spec template

Each scraper lives at `scripts/scrape/<institution_id>.py` and exports
a single function. Template:

```python
# scripts/scrape/sbi.py
"""SBI rate-card scraper.

Source: <verified URL>
Format: HTML, mostly stable since 2024.
Cadence: card refreshed monthly; we hit it daily so changes surface fast.
Legal: SBI's TOS at <url> permits non-commercial display of public rate
       data. Scraping rate: 1 request / 2 seconds. User-Agent set to
       "FinOptima rate refresh / contact: <email>".
"""
from __future__ import annotations
from typing import Optional
import httpx
from bs4 import BeautifulSoup
from scripts.scrape.types import InstitutionScrapeResult, ProductRange


def scrape() -> InstitutionScrapeResult:
    """Returns the latest rate card for SBI. Raises ScrapeError on any
    structural problem; the runner converts that into a "keep last-good"
    fallback."""
    ...
```

Required fields the scraper must return:

- `institution_id`, `name`, `country`
- One `ProductRange` (`low`, `high`) per product the bank publishes
- `last_verified` — ISO date of the scrape
- `source_url` — the exact URL we scraped from
- `confidence` — 'high' (scraped from rate-card page) / 'medium'
  (inferred from marketing copy) / 'low' (single quote, not a range)

---

## 5 · Schedule & freshness

| Job | Trigger | Frequency |
|---|---|---|
| Full Tier-A IN refresh | cron | Daily at 00:00 UTC (05:30 IST, before market open) |
| RBI MPC pulse | cron | Daily at 00:00 UTC + on MPC announcement days at announcement +30m |
| Tier-B IN refresh | cron | Weekly, Sunday |
| US Tier-A | cron | Weekly, Sunday |
| Manual force-refresh | workflow_dispatch | On demand |

**Freshness contract surfaced in the UI:**

- `RATE_CARDS_AS_OF` is already shown in the breakdown ("verified May
  2026"). Once scrapers land, this becomes the actual last-refresh
  date.
- If a specific institution's `last_verified` is > 7 days old, the
  RateRangeHint should add: *"⚠ Rate card not refreshed for {N} days
  — verify with the bank."*
- If > 30 days, the inline hint should be suppressed entirely for
  that institution. We don't want stale data masquerading as fresh.

---

## 6 · Legal / TOS / robots.txt

Per source, before scraping starts, check:

1. **`<bank>.com/robots.txt`** — does it allow `/rates/`, `/interest-rates/`,
   or whichever section? If `Disallow`, do not scrape.
2. **Terms of use page** — most retail bank TOS focus on online-banking
   logins, not public rate pages. Scraping published rate cards is
   generally accepted for non-commercial / informational use. Borderline
   cases (HDFC, ICICI both have explicit clauses about automated
   access) need a one-time legal sign-off before the scraper goes live.
3. **Rate-limit politeness** — ≥ 2 seconds between requests per host.
   Total daily fetches per host ≤ 20. Identify ourselves via
   User-Agent.
4. **RBI** — rbi.org.in robots.txt allows public press releases. No
   special concerns.

**Hard rules:**

- No login-required pages. Ever.
- No CAPTCHA solving.
- No headless-browser scraping unless the rate-card page is JS-rendered
  AND no alternative (PDF, mobile site) exists. Default to `httpx` +
  BeautifulSoup.
- If a bank rolls out anti-bot (Cloudflare interactive challenge),
  stop scraping that source and fall back to seeded value. Don't
  escalate to bot-bypass.

---

## 7 · Fallback policy

The validation gate (architecture diagram, step 4) catches three failure
modes:

1. **Scrape returned but schema is broken** — log error, alert, keep
   previous `rate-cards.json` entry for that institution unchanged.
2. **Scrape returned plausible-looking values but they fail sanity
   checks** — e.g. home loan at 25%, or card APR at 5%. Quarantine
   the new value; keep previous. Flag for manual review.
3. **Day-over-day drift exceeds 30%** — possibly a real rate move, but
   most often a parsing bug. Quarantine. Manual review.

The output JSON gains two fields per institution after Path B lands:

```json
{
  "last_verified": "2026-06-14",
  "stale_for_days": 0,         // computed at write time
  "scraper_status": "ok"       // "ok" | "quarantined" | "down_3d"
}
```

Frontend (RateRangeHint) reads `scraper_status`:

- `ok` — render normally.
- `quarantined` — render with a small "(verified manually, last
  refresh failed)" footnote.
- `down_3d` — render with the stale warning at the top of the hint.

---

## 8 · Quality control

Each scraper output is run through `scripts/scrape/validate.py` before
being written to JSON. Checks:

| Check | Threshold | On fail |
|---|---|---|
| `low < high` | strict | reject |
| `low > 0` and `high < 0.60` (60% APR cap) | strict | reject |
| Home loan low > 0.05 (rate floor) | strict | reject |
| Card APR in [0.12, 0.50] | strict | reject |
| Day-over-day delta on `low` or `high` | ≤ 30% | quarantine |
| `last_verified` not in the future | strict | reject |

Alerts (when something quarantines or fails for 3+ days):

- GitHub Actions failure notification email — built in.
- Optional: webhook to a Slack channel `#finoptima-scrape` for
  human-eyeball review.

---

## 9 · Implementation phases

| Phase | Scope | Effort |
|---|---|---|
| **0 · Prep** | Verify URLs for the 6 IN Tier-A banks. Read each TOS. Check robots.txt. Set up `scripts/scrape/` layout, base types, validation module. | 1 day |
| **1 · SBI + HDFC + RBI** | Three scrapers + RBI MPC feed. End-to-end pipeline including GitHub Action, JSON write, commit. First refresh in prod. | 2-3 days |
| **2 · Rest of Tier-A IN** | ICICI, Axis, Kotak, PNB. Same patterns. | 1-2 days |
| **3 · Validation & alerting** | Sanity-check thresholds, quarantine logic, GitHub Action failure routing. | 1 day |
| **4 · UI plumbing** | Frontend reads `scraper_status` + `stale_for_days`; the RateRangeHint surfaces warnings; the breakdown's existing date stamp becomes a live value. | 0.5 day |
| **5 · Tier-B IN** | 10 more banks. Mostly mechanical. | 2 days |
| **6 · US Tier-A** | 15 banks. Separate per-source legal/TOS review. | 3 days |

**Total Phase 1 (Tier-A IN end-to-end): 5-7 working days.**

---

## 10 · Open questions for the user

These need your decision before Phase 0 starts. Listed in priority
order.

1. **Legal sign-off for Tier-A banks.** Do you want to get an explicit
   read on HDFC's and ICICI's "no automated access" TOS clauses before
   we scrape, or is "public rate card, polite rate-limit, identified
   User-Agent" enough for Phase 1? Most fintechs operate in this grey
   zone; some have asked banks for written permission.

2. **Contact email for User-Agent.** When we identify ourselves as
   "FinOptima rate refresh", which email do we publish? An info@ alias
   or your personal account?

3. **What happens when SBI publishes a 15% home-loan rate?** Real
   scenario: a bank temporarily lists an outlier during a campaign or
   typo on their site. Default proposal: quarantine + alert. Are you
   OK with the resulting "we missed a real rate change for a day" risk
   if it turns out not to be a typo?

4. **MPC announcement triggers.** Do we want the +30-minute post-MPC
   re-scrape, or is the next-day cron good enough? The +30m trigger
   needs a manually-maintained calendar of MPC dates in the repo.

5. **Sub-daily refresh.** Phase 1 plans daily. If you ever want
   intra-day (e.g. on news events), we'd swap JSON for Postgres and
   add a webhook trigger. Defer or plan?

6. **US data accuracy.** Phase 6 is deferred — should we keep US
   features (the country toggle) but explicitly mark US rate data as
   "indicative until Phase 2"? Or hide US until scraped?

---

## 11 · What does NOT change after Path B lands

All of these stay as they are today:

- `engine/rate_cards.py` — the hand-seeded dataclasses stay as the
  fallback when JSON is unreadable or empty. They're already used as
  the import-time default in the engine.
- `web/src/lib/rate-cards.ts` — the typed wrapper, helpers
  (`getRateRange`, `describePosition`), and JSON import all stay
  identical.
- `web/src/components/RateRangeHint.tsx` — renders unchanged. New
  warning footers (stale, quarantined) are additive and behind
  conditionals.
- `web/src/components/EffectiveAprBreakdown.tsx` — `RATE_CARD_AS_OF`
  already comes from the JSON; once scrapers update the JSON,
  the date updates automatically.

The only consumer that gets richer behavior is the validation gate,
which lives entirely in `scripts/scrape/` — new code, not modifications
to existing.

---

## 12 · One-page TL;DR

- Scrape rate cards daily via GitHub Action, write to
  `web/src/lib/rate-cards.json`, commit if changed.
- Phase 1 covers 6 IN Tier-A banks + RBI MPC.
- Frontend already reads the JSON — no change to the user-facing app.
- Failures fall back to last-good values; staleness is shown in the
  UI, not hidden.
- ~5-7 working days of effort to ship Phase 1 end-to-end.
- 6 open decisions (above) before kickoff.

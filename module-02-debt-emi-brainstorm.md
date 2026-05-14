# Module 02 — Debt & EMI Restructuring Optimiser
## Live Brainstorm Document

> **Purpose of this file:** capture the full state of our brainstorm so it can be resumed from any session. Read top to bottom — decisions are locked unless noted as OPEN.
> **Status:** brainstorming. No design work has started.
> **Last updated:** May 2026

---

## 0. Source brief
Module 2 lives inside the larger "FinOptima — Four Money Optimisers" brief (file: `uploads/money-optimisers-brief (1).html`). The original Module 2 covered: payoff ordering (avalanche vs snowball), effective post-tax rate, prepayment penalty check, cash flow buffer, month-by-month schedule. The brainstorm below extends that significantly.

---

## 1. Positioning (LOCKED)
**"Tell me the single best way to be debt-free, fastest."**

Pure objective: minimise total cost of debt + minimise time to zero.
- Credit score, psychological comfort, and tax-shield nuance = **opt-in lenses**, not defaults.
- The product is opinionated. It gives **one** answer, not five options.

---

## 2. Two-mode product (LOCKED)

| | **Simple Mode** | **Detailed Mode** |
|---|---|---|
| Audience | "I have debts, just tell me what to do" | "I want to understand and tune everything" |
| Inputs | Country + 1 line per debt (balance, rate, EMI) | Full per-loan detail incl. fees, penalties, tenure, fixed/float |
| Logic shown | Hidden. Output is an instruction. | Every assumption visible + editable |
| Output | One sentence + a number. *"Pay extra ₹10k/mo to your credit card. Debt-free by Aug 2027."* | Month-by-month schedule, sensitivity tables, what-ifs |
| Mode switch | Single toggle, top of screen | Same toggle, content reveals progressively |

Same engine underneath. Simple Mode = Detailed Mode with sensible defaults and 80% of the UI hidden.

---

## 3. Country-first architecture (LOCKED)

- Tiny country selector in **top-right corner** (flag + 2-letter code, unobtrusive).
- Drives **everything** downstream:
  - Available debt types (BNPL platforms, gold loans, HECS etc. only appear where they exist)
  - Default APR ranges per debt type
  - Real bank list with current rates
  - Tax rules (Sec 80C/24, mortgage interest deduction, etc.)
  - Currency, number formatting, slab structures
  - Tariff for refinance / balance-transfer offers

### Top 10 countries (LOCKED)
1. 🇮🇳 India
2. 🇺🇸 United States
3. 🇬🇧 United Kingdom
4. 🇨🇦 Canada
5. 🇦🇺 Australia
6. 🇩🇪 Germany
7. 🇸🇬 Singapore
8. 🇦🇪 UAE
9. 🇸🇦 Saudi Arabia
10. 🇯🇵 Japan

### Data ops model
- **Phase 1 (launch):** Manually maintained data sheets per country. Top 10–20 banks per country with personal loan / credit card / home loan / auto loan rates + balance-transfer offers + prepayment penalty norms. Refreshed by an ops person.
- **Phase 2 (future — note for reference):** Move to API integrations / web-scraping pipelines per bank where available. Some banks (esp. India RBI-regulated, US large banks) publish machine-readable rates. Many do not — for those, manual updates remain.

### Rate freshness model — tiered approach (LOCKED)
Doing 10 countries × 15 banks × 5 products manually every day = 750 cells/day, not realistic. Instead:

- **Tier A — Auto-scraped (top 5 banks per country).** Most large banks publish their headline rates on a "personal loan rates" / "credit card rates" page. A small scraper hits these daily, diffs against yesterday, flags changes for human review. ~50 automated cells/day.
- **Tier B — Crowd-flagging.** When a user inputs a rate that differs from our stored value by >0.5%, we ask: *"Your bank quoted 13.5%. Our data says 12.9%. Can you confirm?"* If 3 users in 7 days report the same delta, we flip our number. Free, accurate, scales with userbase.
- **Tier C — Quarterly manual audit.** Ops spot-checks the bottom-tier banks every 90 days. Acceptable because they move rates rarely.
- **Tier D — Confidence indicator in UI.** Each rate shows last-verified date. *"Updated 2 days ago"* or *"Confirm with your bank"* if stale. Handles user trust without promising real-time accuracy.

Net positioning: not "fresh daily" but **"fresh enough + transparent about staleness."** Same pattern as NerdWallet, BankBazaar.

---

## 4. Debt types in scope (LOCKED, country-gated)
- Credit cards (everywhere)
- Personal loans (everywhere)
- Home loans / mortgages (everywhere; offset-account logic for AU/UK)
- Auto loans (everywhere)
- Student loans (US, UK, AU, CA — handled specially because income-contingent in some)
- BNPL (Affirm/Klarna in US/EU, LazyPay/Simpl in India)
- No-cost EMI / EMI-on-card (India, MENA)
- Gold loans (India, MENA)
- Overdrafts / lines of credit (UK, US)
- Family / informal loans — optional, tagged as 0% non-optimisable

### Loan repayment structures to support
A single loan-type doesn't tell us how it amortises. Each loan in the system carries a structure flag:
- **Amortising EMI** — principal + interest blended monthly (standard for most consumer loans)
- **Bullet repayment** — interest-only monthly, full principal at maturity (some gold loans, short business loans)
- **Step-up EMI** — EMI rises over tenure (offered to young salaried borrowers expecting income growth)
- **Step-down EMI** — EMI falls over tenure (for borrowers near retirement)
- **Interest-only with refinance-assumed** — common in some US ARMs and UAE villa loans
- **Balloon repayment** — large final installment
- **Income-contingent** (UK Plan 2/5, AU HECS, US IDR) — repayment is a % of income above a threshold; **rule: never recommend voluntary overpayment** unless user is near full repayment AND their salary trajectory ensures they would otherwise repay before the wipe-out year. Special-case the math.

---

## 5. The optimisation stack — three layers, run top-down (LOCKED)

### Layer 1 — Restructuring (run first, biggest wins)
*Before* re-ordering payments, ask: can we make the debts themselves cheaper?
- **Balance transfer candidates** — any card >24% APR where a BT offer at <12% exists in this country/bank list
- **Consolidation candidates** — when 2+ unsecured debts at >15% can be replaced with 1 personal loan at lower blended rate (net of processing fee)
- **Refinance candidates** — home/auto loans where current bank's rate is >1.5% above market median
- **Tenure renegotiation** — extending a long-tenure loan to free monthly cash that gets aimed at a high-rate one. Increases lifetime interest on the home loan but redirects cash flow against a 38% credit card; net win can be large.
- **Part-prepayment with tenure-reduction flag** for every home/auto loan (most banks default to EMI-reduction, which is almost always the wrong choice).

Output: *"Before optimising payment order, do these 3 restructuring moves. Estimated savings: ₹2.4L."*

### Layer 2 — Payment ordering (after restructuring)
The classical avalanche / snowball, but with one upgrade:
- **Default = Pure Avalanche.** This is mathematically the most profitable strategy — always attack the highest effective post-tax rate first. Consistent with our positioning of "the best possible way to get rid of debt, fastest."
- **Hybrid is available as a behavioural opt-in,** clearly labelled: *"Behavioural mode — based on Kellogg / Harvard adherence research, knocking out small debts first improves plan stick-to-it-ness by ~15%. Costs you slightly more interest, but you're more likely to actually finish."* User chooses the threshold N (debts killable in ≤N months get prioritised before avalanche kicks in).
- **Snowball-only** also available as an alternative in Detailed Mode for comparison.
- Effective rate per loan computed with: processing fees amortised, bundled insurance, GST, country-specific tax shields.
- **The N threshold (when hybrid is selected) is user-configurable** — default 3 months; user can set 0 (= pure avalanche, same as default), 6, or 12 (snowball-leaning).

#### Why pure avalanche is the default (decision rationale)
The positioning of this product is *"the single best way to be debt-free, fastest."* On the math alone, pure avalanche wins — every time, by definition. Hybrid sacrifices a measurable amount of interest (typically ₹1,500–₹5,000 on a 3-year plan) for a behavioural benefit that not every user needs. Making hybrid the default would silently cost every user some money, even those who would have stuck with avalanche perfectly. Better to default to the mathematically optimal strategy and offer the behavioural concession explicitly, with the trade-off transparent.

This matches how good financial planners actually work: they recommend the optimal path, then negotiate down to the path the client will actually follow.

### Layer 3 — Invest-vs-prepay decision
For every loan whose post-tax effective rate is *below* the user's risk-adjusted expected return floor, recommend **don't prepay — invest instead**.
- Floor is **per-user, based on their actual investment options at the present moment** (not a single country-default).
- User declares their actual options: e.g. fixed deposit at 7%, index fund expected 12%, real estate fund 9%, employer ESPP at 15% effective return, etc.
- Optimiser picks the **best risk-adjusted return** available to *this* user and uses that as the floor.
- Output sentence: *"Don't prepay your home loan. Redirect that ₹10,000/mo into the Nifty index fund you mentioned. Projected 10-year net worth gain: +₹4.2L vs prepayment."*
- **Return assumptions = historical long-run averages with confidence bands**, not real-time market data. (Nifty 50 1995–2024 ≈ 11.5% CAGR; S&P 500 long-run ≈ 10% nominal / 7% real; etc.) Annual review of the assumption is enough — these don't move month-to-month. User can override their personal expected-return assumption in Detailed Mode.

### Layer 0 — Mandatory contributions check (run BEFORE Layer 1)
Before any debt optimisation, ensure the user is not leaving free money on the table:
- **Employer-matched retirement contributions** (US 401k, UK auto-enrolment, AU superannuation salary-sacrifice, India NPS Tier 1) — if employer matches up to X%, the user MUST be contributing at least that much. A 50% employer match = instant 50% return, which beats every debt rate.
- **Tax-advantaged accounts with hard annual deadlines** (US IRA, India Sec 80C ELSS/NPS in March) — flag if user is leaving deduction headroom unused at year-end.

This is the *highest-priority* allocation for marginal surplus, ahead of debt payoff. The optimiser only routes surplus to debt *after* employer match is captured.

---

## 6. Optional lenses (opt-in toggles in Detailed Mode)
Pure debt-killer logic is the default. These are layered on by user choice:
- **Credit-score-aware mode** — biases toward credit card payoff sequence that maximises score improvement (high-utilisation cards first, avoid closing oldest accounts), even if slightly more interest. Useful for users planning a home loan in 12–24 months.
- **Cash-flow-conservative mode (Emergency Fund First)** — won't recommend any extra payment until the user has a declared emergency fund (default: 3 months of expenses in liquid savings). This is the personal-finance equivalent of a DSRA (Debt Service Reserve Account). Strongly recommend most users enable this by default — extra-paying debt without a reserve is fragile.
- **Tax-year optimised mode** — times big prepayments to maximise current-FY tax deduction headroom.
- **Income-volatility mode** — for freelancers; uses last 6 months of declared income, plans against the 25th-percentile month, not the mean.
- **Aggressive mode** (advanced, off by default) — allows the optimiser to recommend *skipping* a minimum payment on a low-rate loan if the math (extra interest saved on the high-rate loan) beats the penalty + credit-score cost. Almost never the right call, but exposed for power users.

### Minimum payments — soft constraint, not hard
Minimums aren't legal requirements; they're contractual obligations with consequences:
- **Late fee** — flat ₹500–₹1,500 in India, $25–$40 in US
- **Penal interest** — additional 2–3% APR, often applied to the *whole balance*
- **Credit score hit** — 30+ days late ≈ 50–100 point CIBIL/FICO drop
- **Card freeze / default status** in extreme cases

Default behaviour: always pay minimums. Only "Aggressive mode" exposes the option to skip, and only when the math is unambiguously positive.

---

## 7. Killer outputs — the 10-second wow (working list)
The home screen should rotate through whichever of these is biggest for *this* user:
1. *"You're paying ₹1,24,000 in unnecessary interest. Here's how to keep it."* (specific currency number)
2. *"Your real interest rate is 38%, not 24% — here's why."* (the bundled-fees reveal)
3. *"Don't prepay your home loan. Invest instead. Net gain: +₹4.2L over 10 years."* (the contrarian)
4. *"Switch your ₹65k credit card balance to bank X's BT offer. Save ₹18,000."* (the specific restructure)
5. *"Debt-free 14 months earlier."* (the time number)

---

## 8. Decision-moment sub-modules (LOCKED)
In addition to the ongoing plan, the product has three **single-decision tools** for specific user moments:

### 8a. Windfall Handler — "I just got money"
- Trigger: user taps "Got a bonus / windfall" button. (Future: bank-feed integration detects unusual large credit.)
- Routes the windfall through the Layer 1 → 2 → 3 stack, sized to that one amount.
- Output: a **single decision**, not a plan.

### 8b. New Debt Check — "Should I take this EMI?"
- Trigger: user is about to buy something on credit / EMI and wants a sanity check.
- Inputs: item cost, EMI offer details (tenure, rate, processing fee), AND the cash-price-elsewhere if known.
- Computes the *true effective rate* of the new debt, including the **hidden cost of 0% EMI**:
  - **iPhone example:** listed at ₹80,000 on 0% 12-month EMI, but cash-price elsewhere (or with discount) is ₹74,000. The foregone ₹6,000 discount = real cost of borrowing → ~16% effective APR.
  - The retailer/lender isn't absorbing the cost — it's baked into the price as a foregone discount or processing fee. "0% EMI" is a marketing construct.
- Compares three paths: take the EMI / pay cash from savings (keeping emergency reserve intact) / delay purchase and save up.
- Output: a single recommendation with the dominant trade-off shown.
- Example: *"This 'no-cost EMI' is actually 16.2% effective. Pay cash, replenish savings over 6 months. You'll save ₹6,000."*

### 8c. Asset Liquidation Check — "Should I sell to clear debt?"
- Trigger: user wants to know if an idle asset (dormant FD, stagnant gold holding, underperforming mutual fund, appreciating land with no rental yield) should be sold to pay down debt.

#### Decision gate — 4 conditions must all pass before recommending a sale
1. **Debt size threshold:** debt must be ≥ 10% of asset value. (Selling a ₹15L plot to clear ₹10k of debt is absurd — friction outweighs benefit. Pay from regular surplus instead.)
2. **Divisibility check:** is the asset partially saleable (FD, mutual fund, gold) or all-or-nothing (single plot, jewellery piece)? For indivisible assets, the action threshold is much higher because the user can't just sell "enough."
3. **Real rate spread test:** debt's effective rate must exceed asset's **real net annual return** (nominal return − inflation − holding costs, after sale tax) by **at least 3 percentage points**. Smaller margins don't justify transaction friction.
4. **Tax-threshold check:** confirm the sale doesn't push the user into a higher LTCG slab / income bracket that wipes the benefit.

#### Why real return, not nominal
A ₹15L plot returning 3.3% nominally when inflation is 6% is **losing 2.7% in real purchasing power every year**. Most users don't internalise this — the land "feels" like it's growing, but it's silently shrinking. The optimiser should always frame asset returns in real terms when comparing against debt costs.

*Example:* Land 3.3% nominal, inflation 6% → real return − 2.7%. Personal loan effective rate 14% (debt rates are already cash-cost, no inflation adjustment needed for short-tenure debt). Spread = 14% − (−2.7%) = **16.7pp**. The case for selling is much stronger than the nominal comparison suggested.

If **all four pass** → recommend sale with a specific rupee amount and a clear net-benefit number.
If **any fail** → explain why, suggest the alternative (pay from surplus, partial sale, wait, or keep).

#### Worked example matrix

| Scenario | Asset | Net return | Debt | Debt rate | Decision |
|---|---|---|---|---|---|
| A | Land ₹15L | 3.3%/yr | ₹10k personal loan | 14% | **Don't sell.** Debt < 10% of asset; pay from surplus. |
| B | Land ₹15L | 3.3%/yr | ₹2.5L credit card | 38% | **Sell ~₹2.6L worth** (if partial possible) or **rethink** (if indivisible). Spread is 34.7pp. |
| C | Land ₹15L | 3.3%/yr | ₹40L home loan @ post-tax 7.3% | 7.3% | **Don't sell** unless user is debt-stressed. Asset is ₹15L; debt is ₹40L — sale wouldn't move the needle. |
| D | Land ₹15L | 8% (rental + appreciation) | ₹3L personal loan | 14% | **Don't sell.** Spread is 6pp — above the 3pp threshold — but the personal loan can be cleared from surplus in 18–24 months, and the land's net return is reasonable. Borderline; default to keep. |

#### Output format
A specific recommendation with the dominant number:
> *"Your ₹2.5L credit card at 38% costs you ₹95,000/yr in interest. Your land returns ₹50,000/yr net. Even after ₹6,000 LTCG tax on selling enough land to clear the card, you'd save ~₹89,000/yr — and free up the surplus currently servicing this debt. **Sell ₹2.6L of land, pay off the card.**"*

Or the opposite:
> *"Don't sell. Your debt is only ₹10,000 — not worth the friction of liquidating ₹15L of land. Pay it from your monthly surplus over 2–3 months."*

- **Simple Mode:** asks for asset value, asset return %, debt amount, debt rate. Uses default tax assumption per country.
- **Detailed Mode:** all 4 conditions exposed + holding costs + actual LTCG/STCG slabs + transaction costs.
- **Personal-finance scope only** — full business finance (WACC, DSCR, project cash-flow discounting) is out of scope for v2.

### 8d. Quick Recompute — "I just paid ₹X extra"
- Trigger: one-tap button on the home screen labelled *"I made an extra payment."*
- Input: amount + which loan
- Output: "That moved your debt-free date from Aug 2027 to Jun 2027. Saved ₹3,200 in interest."
- Purpose: dopamine feedback. Reinforces the behaviour. Updates the schedule everywhere automatically.

### 8e. Cash Yield Check — "Where is your cash sitting?"
- Trigger: passive check during onboarding + monthly reminder.
- Asks not just *how much* cash you have but *where it is sitting*:
  - Checking / current account (typically 0–1% yield)
  - Standard savings account (3–4% India, ~0.1% US megabanks)
  - High-yield savings / HYSA (US: 4–5%; India: liquid funds 6.5–7%)
  - Fixed deposit (locked, 6–7% India)
- Surfaces idle cash as a one-line nudge:
  *"Your $20k in checking is earning 0.1%. Moving it to an HYSA at 4.5% earns you $880/yr risk-free — more than prepaying your 5.5% mortgage on the same dollars."*
- Often the easiest, lowest-friction win the app can deliver — no behavioural change, just an account migration.

### 8f. Right-Time-to-Borrow Advisor — "Wait or borrow now?"
- Trigger: user enters Detailed Mode of New Debt Check and asks *"is this the right time?"*
- Logic:
  - Current market rate for that loan type vs 6-month rolling average
  - Central bank's next scheduled decision date + market consensus on direction
  - Personal urgency flag (user marks: must buy now / can wait 3 months / can wait 6+ months)
- Output: *"Personal-loan rates are 13.2% currently, vs 12.4% six months ago. RBI is expected to cut in July (consensus 25bps). If you can wait 2–3 months, you save ~₹12k over the loan tenure. Defer if possible."*

---

## 9. Revenue model
- **Free** — country selection + Simple Mode + up to 3 debts + classical avalanche
- **Pro** — Detailed Mode + restructuring + invest-vs-prepay + opt-in lenses + windfall handler + unlimited debts + monthly reminder + PDF export
- **Affiliate** — referral revenue for balance transfers / refinance / consolidation loans the optimiser recommends.
  - Conflict-of-interest disclosure must be visible.
  - No referral fees on "don't prepay, invest" recommendations — and that's a positive trust signal we should lean into.

---

## 10. Decisions log (chronological)

| # | Question | Decision | Date |
|---|---|---|---|
| 1 | Product scope — narrow (ordering only) vs broad (full strategist)? | Both, via Simple/Detailed mode toggle | May 2026 |
| 2 | Geography focus — India-first or multi-country day 1? | Top 10 countries, country-first architecture | May 2026 |
| 3 | Invest-vs-prepay tension with referral revenue | Include the contrarian advice; use it as trust signal | May 2026 |
| 4 | Credit score handling | Opt-in lens, separate logic, not default | May 2026 |
| 5 | Manual entry friction vs account aggregator | Manual entry primary; AA/open banking later | May 2026 |
| 6 | #10 country | Japan | May 2026 |
| 7 | Bank rate data ops | Manual data sheets daily, refreshed by ops; API future | May 2026 |
| 8 | Invest-vs-prepay floor — country default vs user-specific? | User-specific, based on options actually available to them | May 2026 |
| 9 | Default payoff strategy | Pure avalanche (most profitable). Hybrid available as labelled behavioural opt-in. | May 2026 |
| 10 | Rate freshness post-launch | Tiered model: auto-scrape top 5 banks daily + crowd-flag + quarterly audit + UI staleness indicator | May 2026 |
| 11 | Balance transfer execution depth | Phased: Shallow at MVP → Mid by month 6 → Deep with API partners later | May 2026 |
| 12 | Minimum payment as constraint | Soft constraint. Default = always pay. "Aggressive mode" exposes skip-with-penalty option for power users. | May 2026 |
| 13 | Tax shield formula | Cap-aware (corrected). `effective_rate = nominal × [1 − (deductible/total_interest) × tax_bracket]`. Country cap table maintained. | May 2026 |
| 14 | Variable monthly surplus | 12-month cash flow calendar; user marks high/low/specific per month; plan re-runs. | May 2026 |
| 15 | New Debt Check sub-module | Added — evaluates effective rate of any new EMI offer before user takes it | May 2026 |
| 16 | Asset Liquidation Check sub-module | Added — personal-finance scope only; full business finance out of scope | May 2026 |
| 17 | Employer-matched contributions | Added as Layer 0 (highest-priority allocation before debt payoff) | May 2026 |
| 18 | Index fund / market data sourcing | Historical long-run averages with annual review; no real-time scraping | May 2026 |
| 19 | Loan repayment structures | Explicit support: amortising, bullet, step-up, step-down, interest-only, balloon, income-contingent | May 2026 |
| 20 | Central bank rate monitoring | Tracked per country; rate moves trigger automatic replan + notification + refinance opportunity check | May 2026 |
| 21 | Income-contingent loan rule | Never recommend voluntary overpayment on UK Plan 2/5, AU HECS, US IDR unless near full repayment | May 2026 |
| 22 | Business finance (WACC, DSCR, buy-vs-lease) | Explicitly OUT of scope for v2; future separate product | May 2026 |
| 23 | Quick Recompute sub-module (8d) | One-tap "I just paid extra" feedback loop | May 2026 |
| 24 | Cash Yield Check sub-module (8e) | Flags idle low-yield cash; nudges to HYSA / liquid fund | May 2026 |
| 25 | Right-Time-to-Borrow Advisor sub-module (8f) | Wait-or-borrow-now decision support | May 2026 |
| 26 | Inflation handling | Annual country rate, quarterly refresh; used for real return / salary growth / fixed-rate erosion | May 2026 |
| 27 | Multi-tier rates within a credit card | Detailed Mode supports per-component balance entry; Simple Mode uses headline rate | May 2026 |
| 28 | Plain-language principle | No jargon; info-icons + glossary; translation guide maintained | May 2026 |
| 29 | Credit-score guardrails when overpaying | Flag closing-oldest-card + only-installment-loan cases as one-time warnings | May 2026 |
| 30 | 0% EMI true cost | Always show effective rate including foregone discount; not a special case |  May 2026 |

---

## 11. Balance transfer flow — three depths (LOCKED phased rollout)

| Depth | What we do | Build cost | Revenue |
|---|---|---|---|
| **Shallow** | "Bank X has a 0% BT offer for 6 months. Apply on their site." Link out. | Low | Affiliate click-out fee (₹50–200 per click) |
| **Mid** | We capture user details, prefill the bank's form via deep link, hand off | Medium | Lead-gen fee (₹500–1,500 per submission) |
| **Deep** | Full in-app application with the bank as API partner — user never leaves | High | Funded-loan commission (1–3% of transferred amount) |

**Launch plan:** ship Shallow at MVP. Move to Mid by ~month 6. Deep requires API partnerships that take 6–12 months per bank — pursue only after Shallow proves which BT offers users actually take. Conversion data from Shallow is the leverage to negotiate Deep partnerships later.

---

## 12. Tax shield — correct math and country-specific caps (CORRECTION to original brief)

**The original brief had this wrong.** It computed `effective_rate = nominal_rate × (1 − tax_bracket)`, which silently assumes **100% of loan interest is tax-deductible**. In every country we support, it isn't — there's a **cap**, and once your loan is large enough that annual interest exceeds the cap, the marginal additional interest gives you no tax benefit.

### Correct formula
```
deductible_amount = min(actual_annual_interest, country_cap_for_loan_type)
tax_saved         = deductible_amount × user_marginal_tax_rate
effective_rate    = nominal_rate × [1 − (deductible_amount / actual_annual_interest) × marginal_tax_rate]
```

### Worked example — India, ₹50L home loan @ 8.5%, salaried in 30% bracket, self-occupied property

| Step | Calculation | Number |
|---|---|---|
| Annual interest paid | ₹50L × 8.5% | ₹4,25,000 |
| Sec 24 deduction cap | min(₹4.25L, ₹2L) | ₹2,00,000 |
| Deductible portion ratio | ₹2L ÷ ₹4.25L | 47% |
| Tax saved | ₹2L × 30% | ₹60,000 |
| Net interest cost (after tax shield) | ₹4.25L − ₹60k | ₹3,65,000 |
| **Effective post-tax rate** | ₹3.65L ÷ ₹50L | **7.30%** |

The naive formula `8.5% × (1 − 0.30) = 5.95%` was too generous — it assumed *all* ₹4.25L of interest gets shielded. In reality, only 47% does, because the cap binds. **Correct effective rate is 7.30%**, not 5.95%.

### Why this matters for Layer 3 (invest-vs-prepay)
A home loan at *real* 7.30% is harder to beat with investments than one at 5.95%. The "don't prepay" advice still wins for most users (Nifty long-run ~11.5% > 7.30%) but the margin is smaller, and for users in lower tax brackets / smaller loans where the cap doesn't bind, the math can flip. The optimiser must use the correct cap-aware formula per country and per loan type.

### Country-specific caps (data table to maintain)

| Country | Loan type | Cap / Rule | Authority |
|---|---|---|---|
| 🇮🇳 India | Home loan interest | ₹2L/yr (self-occupied), unlimited (let-out) | Sec 24 |
| 🇮🇳 India | Home loan principal | ₹1.5L/yr (within Sec 80C aggregate) | Sec 80C |
| 🇮🇳 India | Education loan interest | 100% deductible for 8 yrs from repayment start | Sec 80E |
| 🇺🇸 US | Mortgage interest | Interest on up to $750k principal, itemisers only | IRC §163 |
| 🇺🇸 US | Student loan interest | Up to $2,500/yr, phases out at higher income | IRC §221 |
| 🇬🇧 UK | Mortgage interest (primary) | Not deductible | n/a |
| 🇬🇧 UK | Mortgage interest (rental) | 20% basic-rate credit only | s.272A ITTOIA |
| 🇩🇪 Germany | Primary mortgage interest | Not deductible | n/a |
| 🇩🇪 Germany | Rental mortgage interest | Fully deductible against rental income | EStG |
| 🇦🇺 Australia | Owner-occupier mortgage | Not deductible | n/a |
| 🇦🇺 Australia | Investment property | Fully deductible (negative gearing) | ITAA |
| 🇨🇦 Canada | Mortgage on primary | Not deductible | n/a |
| 🇨🇦 Canada | Investment loan interest | Deductible if used to earn income | s.20(1)(c) |
| 🇸🇬 Singapore | Mortgage interest | Not deductible (primary); deductible vs rental | IRAS |
| 🇦🇪 UAE | All personal loan interest | Not deductible (no personal income tax) | n/a |
| 🇸🇦 Saudi Arabia | All personal loan interest | Not deductible (no personal income tax) | n/a |
| 🇯🇵 Japan | Mortgage interest | Tax credit (not deduction) of 0.7% of balance, up to JPY 4M loan, 13 yrs | Article 41 |

---

## 13. Cash flow calendar — variable budgets through the year (LOCKED)

A flat monthly surplus is fiction. The optimiser must accept a **12-month cash flow calendar** where the user can mark months as low / normal / high or input specific amounts.

### Events to capture
- **Festive / wedding months** (Oct–Nov India, Dec West) — temporary squeeze
- **Annual bonus month** — surplus spike
- **Job loss** — surplus drops to zero or negative; user updates "I lost my job" and the plan replans on conservative assumptions
- **Salary hike** — permanent step-up from a specific month
- **New EMI starting** (car loan begins) — surplus drops
- **EMI ending** (a loan finishes) — surplus jumps; the freed EMI should auto-route to the next-priority debt ("avalanche cascade")
- **Advance tax months** (India: Jun/Sep/Dec/Mar) — temporary squeeze
- **School fees** (Apr/Jun) — squeeze
- **Insurance premium renewals** — annual/semi-annual lumps
- **Freelance / variable income** — volatility model (see Income-volatility lens)

### Interaction with the plan
- Optimiser uses the per-month surplus to schedule extra payments (not a flat surplus).
- If a low month is coming, the optimiser front-loads payments in the high month before it.
- User can update the calendar anytime; plan re-runs.
- Major life events (job loss, hike) trigger a replan + an explanatory notification.

---

## 14. Central bank rate monitoring and replanning (LOCKED)

When a central bank moves rates, floating-rate debts reset and refinance opportunities shift. The product monitors this and triggers replans automatically.

### Coverage

| Country | Central bank | Decision cadence |
|---|---|---|
| India | RBI MPC | 6 per year |
| US | Fed FOMC | 8 per year |
| UK | BoE MPC | 8 per year |
| Eurozone (Germany) | ECB GC | 8 per year |
| Canada | BoC | 8 per year |
| Australia | RBA | 11 per year |
| Singapore | MAS | 2 per year (no rate — NEER) |
| UAE | CBUAE (USD-pegged, follows Fed) | follows Fed |
| Saudi Arabia | SAMA (USD-pegged, follows Fed) | follows Fed |
| Japan | BoJ | 8 per year |

Decisions are scheduled in advance and announced through machine-readable RSS / press releases. Data ops responsibility: pull the next 12 months of scheduled decisions per country, plus monitor announcement day for the actual change.

### Replan triggers
When a rate change happens, automatically:
1. Recompute effective rate for every user's floating-rate debts (home loans, ARMs, some personal loans)
2. Recompute every active plan
3. Check whether any new balance-transfer / refinance offers in the market now beat the user's current debts
4. Send the user a notification:
   *"RBI cut repo by 25bps yesterday. Your home loan EMI will reset on July 5 to ₹X (savings ₹Y/month). Your debt-free date moved up by 2 months. — see updated plan."*

### Why this matters strategically
- Gives the app a **recurring reason to engage** the user that isn't user-initiated (notification on rate-decision days)
- Positions the product as the user's eyes on debt-market conditions, not just a one-time calculator
- Generates affiliate revenue opportunities each cycle (when rates fall, refinancing window opens)

---

## 15. Inflation handling (LOCKED)

Inflation affects three specific calculations in the optimiser. We use **an annual rate per country, refreshed quarterly** — not month-by-month CPI data. Sources: RBI projections (India), Fed SEP (US), BoE / ECB / RBA forecasts.

### Where inflation matters
1. **Real return on investments** — in Layer 3 (invest-vs-prepay), long-horizon decisions use real returns (nominal − inflation). A 12% nominal stock return at 6% inflation = 6% real return. Prepaying a 7.3% effective-rate mortgage suddenly looks better.
2. **Future salary growth** — user's salary likely grows roughly with inflation (or above, for early career). The optimiser projects future surplus growing at a default 1.5× inflation rate, capped at 8%/yr (user override available). This matters for long-tenure home loan planning where surplus capacity expands over time.
3. **Real value of fixed-rate long-tenure debt** — inflation erodes the real burden of your home loan EMI. A ₹45,000 EMI today feels much lighter in year 12 of a 20-year loan. The plan should *show* this in a chart — most users have never seen it visualised and it's a powerful insight against over-aggressive home loan prepayment.

### Where inflation does NOT matter (don't model)
- Short-tenure decisions (<24 months) — inflation impact is rounding error
- Credit card payoff plans — they finish before inflation moves the needle
- The "which debt first" ordering decision — ordering is rate-driven, not inflation-driven

### CPI release cadence (reference)
- India: MoSPI releases CPI on the 12th of the following month
- US: BLS releases CPI mid-month
- We don't react to monthly prints. We use central bank forecasts as the planning rate, refreshed quarterly.

---

## 16. Multi-tier rates within a single credit card (LOCKED)

A credit card isn't one rate — it's several. Most users don't know this. Detailed Mode should let users enter per-component balances; Simple Mode rolls them into one weighted rate.

### Component breakdown (per card)
- **Retail purchase rate** — e.g. 36% APR
- **Cash advance rate** — typically 42–48% APR + flat 2.5% upfront fee on withdrawal
- **EMI conversion rate** (when user converts a big purchase to EMIs on the card) — often 13–18%, surprisingly *lower* than retail rate
- **Outstanding balance rate** — after grace period, on the unpaid portion
- **Late payment fee** — flat, balance-slab-based (e.g. ₹500 below ₹10k balance, ₹1,300 above ₹50k)
- **Foreign transaction markup** — typically 3.5%
- **GST on interest** (India) — 18% on top of all of the above
- **Reward redemption / cashback value** — a *negative* cost we can credit back if user actively redeems

### How the optimiser handles it
- **Detailed Mode:** user enters per-component balances. Optimiser computes a weighted effective rate for the card AND identifies the highest-rate component for targeted payoff guidance.
- **Insight output example:** *"Your Kotak card shows as 36% overall, but ₹14,000 of your ₹65,000 balance is cash-advance at 48%. The bank applies your payments to the lowest-rate component first by default — you must explicitly request 'payment toward cash advance' or the high-rate balance keeps accruing."*
- **Simple Mode:** ask one rate (the user's headline number) and use it. We can always upgrade them to detailed later.

### Data ops note
For each card in our country bank-data sheets, we maintain the component-level rate matrix — not just the headline rate. This is non-trivial data work but is what creates the moat against generic comparison sites.

---

## 17. Plain-language design principle (LOCKED)

No jargon in user-facing copy. Ever.

### Translation guide (working list — to expand)

| Don't say | Say instead |
|---|---|
| Effective post-tax rate | What this loan really costs you |
| Opportunity cost | What you give up by doing this |
| Net present value | Worth today |
| Amortisation schedule | Month-by-month plan |
| Tax shield | Tax saving |
| Marginal tax rate | Your tax bracket |
| Tenure | Loan length |
| Principal outstanding | Amount you still owe |
| Prepayment | Paying extra |
| Balance transfer | Move your debt to a cheaper card |
| Debt service coverage | (do not surface) |
| WACC / NPV / DSRA | (out of scope; never surface) |
| Income-contingent repayment | A loan you only pay when you earn enough |
| Hybrid / avalanche / snowball | The behavioural mode names can stay but always with a tooltip |

### Info-icon pattern
Every non-obvious number gets a tap-to-explain (ⓘ) icon next to it. Tap = bottom-sheet popup with: *"What this means"* + *"How we calculated it"* + the actual formula for Detailed Mode users.

### Glossary screen
Accessible from settings. Lists every concept the app uses, in plain English. Linked from every ⓘ popup.

---

## 18. Credit-score guardrails when overpaying (additions to Credit-Score-Aware lens)

Paying off debt aggressively can paradoxically *hurt* your credit score in two specific cases. The optimiser should flag these even when Credit-Score-Aware mode is off (one-time warning, not recurring nudge).

### Guardrail 1: Closing your oldest credit card
Closing a card reduces:
- Total available credit → utilisation ratio rises on remaining cards → score drops
- Average age of accounts (especially if closed card is your oldest) → score drops

**Recommendation pattern:** *"Pay this card off to zero, but **keep it open**. Use it for a small recurring charge (Netflix, a monthly auto-debit) and pay in full each month. This preserves the credit history and available-credit headroom."*

### Guardrail 2: Paying off an installment loan too early
A mix of installment loans (car, personal) and revolving credit (cards) improves credit mix. Closing your only installment loan early can drop the FICO mix component by 30–60 points temporarily.

**Recommendation pattern:** flag if user is about to fully pay off their only installment loan; suggest considering whether the score impact matters for their next planned credit application (home loan, etc.).

### Behavioural note
These guardrails should appear **once**, as part of plan generation, not as recurring popups. Most users find recurring credit-score nudges noisy.

---

## 19. Out of scope for v2 (LOCKED)

Keep these explicitly out so the product stays focused:

- **Business / project finance**: WACC, DSCR (debt service coverage ratio), DSRA modelling, capital structure optimisation (debt vs equity mix), buy-vs-lease analysis, NPV/IRR of business projects, working capital management. These belong in a separate future product for SMB / entrepreneur users.
- **Tax filing or tax optimisation beyond debt-related shields.** We compute the tax shield on loan interest; we don't tell you how to file your return.
- **Investment portfolio optimisation.** We help you decide *whether* to prepay vs invest; we don't pick the actual fund / asset for you.
- **Insurance optimisation** (life, health, term cover sizing). Adjacent but separate.
- **Estate planning / succession.**
- **Foreign-currency loans** (uncommon retail product; revisit if user demand emerges).
- **Loans in default / collections.** Different emotional + legal state — separate flow if added later.
- **Account aggregator / open-banking auto-import.** Manual entry only for v2. (Future: Sahamati/AA in India, Plaid/MX in US/UK, AISP in EU.)

---

## 20. Open questions — resolved (LOCKED)

All open questions from prior rounds are now decided:

| # | Question | Resolution |
|---|---|---|
| 31 | Negative-equity car loans | Detect & flag; never recommend selling underwater car. Show info note: *"Your car is currently worth less than what's owed (₹X negative equity). Selling won't help. Continue normal payments; typically corrects in 24–36 months as principal pays down faster than depreciation."* Standard payoff order applies. |
| 32 | Joint / co-signed debts with spouse | MVP = individual-level only. User flags joint loans, optimises as if they own them. **Household Mode** saved as Pro feature for later (consent flow, dual login, shared plan). |
| 33 | UI tone for different emotional states | Default = calm-planner aesthetic. Add a "feeling overwhelmed?" toggle that swaps into a stripped-down "next single step" view. Matrix: Simple×Calm, Detailed×Calm, Simple×Overwhelmed. (No Detailed×Overwhelmed — defeats the point.) |
| 34 | Business finance (WACC, DSCR, buy-vs-lease) | Confirmed OUT for v2. Add "Coming soon: Business Capital Optimiser" email-capture placeholder in app footer for V3 demand validation. |
| 35 | Mortgage Overpayment + Student Loan modules from original brief | Killed as standalone modules. They become marketing hooks / landing-page features of Module 2. |
| 36 | Inflation in Asset Liquidation Check | Use **real return** (nominal − inflation − holding costs) when comparing asset return to debt cost. Most users miss this; it dramatically changes the answer. |

---

## 21. What we are NOT doing yet (NOTE: design spec now exists as separate file)
Brainstorm is complete. Design spec is in `module-02-design-spec.md`.

---

## 22. How to resume this brainstorm in a new session
Paste this whole file in, plus the original brief (`uploads/money-optimisers-brief (1).html`), and say:
> "Here's the running brainstorm doc for Module 2. Read it, then continue from Section 20 (Open questions). I'm ready with my next round of questions."

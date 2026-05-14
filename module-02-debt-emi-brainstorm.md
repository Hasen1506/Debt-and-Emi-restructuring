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
| 31 | PF/EPF/PPF/NPS handling | Restricted-liquidity category, excluded from invest-vs-prepay monthly allocation. One-time decision tool only when withdrawal eligibility confirmed. See §23. | May 2026 |
| 32 | India tax regime | User declares old vs new regime in onboarding. App never auto-assumes old regime. Sec 24 tax shield only applied if user is on old regime (self-occupied home loan). See §25. | May 2026 |
| 33 | India surcharge + cess | Full surcharge + 4% cess formula applied. Effective marginal rate ≠ slab rate for incomes > ₹50L. See §25. | May 2026 |
| 34 | Minimum payment — bank-specific | Country data store stores per-bank minimum payment formula. Simple Mode default = 5%/₹200 India; 2%/$35 US. Detailed Mode auto-populates formula from bank selection. See §24. | May 2026 |
| 35 | Asset liquidation — transaction costs | Gate 3 spread must include stamp duty + registration + brokerage + LTCG on the asset side, plus interest accrued during selling period on the debt side. See §26. | May 2026 |
| 36 | Salary hike model | User-declared annual %, defaulting to inflation × 1.5 capped at 8%. Business owners use 3-year income CAGR. Detailed Mode allows year-by-year schedule. See §27. | May 2026 |
| 37 | Business owner income | P25 of last 12 months (not 6). Advance tax months auto-marked as cash outflows. Business loans flagged separately. See §28. | May 2026 |
| 38 | India MAB | Subtracted from available cash before emergency fund calculation. Auto-populated from primary bank selection in onboarding. See §29. | May 2026 |
| 39 | Geographic scope Phase 1 | India + USA only. Remaining 8 countries move to Phase 2. See §30. | May 2026 |
| 40 | Bank data scope | India: top 30 banks (tiered A/B/C). USA: top 15 lenders/issuers (tiered A/B/C). See §31. | May 2026 |
| 41 | Web-first v1 | Desktop/web primary (1280px+). Mobile browser fully functional. Native app Phase 2. See §32. | May 2026 |
| 42 | GST on interest — India scope | GST @ 18% applies to credit card interest and personal loan processing fees only. Does NOT apply to home loan EMI interest or auto loan EMI interest. | May 2026 |
| 43 | US mortgage interest deduction — itemisation gate | Apply IRC §163 deduction only if user confirms they itemise. Since TCJA 2017, most US filers use standard deduction and get zero mortgage interest benefit. Add itemisation flag in US onboarding. | May 2026 |

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
| 🇮🇳 India | Home loan interest | ₹2L/yr (self-occupied, **old regime only** — new regime does not allow this deduction for self-occupied property), unlimited (let-out, both regimes) | Sec 24 |
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
Brainstorm extended through §34. Design spec is in `module-02-design-spec.md`. All open questions resolved as of May 2026. See §35 for resume instructions.

---

## 22. How to resume this brainstorm in a new session
All open questions are resolved through §34. See §35 for current resume instructions.

---

## 23. India PF ecosystem — restricted-liquidity instruments (LOCKED)

EPF, PPF, NPS, and VPF are not freely available savings. They are restricted-liquidity instruments requiring special handling in the invest-vs-prepay decision and asset liquidation check.

### 23.1 Instrument profiles

| Instrument | Rate (FY2024-25 confirmed; FY2025-26+ `[VERIFY]`) | Tax treatment | Liquidity | Voluntary? |
|---|---|---|---|---|
| **EPF** | 8.25% (FY2024-25; announced Feb 2025). `[VERIFY FY2025-26 → EPFO circular ~Mar 2026]` `[VERIFY FY2026-27 → EPFO circular ~Mar 2027]` | Fully tax-free (EEE) | Partial withdrawal for: home purchase, marriage, medical, education (Form 31). Full settlement only on retirement (58+) or 2+ months after leaving employment (Form 19). | Mandatory for salaried (12% employee + 12% employer on basic+DA) |
| **VPF** | Same as EPF | Same as EPF (EEE) | Same rules as EPF | Voluntary top-up to EPF — employee chooses %; employer not required to match |
| **PPF** | 7.1% (quarterly-set by Govt) | Fully tax-free (EEE) | 15-year lock. Partial withdrawal from year 7 (up to 50% of balance at end of year 4 or immediately preceding year, whichever is lower). Loan against PPF: years 3–6, up to 25% of balance at end of 2nd preceding year. | Fully voluntary |
| **NPS Tier 1** | Market-linked (~8–12% historically) | 60% lump sum tax-free at 60; 40% must buy annuity (taxable) | Partial withdrawal after 3 years for: home purchase, medical treatment, education, disability. Max 25% of own contributions, up to 3 times. | Voluntary (80CCD deduction in old regime) |
| **NPS Tier 2** | Market-linked | No tax benefit | Fully liquid (no lock-in) | Voluntary |

### 23.2 How the optimiser handles PF instruments

**In invest-vs-prepay (Layer 3):**
- EPF/VPF/PPF are listed as a separate **locked savings** category in onboarding — not as freely available investment options in the Layer 3 comparison pool
- The effective pre-tax equivalent return of EPF at 8.25% tax-free (FY2024-25) = **11.79%** at 30% bracket, **10.31%** at 20% bracket `[VERIFY current FY rate from EPFO circular]`
- This reference rate IS used when evaluating whether a *new voluntary VPF contribution* beats paying off debt — but the engine never routes regular monthly surplus *into* EPF/PPF as a debt-payoff strategy
- NPS Tier 2 (fully liquid, no lock-in) can appear in the regular investment options pool

**In asset liquidation check (§8c):**
- EPF/PPF cannot be "liquidated on demand." The app only surfaces them as a debt-payoff option if:
  1. User explicitly qualifies under one of the allowed withdrawal conditions
  2. Debt rate > 20% AND quantum is large relative to the withdrawal available
- Even then: presented as a one-time windfall (§8a handler), not a recurring plan

**Data to collect in onboarding (Detailed Mode):**
```
epf_balance               → accumulated EPF + VPF balance
ppf_balance               → PPF balance + year account was opened
nps_tier1_balance         → NPS Tier 1 balance + years since account opening
voluntary_pf_contribution → employee's monthly VPF amount (0 if not contributing)
ppf_monthly               → user's PPF deposit per month
years_in_current_service  → to evaluate EPF partial withdrawal eligibility
```

**Withdrawal eligibility gates:**
```
epf_partial_eligible = (years_in_current_service >= 5) AND reason in EPF_ALLOWED_REASONS
ppf_loan_eligible    = 3 <= years_since_ppf_opened <= 6
ppf_partial_eligible = years_since_ppf_opened >= 7
nps_partial_eligible = years_since_nps_opened >= 3 AND reason in NPS_ALLOWED_REASONS
```

---

## 24. Minimum payment formulas — bank-specific (LOCKED)

### 24.1 India — credit card minimum payment formulas

| Bank | Formula | Source |
|---|---|---|
| **SBI Card** | `max(5% of total outstanding, ₹200) + interest + fees + GST` | SBI Card MITC |
| **HDFC Bank** | `max(5% of total outstanding, ₹200) + any current-month EMI + over-limit amount + past-due` | HDFC MITC |
| **ICICI Bank** | `max(interest + fees + 1% of principal, 5% of outstanding, ₹100)` | ICICI Card MITC |
| **Axis Bank** | `5% of total outstanding, min ₹200` | Axis MITC |
| **Kotak Mahindra** | `5% of total outstanding + all interest + fees, min ₹200` | Kotak MITC |
| **Yes Bank** | `5% of outstanding, min ₹200` | Yes Bank MITC |
| **RBL Bank** | `5% of outstanding, min ₹100` | RBL MITC |
| **AmEx India** | `2% of statement balance, min ₹100` | AmEx India |
| **IndusInd Bank** | `5% of outstanding, min ₹200` | IndusInd MITC |

### 24.2 USA — credit card minimum payment formulas

| Bank / Issuer | Formula | Source |
|---|---|---|
| **Chase** | `max(2% of balance, $35)` or if greater: `interest + fees + 1% of principal` | Chase cardmember agreement |
| **Bank of America** | `max(1% of balance + interest + fees, $35)` | BofA agreement |
| **Citibank** | `max(2% of balance, $25)` or `interest + fees + 1% of principal` if higher | Citi agreement |
| **Capital One** | `max($25, 2% of balance if > $1,000)` or full balance if ≤ $25 | Capital One agreement |
| **Discover** | `max($35, 2% of balance)` | Discover agreement |
| **American Express** | `max(1% of balance + interest + fees, $35)` | AmEx agreement |
| **Goldman Sachs (Marcus card)** | `max(1% of balance + interest + fees, $35)` | Goldman agreement |
| **Synchrony** | `max(2% of balance, $25 or $29 depending on product)` | Synchrony agreement |

### 24.3 Engine implementation
- **Simple Mode:** universal default = `max(5% of outstanding, ₹200)` India; `max(2% of balance, $35)` US. Labelled *"estimated — verify against your statement."*
- **Detailed Mode:** bank-name selection in debt entry auto-populates the correct formula from the country data store. User can override with their actual statement minimum.
- **Engine rule:** minimum_payment_i is always a hard floor. Allocation never drops below it regardless of strategy mode (even "Aggressive" mode in §6 requires careful justification).

---

## 25. India tax computation — old vs new regime + surcharge (CORRECTION/EXTENSION to §12)

### 25.1 Regime selection is mandatory

From AY2024-25 the **new regime is the default**. Critical implications for this app:
- **Old regime only:** Sec 80C, 80CCD, HRA, LTA, Sec 24(b) on self-occupied home loan
- **Both regimes:** Sec 24(b) on let-out property (deductible against rental income), standard deduction (₹50K old / ₹75K new)
- **New regime:** Sec 24(b) for self-occupied home loan = ₹0. The mortgage tax shield computation only applies to old-regime users.

**Auto-defaulting to old regime for India users and claiming a tax shield on a home loan would be systematically wrong for most salaried employees in 2024–25.** Regime selection is a required field in India onboarding.

### 25.2 Tax slabs

**New regime — FY2025-26 (Budget 2025, Feb 1 2025):** `[VERIFY FY2026-27 → Budget 2026, Feb 1 2026]`

| Taxable income | Rate |
|---|---|
| Up to ₹4L | 0% |
| ₹4L – ₹8L | 5% |
| ₹8L – ₹12L | 10% |
| ₹12L – ₹16L | 15% |
| ₹16L – ₹20L | 20% |
| ₹20L – ₹24L | 25% |
| Above ₹24L | 30% |
| Rebate Sec 87A | Tax = ₹0 if net taxable income ≤ ₹12L (rebate ₹60,000) |
| Standard deduction (salaried) | ₹75,000 under new regime (so effective no-tax limit = ₹12.75L for salaried) |

**Note vs FY2024-25:** base exemption raised ₹3L→₹4L; top-rate threshold raised ₹15L→₹24L; 87A rebate threshold raised ₹7L→₹12L. The new regime is significantly more beneficial for most taxpayers from FY2025-26. Ensure the app's regime-comparison tool (onboarding Step 4) uses the correct FY slab set.

**Old regime:**

| Taxable income | Rate |
|---|---|
| Up to ₹2.5L (₹3L for 60+, ₹5L for 80+) | 0% |
| ₹2.5L – ₹5L | 5% |
| ₹5L – ₹10L | 20% |
| Above ₹10L | 30% |
| Rebate Sec 87A | No tax if net taxable income ≤ ₹5L |

### 25.3 Surcharge on tax (both regimes)

| Income | Surcharge on income tax |
|---|---|
| Up to ₹50L | Nil |
| ₹50L – ₹1Cr | 10% |
| ₹1Cr – ₹2Cr | 15% |
| ₹2Cr – ₹5Cr | 25% |
| Above ₹5Cr | 37% (25% applies if LTCG / special rate income) |

### 25.4 Education cess

4% on (tax + surcharge) for all taxpayers.

### 25.5 Effective marginal rate formula
```
base_rate      = marginal_slab_rate(taxable_income, regime)
surcharge_rate = surcharge_slab_lookup(taxable_income)
marginal_rate  = base_rate × (1 + surcharge_rate) × 1.04
```

**Example — ₹1.2Cr income, old regime (FY2025-26):**
Base rate = 30%, surcharge = 15% (₹1Cr–₹2Cr slab), cess = 4%
→ Effective marginal rate = 30% × 1.15 × 1.04 = **35.88%** — not 30%.

**Example — ₹14L income, new regime (FY2025-26):**
Slabs: 5% on ₹4–8L (₹20k) + 10% on ₹8–12L (₹40k) + 15% on ₹12–14L (₹30k) = ₹90k tax. Surcharge = nil (<₹50L). Cess = 4%. Total tax = ₹93,600. **Income > ₹12L → 87A rebate does not apply.** Marginal rate = 15% × 1.04 = 15.6%. With ₹75k standard deduction, taxable income = ₹13.25L; same bracket. `[VERIFY FY2026-27]`

**Example — ₹12L income, new regime (FY2025-26):**
Tax before rebate = 5% on ₹4–8L + 10% on ₹8–12L = ₹20k + ₹40k = ₹60k. 87A rebate = ₹60k. **Net tax = ₹0.** Effective tax rate = 0%. With ₹75k standard deduction (salaried): gross CTC up to ₹12.75L = zero tax.

### 25.6 Taxable income inputs required from user

| Income component | Required in Simple Mode | Detailed Mode |
|---|---|---|
| Gross salary / CTC | Yes (or take-home with gross estimate) | Yes, gross CTC |
| Rental income | Optional | Yes |
| Interest income (FD/savings) | Optional | Yes |
| Business / freelance income | Optional (if declared as business owner) | Yes |
| 80C utilised (old regime only) | No (app estimates from EPF + assumed) | Yes, all components |
| HRA exemption (old regime only) | No | Yes |

---

## 26. Asset liquidation — transaction costs + time delay (CORRECTION/EXTENSION to §8c)

Gate 3 in §8c needs the following corrections: the real return must be net of selling costs (not just inflation-adjusted nominal return), and the interest accrual during the sale period must be counted.

### 26.1 India real estate selling costs

| Cost | Rate | Notes |
|---|---|---|
| Stamp duty | 4–8% of sale value | Varies by state: Maharashtra ~6%, Karnataka ~5.65%, Delhi ~4–6%, Tamil Nadu ~7% |
| Registration fee | 1% of sale value | Capped at ₹30,000 in some states |
| Brokerage | 1–2% of sale value | Market standard |
| LTCG tax (held > 2 years) | 20% on indexed gains + surcharge + cess | Indexed cost = purchase price × CII_current ÷ CII_purchase_year (CBDT publishes CII annually) |
| STCG (held ≤ 2 years) | Added to taxable income; taxed at marginal slab rate | |

**Net proceeds formula (India, LTCG):**
```
selling_cost_pct = stamp_duty_rate[state] + 0.01 + brokerage_rate
gross_proceeds   = sale_price × (1 − selling_cost_pct)
indexed_cost     = purchase_price × (CII[current_fy] / CII[purchase_fy])
ltcg             = max(0, gross_proceeds − indexed_cost)
ltcg_tax         = ltcg × ltcg_rate  // 20% × (1 + surcharge) × 1.04
net_proceeds     = gross_proceeds − ltcg_tax
```

### 26.2 USA real estate selling costs

| Cost | Rate |
|---|---|
| Realtor commission | 5–6% of sale price |
| Closing costs (seller side) | 1–3% |
| Short-term gains (held < 1 yr) | Ordinary income rate |
| Long-term gains (held ≥ 1 yr) | 0% / 15% / 20% depending on income |
| Depreciation recapture (rental property) | 25% on accumulated depreciation |

### 26.3 Time-to-liquidate adjustment

Real estate is illiquid. Selling takes time; the high-rate debt keeps compounding during that period:
```
selling_period_months = 3   // conservative India estimate; 2 months for US
interest_during_sale  = debt_balance × (effective_rate / 12) × selling_period_months
true_net_benefit      = net_proceeds − debt_balance − interest_during_sale
```

### 26.4 Updated Gate 3 formula
```
one_time_selling_drag = (selling_cost_pct + ltcg_effective_rate) / expected_hold_years_post_sale
asset_real_return_net = nominal_return − inflation − holding_cost_rate − one_time_selling_drag
gate_3                = (debt_effective_rate − asset_real_return_net) >= 3.0
```

### 26.5 Real estate return input model

The app needs the following inputs to compute `nominal_return` for real estate:

```
purchase_price           → user enters
purchase_year            → user enters
current_market_value     → user's estimate (or recent comparable sale price)
rental_income_annual     → user enters (₹0 if vacant)
holding_costs_annual     → property tax + maintenance + HOA/society fees

historical_cagr = (current_value / purchase_price)^(1 / years_held) − 1
cap_rate        = rental_income_annual / current_value
nominal_return  = historical_cagr + cap_rate

// Detailed Mode also exposes:
user_forecast_growth     → user's own expectation for next few years
// App shows both and asks which to use for the gate test
```

**Output example:** *"Your land has appreciated 3.2%/yr historically and earns no rental income. After stamp duty (6%), registration (1%), brokerage (1.5%), and capital gains tax, net proceeds would be ₹X. Your 38% credit card accrues ₹Y over the estimated 90-day sale period. True net benefit from selling: ₹Z. **Recommend selling.**"*

---

## 27. Salary hike and income projection model (LOCKED)

The formula in §15 (`projected_surplus × (1 + min(1.5 × inflation, 0.08))^t/12`) is a reasonable default for long-horizon projections but is under-specified for user control.

### 27.1 User-facing model

**Simple Mode:** single field — *"Expected annual income growth: ____%"*. Pre-filled with `inflation × 1.5` (e.g., 7.5% if inflation is 5%, rounded to nearest 0.5%). User can change.

**Detailed Mode:** the cash flow calendar (§13) gains three additional rows:
- **Annual hike month:** enter expected % or absolute ₹ increase per year
- **Known future event:** specific date + amount (e.g., promotion confirmed from April)
- **Income ceiling flag:** *"I expect my income to plateau at ₹X"* — prevents unrealistic perpetual compounding for late-career users

**Business owner / freelancer:**
- User provides net personal income for last 3 years
- App computes 3-year income CAGR and uses that as the forward projection rate
- Labelled explicitly: *"Based on your 3-year income CAGR of X%, projected forward. You can override."*
- Plan runs at P25 of last 12 months, not the mean

### 27.2 Updated projection formula
```
# Salaried
projected_surplus_t = base_surplus × ∏(y=1 to floor(t/12)) (1 + annual_hike_rate_y)

# Business owner / freelancer
p25_income          = percentile_25(last_12_months_net_income)
business_cagr       = (income_year3 / income_year1)^(1/2) − 1
projected_surplus_t = max(0, p25_income − fixed_expenses) × (1 + business_cagr)^(t/12)
```

### 27.3 Long-horizon visual
For plans with tenure > 5 years, the Plan screen shows two surplus lines on the cash flow chart:
- "Today's surplus" (flat line)
- "Projected surplus at your declared hike rate"

This is one of the most compelling visuals for home loan planning — showing that the effective burden of a ₹45,000 EMI gets progressively lighter as income grows.

---

## 28. Business owner income declaration model (LOCKED)

The income-volatility lens (§6) says "use last 6 months, plan against P25 month." This is extended for Indian self-employed users.

### 28.1 Inputs required

| Field | Simple Mode | Detailed Mode |
|---|---|---|
| Income type | Salaried / Business owner / Freelancer / Mixed | Same |
| Last 12 months personal income (monthly) | Single monthly average | Month-by-month for P25 |
| 3 prior years' net income | Optional | Yes (for CAGR) |
| Advance tax liabilities | Auto-estimated | User-entered per quarter |
| GST filing month cash impact | N/A | Flag + estimated outflow |
| Business debt (separate from personal) | Flag: "this loan is a business loan" | Full business loan detail |

### 28.2 Advance tax payment schedule (India) — auto-marked in cash flow calendar
For business owners and freelancers, these months automatically show as cash outflow events:
- **15 June:** 15% of estimated annual tax liability
- **15 September:** 45% cumulative
- **15 December:** 75% cumulative
- **15 March:** 100% cumulative

The plan should front-load extra debt payments in surplus months before each advance tax quarter.

### 28.3 Business loan flag
When a user marks a loan as "business loan":
- Excluded from personal EMI-to-income ratio calculations
- Interest treated as a business expense, not a personal tax shield via Sec 24/80C
- Personal surplus is not allocated to it (serviced from business cash flow)
- It still appears in the debt list for informational completeness

---

## 29. India minimum balance as a surplus constraint (LOCKED)

Banks charge penalties for falling below Monthly Average Balance (MAB). This is a hard floor on available cash, not available for debt payoff.

### 29.1 MAB requirements — India top banks (urban / semi-urban / rural)

| Bank | Urban | Semi-urban | Rural |
|---|---|---|---|
| SBI | ₹3,000 | ₹2,000 | ₹1,000 |
| HDFC Bank | ₹10,000 | ₹5,000 | ₹2,500 |
| ICICI Bank | ₹10,000 | ₹5,000 | ₹2,000 |
| Axis Bank | ₹10,000 | ₹5,000 | ₹2,000 |
| Kotak Mahindra | ₹10,000 | ₹5,000 | — |
| PNB | ₹2,000 | ₹1,000 | ₹500 |
| Bank of Baroda | ₹2,000 | ₹1,000 | ₹500 |
| Canara Bank | ₹1,000 | ₹500 | ₹500 |
| Yes Bank | ₹10,000 | ₹5,000 | — |
| IndusInd Bank | ₹10,000 | ₹5,000 | — |
| IDFC First Bank | ₹25,000 (₹0 for salary accounts) | — | — |
| AU Small Finance Bank | ₹2,500 | ₹2,500 | — |
| Federal Bank | ₹5,000 | ₹2,500 | — |
| Bandhan Bank | ₹1,000 | ₹500 | — |

*Salary accounts at most banks carry ₹0 MAB. Confirm account type during onboarding.*

### 29.2 Engine formula
```
mab_reserve      = lookup_mab(user.primary_bank, user.location_tier)
liquid_cash      = user.savings_balance − mab_reserve
available_buffer = max(0, liquid_cash − emergency_fund_target)
```

**UX:** When the user selects their salary bank in onboarding Step 2, the MAB is auto-populated as a hidden constraint. Shown in Detailed Mode as a footnote: *"₹10,000 reserved for your HDFC MAB requirement."*

---

## 30. Geographic scope — India + USA Phase 1 (LOCKED)

The original brief targeted 10 countries for launch. Phase 1 launches with **India and USA only**. The remaining 8 countries move to Phase 2.

**Rationale:**
- **India** — largest addressable user base; highest debt-stress; most complex rules (PF ecosystem, tax regimes, MAB, BNPL, gold loans, GST on financial services, RBI compliance). Solving India thoroughly creates a data and compliance moat.
- **USA** — largest English-speaking market; well-documented federal tax rules; high credit-card-debt population; strong SaaS willingness-to-pay; Fed FOMC monitoring straightforward via FRED API.

**Phase 2 countries (priority order unchanged):**
🇬🇧 UK → 🇨🇦 Canada → 🇦🇺 Australia → 🇩🇪 Germany → 🇸🇬 Singapore → 🇦🇪 UAE → 🇸🇦 Saudi Arabia → 🇯🇵 Japan

All country-specific logic already specified in §12 (tax caps), §14 (central bank monitoring), and the data source tables in the design spec remains valid — those sections are forward-compatible. Phase 2 countries activate their rows when their data ops are ready.

---

## 31. Bank data scope — India top 30 + USA top 15 (LOCKED)

### 31.1 India — top 30 banks

| # | Bank | Type | Scrape tier |
|---|---|---|---|
| 1 | State Bank of India | PSU | Tier A |
| 2 | HDFC Bank | Private | Tier A |
| 3 | ICICI Bank | Private | Tier A |
| 4 | Axis Bank | Private | Tier A |
| 5 | Kotak Mahindra Bank | Private | Tier A |
| 6 | Punjab National Bank | PSU | Tier A |
| 7 | Bank of Baroda | PSU | Tier B |
| 8 | Canara Bank | PSU | Tier B |
| 9 | Bank of India | PSU | Tier B |
| 10 | Union Bank of India | PSU | Tier B |
| 11 | Indian Bank | PSU | Tier B |
| 12 | Central Bank of India | PSU | Tier B |
| 13 | IDBI Bank | PSU/Private | Tier B |
| 14 | Yes Bank | Private | Tier B |
| 15 | IDFC First Bank | Private | Tier B |
| 16 | IndusInd Bank | Private | Tier B |
| 17 | Federal Bank | Private | Tier C |
| 18 | South Indian Bank | Private | Tier C |
| 19 | RBL Bank | Private | Tier C |
| 20 | Bandhan Bank | Private | Tier C |
| 21 | AU Small Finance Bank | SFB | Tier C |
| 22 | UCO Bank | PSU | Tier C |
| 23 | Bank of Maharashtra | PSU | Tier C |
| 24 | Punjab & Sind Bank | PSU | Tier C |
| 25 | Karnataka Bank | Private | Tier C |
| 26 | Karur Vysya Bank | Private | Tier C |
| 27 | City Union Bank | Private | Tier C |
| 28 | Jammu & Kashmir Bank | Private | Tier C |
| 29 | Ujjivan Small Finance Bank | SFB | Tier C |
| 30 | Suryoday Small Finance Bank | SFB | Tier C |

**Data fields to maintain per bank per product (home / personal / auto / credit card):**
- Headline interest rate: floating or fixed, with range (min–max offered)
- Processing fee: flat ₹ amount or % of loan
- Prepayment penalty: floating personal/home = ₹0 (RBI mandated); fixed rate = bank-specific (typically 1–3%)
- Bundled insurance: yes/no; if yes, annual premium rate
- Balance transfer promotional offer: promo rate + duration + BT fee
- Credit card minimum payment formula (from §24.1)
- MAB requirement for savings account (from §29.1)
- Last-verified date per field

### 31.2 USA — top 15 lenders / card issuers

| # | Institution | Type | Products | Scrape tier |
|---|---|---|---|---|
| 1 | JPMorgan Chase | Universal bank | CC, mortgage, auto, personal | Tier A |
| 2 | Bank of America | Universal bank | CC, mortgage, auto, personal | Tier A |
| 3 | Wells Fargo | Universal bank | CC, mortgage, auto, personal | Tier A |
| 4 | Citibank | Universal bank | CC, mortgage, personal | Tier A |
| 5 | U.S. Bank | Universal bank | CC, mortgage, auto, personal | Tier A |
| 6 | Capital One | CC + auto | CC, auto loan | Tier A |
| 7 | American Express | CC + personal | CC, personal loans | Tier B |
| 8 | Discover | CC + personal | CC, personal, student refi | Tier B |
| 9 | Goldman Sachs (Marcus) | Digital | Personal loans, HYSA | Tier B |
| 10 | Ally Financial | Digital | Auto, HYSA, personal | Tier B |
| 11 | Truist Financial | Regional bank | CC, mortgage, auto | Tier B |
| 12 | PNC Financial | Regional bank | CC, mortgage, auto | Tier B |
| 13 | TD Bank | Regional bank | CC, mortgage, personal | Tier C |
| 14 | Navy Federal Credit Union | Credit union | CC, mortgage, auto, personal | Tier C |
| 15 | SoFi | Digital | Student refi, personal, mortgage | Tier C |

**Data fields to maintain per institution (USA):**
- APR range: credit cards (purchase / cash advance / BT promotional); loans (advertised range, subject to creditworthiness)
- Balance transfer: 0% intro APR duration + BT fee % + regular APR after promo
- Origination fee (personal loans): 0–10% depending on institution
- Prepayment penalty: most US personal and auto loans have none; some mortgages do — confirm per product
- Current HYSA yield (for Cash Yield Check — §8e; changes with Fed rate)
- Last-verified date per field

---

## 32. Web-first v1 architecture decision (LOCKED)

v1 is **web-first, desktop-primary**.

- **Primary design target:** 1280px+ desktop/laptop, for: Onboarding (multi-field forms), Plan screen (month-by-month table, sensitivity sliders, strategy comparison), My Debts detail (amortisation chart + edit fields side-by-side)
- **Mobile browser:** fully functional responsive layout. Home screen, Quick Recompute, Windfall Handler, and New Debt Check are specifically optimised for mobile since these are the "in the moment" interactions
- **Native app (iOS/Android):** Phase 2 — React Native with engine code shared from web
- **Tech stack (locked):** Next.js + React + TypeScript frontend; Python (FastAPI) backend; Postgres + RLS for user data; Redis for plan-snapshot caching; Decimal (never float) for all currency arithmetic

---

## 33. Build readiness assessment (as of May 2026)

### Ready to build immediately
- Optimisation engine: all formulas specified and corrected in design spec §4 (updated)
- Data model: user profile, debts, assets, PF instruments, cash flow calendar, plan snapshots
- Country data store schema: bank rate matrix + tax rules + central bank calendar (India + USA)
- Layer 0 (employer match), Layer 1 (restructuring), Layer 2 (avalanche/hybrid/snowball), Layer 3 (invest-vs-prepay)
- All 6 decision sub-modules (§8a–8f)
- India/USA bank data entry (30 + 15 institutions; data ops starts immediately)

### Needs wireframes before frontend build starts
- Onboarding (6 steps — tax regime selector, PF entry, MAB, income type branch)
- My Debts (list + detail screen with amortisation chart)
- Plan screen (desktop + mobile — the most complex screen)
- All 6 Tools sub-module screens
- Insights screen
- Settings screen

### Remaining design decisions (unblocking frontend)
1. **Visual language / brand:** dark navy + gold from FinOptima brief, or fresh identity? Must decide before building any visual component.
2. **Charts library:** Recharts vs Visx vs D3. Affects design vocabulary and developer tooling.
3. **Tools surface:** recommendation below — contextual surfacing primary; tile grid secondary; Windfall gets a FAB. Needs final sign-off.

---

## 34. Tools surface decision — recommendation (OPEN → decide before frontend)

The current wireframe shows 6 tiles. The risk: it looks like a feature dump, and users don't know which tool applies to their situation.

**Recommended approach (needs sign-off):**
- **Primary:** contextual surfacing. Based on current user state, the app proactively shows the most relevant tool card on Home screen below "This Month's Action." Logic:
  - If user just had salary credited (detected from calendar input) → nudge towards Windfall Handler
  - If a central bank rate change happened → nudge towards Right-Time-to-Borrow
  - First of each month → Cash Yield Check if idle cash detected
  - User enters Detailed Mode → show Plan diagnostics strip (already in wireframe)
- **Secondary:** "More tools →" link that expands to the full 6-tile grid (below the fold)
- **Windfall Handler:** also gets a persistent floating action button (FAB) in the bottom-right of Home screen, labelled *"Got a bonus?"* — this is the highest-frequency ad-hoc action and should be one tap away at all times

---

## 35. How to resume from a new session (updated)

Paste this whole file + `module-02-design-spec.md` and say:
> "Here are the complete brainstorm and design spec for Module 2. Both are fully current as of May 2026. All open questions are resolved through §34. We are ready to start building. Begin with [engine / data schema / onboarding wireframes / specific screen]."

The original resume instruction (earlier in this file) pointed to §20. All questions through that round plus the second round are now resolved in §23–34 and the decisions log through entry #43.

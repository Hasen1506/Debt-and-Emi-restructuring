# Module 02 — Debt & EMI Restructuring Optimiser
## Design Specification

> **Companion to:** `module-02-debt-emi-brainstorm.md`
> **Purpose:** translate the locked brainstorm into an implementation-ready spec covering UI modes, screens, math, architecture, data sources, and accuracy framework.
> **Status:** v1.0. Designs (HTML/Figma) not yet produced.
> **Last updated:** May 2026

---

## Table of contents

1. Information architecture
2. UI mode matrix
3. Screen-by-screen breakdown
4. Mathematical computations (all formulas)
5. Optimisation engine algorithm
6. System architecture
7. Data sources — comprehensive
8. Accuracy & confidence framework
9. Build phases / roadmap

---

## 1. Information architecture

### Top-level navigation (5 destinations)

```
[Country selector ▼]                                  Settings ⚙
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   1. Home          → Plan overview + killer output          │
│   2. My Debts      → List + add/edit + per-loan detail      │
│   3. Plan          → Month-by-month schedule + scenarios    │
│   4. Tools         → Sub-modules 8a–8f                      │
│   5. Insights      → Notifications, rate changes, glossary  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                                            [Mode: Simple ⇆ Detailed]
                                            [Tone: Calm ⇆ Overwhelmed]
```

### Hierarchy

- **Home** is the always-default landing screen
- **Tools** contains six single-decision sub-modules: Windfall Handler, New Debt Check, Asset Liquidation Check, Quick Recompute, Cash Yield Check, Right-Time-to-Borrow
- **Plan** is the deep view (full amortisation, sensitivity, what-ifs)
- **Insights** is the engagement loop (rate changes, monthly reminders, learning content)

### Country & mode persistence
- Country sticks at user profile level (set on first run; rarely changed)
- Mode (Simple/Detailed) and Tone (Calm/Overwhelmed) sticky per session, remembered across sessions

---

## 2. UI mode matrix

There are **two orthogonal axes**, both user-toggleable:

| | **Simple Mode** | **Detailed Mode** |
|---|---|---|
| **Calm tone (default)** | One sentence + one number per screen. Confident, data-rich design language. Charts visible but not overwhelming. | All inputs editable, all formulas exposed via info icons, sensitivity tables, scenario comparisons. Wealth-management feel. |
| **Overwhelmed tone** | Single "do this one thing this week" card. Soft palette, reassuring language. No multi-year horizons shown. Hides everything except the next action. | (not exposed — Detailed + Overwhelmed defeats the purpose) |

### Tone differences (concrete)

| Aspect | Calm | Overwhelmed |
|---|---|---|
| Primary copy length | 1–2 sentences per insight | 1 sentence, max 12 words |
| Numbers shown | Full precision (₹1,24,237) | Rounded ("about ₹1.2L") |
| Horizon | 5–30 years visible | This week, this month only |
| Palette | Deep navy / gold / white (current brief direction) | Soft warm neutrals, single accent |
| Charts | Multi-series, comparison lines | Single bar, single number |
| Animations | Subtle, professional | None — stillness = calm |
| CTA verbs | "Optimise," "Restructure," "Explore" | "Start here," "One step," "Take a breath" |

### Toggle UX
- Mode toggle (Simple ⇆ Detailed): top-right of every screen, single tap
- Tone toggle (Calm ⇆ Overwhelmed): tucked in settings + one prominent surface ("feeling overwhelmed?" link in the footer of Home screen)

---

## 3. Screen-by-screen breakdown

### 3.1 Onboarding (first-run only, ~3–5 minutes)

**Step 1 — Country.** Single screen: flag grid for 10 countries. Sticky.

**Step 2 — Your money.** Three numbers:
- Take-home monthly income
- Average monthly fixed expenses (rent, utilities, groceries, insurance, transport — exclude debt EMIs)
- Current liquid savings / cash position + *where it's sitting* (checking / savings / HYSA / FD)

**Step 3 — Your debts.** Add each debt. Per-debt minimum required fields (Simple Mode):
- Type (dropdown: credit card / personal / home / auto / student / BNPL / EMI-on-card / gold / overdraft / informal)
- Outstanding balance
- Interest rate (with help text on where to find it on a statement)
- Current EMI / minimum monthly payment

Detailed Mode adds: bank name, tenure remaining, fixed/floating flag, prepayment penalty %, processing fee paid, bundled insurance amount, country-specific tax deduction eligibility, multi-tier component balances (credit cards only).

**Step 4 — Tax & employment.**
- Country tax bracket (auto-detected from income; user can override)
- Employer retirement match? (yes/no + match details if yes) — drives Layer 0
- Income type: salaried / freelance / mixed → flips "income-volatility lens" default

**Step 5 — Goals & constraints.**
- Emergency fund target (default 3 months expenses)
- Behavioural mode: pure-math vs hybrid vs snowball (with the trade-off shown)
- Optional lenses: credit-score-aware on/off; tax-year optimised on/off
- Investment options actually available (FD rate / index fund expected return / ESPP / etc.)

**Step 6 — Plan generated.** Direct land into Home screen with the killer output rotating.

### 3.2 Home

The most important screen. Layout:

```
┌──────────────────────────────────────────────────────────┐
│  YOUR DEBT-FREE DATE                                     │
│  Aug 2027                          (14 months earlier    │
│                                     than minimums-only)  │
│                                                          │
│  Total owed: ₹46,80,000                                  │
│  Saving with current plan: ₹2,18,400 in interest         │
├──────────────────────────────────────────────────────────┤
│  THIS MONTH'S ACTION                                     │
│  Pay extra ₹10,000 to: Kotak Credit Card                 │
│  Why: highest effective rate (38%) in your portfolio     │
│  [I made this payment] [Why this one?]                   │
├──────────────────────────────────────────────────────────┤
│  TODAY'S INSIGHT (rotating)                              │
│  Your real interest rate on the credit card is 42%,      │
│  not 36%. Here's why →                                   │
├──────────────────────────────────────────────────────────┤
│  TOOLS                                                   │
│  [💰 Windfall] [🛒 New EMI?] [🏷 Sell asset?]            │
│  [✓ Paid extra] [💵 Cash yield] [⏳ Wait or borrow?]     │
└──────────────────────────────────────────────────────────┘
   feeling overwhelmed? · Mode: Simple ⇆ Detailed
```

In **Overwhelmed mode**, the same screen collapses to just the "THIS MONTH'S ACTION" card, with a soft palette and one large CTA.

In **Detailed mode**, the home screen gains a "Plan diagnostics" strip below Tools showing: sensitivity to ±1% rate changes, sensitivity to ±10% surplus, debt-free-by-confidence-band.

### 3.3 My Debts
List view, one row per debt. Each row shows: name, bank, balance, effective rate (with badge if recently updated by central bank), next payment date, priority rank in current plan. Tap = full detail screen with all variables editable + per-loan amortisation chart.

### 3.4 Plan
- Month-by-month payment schedule (table + chart)
- Strategy comparison: Pure Avalanche vs Hybrid vs Snowball vs Minimums-Only (side-by-side debt-free dates and total interest)
- Sensitivity sliders: what if surplus +₹5k? What if I lose my job for 3 months? What if RBI cuts 50bps?
- Cash flow calendar view (12-month strip) — user can mark high/low months
- Export to PDF (Pro feature)

### 3.5 Tools — sub-module screens
Each of 8a–8f is one focused screen. Pattern:
1. Inputs (1–4 fields)
2. Computed answer (1 sentence + 1 number + 1 chart)
3. "Show your work" expandable section with the math

### 3.6 Insights
- Rate-change notifications log (when central banks moved, what we did)
- Monthly progress summary (when the plan re-runs)
- Educational cards (one concept at a time, plain language)
- Glossary (all terms used in app)

---

## 4. Mathematical computations

All formulas the system needs, in one place. Every formula is testable in isolation.

### 4.1 Effective post-tax rate per loan

```
deductible_amount   = min(annual_interest_i, country_cap_i)
tax_saved_i         = deductible_amount × marginal_tax_rate
effective_rate_i    = nominal_rate_i × [1 − (deductible_amount / annual_interest_i) × marginal_tax_rate]
                    + amortised_fees_rate_i
                    + bundled_insurance_rate_i
                    + GST_on_interest_rate_i           // country-specific (18% in India)
```

`annual_interest_i = outstanding_balance_i × nominal_rate_i`

For credit cards with multi-tier balances:
```
weighted_card_rate = Σ (component_balance_j × component_rate_j) / total_card_balance
```

### 4.2 Monthly amortisation (standard EMI loans)
```
monthly_rate         = effective_rate_i / 12
monthly_interest_i   = balance_i × monthly_rate
principal_paid_i     = scheduled_payment_i − monthly_interest_i
new_balance_i        = balance_i − principal_paid_i − extra_payment_i
```

For other repayment structures:
- **Bullet:** monthly_interest only; principal_paid = 0 until maturity
- **Step-up / Step-down:** scheduled_payment varies by month per schedule
- **Income-contingent (UK Plan 2/5):** payment = max(0, (income − threshold) × repayment_rate / 12)

### 4.3 Layer 0 — Mandatory contributions floor
```
employer_match_value = min(user_contribution, match_cap) × match_rate
                       × (1 + expected_annual_return)^years_to_retirement
```
If `employer_match_value > 0` for any unmet match, surplus routes there FIRST.

### 4.4 Layer 2 — Pure avalanche allocation
```
priority_order = sort(loans, key=effective_rate_i, descending=True)
extra_surplus  = monthly_income − fixed_expenses − Σ minimums − emergency_fund_contribution
allocate(extra_surplus → priority_order[0]) until balance_0 = 0
then priority_order[1], etc.
```

### 4.5 Layer 2 — Hybrid (with threshold N months)
```
small_debts = {loan_i : months_to_clear(loan_i, with_surplus) ≤ N}
if small_debts non-empty:
    allocate to smallest of small_debts first
else:
    apply pure avalanche
```

### 4.6 Layer 3 — Invest-vs-prepay test (per loan, evaluated monthly)
```
user_best_real_return = max(user_investment_options) − inflation_rate
loan_real_rate        = effective_rate_i − inflation_rate
prepay_recommended    = loan_real_rate > user_best_real_return + 0.5  // 0.5pp risk premium
```
If `prepay_recommended == False`, route surplus to investment instead of prepayment.

### 4.7 Restructuring scans (Layer 1)

**Balance transfer candidate:**
```
candidate if: effective_rate_card > 24% AND
              BT_offer_rate + amortised_BT_fee < effective_rate_card − 5
```

**Consolidation candidate:**
```
candidate if: count(unsecured_debts where effective_rate > 15%) ≥ 2 AND
              market_personal_loan_rate × (1 + fee_amortised) < blended_avg_rate − 3
```

**Refinance candidate (home/auto):**
```
candidate if: current_rate > market_median_rate + 1.5 AND
              (interest_saved − refi_costs) / refi_costs > 1.0
```

**Tenure renegotiation (home loan to free surplus):**
```
extra_lifetime_interest_home = extra_monthly_freed × months × home_rate_compound_factor
high_rate_interest_saved     = surplus_freed × months × (high_rate − home_rate)
recommend if: high_rate_interest_saved > extra_lifetime_interest_home × 1.2
```

### 4.8 Asset liquidation gate (Section 8c — all four must pass)
```
gate_1 = debt_amount / asset_value ≥ 0.10
gate_2 = asset_divisibility flag == "yes" OR debt_amount / asset_value ≥ 0.50
asset_real_return = nominal_return − inflation − holding_cost_rate
debt_effective    = effective_rate  // already cash-cost
gate_3 = debt_effective − asset_real_return ≥ 3
gate_4 = post_sale_tax_bracket == pre_sale_tax_bracket
recommend_sale = all(gate_1..4)
```

### 4.9 No-cost EMI true cost (Section 8b)
```
foregone_discount  = list_price − cash_price_elsewhere
processing_fee     = stated_fee  // many "no-cost EMI" charge ~3–5%
total_real_cost    = foregone_discount + processing_fee
effective_apr      = solve_apr_such_that(NPV(payments) = list_price − total_real_cost)
```

### 4.10 Inflation usage
- **Long-tenure loans (>5 yrs):** Layer 3 uses real return for comparison
- **Salary growth projection:** `projected_surplus_month_t = current_surplus × (1 + min(1.5 × inflation, 0.08))^t/12`
- **Real value of fixed EMI:** `real_emi_t = nominal_emi / (1 + inflation)^t/12`
- Inflation source: central bank forecast, refreshed quarterly

### 4.11 Central bank rate change handling
```
on rate_change_event(country, delta_bps):
    for each user in country:
        for each floating_rate_loan:
            new_rate = old_rate + delta_bps × pass_through_factor[bank]
            recompute effective_rate
        replan()
        if new_offers_better_than_current_debts():
            queue_notification(user, "refinance opportunity")
```

`pass_through_factor[bank]` is empirically observed — Indian PSU banks pass ~60–80% of repo changes; private banks 80–100%; US banks 100% on prime-linked products.

### 4.12 Total interest saved vs minimums-only
```
total_interest_minimums_only = sum over all months: Σ monthly_interest_i with payment = minimum_i
total_interest_optimised     = sum over all months: Σ monthly_interest_i under recommended plan
savings                      = total_interest_minimums_only − total_interest_optimised
```

This is the headline killer-output number.

---

## 5. Optimisation engine algorithm

Pseudocode for a single plan computation:

```
function generate_plan(user):
    inputs = collect(user.country, user.income, user.expenses, user.debts,
                     user.assets, user.investment_options, user.lenses, user.tone)

    # Layer 0 — capture employer match before doing anything else
    matched_contribution = compute_mandatory_contributions(user)
    available_surplus = user.surplus - matched_contribution

    # Layer 1 — restructuring scans
    restructure_actions = []
    for loan in user.debts:
        if balance_transfer_candidate(loan): restructure_actions.append(BT_action(loan))
        if refinance_candidate(loan):        restructure_actions.append(refi_action(loan))
    if consolidation_candidate(user.debts):  restructure_actions.append(consolidation_action)
    for loan in user.debts:
        if tenure_reneg_helps(loan, user):    restructure_actions.append(tenure_action(loan))

    # Apply hypothetical restructuring to debt set for downstream layers
    debt_set = apply(restructure_actions, user.debts)  // user reviews & approves before commit

    # Layer 2 — payment ordering
    behavioural_mode = user.behavioural_mode  // pure-avalanche | hybrid | snowball
    schedule = build_amortisation_schedule(debt_set, available_surplus, behavioural_mode,
                                           user.cash_flow_calendar)

    # Layer 3 — invest-vs-prepay overlay
    for loan in debt_set:
        if invest_beats_prepay(loan, user.investment_options, user.inflation):
            redirect_surplus_from(loan).to(best_investment_option(user))

    # Apply lenses
    if user.lenses.credit_score_aware:
        schedule = apply_credit_score_bias(schedule, debt_set)
    if user.lenses.tax_year_optimised:
        schedule = apply_tax_year_bias(schedule, user.country)
    if user.lenses.cash_flow_conservative:
        schedule = apply_emergency_fund_first(schedule, user.emergency_fund_target)
    if user.lenses.income_volatility:
        schedule = apply_percentile_25_replan(schedule, user.income_history)

    # Compute outputs
    debt_free_date = schedule.last_month_with_balance
    total_interest = sum_interest(schedule)
    savings_vs_minimums = baseline_interest(debt_set) - total_interest
    insights = generate_insights(user, debt_set, schedule, restructure_actions)

    return Plan(restructure_actions, schedule, debt_free_date, total_interest,
                savings_vs_minimums, insights)
```

The engine runs:
- Once at onboarding
- On every user input change
- On every central bank rate event
- On every "I made an extra payment" event (Quick Recompute)
- On every cash-flow-calendar edit
- Monthly, as a scheduled re-evaluation

Performance target: < 250ms for a user with up to 20 debts, on standard mobile.

---

## 6. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (web + mobile)                                       │
│  React / Next.js. Local state for in-progress edits.         │
│  Renders both UI modes from the same data.                   │
└──────────────────┬──────────────────────────────────────────┘
                   │ HTTPS / GraphQL
┌──────────────────▼──────────────────────────────────────────┐
│  API gateway                                                 │
│  Auth, rate limit, request shaping.                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
       ┌───────────┼───────────┬───────────────┬─────────────┐
       │           │           │               │             │
┌──────▼────┐ ┌────▼─────┐ ┌──▼─────────┐ ┌───▼──────┐ ┌────▼────┐
│ Optimiser │ │ User DB  │ │ Country    │ │ Central  │ │ Affiliate│
│ Engine    │ │ (Postgres│ │ Data Store │ │ Bank     │ │ Service  │
│ (Python   │ │  RLS)    │ │ (banks,    │ │ Event    │ │ (BT /    │
│  +Numpy)  │ │          │ │ rates,     │ │ Pipeline │ │ refi     │
│           │ │          │ │ taxes,     │ │          │ │ links)   │
│           │ │          │ │ inflation) │ │          │ │          │
└───────────┘ └──────────┘ └────────────┘ └──────────┘ └──────────┘
```

### Component responsibilities

**Optimiser Engine** — Pure function: `(user_state, country_data) → Plan`. Stateless, no database access. Easy to unit-test. Same code runs server-side (for notifications) and (eventually) on-device for offline mode.

**User DB** — Per-user encrypted store: profile, debts, assets, cash flow calendar, lenses, plan snapshots, notification preferences. Postgres with row-level security. No bank credentials stored.

**Country Data Store** — Read-mostly. Per-country tables: banks, rate matrix (loan type × bank), BT offers, tax rules (deduction caps + slabs), inflation forecast, central bank decision calendar, currency formatting. Versioned — every plan snapshot records which country-data version it ran against.

**Central Bank Event Pipeline** — Polls scheduled decision dates per country, listens for announcements via official RSS / press wires, ingests rate change events, triggers replans for affected users, dispatches notifications.

**Affiliate Service** — Tracks click-throughs and conversions for BT / refinance / consolidation recommendations. Records source recommendation for attribution.

### Tech choices (recommendations, not locked)
- Frontend: Next.js + React + TypeScript
- Mobile: React Native with code-share for the optimiser engine
- Backend: Python (FastAPI) for engine; Node for gateway
- DB: Postgres + row-level security; Redis for plan-snapshot caching
- Math: numpy + scipy for sensitivity analyses; Decimal for currency arithmetic (never float)
- Infra: AWS / GCP; eu-west, ap-south, us-east regions for data residency

---

## 7. Data sources — comprehensive

### 7.1 Country-specific bank rate data (the moat)

| Source type | What it gives us | Update mechanism |
|---|---|---|
| **Bank's own "Rates" page** | Headline retail loan / mortgage / credit card rates per bank, per product | Daily scrape (Tier A: top 5 banks per country); weekly manual (Tier B); quarterly audit (Tier C). Full model in brainstorm §3. |
| **Bank product brochures (PDF)** | Processing fees, prepayment penalties, bundled-insurance charges, tier-rate structures (cash advance vs retail vs EMI) | Manual ingestion at MVP. PDF text-extract pipeline as automation. Updated when products change. |
| **Aggregator sites (BankBazaar, NerdWallet, Money.co.uk, Canstar)** | Cross-bank comparison snapshots; useful for cold-start before our own data is rich | Weekly snapshot; used as sanity check, not primary source |
| **Credit card schemes (Visa / Mastercard / RuPay merchant rates)** | Foreign transaction markup standards | Annual |
| **Crowd-sourced user submissions** | Real-world rates as actually offered to users (often differs from headline) | Continuous. Triggered when a user's input differs from our stored value by >0.5%. Verified at 3-submissions-in-7-days threshold. |

### 7.2 Tax rules per country

| Country | Authority | Source |
|---|---|---|
| 🇮🇳 India | Income Tax Department | incometaxindia.gov.in — Sec 24, 80C, 80E, 80EE annual notifications |
| 🇺🇸 US | IRS | irs.gov publications: 936 (mortgage), 970 (education), 525 (income) |
| 🇬🇧 UK | HMRC | gov.uk/hmrc-internal-manuals — PIM, BIM manuals |
| 🇨🇦 Canada | CRA | canada.ca — T2202 (education), interest deductibility guidance |
| 🇦🇺 Australia | ATO | ato.gov.au — negative gearing rules, HECS-HELP indexation |
| 🇩🇪 Germany | Bundeszentralamt für Steuern | bzst.de — EStG provisions |
| 🇸🇬 Singapore | IRAS | iras.gov.sg — rental income deductions, CPF rules |
| 🇦🇪 UAE | Federal Tax Authority | tax.gov.ae — no personal income tax; VAT considerations only |
| 🇸🇦 Saudi Arabia | ZATCA | zatca.gov.sa — no personal income tax |
| 🇯🇵 Japan | National Tax Agency | nta.go.jp — Article 41 mortgage tax credit |

Refresh: annually at start of each country's tax year + immediately on any reform announcement.

### 7.3 Central bank rate decisions (per country)

| Central bank | Calendar source | Decision RSS / data |
|---|---|---|
| RBI India | rbi.org.in/Scripts/CalendarMonetaryPolicy.aspx | rbi.org.in press releases |
| US Fed FOMC | federalreserve.gov/monetarypolicy/fomccalendars.htm | FRED API (FEDFUNDS, DFF) |
| Bank of England | bankofengland.co.uk/monetary-policy/upcoming-mpc-dates | BoE press releases |
| ECB Eurozone (Germany) | ecb.europa.eu/press/calendars | ECB SDW API |
| Bank of Canada | bankofcanada.ca/core-functions/monetary-policy/schedule | BoC API |
| RBA Australia | rba.gov.au/schedules-events | RBA statistical tables |
| MAS Singapore | mas.gov.sg/news/monetary-policy-statements | MAS publications |
| CBUAE | centralbank.ae (USD-pegged, follows Fed) | Mirror Fed |
| SAMA | sama.gov.sa (USD-pegged, follows Fed) | Mirror Fed |
| Bank of Japan | boj.or.jp/en/mopo/mpmsche_minu | BoJ press releases |

### 7.4 Inflation data

| Country | Authority | Series |
|---|---|---|
| 🇮🇳 India | MoSPI | CPI Combined (base 2012) |
| 🇺🇸 US | BLS | CPI-U, also Fed SEP for forecast |
| 🇬🇧 UK | ONS | CPIH |
| 🇨🇦 Canada | StatCan | Total CPI |
| 🇦🇺 Australia | ABS | Quarterly CPI |
| 🇩🇪 Germany | Destatis / Eurostat | HICP |
| 🇸🇬 Singapore | MAS / SingStat | Headline + Core CPI |
| 🇦🇪 UAE | FCSC | CPI |
| 🇸🇦 Saudi Arabia | GASTAT | CPI |
| 🇯🇵 Japan | Statistics Bureau | Core CPI |

For planning we use central bank's *forward forecast*, not the latest print, refreshed quarterly.

### 7.5 Investment-return benchmarks (Layer 3)

| Country | Default proxy | Long-run nominal | Source |
|---|---|---|---|
| 🇮🇳 India | Nifty 50 TRI | ~12% | NSE / AMFI |
| 🇺🇸 US | S&P 500 TR | ~10% | S&P / Robert Shiller dataset |
| 🇬🇧 UK | FTSE All-Share TR | ~7% | FTSE Russell |
| 🇨🇦 Canada | S&P/TSX TR | ~8% | TMX |
| 🇦🇺 Australia | ASX 200 TR | ~9% | ASX |
| 🇩🇪 Germany | DAX TR | ~7% | Deutsche Börse |
| 🇸🇬 Singapore | STI TR | ~6% | SGX |
| 🇦🇪 UAE | ADX General | ~6% | ADX |
| 🇸🇦 Saudi Arabia | TASI | ~7% | Tadawul |
| 🇯🇵 Japan | Nikkei 225 TR | ~5% | Nikkei |

User can override; defaults reviewed annually.

### 7.6 Bonus data (future / aspirational)
- Open banking / account aggregator (Plaid US, AISP EU, Sahamati India) for auto-import
- Credit bureau APIs (Experian, CIBIL, Equifax) for real-time credit-score-aware mode
- Real-estate price indices (Knight Frank, NHB Residex India, Case-Shiller US) for property as an asset
- Gold spot price API for gold-loan principal valuation

---

## 8. Accuracy & confidence framework

You raised this as a concern. Fair — financial recommendations carry real cost if wrong. Here's how we enforce correctness.

### 8.1 Layered defence

**Layer A — Unit-test every formula.** Each formula in Section 4 has a test suite with hand-computed known answers. The engine is a pure function; tests run in <30s on every commit.

**Layer B — Calibration against public sources.** For canonical scenarios (debt-avalanche example from NerdWallet, US-mortgage payoff calculator from Bankrate, India-EMI calculator from HDFC), our outputs must match within 0.5%. Discrepancies = bug.

**Layer C — Sensitivity bands on every output.** Don't just say "debt-free by Aug 2027." Say "debt-free between **Jul–Oct 2027** (80% confidence given ±1% rate variance and ±10% surplus variance)." This trains users to read the answer probabilistically.

**Layer D — Show your work.** Every recommendation has an expandable "How we got this" view that walks through the math step-by-step with the user's actual numbers plugged in. If the math looks wrong to the user, they can challenge it.

**Layer E — Disclaimers + jurisdiction.** Every recommendation carries: "*This is decision support, not financial advice. Rules change. Verify with a qualified advisor for material decisions.*" Especially important for tax-shield computations.

**Layer F — Human review of first N users.** Before scaling, the team's financial advisor reviews the first 500 generated plans, comparing the recommendation to what they'd advise. Catch systemic biases.

**Layer G — Audit log per user.** Every plan run stores: input snapshot, country-data version, formula version, output. Reproducible later for debugging or user query.

**Layer H — User-flagged outputs.** Every recommendation has a "this doesn't seem right" button. Submissions queue to human review.

### 8.2 Specific risk areas to over-validate

- **Tax-shield math** — country-specific caps are easy to misapply. Test every country every quarter against published tax-calculator outputs.
- **Effective rate computation on credit cards** — multi-tier complexity. Test each Indian top-10 card monthly against the card's actual statement.
- **Central bank pass-through factors** — bank-specific. Validate after every rate change by comparing predicted EMI delta to actual EMI delta reported by users.
- **Restructuring "savings" claims** — most prone to overstatement. Always present as "estimated" with the confidence band.
- **Income-contingent student loans** — special enough that we test against UK SLC's own calculator output.

### 8.3 Confidence visualisation in UI
Numbers in Detailed Mode carry a confidence tag:
- ★★★★★ Verified (computed from user inputs, formula-tested)
- ★★★★ Modelled (uses our country-data; verified within last 30 days)
- ★★★ Estimated (uses defaults; user hasn't overridden)
- ★★ Forecast (depends on central bank projection or market consensus)
- ★ Speculative (long-horizon, sensitive to many assumptions)

Simple Mode hides this. Calm-Overwhelmed mode hides this. Detailed Mode shows it.

---

## 9. Build phases / roadmap

### Phase 1 — MVP (months 0–4)
- Country selector for top 10
- Simple Mode only (Calm tone)
- Layer 0 + Layer 1 (BT only, Shallow execution) + Layer 2 (pure avalanche only) + Layer 3 (with manual user override of return assumption)
- Manual debt entry only
- 8a Windfall Handler, 8b New Debt Check, 8d Quick Recompute
- Manual data ops (no scraping yet)
- Web only

### Phase 2 — Depth (months 4–8)
- Detailed Mode + Overwhelmed Mode
- Layer 1 expanded: refinance, consolidation, tenure renegotiation
- Hybrid + snowball strategies as opt-in
- 8c Asset Liquidation, 8e Cash Yield, 8f Right-Time-to-Borrow
- All four optional lenses
- Cash flow calendar
- Tier A scraping for top 5 banks per country
- Central bank rate-event monitoring
- BT execution upgraded to Mid (form prefill)
- Mobile app

### Phase 3 — Defensibility (months 8–14)
- Multi-tier credit card balance entry
- Account aggregator integrations (India Sahamati, US Plaid, EU AISP)
- BT execution upgraded to Deep (API partnership) for top 3 banks per major country
- Household Mode (joint debts with spouse consent flow)
- Credit-score-aware mode integrated with bureau APIs
- Glossary & info-icon educational content fully populated
- B2B partnership: white-label for credit unions / financial advisors

### Phase 4 — Adjacencies (months 14+)
- Business Capital Optimiser (separate product; reuses some math primitives)
- Tax-filing assistance (separate product)
- Investment portfolio integration
- Estate / succession planning

---

## 10. Open design decisions (for the actual UI work)

These are the things that come up when we start drawing pixels — capture them now so we don't drift during design:

1. **Visual language.** The original FinOptima brief uses a dark navy + gold palette with Syne / DM Mono / Lora type. Keep, or design fresh per this product's brand?
2. **Mobile-first or web-first?** Plan/schedule views are easier on web; daily nudges + Quick Recompute are mobile-native.
3. **The Tools surface — six tiles, or progressive disclosure?** Six tiles risks looking like a feature dump. A "what brings you here today?" entry could route to one tile at a time.
4. **Charts library.** Need real-time interactive charts (sensitivity sliders, scenario compare). Recharts, Visx, D3? Affects design vocabulary.
5. **Numbers formatting per locale.** ₹1,23,45,678 (Indian) vs $1,234,567.89 (US) — pick a single i18n library and lock.
6. **Accessibility.** Detailed Mode is data-dense; ensure AA contrast, keyboard nav, screen-reader paths for every formula expansion.

---

End of spec. Next step: produce wireframes (low-fi) for the 5 top-level screens × 3 mode combinations, plus the six Tools sub-modules. That's ~21 screens at sketch fidelity — doable in one design pass once we agree the spec.

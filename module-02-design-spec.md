# Module 02 — Debt & EMI Restructuring Optimiser
## Design Specification

> **Companion to:** `module-02-debt-emi-brainstorm.md`
> **Purpose:** translate the locked brainstorm into an implementation-ready spec covering UI modes, screens, math, architecture, data sources, and accuracy framework.
> **Status:** v2.0 — formulas complete and corrected; wireframes pending.
> **Last updated:** May 2026
>
> ⚠ **DATA CURRENCY (verified May 2026):** All tax slabs, instrument returns, and regulatory caps reflect **India FY2026-27 / USA Tax Year 2026**. Verified sources: Union Budget 2026-27 (Feb 1, 2026 — slabs unchanged from FY2025-26, 87A rebate ₹60k retained, standard deduction ₹75k retained; **Income Tax Act, 2025 effective April 1, 2026**); EPFO 239th CBT meeting (Mar 2, 2026 — **8.25% retained for FY2025-26**, third consecutive year); MoF small-savings notification (Mar 30, 2026 — **PPF 7.1% retained Q1 FY2026-27**, unchanged since Apr 2020); IRS Rev Proc 2025-32 (Oct 2025 — Tax Year 2026 brackets + standard deduction). RBI repo rate **5.25%** (April 2026 MPC, neutral stance); Fed funds target **3.50–3.75%** (April 2026 FOMC, held). Floating-rate bank cards refreshed per scrape tier (§7.1).

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

**Step 0 — Derive `marginal_tax_rate` from declared income (see §4.14 for full formula).**
For India: the effective marginal rate includes surcharge + 4% cess — it is NOT the raw slab rate. At ₹1.2Cr income (old regime) the correct marginal rate is 35.88%, not 30%. Always use the §4.14 output.
Current rates: **India FY2026-27** slabs (Budget 2026-27 retained the FY2025-26 structure — see brainstorm §25.2 and Income Tax Act, 2025 effective Apr 1, 2026); **USA Tax Year 2026** brackets (§4.14, IRS Rev Proc 2025-32).

**Step 1 — India new-regime gate for home loan (runs BEFORE applying cap):**
```
# FY2026-27 default: new regime (slabs unchanged from FY2025-26 per Budget 2026-27).
# Sec 24(b) shield on self-occupied = ₹0 under new regime.
# Old regime (user must explicitly opt in): Sec 24(b) cap = ₹2,00,000/yr.
if country == "IN" AND loan_type == "home_loan" AND property_use == "self_occupied":
    country_cap_i = 0 if user.tax_regime == "new" else 200_000
# Let-out property: deductible without cap in both regimes (deducted against rental income).
```
⚠ Defaulting to old-regime shield for a new-regime user is a systematic error — see brainstorm §25.1.

**Step 2 — Effective rate formula:**
```
annual_interest_i   = outstanding_balance_i × nominal_rate_i
deductible_amount   = min(annual_interest_i, country_cap_i)
tax_saved_i         = deductible_amount × marginal_tax_rate
effective_rate_i    = nominal_rate_i × [1 − (deductible_amount / annual_interest_i) × marginal_tax_rate]
                    + amortised_fees_rate_i
                    + bundled_insurance_rate_i
                    + GST_on_interest_rate_i   // credit cards + personal loan processing fees only (18%); NOT on home/auto EMI interest — see §4.16
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

**PF liquidity gate (runs before comparison):** EPF, VPF, PPF, and NPS Tier 1 are locked — never in the monthly comparison pool. See §4.17 for full gate. NPS Tier 2 is freely liquid and appears in the pool.

```
# Step 1 — filter to liquid options only
liquid_options        = [opt for opt in user_investment_options if opt.liquidity_class != "locked"]

# Step 2 — compare real rates
user_best_real_return = max(liquid_options, key=lambda o: o.expected_return) − inflation_rate
loan_real_rate        = effective_rate_i − inflation_rate
prepay_recommended    = loan_real_rate > user_best_real_return + 0.005  // +0.5pp risk premium (rates stored as decimals)
```
If `prepay_recommended == False`, route surplus to best liquid investment instead of prepayment.

**India reference returns (verified May 2026; display only — not auto-populated in pool for locked instruments):**
- EPF: **8.25% tax-free** (FY2025-26, retained Mar 2 2026 by EPFO CBT — third consecutive year) → ~11.79% pre-tax equiv at 30% bracket (locked). `[VERIFY FY2026-27 rate → EPFO CBT meeting ~Feb-Mar 2027]`
- PPF: **7.1% tax-free** (Q1 FY2026-27, Apr-Jun 2026, notified Mar 30 2026; unchanged since Apr 2020) → ~10.14% pre-tax equiv at 30% bracket (15-yr lock; partial from yr 7). `[VERIFY next quarter → MoF notification ~end-Jun 2026]`
- Nifty 50 TRI long-run: ~12% nominal (liquid; in pool)
- Best FD rate (India): ~6.75–7.25% (post repo-rate cut to 5.25% in Dec 2025; fully liquid; in pool) `[VERIFY weekly per bank]`

**USA reference returns (Tax Year 2026, verified May 2026; liquid):**
- S&P 500 long-run: ~10% nominal (in pool)
- HYSA top rate: ~3.75–4.25% (post Fed cuts to 3.50–3.75% target; in pool) `[VERIFY weekly per institution]`
- 401k/IRA: flag as age-gated (not liquid before 59½ without penalty — exclude for users <55)

### 4.7 Restructuring scans (Layer 1)

**Balance transfer candidate:** (all rate values are decimals — e.g. 24% = 0.24)
```
candidate if: effective_rate_card > 0.24 AND
              BT_offer_rate + amortised_BT_fee < effective_rate_card − 0.05
```

**Consolidation candidate:**
```
candidate if: count(unsecured_debts where effective_rate > 0.15) ≥ 2 AND
              market_personal_loan_rate × (1 + fee_amortised) < blended_avg_rate − 0.03
```

**Refinance candidate (home/auto):**
```
candidate if: current_rate > market_median_rate + 0.015 AND
              (interest_saved − refi_costs) / refi_costs > 1.0
```

**Tenure renegotiation (home loan to free surplus):**
```
extra_lifetime_interest_home = extra_monthly_freed × months × home_rate_compound_factor
high_rate_interest_saved     = surplus_freed × months × (high_rate − home_rate)
recommend if: high_rate_interest_saved > extra_lifetime_interest_home × 1.2
```

### 4.8 Asset liquidation gate (Section 8c)

**⚠ This original formula is superseded by §4.18.** It understates the debt hurdle by omitting:
- Transaction costs (stamp duty + registration + brokerage = 7–11% in India; 7–9% in USA)
- LTCG tax (indexed cost method for India; bracket-dependent for USA). Note: Finance Act 2024 removed indexation for property bought after 23 Jul 2024 — flat 12.5% LTCG applies. Property held since before 23 Jul 2024 retains CII-based indexation option. `[VERIFY current CII table → CBDT annual notification]`
- Time-to-sell delay interest (3 months of high-rate debt accruing while sale completes)
- CAGR-derived `nominal_return` (not a direct user input — computed from purchase price + year)

The four-gate structure is preserved in §4.18. Gate 1 uses `true_net_benefit` (not raw debt amount); Gate 3 requires spread ≥ 3pp **and** `true_net_benefit > 0`. Use §4.18 for all production computations.

### 4.9 No-cost EMI true cost (Section 8b)
```
foregone_discount  = list_price − cash_price_elsewhere
processing_fee     = stated_fee  // many "no-cost EMI" charge ~3–5%
total_real_cost    = foregone_discount + processing_fee
effective_apr      = solve_apr_such_that(NPV(payments) = list_price − total_real_cost)
```

### 4.10 Inflation usage and salary growth model

**Inflation usage:**
- **Long-tenure loans (>5 yrs):** Layer 3 uses real return for comparison
- **Real value of fixed EMI:** `real_emi_t = nominal_emi / (1 + inflation)^(t/12)`
- Inflation source: RBI forward forecast (India — **CPI 4.6% for FY2026-27 per April 2026 MPC**); Fed SEP median (USA). Refreshed quarterly. `[VERIFY next forecast → RBI MPC / Fed SEP next release]`

**Salary growth projection — salaried user:**
```
# User declares annual_hike_rate in onboarding
# Simple Mode default pre-fill: min(1.5 × inflation, 0.08)
# Detailed Mode: per-year hike table allowed (e.g. 12% promotion year, 7% other years)
projected_surplus_t = base_surplus × ∏(y=1..floor(t/12)) (1 + annual_hike_rate_y)
```

**Income projection — business owner / freelancer:**
```
# Plan runs at P25 of last 12 months net personal income — not the mean
p25_income          = percentile_25(last_12_months_net_income)
# 3-year income CAGR as forward projection rate (user provides 3 prior years)
business_cagr       = (income_year3 / income_year1)^(1/2) − 1
projected_surplus_t = max(0, p25_income − fixed_expenses) × (1 + business_cagr)^(t/12)

# Advance tax months (India business owners) auto-marked in cash flow calendar:
# 15 Jun (15%), 15 Sep (45% cumulative), 15 Dec (75%), 15 Mar (100%)  [VERIFY dates annually]
```

**Plan screen visual (plans > 5 years):** shows two surplus lines — "today's surplus (flat)" and "projected at your declared hike rate." Most compelling for home loan planning — users see their 20-year debt become progressively lighter. See brainstorm §27 for full UX spec.

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

### 4.13 Standard EMI formula (amortising loans)

```
monthly_rate = effective_rate_i / 12
EMI_i        = balance_i × monthly_rate × (1 + monthly_rate)^n / ((1 + monthly_rate)^n − 1)
```

Remaining balance after t scheduled payments:
```
balance_after_t = balance_i × ((1 + monthly_rate)^n − (1 + monthly_rate)^t) / ((1 + monthly_rate)^n − 1)
```

Total interest over full tenure (no extra payments):
```
total_interest_i = EMI_i × n − principal_i
```

Uses `effective_rate_i` (not nominal) — fees, bundled insurance, and applicable taxes are absorbed into the rate before this formula runs.

**Currency arithmetic rule:** always use `Decimal` type (never float) for all monetary calculations. Floating point errors compound over multi-year plans and produce incorrect output.

### 4.14 India tax computation — effective marginal rate

```
# Inputs: gross_income (₹/yr), regime ("old" | "new"), deductions_dict
taxable_income   = compute_taxable_income(gross_income, regime, deductions_dict)

# Marginal slab rate at the top rupee of taxable_income
base_rate        = marginal_slab_rate(taxable_income, regime)   # see brainstorm §25.2

# Surcharge on income tax
if taxable_income <= 5_000_000:      surcharge = 0.00
elif taxable_income <= 10_000_000:   surcharge = 0.10
elif taxable_income <= 20_000_000:   surcharge = 0.15
elif taxable_income <= 50_000_000:   surcharge = 0.25
else:                                surcharge = 0.37   # capped at 0.25 for LTCG/special rate income

# Education cess (4% on tax + surcharge)
marginal_rate    = base_rate × (1 + surcharge) × 1.04
```

**US federal marginal rate computation (Tax Year 2026, IRS Rev Proc 2025-32, verified May 2026):**
```
# 2026 tax brackets — published by IRS Rev Proc 2025-32 (Oct 2025); inflation +~2.7% vs 2025
# Includes amendments from the One Big Beautiful Bill Act (OBBBA)
# Single filer: 10%→12%→22%→24%→32%→35%→37%
#   thresholds: $12,400 / $50,400 / $105,700 / $201,775 / $256,225 / $640,600
# MFJ:         10%→12%→22%→24%→32%→35%→37%
#   thresholds: $24,800 / $100,800 / $211,400 / $403,550 / $512,450 / $768,700
federal_marginal_rate   = bracket_lookup(taxable_income, filing_status, year=2026)
# State income tax: add state_rate[state] to effective marginal rate
# Key state rates 2026: CA 13.3% | NY 10.9% | TX/FL/WA 0% | IL 4.95% | NJ 10.75%  [VERIFY state-by-state annually]
effective_marginal_rate = federal_marginal_rate + state_marginal_rate
```

### 4.15 USA mortgage interest deduction — itemisation gate

```
# TCJA 2017 + OBBBA: standard deduction largely eliminated itemisation benefit for most filers
# IRS Rev Proc 2025-32 (Oct 2025) — Tax Year 2026 figures verified May 2026
standard_deduction = {
    2025: {single: 15_000, mfj: 30_000, hoh: 22_500},
    2026: {single: 16_100, mfj: 32_200, hoh: 24_150},
}   # [VERIFY Tax Year 2027 → IRS Rev Proc ~Oct 2026]

total_itemisable = mortgage_interest_paid + min(salt_taxes_paid, 10_000) + charitable_giving + ...

if total_itemisable > standard_deduction[year][filing_status]:
    # User itemises; mortgage interest deduction is incremental vs standard deduction
    incremental_benefit = total_itemisable − standard_deduction[year][filing_status]
    deductible_interest  = min(mortgage_interest_paid,
                               incremental_benefit,
                               interest_on_750k_principal_limit)
    tax_saved            = deductible_interest × marginal_rate
else:
    # Standard deduction taken — mortgage interest gives zero additional tax benefit
    tax_saved            = 0
    effective_rate_mortgage = nominal_rate_mortgage   # no shield applied
```

**Implication for invest-vs-prepay (Layer 3):** US homeowners at standard deduction see no tax shield — their home loan effective rate equals the nominal rate, raising the hurdle for "invest instead of prepaying" advice.

### 4.16 GST on financial products — India (correction to §4.1)

```
# What actually attracts 18% GST in India:
#   Credit cards: GST on interest charges, late fees, cash advance fees, annual fees
#   Personal loans: GST on processing fee (NOT on the monthly interest itself)
#   Home loans: GST on processing fee only. Interest payments: no GST.
#   Auto loans: GST on processing fee only. Interest payments: no GST.

if loan_type == "credit_card":
    # Interest effectively becomes nominal × 1.18
    gst_component = nominal_rate × 0.18

elif loan_type in ("personal_loan", "home_loan", "auto_loan"):
    # GST only on processing fee, amortised over tenure
    gst_component = (processing_fee × 0.18) / (principal × tenure_years)

GST_on_interest_rate_i = gst_component   # plug into §4.1 formula
```

### 4.17 India EPF/PPF pre-tax equivalent and liquidity gate

```
# Pre-tax equivalent of EPF return (used as reference floor, NOT as free allocation)
epf_rate_taxfree    = 0.0825          # FY2025-26: 8.25% (retained Mar 2 2026 by EPFO 239th CBT)
                                      # Third consecutive year at 8.25%; credited to subscriber
                                      # accounts ~Jun-Aug 2026 after MoF notification.
                                      # [VERIFY FY2026-27 rate → EPFO CBT meeting ~Feb-Mar 2027]
epf_pretax_equiv    = epf_rate_taxfree / (1 − marginal_rate)
# e.g. at 30% bracket: 8.25% / 0.70 = 11.79% pre-tax equivalent

# PPF pre-tax equivalent
ppf_rate_taxfree    = 0.071           # 7.1% for Q1 FY2026-27 (Apr-Jun 2026, notified Mar 30 2026)
                                      # Unchanged since Apr 2020; quarterly-set by MoF.
                                      # [VERIFY next quarter → MoF small-savings notification ~Jun 2026]
ppf_pretax_equiv    = ppf_rate_taxfree / (1 − marginal_rate)
# e.g. at 30% bracket: 7.1% / 0.70 = 10.14% pre-tax equivalent

# Liquidity gate — can this instrument be mobilised for debt payoff?
def pf_withdrawal_eligible(instrument, user_data):
    if instrument == "EPF":
        return (user_data.years_in_service >= 5
                and user_data.withdrawal_reason in EPF_ALLOWED_REASONS)
    elif instrument == "PPF":
        return user_data.years_since_ppf_open >= 7      # partial only
    elif instrument == "NPS_Tier1":
        return (user_data.years_since_nps_open >= 3
                and user_data.withdrawal_reason in NPS_ALLOWED_REASONS)
    elif instrument == "NPS_Tier2":
        return True     # fully liquid
    return False

# EPF/PPF/NPS Tier1 are NEVER included in the Layer 3 monthly invest-vs-prepay pool
# They appear only in the Asset Liquidation Check (§8c) when eligibility confirmed
```

### 4.18 Asset liquidation — corrected formula (supersedes §4.8)

```
# ── India LTCG on immovable property (Finance Act 2024 split) ──
# Post-23-Jul-2024 purchases: flat 12.5% on gain, NO indexation.
# Pre-23-Jul-2024 purchases: taxpayer picks min of (12.5% without indexation) vs (20% with CII indexation).
# LTCG surcharge is capped at 25% (cf. §4.14 — capped for LTCG/special-rate income).
cii_table       = {FY: CII_value}   # CBDT publishes annually
gross_proceeds  = sale_price × (1 − selling_cost_pct)   # stamp duty + 1% reg + brokerage
ltcg_surcharge_capped = min(surcharge_rate, 0.25)       # LTCG surcharge cap

if purchase_date >= date(2024, 7, 23):
    # New regime — no indexation
    ltcg          = max(0, gross_proceeds − purchase_price)
    ltcg_tax_base = ltcg × 0.125
else:
    # Old regime — taxpayer picks lower-tax option
    indexed_cost  = purchase_price × cii_table[current_fy] / cii_table[purchase_fy]
    option_a      = max(0, gross_proceeds − purchase_price) × 0.125
    option_b      = max(0, gross_proceeds − indexed_cost)  × 0.20
    ltcg_tax_base = min(option_a, option_b)

ltcg_tax     = ltcg_tax_base × (1 + ltcg_surcharge_capped) × 1.04   # + capped surcharge + 4% cess
net_proceeds = gross_proceeds − ltcg_tax

# ── Time-to-liquidate drag ──
selling_period_months = 3      # conservative India; 2 months for US
interest_during_sale  = debt_balance × (effective_rate_debt / 12) × selling_period_months
true_net_benefit      = net_proceeds − debt_balance − interest_during_sale

# ── Updated Gate 1 — net-benefit hurdle (replaces brainstorm §8c "debt ≥ 10% asset value") ──
gate_1                = true_net_benefit > 0 AND (true_net_benefit / asset_value) >= 0.10
                        # Uses true_net_benefit (after costs), not raw debt amount

# ── Updated Gate 3 — spread hurdle (all rates as decimals; 3pp = 0.03) ──
one_time_drag         = (selling_cost_pct + ltcg_effective_rate)
asset_real_return_net = (nominal_return_asset − inflation
                        − holding_cost_rate
                        − one_time_drag / expected_hold_years_post_sale)
gate_3                = (effective_rate_debt − asset_real_return_net) >= 0.03
                        # Note: benefit-positivity is enforced by gate_1; gate_3 is the spread test.
```

### 4.19 Prepayment penalty net savings

```
# India: RBI mandates zero prepayment penalty on floating-rate home and personal loans
# Fixed-rate loans: bank-specific, typically 1–3% of prepaid amount
penalty_rate          = prepayment_penalty_table[bank][loan_type][rate_type]
prepayment_penalty    = prepaid_amount × penalty_rate

# Interest saved by reducing balance now vs not prepaying
interest_saved        = compute_interest_total(balance, rate, remaining_tenure)
                      − compute_interest_total(balance − prepaid_amount, rate, remaining_tenure)
net_prepayment_saving = interest_saved − prepayment_penalty
recommend_prepayment  = net_prepayment_saving > 0
```

### 4.20 Balance transfer effective APR

```
# True cost of a balance transfer offer (all-in)
bt_fee               = transferred_amount × bt_offer.fee_pct
net_amount_received  = transferred_amount − bt_fee
required_monthly     = transferred_amount / bt_offer.promo_months  # to clear in promo period

# Effective APR (assuming full clearance within promo period, using IRR method)
cashflows            = [−net_amount_received] + [required_monthly] * bt_offer.promo_months
effective_bt_apr     = irr(cashflows) × 12

# Recommend only if meaningfully cheaper than current rate
recommend_bt         = effective_bt_apr < current_card_effective_rate − 0.02   # 2pp minimum hurdle (decimal)

# If user cannot clear within promo period, post-promo revert rate kicks in — show that scenario too
```

### 4.21 Avalanche cascade — freed EMI routing

When any debt reaches zero balance, its minimum payment (and any extra allocated to it) auto-routes to the next-priority debt:

```
on debt_i_reaches_zero(month_t):
    freed_payment            = minimum_payment_i + extra_allocated_to_i[month_t]
    next_priority_debt       = priority_queue.peek()    # sorted by effective_rate, descending
    extra_allocated[next_priority_debt] += freed_payment
    # Plan re-computes from month_t with updated allocations
    recompute_plan_from(month_t)

# UI notification generated:
# "Your HDFC Personal Loan is paid off. ₹8,500/mo now routed to SBI Auto Loan.
#  Debt-free date: May 2027 (was Aug 2027)."
```

### 4.22 Minimum payment computation

```
def compute_minimum_payment(loan, bank, country):
    if loan.type == "credit_card":
        formula = bank_data[bank]["min_payment_formula"]
        # formula is one of:
        #   {"type": "greater_of", "pct": 0.05, "floor": 200}      # standard India (e.g. SBI, Axis, Yes, IndusInd)
        #   {"type": "greater_of_three_methods",                    # ICICI-style (brainstorm §24.1)
        #    "a": {"interest_plus_fees_plus_pct_principal": 0.01},
        #    "b": {"pct": 0.05},
        #    "floor": 100}
        #   {"type": "pct_plus_emi_plus_overlimit_plus_pastdue",    # HDFC-style
        #    "pct": 0.05, "floor": 200}
        #   {"type": "pct_plus_interest_plus_fees", "pct": 0.05, "floor": 200}   # Kotak-style
        return evaluate_formula(formula, loan.outstanding, loan.interest_accrued, loan.fees, loan.current_emi, loan.over_limit, loan.past_due)
    else:
        # Personal / home / auto loan: EMI is the minimum; no ambiguity
        return loan.scheduled_emi

# Simple Mode: always use default formula (5%/₹200 India; 2%/$35 US)
# Detailed Mode: use bank-specific formula from data store
```

### 4.23 Available monthly surplus — complete formula

The surplus available for extra debt payments has several mandatory deductions before any allocation:

```
# Hard floors — computed first, always
total_minimums        = Σ compute_minimum_payment(loan_i)        # §4.22; never violated
efund_monthly         = max(0, (efund_target − efund_balance) / 12)  # until target reached
matched_contribution  = compute_mandatory_contributions(user)     # §4.3; Layer 0, routes first

# India-specific: MAB is a cash floor on savings_balance, not a monthly deduction
mab_reserve           = lookup_mab(user.primary_bank, user.location_tier)  # §4; brainstorm §29
available_buffer      = max(0, user.savings_balance − mab_reserve − efund_target)
# available_buffer is the one-time deployable cash pool; reduces as used

# Business owner DSR: one-time reserve held in savings, not a monthly deduction
debt_servicing_reserve = 3 × total_monthly_emis if user.income_type == "business_owner" else 0
available_buffer       = max(0, available_buffer − debt_servicing_reserve)

# Monthly surplus available for extra debt payments
available_surplus     = (monthly_income
                        − fixed_expenses
                        − total_minimums
                        − efund_monthly
                        − matched_contribution)
available_surplus     = max(0, available_surplus)   # floor at zero; never negative
```

Note: `available_buffer` (one-time cash) and `available_surplus` (monthly recurring) are separate pools. The plan uses both: one-time buffer can be deployed as a lump-sum prepayment immediately; monthly surplus feeds the ongoing schedule.

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

### 7.1 Phase 1 institution data — India (30) + USA (15)

Full institution lists with scrape tiers are in brainstorm §31. Summary:

**India — scrape tiers:**

| Tier | Institutions (30 total) | Cadence |
|---|---|---|
| **A** — daily auto-scrape | SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra, PNB | Daily automated diff + human review |
| **B** — weekly manual | Bank of Baroda, Canara Bank, Bank of India, Union Bank, Indian Bank, Central Bank, IDBI, Yes Bank, IDFC First, IndusInd | Weekly update |
| **C** — quarterly audit | Federal Bank, South Indian Bank, RBL Bank, Bandhan Bank, AU SFB, UCO Bank, Bank of Maharashtra, Punjab & Sind, Karnataka Bank, Karur Vysya, City Union, J&K Bank, Ujjivan SFB, Suryoday SFB | Quarterly spot-check |

**USA — scrape tiers:**

| Tier | Institutions (15 total) | Cadence |
|---|---|---|
| **A** — daily auto-scrape | JPMorgan Chase, Bank of America, Wells Fargo, Citibank, U.S. Bank, Capital One | Daily automated |
| **B** — weekly manual | American Express, Discover, Goldman Sachs (Marcus), Ally Financial, Truist, PNC Financial | Weekly update |
| **C** — quarterly audit | TD Bank, Navy Federal Credit Union, SoFi | Quarterly |

**Data fields maintained per institution per product:**

| Field | India | USA |
|---|---|---|
| Loan rate range (min–max) | EBLR/RLLR-linked for floating; EBLR ~8.25–8.50% post 5.25% repo (May 2026) `[VERIFY current EBLR per bank]` | Prime ~7.50% / SOFR-linked `[VERIFY current prime rate]` |
| Credit card APR (retail / cash advance) | ~24–45% / ~36–48% `[VERIFY per bank]` | ~18–30% / ~24–30% `[VERIFY per issuer]` |
| Min payment formula | Structured object (brainstorm §24.1) | Structured object (brainstorm §24.2) |
| BT offer | Promo rate + months + fee % | 0% intro + months + fee % |
| Processing / origination fee | % or flat ₹ | 0–10% of loan amount |
| Prepayment penalty | Floating = ₹0 (RBI mandated); fixed = 1–3% | Most = $0; confirm per product |
| MAB | Urban/semi-urban/rural ₹ (brainstorm §29.1) | N/A |
| HYSA yield | Savings/liquid fund rate `[VERIFY weekly]` | Best HYSA rate `[VERIFY weekly]` |
| Last-verified date | Per field | Per field |

**Institution JSON schema (abbreviated):**
```json
{
  "institution_id": "IN_HDFC",
  "country": "IN",
  "name": "HDFC Bank",
  "scrape_tier": "A",
  "products": {
    "home_loan": {
      "rate_min": 0.0775, "rate_max": 0.0815, "rate_type": "floating",
      "benchmark": "RLLR", "processing_fee_pct": 0.005,
      "prepayment_penalty_floating": 0,
      "bundled_insurance": true, "insurance_premium_pct": 0.004,
      "last_verified": "2026-05-14"
    },
    "credit_card": {
      "retail_rate": 0.432, "cash_advance_rate": 0.456,
      "min_payment_formula": {
        "type": "greater_of", "pct": 0.05, "floor": 200,
        "plus": ["current_emi", "over_limit", "past_due"]
      },
      "bt_offer": {"promo_rate": 0.00, "promo_months": 6, "bt_fee_pct": 0.015},
      "last_verified": "2026-05-14"
    }
  },
  "savings_account": {"mab_urban": 10000, "mab_semi_urban": 5000, "mab_rural": 2500}
}
```

**Indicative India rates (May 2026, post-RBI cut to 5.25%; refresh before launch):** `[VERIFY weekly per bank]`

| Product | SBI | HDFC | ICICI | Axis | Kotak |
|---|---|---|---|---|---|
| Home loan (floating) | 7.50–8.70% | 7.75–8.15% | 7.50–8.85% | 7.65–9.80% | 7.99–9.35% |
| Personal loan | 10.30–14.85% | 10.50–24.00% | 10.65–19.00% | 10.49–22.00% | 10.99–24.00% |
| Auto loan | 8.10–9.05% | 8.50–9.20% | 8.80–9.80% | 8.65–9.50% | 8.49–9.50% |
| Credit card APR (mo/p.a.) | 1.99–3.50%/23.88–42% | 2.50–3.60%/30–43.2% | 2.49–3.75%/29.88–45% | 2.40–3.40%/28.8–40.8% | 3.10–3.50%/37.2–42% |

**Indicative USA rates (May 2026, Fed funds 3.50–3.75% target; refresh before launch):** `[VERIFY weekly per institution]`

| Product | Chase | BofA | Wells Fargo | Citi | Capital One |
|---|---|---|---|---|---|
| 30yr fixed mortgage | 6.50–7.00% | 6.55–7.05% | 6.45–6.95% | 6.60–7.10% | N/A |
| Personal loan | 6.99–24.99% | 7.49–24.99% | 7.49–23.99% | 11.49–20.49% | N/A |
| Auto loan | 5.69–13.69% | 5.49–10.74% | 5.74–11.74% | N/A | 4.79–9.79% |
| Credit card APR | 20.24–29.24% | 17.99–28.99% | 19.99–28.99% | 19.74–29.74% | 19.74–29.74% |
| Best HYSA yield | ~3.75% | ~3.50% | ~3.60% | ~3.70% | ~3.80% |

**Crowd-sourcing:** when a user's input differs from stored value by >0.5%, prompt confirmation. 3 confirmations in 7 days flips the stored value. UI always shows last-verified date with staleness badge.

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

### 7.6 India-specific additional data sources

| Data | Source | Update frequency |
|---|---|---|
| **EPF interest rate** | EPFO annual circular (epfindia.gov.in) | Annually (typically March/April) |
| **PPF interest rate** | Ministry of Finance quarterly notification | Quarterly |
| **NPS historical returns** | PFRDA (pfrda.org.in) — NPS scheme returns table | Monthly |
| **CII for LTCG indexation** | CBDT notification (incometaxindia.gov.in) | Annually (June) |
| **India income tax slabs + regime rules** | IT Department budget notifications | At Union Budget (Feb 1 each year) |
| **Advance tax schedule** | IT Department (fixed dates: Jun 15 / Sep 15 / Dec 15 / Mar 15) | Static; confirm if dates shift |
| **Stamp duty rates by state** | State government registration portals (30 states × rates) | When state amends the Stamp Act |
| **Bank MAB requirements** | Individual bank websites (savings account product page) | When bank changes policy |
| **India HYSA / liquid fund yields** | AMFI (amfiindia.com) for liquid fund category average; individual bank HYSA pages | Monthly for liquid funds; real-time for savings rates |
| **Gold spot price (for gold loan principal)** | MCX / IBJA daily spot | Daily (used for gold loan value refresh) |

### 7.7 USA-specific additional data sources

| Data | Source | Update frequency |
|---|---|---|
| **Federal income tax brackets** | IRS annual revenue procedure (irs.gov) | Annually (October inflation adjustment) |
| **State income tax rates** | Individual state revenue dept websites | When state legislature changes |
| **Standard deduction** | IRS Rev Proc (updated annually for inflation) | Annually |
| **Student loan thresholds (federal IDR)** | studentaid.gov — IDR plan parameters | Annually (July 1 each year) |
| **401k contribution limits + IRS match rules** | IRS Notice (issued October each year) | Annually |
| **HYSA / savings rates** | FDIC weekly national rate cap (fdic.gov) + individual bank pages (Marcus, Ally, SoFi) | Weekly for FDIC; bank pages as needed |
| **Federal student loan interest rates** | studentaid.gov (set annually July 1) | Annually |
| **Realtor commission / closing cost averages** | NAR survey + Zillow data | Annually |
| **LTCG tax brackets (US)** | IRS (updated annually) | Annually |

### 7.8 Bonus data (future / aspirational)
- Open banking / account aggregator (Plaid US, AISP EU, Sahamati India) for auto-import
- Credit bureau APIs (Experian, CIBIL, Equifax) for real-time credit-score-aware mode
- Real-estate price indices (Knight Frank, NHB Residex India, Case-Shiller US) for property as an asset
- Gold spot price API for gold-loan principal valuation

### 7.9 Sources verified in current data refresh (May 2026)

Authoritative sources used for the current rate cards, tax slabs, and instrument returns embedded in this spec. Refresh these on the cadences listed in §7.6–§7.7 before launch.

**India — tax & policy (FY2026-27):**
- Union Budget 2026-27 — slabs retained unchanged: [KPMG Budget 2026-27 analysis](https://kpmg.com/in/en/services/tax/india-union-budget-2026-27.html), [PRS Legislative Research Budget Analysis](https://prsindia.org/files/budget/budget_parliament/2026/Union_Budget_Analysis-2026-27.pdf), [HDFC Bank Budget 2026-27 explainer](https://www.hdfc.bank.in/blogs/union-budget/budget-2026-27-income-tax-act-2026-tax-slabs-stt)
- Income Tax Act, 2025 (effective Apr 1 2026): Income Tax Department portal — incometax.gov.in
- LTCG (Finance Act 2024 split): CBDT notifications — incometaxindia.gov.in

**India — small savings & EPF:**
- EPF 8.25% retained (FY2025-26, EPFO 239th CBT, Mar 2 2026): [DD News official release](https://ddnews.gov.in/en/epfo-retains-8-25-interest-rate-on-pf-deposits-for-2025-26/), [Upstox coverage](https://upstox.com/news/personal-finance/investing/epf-interest-rate-for-fy-2025-26-declared-when-will-it-be-credited-to-employees-provident-fund-accounts/article-190151/)
- PPF 7.1% retained (Q1 FY2026-27, MoF notification Mar 30 2026): [Upstox PPF Q1 notification](https://upstox.com/news/personal-finance/investing/public-provident-fund-ppf-interest-rate-april-june-2026-tax-free-7-1-compounding-continues/article-191464/), [Relakhs small savings rates Q1 FY27](https://www.relakhs.com/latest-post-office-small-savings-schemes-interest-rates-apr-jun-2026/)

**India — central bank & banking:**
- RBI repo rate 5.25% (Apr 2026 MPC, neutral stance, held; cut from 5.50% Dec 2025): [DD News RBI MPC Apr 2026](https://ddnews.gov.in/en/rbi-keeps-repo-rate-unchanged-at-5-25-in-first-policy-of-fy27-after-ceasefire-in-west-asia-conflict/), [News on Air MPC release](https://www.newsonair.gov.in/rbi-to-announce-its-first-bi-monthly-monetary-policy-statement-for-financial-year-2026-27-today/)
- India home loan rates May 2026 (SBI 7.50–8.70%, HDFC 7.75–8.15%, ICICI 7.50%+, Axis 7.65–9.80%): [UrbanMoney May 2026 rate table](https://www.urbanmoney.com/home-loan/interest-rate), [HDFC Bank rate page](https://homeloans.hdfc.bank.in/checklist/home-loan-interest-rates), [ICICI Bank rate page](https://www.icici.bank.in/personal-banking/loans/home-loan/interest-rates)
- India credit card APRs (ICICI 2.49–3.75%/mo, SBI 1.99–2.25%/mo, HDFC ~2.5%/mo): [Paisabazaar credit card rates 2026](https://www.paisabazaar.com/credit-card/interest-rates/), [Bajaj Markets ICICI card rates](https://www.bajajfinservmarkets.in/credit-card/icici-bank-credit-card-interest-rate)

**USA — tax & policy (Tax Year 2026):**
- IRS Rev Proc 2025-32 (Oct 2025) — 2026 brackets + standard deduction: [IRS official release](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill), [Rev Proc 2025-32 PDF](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [Tax Foundation 2026 brackets](https://taxfoundation.org/data/all/federal/2026-tax-brackets/)
- OBBBA (One Big Beautiful Bill Act) amendments folded into 2026 inflation adjustments

**USA — central bank:**
- Fed funds target 3.50–3.75% (held through April 2026 FOMC): [Federal Reserve H.15 daily release](https://www.federalreserve.gov/releases/h15/), [FRED DFEDTARU series](https://fred.stlouisfed.org/series/DFEDTARU), [FOMC Mar 17-18 2026 minutes](https://www.federalreserve.gov/monetarypolicy/fomcminutes20260318.htm)

**Refresh cadence:** rerun the verification queries each quarter (Mar, Jun, Sep, Dec) and on every event that may shift base rates: Union Budget (Feb), EPFO CBT (Feb-Mar), MoF small-savings notification (last week of each quarter), RBI MPC (bimonthly), FOMC meeting (8/yr), IRS Rev Proc (Oct).

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

### Phase 1 — MVP (months 0–4) — India + USA only
- Country selector: India + USA (Phase 1 scope per brainstorm §30; 8 remaining countries activate in Phase 2)
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

## 10. Design decisions — locked and open

### Locked decisions (resolved May 2026)

**7. Web-first, desktop-primary for v1. LOCKED.**
- Primary design target: 1280px+ desktop/laptop
- Specifically desktop-first: Onboarding (multi-field), Plan screen (table + sliders + comparison), My Debts detail (chart + edit fields side-by-side)
- Mobile browser: fully responsive; Home, Quick Recompute, Windfall Handler, New Debt Check optimised for one-hand mobile use
- Native app: Phase 2 (React Native with shared engine code)

**8. Tools surface. LOCKED.**
- Primary: contextual surfacing — app shows the most relevant tool card below "This Month's Action" based on current user state (salary received → Windfall; rate changed → Right-Time-to-Borrow; first of month + idle cash → Cash Yield Check)
- Secondary: "More tools →" link expands to the 6-tile grid (below the fold)
- Windfall Handler also gets a persistent floating action button (FAB) on the Home screen, labelled *"Got a bonus?"* — highest-frequency ad-hoc action

**9. Navigation. LOCKED.**
- Desktop: left sidebar with 5 destinations (Home / My Debts / Plan / Tools / Insights) + country selector + settings in sidebar header
- Mobile: bottom tab bar (5 items; collapse Tools into a modal sheet to avoid crowding)
- Mode toggle (Simple ⇆ Detailed): persisted in top-right of every screen
- Country selector: top of sidebar (desktop) / top of Home screen (mobile)

### Still open (must resolve before frontend build starts)

1. **Visual language.** Dark navy + gold (FinOptima brief direction), or new identity for this product specifically? Decision gates the component library.
2. **Charts library.** Must support interactive sensitivity sliders + multi-series comparison in Detailed Mode. Candidates: Recharts (easiest React integration), Visx (D3-backed, more control), ECharts (better mobile performance). Lock before Plan screen wireframes.
3. **Locale number formatting.** ₹1,23,45,678 (Indian lakh/crore system) vs $1,234,567.89 (US). Use `Intl.NumberFormat` with `maximumFractionDigits` per country; lock the locale string mapping per country code before any number renders.
4. **Accessibility.** Detailed Mode is data-dense. Requirement: WCAG AA contrast ratios, keyboard navigation for all formula expansions and sensitivity sliders, screen-reader labels on every computed number. Must be designed in, not retrofitted.

---

## 11. Build readiness assessment (May 2026)

### Engine and data layer — READY TO BUILD

All mathematical formulas are specified and corrected in §4 (4.1–4.22). The optimiser is a pure function: `(user_state, country_data) → Plan`. It can be built, tested, and validated independently of any frontend work.

**Test harness requirements (before any frontend):**
- Unit tests for every formula in §4 with hand-computed known answers
- Calibration tests: India EMI against HDFC calculator; US mortgage payoff against Bankrate; UK Plan 2 against SLC's own calculator — all must match within 0.5%
- Tax-shield regression: India old regime vs new regime; US itemiser vs standard-deduction filer — both must produce correct effective rates
- Central bank event tests: simulate a 25bps RBI cut, confirm all floating-rate EMIs recompute correctly

**Data ops to start immediately:**
- India top 30 bank data sheet (fields per §7): headline rates, processing fees, prepayment penalties, BT offers, minimum payment formulas, MAB
- USA top 15 lender data sheet (fields per §7): APR ranges, BT offers, origination fees, HYSA rates
- India tax table: old + new regime slabs, surcharge table, Sec 24/80C caps (§25 in brainstorm)
- USA tax table: 2024 federal brackets (MFJ + single), standard deduction, itemisation threshold
- Central bank calendars: RBI MPC 2024–25 schedule + Fed FOMC 2024–25 schedule
- CII table (India LTCG indexation): CBDT values through current FY
- EPF/PPF rates: current FY values

### Frontend — BLOCKED on 3 things

1. Visual language decision (open question 1 above)
2. Charts library selection (open question 2 above)
3. Wireframes for the 18 missing screens:
   - Onboarding: 6 steps (India/USA branching — tax regime for India, itemisation flag for USA, PF entry for India, 401k match for USA)
   - My Debts: list view + per-loan detail view
   - Plan screen: desktop layout (the most complex; month-by-month table + sensitivity sliders + strategy comparison + cash flow calendar strip)
   - 6 Tools sub-module screens
   - Insights screen
   - Settings screen

The 3 currently-built wireframes (Home × 3 mode combinations) are complete and correct.

### Suggested build sequence once unblocked

**Week 1–2:** Optimisation engine in Python. Core data structures, Layers 0–3, all formulas, unit test suite. No database, no API — pure function + tests.

**Week 3–4:** Country data store schema + seed data for India top 5 banks + US top 5 lenders. Validate engine against real-world loan scenarios from each institution.

**Week 5–6:** API gateway + user data model + plan storage. FastAPI endpoints: create-user, add-debt, generate-plan, update-plan, add-windfall.

**Week 7–8:** Frontend — Home screen (already wireframed) + Onboarding (requires wireframes first). Data input → plan generation → Home screen display.

**Week 9–12:** Remaining screens; Tools sub-modules; central bank event pipeline; notification system.

**Month 4:** Private beta with India users; India data ops running. US data ops running in parallel.

---

End of spec v2.0 (May 2026). All formulas complete and corrected. All open questions resolved or explicitly flagged. India + USA scope locked. Web-first locked. Ready to begin engine build.

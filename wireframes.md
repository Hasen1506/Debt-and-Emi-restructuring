# Debt & EMI Optimiser — Wireframes (web-first, desktop 1280px)

Each screen lists: **layout** (ASCII sketch), **data binding** (engine functions consumed), **components** (React composition), and **edge cases**.

Extends the mobile palette from `wireframes-home.html`. Primary layout breakpoint is **1280px desktop**; mobile (≤768px) re-stacks single-column.

Sequence below maps to the 18-screen Phase 1 set per spec §3.1–§3.6. Tools §8a-§8f account for 6 screens; onboarding for 6; the rest are core surfaces (Home Calm/Overwhelmed, Debts list, Debt detail, Plan desktop, Insights, Settings).

---

## 1. Home — Calm Mode (default)

```
┌────────────────────────────────────────────────────────────────────────┐
│ FinOptima   Debt & EMI         Home Debts Plan Tools Insights   [IN ₹]│
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Good evening, Hasen.                                                 │
│  You're on track. Debt-free by Aug 2027 at your current plan.         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ This month's action                                              │ │
│  │ Pay ₹18,500 extra toward your ICICI credit card                  │ │
│  │ Effective APR 42.48%. Clearing this saves ₹31,400 in interest.   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  Tools                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                              │
│  │ Bonus?   │ │ New EMI? │ │ Sell?    │                              │
│  └──────────┘ └──────────┘ └──────────┘                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                              │
│  │ Paid+?   │ │ Idle $?  │ │ Borrow?  │                              │
│  └──────────┘ └──────────┘ └──────────┘                              │
│                                          [+ Got a bonus?] (FAB)        │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `simulate_plan()` → debt_free_month, top-priority loan + extra suggested. Top action is `rank_loans()[0]` with `allocate_extra` output.
**Components** — `Card`, `ActionTile` × 6, FAB.
**Edge cases** — No debt: hide "this month's action", show "You're debt-free 🎉" card. If user under emotional-overload heuristic (>3 debts AND total > 6× monthly income), auto-flip to Overwhelmed Mode.

---

## 2. Home — Overwhelmed Mode

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Just do this one thing.                      │
│                                                                        │
│              Pay ₹18,500 to ICICI credit card today.                  │
│                                                                        │
│                       [I did it]   [Show me more]                     │
│                                                                        │
│           That's it. We'll tell you what's next tomorrow.             │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — same top-priority extra; one CTA only.
**Components** — single Card centered, two buttons.
**Edge cases** — "I did it" → triggers `quick_recompute()` flow on next screen; "Show me more" reverts to Calm Mode.

---

## 3. Onboarding 1 — Country & profile basics

```
┌────────────────────────────────────────────────────────────────────────┐
│ Step 1 of 6  ●○○○○○                                                   │
│                                                                        │
│   Where are you?                                                       │
│                                                                        │
│   ( ) India          ( ) USA                                          │
│                                                                        │
│   Your primary bank: [ HDFC Bank      ▾ ]                             │
│   Your location:     ( ) Urban  ( ) Semi-urban  ( ) Rural             │
│                                                                        │
│                                              [Continue →]              │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — sets `User.country`, `primary_bank`, `location_tier`. Bank dropdown sources from `rate_cards.ALL_INSTITUTIONS` filtered by country.
**Edge cases** — "I don't see my bank" → free-text fallback; defaults MAB to ₹0.

---

## 4. Onboarding 2 — Income & expenses

```
┌────────────────────────────────────────────────────────────────────────┐
│ Step 2 of 6  ●●○○○○                                                   │
│                                                                        │
│   Income & expenses (monthly)                                          │
│                                                                        │
│   I am:           ( ) Salaried   ( ) Business owner                   │
│   Monthly income: [ ₹            ]                                     │
│   Fixed monthly expenses: [ ₹    ]   ⓘ Rent, utilities, insurance     │
│   Annual hike rate:       [   % ]     (For salary growth projection)  │
│                                                                        │
│   IN: Tax regime  ( ) New (FY26-27 default)  ( ) Old                  │
│   US: Filing      ( ) Single  ( ) MFJ  ( ) HoH                        │
│                                                                        │
│                                              [Continue →]              │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — sets `User.income_type / monthly_income / fixed_expenses / annual_hike_rate / tax_regime / filing_status`.
**Edge cases** — Business owner triggers DSR (3× monthly EMIs reserve) logic in `compute_available_buffer`. Tax regime selector affects effective rate per `formulas.effective_rate`.

---

## 5. Onboarding 3 — Debts list

```
┌────────────────────────────────────────────────────────────────────────┐
│ Step 3 of 6  ●●●○○○                                                   │
│                                                                        │
│   Your debts                                                           │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ Home loan   HDFC          ₹40,00,000   8.5% floating   240 mo  ✏│ │
│   ├──────────────────────────────────────────────────────────────────┤ │
│   │ Credit card ICICI         ₹1,00,000   36%               12 mo  ✏│ │
│   └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│   [ + Add a debt ]                                                     │
│                                                                        │
│                                              [Continue →]              │
└────────────────────────────────────────────────────────────────────────┘
```

**Components** — `LoanRow` × N, "Add" modal: type / bank (rate-card prefill) / outstanding / nominal_rate / rate_type / tenure / scheduled_emi.
**Edge cases** — Picking bank auto-suggests rate range from `rate_cards.lookup_rate()`. Credit card with no scheduled_emi → simulator uses `compute_minimum_payment()`.

---

## 6. Onboarding 4 — Assets

```
┌────────────────────────────────────────────────────────────────────────┐
│ Step 4 of 6  ●●●●○○                                                   │
│                                                                        │
│   Assets you own  (optional — only those you might sell)              │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ Real estate · Mumbai land · purchased 2015 · ₹15,00,000 → 25L ✏ │ │
│   └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│   [ + Add an asset ]    [ Skip this step → ]                           │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `User.assets` for §8c asset liquidation tool. State + purchase_date drive LTCG split (`asset_liquidation.india_ltcg_tax`).
**Edge cases** — Skipping is fine — §8c just hides.

---

## 7. Onboarding 5 — Investments & PF

```
┌────────────────────────────────────────────────────────────────────────┐
│ Step 5 of 6  ●●●●●○                                                   │
│                                                                        │
│   Where could you invest a surplus instead of prepaying debt?         │
│                                                                        │
│   IN:  ☑ EPF  (8.25%, locked until retirement)                        │
│        ☐ PPF  (7.1%, locked 15 yr)                                    │
│        ☐ Liquid fund   ☐ FD   ☐ Nifty 50 index                       │
│   US:  ☐ 401(k) — Employer matches up to [   % ] @ [    % ]          │
│        ☐ HYSA   ☐ S&P 500 index                                       │
│                                                                        │
│   Years to retirement: [    ]                                          │
│                                                                        │
│                                              [Continue →]              │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `User.investment_options` (drives Layer 3 invest-vs-prepay gate). Employer match block → `EmployerMatch` for Layer 0.
**Edge cases** — Locked items are saved but `is_in_pool=False`. Liquid pool drives `prepay_recommended()`.

---

## 8. Onboarding 6 — Lenses & tone

```
┌────────────────────────────────────────────────────────────────────────┐
│ Step 6 of 6  ●●●●●●                                                   │
│                                                                        │
│   How should we frame your plan?                                       │
│                                                                        │
│   Strategy:                                                            │
│    ( ) Pure avalanche   (lowest interest, best math)                  │
│    ( ) Hybrid           (small wins first, then avalanche)            │
│    ( ) Snowball         (smallest balance first; pure behavioural)    │
│                                                                        │
│   Lenses:  ☐ Credit-score aware   ☐ Tax-year optimised                │
│            ☐ Cash-flow conservative   ☐ Income volatility             │
│                                                                        │
│                                              [Build my plan →]         │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — Strategy enum → `simulate_plan(strategy=...)`. Lenses toggle post-processing helpers.

---

## 9. My Debts — list

```
┌────────────────────────────────────────────────────────────────────────┐
│  Your debts                                  Total outstanding ₹41.8L  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ HDFC Home Loan          ₹40,00,000   8.5% floating  240 mo      │ │
│  │  Effective 8.50%  EMI ₹34,713  Tax shield: ₹0 (new regime)     ⓘ│ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ ICICI Credit Card       ₹1,00,000    36% fixed     [BT candidate]│ │
│  │  Effective 42.48%  Min ₹2,500  GST 18% on interest             ⓘ│ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ SBI Personal Loan       ₹80,000      13% fixed      36 mo       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  [ + Add a debt ]                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — list from `User.loans`; effective per-loan from `formulas.effective_rate`. BT/refi badges from `restructuring.scan_*`.

---

## 10. Debt detail

```
┌────────────────────────────────────────────────────────────────────────┐
│  ICICI Credit Card                          [Edit]  [Delete]           │
│                                                                        │
│  Outstanding              ₹1,00,000                                    │
│  Nominal APR              36.00%                                       │
│  Effective rate           42.48%   ← includes 18% GST on interest      │
│  Minimum this month       ₹2,500   ← ICICI three-way max formula      │
│  Plan suggests paying     ₹21,000  (₹2,500 min + ₹18,500 extra)       │
│                                                                        │
│  ┌───────────────────────────────────────────────────────────────────┐│
│  │ Restructuring offers detected                                    ││
│  │   • Balance Transfer to HDFC: 0% promo / 6 mo / 1.5% fee         ││
│  │     Effective BT APR: 3.0%. Saves ₹3,950 over 6 months. [Apply]  ││
│  └───────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `restructuring.scan_balance_transfer()` returns `BTCandidate` rendered as the offer card.

---

## 11. Plan — Desktop (the centrepiece)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Your plan                            Strategy: [ Pure avalanche ▾]    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                  Total debt over time                            │ │
│  │   ╮                                                              │ │
│  │     ╲╲╲  ← minimums-only (dashed grey)                          │ │
│  │        ╲╲╲                                                       │ │
│  │           ╲╲                                                     │ │
│  │  ───────────╲────────── avalanche (accent line)                  │ │
│  │                                                                  │ │
│  │  m0           m12          m24       Aug-27                      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  Debt-free   Total interest   Months saved   Total invested            │
│   Aug 2027    ₹2.4L (vs 4.1)   14            ₹68k                     │
│                                                                        │
│  What if…                                                              │
│  Surplus +/- [────●──────] ₹35k    Job-loss months [─●──] 0           │
│  RBI repo +/- [─────●────]  0bps   Strategy [Pure avalanche ▾]        │
│  Lump sum     [─●───────] ₹0       Apply to [— pick a debt —]         │
│                                                                        │
│  [Apply changes]   [Reset]                                             │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — Chart from `simulate_plan()` + `baseline_minimums_only()`. Sliders fire `sensitivity.with_*()` + `compare()`.
**Components** — `DebtTrajectoryChart` (already scaffolded), `SliderRow` × 5, `ScenarioStats` row.

---

## 12. Plan — Mobile

```
┌────────────────────────┐
│ Strategy [Avalanche ▾] │
├────────────────────────┤
│ Debt-free              │
│   Aug 2027             │
│                        │
│ ┌────────────────────┐ │
│ │  trajectory chart  │ │
│ └────────────────────┘ │
│                        │
│ Total interest ₹2.4L   │
│ Months saved   14      │
│                        │
│ What if…  [Open sliders]│
│  ↓ (expandable)        │
└────────────────────────┘
```

**Data binding** — same as desktop; sliders behind a single accordion.

---

## 13. Tools — dispatch grid

```
┌────────────────────────────────────────────────────────────────────────┐
│  Tools                                                                 │
│  Six single-decision modules. Each answers one question.              │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Windfall     │  │ New debt     │  │ Asset        │                 │
│  │ handler      │  │ check        │  │ liquidation  │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Quick        │  │ Cash yield   │  │ Right time   │                 │
│  │ recompute    │  │ check        │  │ to borrow    │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — pure navigation; no engine calls until child screens.

---

## 14. §8a — Windfall handler

```
┌────────────────────────────────────────────────────────────────────────┐
│  Got money. What now?                                                  │
│                                                                        │
│  Windfall amount  [ ₹ 50,000           ]                              │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Pay it to:  ICICI credit card                                   │ │
│  │                                                                  │ │
│  │  Why: highest effective rate (42.48%).                           │ │
│  │  This avoids ₹21,240 in interest over the next year.            │ │
│  │                                                                  │ │
│  │  [ Apply this allocation ]    [ Choose differently ]             │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ▾ Show your work                                                      │
│      • Eligible loans  → ICICI 42.48%, SBI 13%, HDFC 8.5%            │
│      • Layer 3 gate   → ICICI 42.48% − 4.6% > liquid 7% + 0.5%       │
│      • Layer 2 rank   → ICICI first by avalanche                     │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `decisions.allocate_windfall()`.
**Edge cases** — If output.invest_instead → flip the card to "Invest in <option>" with the same explanatory pattern.

---

## 15. §8b — New debt check

```
┌────────────────────────────────────────────────────────────────────────┐
│  Should you take this EMI?                                             │
│                                                                        │
│  Item                  [ iPhone 16 Pro              ]                 │
│  List price            [ ₹ 80,000                   ]                 │
│  Cash price elsewhere  [ ₹ 74,000                   ]   ⓘ Same item, │
│                                                          another store │
│  EMI tenure            [ 12   months  ]                               │
│  EMI monthly payment   [ ₹ 6,667                    ]                 │
│  Processing fee        [ ₹ 0                        ]                 │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Real APR: 16.2%  →  Verdict: PAY CASH                            │ │
│  │ The "no-cost" EMI is foregoing a ₹6,000 discount — that's the    │ │
│  │ hidden cost. Pay cash; replenish savings over 6 months.          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `decisions.evaluate_new_debt()` → `NewDebtVerdict`.

---

## 16. §8c — Asset liquidation

```
┌────────────────────────────────────────────────────────────────────────┐
│  Sell to clear debt?                                                   │
│                                                                        │
│  Asset            [ Mumbai land · 2015 · ₹15L → ₹25L ▾ ]              │
│  Sale price       [ ₹ 25,00,000                ]                       │
│  Debt to clear    [ ICICI card ₹1,00,000 @ 42.48% ▾ ]                 │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Verdict: DON'T SELL                                              │ │
│  │ Gate 1 net benefit:  ✓ (₹22.6L > 10% of asset)                   │ │
│  │ Gate 2 high rate:    ✓ (42.48% > 20%)                            │ │
│  │ Gate 3 spread:       ✗ (asset real return -2.7% vs land 8% etc.) │ │
│  │ → Selling a ₹25L asset to clear ₹1L of debt is friction without  │ │
│  │   payoff. Pay it from monthly surplus in 2–3 months instead.     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ▾ Show your work                                                      │
│      LTCG: pre-23-Jul-2024 — engine picks lower of (12.5% no idx) vs  │
│      (20% indexed with CII). Indexed wins; tax ~₹4.2L; net ₹19.6L.    │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — `asset_liquidation.india_ltcg_tax()` + `gate_check()`.

---

## 17. §8d — Quick recompute

```
┌────────────────────────────────────────────────────────────────────────┐
│  I just paid extra                                                     │
│                                                                        │
│  Loan           [ ICICI credit card ▾ ]                               │
│  Extra paid     [ ₹ 5,000              ]                              │
│                                                                        │
│                              [ Apply ]                                 │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Debt-free Aug 2027 → Jul 2027                                    │ │
│  │ Saved ₹3,200 in interest. Nice work.                             │ │
│  │                                                                  │ │
│  │     [ See the new schedule ]    [ Pay more ]                     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**Data binding** — re-runs `simulate_plan()` with the loan's outstanding reduced, then `decisions.quick_recompute()` diffs the two summaries.

---

## 18. §8e — Cash yield check + §8f Right-time-to-borrow + Insights + Settings

These four share the "one card + show your work" pattern from above. Compressed for brevity:

### 18a. Cash yield (§8e)
- Inputs: idle balance + current yield + (optional) override of best alt yield.
- Output: `decisions.cash_yield_check()` — alert card with annual_uplift and "beats top loan" badge.
- Skip-rule UI: if idle < ₹10k → grey-out card "Below threshold."

### 18b. Right-time-to-borrow (§8f)
- Inputs: current rate / 6m avg (prefilled from rate cards) / consensus bps / months to RBI/Fed meeting / urgency radio (now / 3m / 6m) / principal / tenure.
- Output: `decisions.right_time_to_borrow()` — verdict card with estimated_savings.

### 19. Insights
- Vertical feed of cards: rate-change notifications, monthly progress, educational tiles (Glossary at bottom). Already stubbed in `web/src/app/insights/page.tsx`.

### 20. Settings
- Country toggle, tax regime, currency, notification cadence, "Export plan as PDF" (Pro), Logout, Delete account.

---

## Implementation order

1. **Onboarding flow** (screens 3-8) — gates everything else; can be built top-down from `User` model.
2. **Debts list + detail** (9, 10) — read-only at first; "Add" form last.
3. **Plan desktop** (11) — chart already scaffolded; wire to simulate_plan via API later.
4. **Home Calm** (1) — depends on plan output for "this month's action."
5. **Tools** (13–18) — each Tool screen is independent; ship one at a time.
6. **Home Overwhelmed** (2) — heuristic-gated; ship after Calm is live.
7. **Insights, Settings** (19, 20) — last; mostly content.

Mobile variants for each (responsive, not separate routes) follow desktop.

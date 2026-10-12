# Silent defaults: what the app assumes, and what the person now chooses

Sprint G10, grill #22. The founder's question: "emergency fund target set as 6
months by default, but it's sort of important to be chosen by the user; how
much fund to divert to a goal, and so on. What else, and a way to identify
such cases?"

## The rule for telling them apart

A default is fine when a reasonable person could not do better without a
document (a tax table, a bank's formula) and the app cites it. A default is a
**choice** when two reasonable people would pick differently for reasons only
they know: how much risk they carry, how they feel about debt, what they plan.
Choices must be picked by the person. The test, for any new field: *would two
people with the same numbers want different values?* If yes, it's a choice:
no pre-selected answer, a required pick, and the profile records that it was
picked (`assumptions.confirmed`).

How to find new ones: `grep -rn "DEFAULT_" web/src/lib` and the `defaults`
block in `components/setup/QuickSetup.tsx` `buildUser()`. Every entry there
must be listed below, under one of the two headings.

## Now the person's choice (changed in sprint G10)

| What | Was | Now | Where |
|---|---|---|---|
| Emergency-fund target | Setup saved **0** (no fund) without asking; Profile's picker pre-selects "6 months, recommended" | Setup's last step asks: Not now / 3 / 6 / 12 months of spending, no pre-selection; saved with `assumptions.confirmed` | `components/setup/SetupChoices.tsx`, `lib/setup-choices.ts` |
| Share of spare cash to the fund while it fills | 30% (`DEFAULT_EF_SPLIT`) without asking | Asked when a fund is chosen: 20% / 30% / 50% / all of it | same |
| Payoff order | Avalanche (`DEFAULT_STRATEGY`) without asking | Asked at setup: Cheapest path / Smallest first / Your own order | same |
| How a new goal is funded | "Debt first" pre-selected | No rule pre-selected; the goal can't be saved until one is picked | `components/goals/GoalForm.tsx` |
| Share of spare cash to a goal | 25% pre-filled | Blank: the person types it | same |
| Growth of an asset in Sell to repay | 6% pre-filled, hidden under "+ MORE" | The person's own assumption for that kind of asset (or the app default) shown beside the answer as "your assumptions"; crypto and "something else" have no default and must be typed | `app/tools/liquidate/tool.tsx`, `lib/sale-calculator.ts` |
| Remittance cost on NRI prepay | Not counted | A field; blank says "not counted" in the answer | `app/tools/nri-prepay/tool.tsx` |

## Still a default (sourced, editable, or owned by another workstream)

| Default | Value | Why it can stay a default | Owner |
|---|---|---|---|
| India tax regime at setup | new (the statutory default regime) | Law's own default; G2 adds the yearly old-vs-new card and a confirm chip | G2 |
| US filing status at setup | single | Needs a confirm chip like the regime; recorded for G3 | G3 |
| Inflation rate | RBI / Fed forecast (`INFLATION_FORECAST`) | Sourced; G4 sets the update rule | G4 |
| Annual pay rise | 0 at setup | Conservative: no growth assumed; hike phases are opt-in on Plan | G2 (#79) |
| Location tier | urban | Only used for a few benchmarks | — |
| Prepay hurdle | +0.5 pt (`DEFAULT_PREPAY_HURDLE`) | Editable on Profile → Assumptions | G1 (#36) |
| Asset returns by type | `DEFAULT_ASSET_RETURNS` (ballpark, not sourced) | Editable on Profile → Assumptions; **should be sourced or made a choice**, see DECISIONS in the G10 answers | — |
| Selling costs by asset type | `DEFAULT_LIQUIDATION_COSTS` | Brokerage, STT, a jeweller's cut: published or typical costs, editable | — |
| Emergency-fund months on Profile's picker | 6 ("Standard") as the fallback (`DEFAULT_EF_MONTHS`) | Setup now asks first; Profile shows the saved choice. Its "6 months — recommended" label now reads "6 months of expenses" (G10) | — (ProfileClient is shared) |
| Rate type of a new loan | the usual type for its kind, marked "assumed" | Already labelled "Not sure (taken as …)" | — |
| Prepayment fee on a floating loan | 0%, citing RBI | A rule, not a choice; G1 adds the business-purpose question | G1 |
| Liquid-fund / HYSA yield for idle cash | `SAFE_RATES` from market-data.json | Sourced and dated | G9 |
| FX drift | last 20 years' trend (engine/cross_border.py) | Sourced (ECB rates), re-checked in G10 | G10 / G4 |

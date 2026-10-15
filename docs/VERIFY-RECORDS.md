# Facts and defaults waiting for the founder's check

A register of figures the app uses that are a founder default, an estimate, or
not found in the source we read. Each is tagged in code (`verify: true` or a
`VERIFY` comment) next to the value. When one is confirmed, record the source
and date on its line and remove the tag.

One entry per line, `VERIFY:` first, so these fold straight into
docs/FOUNDER-RECORDS.md (section (a), status Verify):
`VERIFY: #n <what> = <value in the app> | why: … | code: … | added: …`

VERIFY: #1 ICICI Bank credit card minimum due floor = ₹100 | why: kept (founder, 15 Oct 2026) but not in the ICICI MITC (w.e.f. 1 Mar 2026) read 14 Oct 2026; confirm from an ICICI card statement, or drop it | code: `engine/minimum_payments.py` INDIA_MIN_PAYMENT_FORMULAS["ICICI Bank"] (`verify: True`), FORMULA_SOURCE["ICICI Bank"]; `web/src/lib/min-payment.ts` | added: Round 2, 15 Oct 2026

VERIFY: #2 Rate-rise extension ceiling counted from today = 360 months | why: Aavas counts 360 months as the loan's whole tenor ("if tenor exceeds 360 months, then EMI/PEMI shall increase"); the engine doesn't know when a loan started, so it counts from today. A loan 5 years in could be stretched 5 years further than its lender allows | code: `engine/contract.py` ABSOLUTE_MAX_TENURE_MONTHS, extension_cap | added: Round 2

VERIFY: #3 Age limit for a tenure-first extension when no retirement age is given = 60 salaried, 70 otherwise | why: founder default; lenders' own maximum ages differ (SBI home loan "Max. Age: 70"); the borrower can edit it on Plan | code: `engine/contract.py` DEFAULT_RETIREMENT_AGE; `web/src/lib/plan-inputs.ts` DEFAULT_RETIREMENT_AGE | added: Round 2

VERIFY: #4 Non-home floating loans without a lender limit = not stretched (EMI rises) | why: founder rule says min(360, lender max, age); with no lender max typed for a floating personal loan / LAP the engine keeps the old W1 rule (raise the EMI) rather than allow 30 years | code: `engine/contract.py` extension_cap; `web/src/lib/plan-inputs.ts` ceilingLine | added: Round 2

VERIFY: #5 Assumed return after tax for the prepay / keep / split question = 6.5% India, 4% US (+1 point margin) | why: founder figures ("post-tax FD-like"), not read from a source; labelled as an assumption and editable on Plan ("Your return after tax"); Insights and Prepay/keep/split copy say so | code: `engine/prepay_invest.py` DEFAULT_ASSUMED_RETURN, SPLIT_MARGIN; `web/src/lib/plan-inputs.ts` | added: Round 2

VERIFY: #6 US → India transfer cost used in the NRI payoff order = 2.45% one-time | why: World Bank Remittance Prices, US→India $500 average, Q3 2025; re-read quarterly. Users with a cheaper provider should type theirs | code: `engine/cross_border.py` REMITTANCE_COST_DEFAULT; `web/src/lib/marginal-cost.ts` REMITTANCE_COST_DEFAULT | added: Round 2

VERIFY: #7 Advance tax for salaried users, capital gains rates = equity STCG 20%, equity LTCG 12.5% above ₹1.25 lakh, other gains at slab | why: rates from the Finance (No. 2) Act 2024 (s.111A / s.112A of the 1961 Act); the Income-tax Act 2025 section numbers for them were not confirmed this round; no surcharge on special-rate income is modelled | code: `engine/tax/advance_tax.py`; `web/src/components/onboarding/IncomeStreamsPanel.tsx` (Kind of gain labels) | added: Round 2

VERIFY: #8 Advance tax interest rounding = assessed tax rounded down to ₹100; part of a month = a month | why: Rule 119A of the Income-tax Rules 1962; the 2026 Rules' equivalent was not checked | code: `engine/tax/advance_tax.py` | added: Round 2

VERIFY: #9 Advance tax, salaried user with presumptive freelance income (44ADA / s.58) = whole advance tax by 15 March | why: the single-instalment rule is for an assessee declaring presumptive income; whether it covers the salary part too was not confirmed | code: `engine/tax/advance_tax.py`; `web/src/lib/salaried-advance-tax.ts` (freelance → presumptive unless "business_normal") | added: Round 2

VERIFY: #10 234B period in the "if you pay nothing" estimate = 1 April to 31 July (4 months) | why: assumes the return and self-assessment tax are paid by the 31 July due date for a non-audit individual | code: `engine/tax/advance_tax.py` | added: Round 2

VERIFY: #11 Seasonal reserve = opt-in (off unless the user turns it on); looks 12 months ahead; holds only when the coming year pays for itself and no open loan is as dear as card borrowing | why: founder asked for it opt-in with its interest cost shown; the 12-month look-ahead and the "year pays for itself" gate are engineering choices, not a published rule. "Lean months" on the API = months below the year's average (display only) | code: `engine/simulation.py` income_lookahead block; `api/routes/simulation.py` _seasonal_setup/_seasonal_out; `web/src/lib/seasonal-income.ts` | added: Round 2, 15 Oct 2026

VERIFY: #12 Seasonal pattern and a planned salary change together = the pattern is skipped (plan runs on the flat figure) and the page says so | why: engine rule (income_scenarios: salary changes go inside the path); a user with both would expect both. Decide whether to fold planned changes into the pattern | code: `api/routes/simulation.py` _seasonal_setup ("salary_change_planned") | added: Round 2, 15 Oct 2026

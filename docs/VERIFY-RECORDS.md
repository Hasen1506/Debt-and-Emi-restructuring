# Facts and defaults waiting for the founder's check

A register of figures the app uses that are a founder default, an estimate, or
not found in the source we read. Each is tagged in code (`verify: true` or a
`VERIFY` comment) next to the value. When one is confirmed, record the source
and date here and remove the tag.

| # | What | Value in the app | Why it needs a check | Where in code | Added |
|---|---|---|---|---|---|
| 1 | ICICI Bank credit card minimum due: floor | ₹100 | Kept (founder, 15 Oct 2026) but not in the ICICI MITC (w.e.f. 1 Mar 2026) read 14 Oct 2026. Confirm from an ICICI card statement, or drop it. | `engine/minimum_payments.py` INDIA_MIN_PAYMENT_FORMULAS["ICICI Bank"] (`verify: True`), FORMULA_SOURCE["ICICI Bank"]; `web/src/lib/min-payment.ts` | Round 2, 15 Oct 2026 |
| 2 | Rate-rise extension ceiling: 360 months counted from today | 360 | Aavas counts 360 months as the loan's whole tenor ("if tenor exceeds 360 months, then EMI/PEMI shall increase"); the engine doesn't know when a loan started, so it counts from today. A loan 5 years in could be stretched 5 years further than its lender allows. | `engine/contract.py` ABSOLUTE_MAX_TENURE_MONTHS, extension_cap | Round 2 |
| 3 | Age limit for a tenure-first extension when no retirement age is given | 60 salaried, 70 otherwise | Founder default. Lenders' own maximum ages differ (SBI home loan "Max. Age: 70"); the borrower can edit it. | `engine/contract.py` DEFAULT_RETIREMENT_AGE | Round 2 |
| 4 | Non-home floating loans without a lender limit are not stretched | no extension (EMI rises) | Founder rule says min(360, lender max, age); with no lender max typed for a floating personal loan / LAP the engine keeps the old W1 rule (raise the EMI) rather than allow 30 years. | `engine/contract.py` extension_cap | Round 2 |
| 5 | Assumed return after tax for the prepay / keep / split question | 6.5% India, 4% US (+1 point margin) | Founder figures ("post-tax FD-like"), not read from a source; labelled as an assumption and editable on Plan. | `engine/prepay_invest.py` DEFAULT_ASSUMED_RETURN, SPLIT_MARGIN | Round 2 |
| 6 | US → India transfer cost used in the NRI payoff order | 2.45% one-time | World Bank Remittance Prices, US→India $500 average, Q3 2025; re-read quarterly. Users with a cheaper provider should type theirs. | `engine/cross_border.py` REMITTANCE_COST_DEFAULT; `web/src/lib/marginal-cost.ts` REMITTANCE_COST_DEFAULT | Round 2 |
| 7 | Advance tax for salaried users: capital gains rates | equity STCG 20%, equity LTCG 12.5% above ₹1.25 lakh, other gains at slab | Rates from the Finance (No. 2) Act 2024 (s.111A / s.112A of the 1961 Act); the Income-tax Act 2025 section numbers for them were not confirmed in this round. No surcharge on special-rate income is modelled. | `engine/tax/advance_tax.py` | Round 2 |
| 8 | Advance tax interest rounding | assessed tax rounded down to ₹100; part of a month = a month | Rule 119A of the Income-tax Rules 1962; the 2026 Rules' equivalent was not checked. | `engine/tax/advance_tax.py` | Round 2 |
| 9 | Advance tax: a salaried user with presumptive freelance income (44ADA / s.58) | whole advance tax by 15 March | The single-instalment rule is for an assessee declaring presumptive income; whether it covers the salary part too was not confirmed. | `engine/tax/advance_tax.py` | Round 2 |
| 10 | 234B period in the "if you pay nothing" estimate | 1 April to 31 July (4 months) | Assumes the return and self-assessment tax are paid by the 31 July due date for a non-audit individual. | `engine/tax/advance_tax.py` | Round 2 |

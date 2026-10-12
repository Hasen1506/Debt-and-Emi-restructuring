# US market rules (sprint G3)

What RightDue models for US borrowers, why, and where each rule comes from.
Code: `engine/us_loans.py` (engine), `web/src/lib/us-loans.ts` (its TypeScript
twin), `engine/tax/usa.py` (SALT). The differential fixture
`engine/tests/fixtures/us_loan_cases.json` (made by
`python scripts/export_us_loan_cases.py`) keeps the two equal; the engine test
fails when the fixture is stale and `web/tests/us-market.cjs` fails when the
TypeScript differs. All sources read **2026-10-12**; re-check each July (new
federal student-aid rules start 1 July) and each October (IRS inflation
figures for the next tax year).

## Federal student loans (grill #33)

| Rule | What the app does | Source |
| --- | --- | --- |
| Federal vs private matters: federal loans have income-driven plans, PSLF, deferment and forbearance; refinancing them with a private lender gives all of that up. | Each US student loan is marked **federal**, **private** or **not sure**. Not sure is treated as federal. A federal or unmarked loan is never put into a private refinance or consolidation; when a private rate is lower the scan lists it under "looked at, not worth it" with the reason. | CFPB, https://www.consumerfinance.gov/paying-for-college/repay-student-debt/federal-and-private-student-loans |
| PSLF forgives the rest after 120 qualifying payments while working full time for a government or qualifying not-for-profit employer; Direct Loans only; Tiered Standard payments don't count. | A loan marked **PSLF** gets its required payment and no extra (extra would only shrink a tax-free forgiveness). Same gate in the plan and in the one-off "spare cash" split. | https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service |
| IDR after the One Big Beautiful Bill Act (P.L. 119-21): RAP (1–10% of AGI ÷ 12, minus $50 per dependent, 30 years) open since 1 July 2026; IBR 20/25 years; ICR and PAYE end by 1 July 2028; loans first disbursed on or after 1 July 2026 can use only RAP or Tiered Standard; SAVE ended by court order 10 March 2026. | A loan marked **IDR forgiveness** is held off extra payments like PSLF. The loan card explains the 2026 plans in plain words. RAP payments themselves are not calculated (the user enters the payment their servicer bills). | https://studentaid.gov/manage-loans/repayment/plans/income-driven, https://studentaid.gov/announcements-events/big-updates |
| IDR forgiveness after 31 Dec 2025 is generally taxable income (the ARPA exclusion expired); PSLF, Teacher Loan Forgiveness, death and disability discharges are not. | Said on the loan card for IDR-track loans ("set some money aside for it"). Not modelled as a cash event. | IRS Taxpayer Advocate, https://www.taxpayeradvocate.irs.gov/news/tax-tips/what-to-know-about-student-loan-forgiveness-and-your-taxes/2026/03; IRS Pub 4681 |

Already in place before this sprint: the §221 student-loan interest deduction
($2,500, 2026 phase-out $85k–$100k single / $175k–$205k joint, Rev. Proc.
2025-32 §4.29) and interest capitalised during a deferment before the first
payment.

## Mortgage insurance and escrow (grill #34)

| Rule | What the app does | Source |
| --- | --- | --- |
| PMI (loans closed on or after 29 July 1999): ask in writing to cancel when the balance reaches 80% of the original value (sooner by paying extra); automatic end when the balance is *scheduled* to reach 78%; final end at the midpoint. Original value = the lower of price and appraisal at purchase (the appraisal at refinancing if refinanced). Conditions: good payment history, no junior liens, value not fallen. | The mortgage takes a monthly PMI amount and the original value. The plan pays PMI each month as a cost (it lowers spare cash) until the balance is at or below 80%, assuming the user asks then, and reports the month as a lifecycle event (`pmi_events` on `/api/simulate`). The loan card shows when PMI can end, the extra that ends it now, and that extra's yearly return (annual PMI ÷ extra) on top of the interest it saves. | CFPB, https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/ |
| FHA annual MIP (case numbers from 3 June 2013): 11 years if the loan was 90% or less of value, else the loan term (max 30 years). | FHA MIP is not dropped at 80%/78%; it runs for the months the user enters, or for the loan's life. | HUD, https://answers.hud.gov/FHA/s/article/How-long-is-MIP-collected-for-case-numbers-assigned-on-or-after-June-3-2013 |
| PMI is deductible as mortgage interest again for 2026 (itemisers; phased out above $100,000 AGI, none above $109,000). | Stated on the card; not in the tax maths (would need AGI and itemising detail per year). | IRS Pub 936 (2026 draft), https://www.irs.gov/pub/irs-dft/p936--dft.pdf |
| Escrow (property tax + home insurance collected with the payment). | The card tells the user to enter principal + interest as the payment, escrow in fixed expenses, PMI in its own field. | — |

## State tax on mortgage interest (grill #79)

The app's marginal rate is federal + state. For a mortgage that is right only
where the state taxes income *and* allows the deduction.

| State group | Treatment | Source |
| --- | --- | --- |
| AK, FL, NV, NH, SD, TN, TX, WA, WY | No state income tax on wages (NH's interest and dividends tax repealed from 1 Jan 2025; WA taxes only capital gains): mortgage interest saves federal tax only. **Modelled.** | Tax Foundation 2026, https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/; NH DRA |
| PA | No itemised deductions at all: federal only. **Modelled.** | PA DOR, https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/deductions-and-credits |
| MA | Doesn't adopt the IRC §163 interest deduction except for rental/business debt: federal only. **Modelled.** | MA DOR Directive 86-8, https://www.mass.gov/directive/directive-86-8-interest-expenses |
| Every other state | Not verified from a primary source in this sprint. The plan keeps the state rate in the mortgage's tax saving and **labels** it "state rules vary, check your state". | — |

Where modelled, the state rate is taken out of the mortgage's tax saving in
the payoff order (`engine/marginal_cost.py::_home_rate`, mirrored in
`web/src/lib/marginal-cost.ts`). The user picks their state on Profile.

## SALT cap

IRC §164(b)(7), added by P.L. 119-21 §70120 (https://www.law.cornell.edu/uscode/text/26/164):
$40,000 for 2025, $40,400 for 2026, then 101% a year to 2029, $10,000 from
2030. Phase-down: 30% of MAGI above $500,000 (2025), $505,000 (2026), then
101% a year, never below $10,000; married filing separately half of each.
`salt_cap_for_year(year, magi, married_separately)` implements the schedule;
the statute gives no rounding for the 101% years, so none is applied (replace
with IRS's published figures when they appear). The deductions form copy now
states the 2026 cap (it said $10k).

## Not done / later
- RAP payment calculation and a "PSLF vs pay off" comparison: needs AGI,
  family size and qualifying-payment count; worth a tool of its own.
- PMI's marginal value in the payoff *order*: the plan's cash flow drops PMI
  correctly, but the avalanche order still ranks the mortgage by rate alone.
- The other 40 jurisdictions (39 income-tax states + DC) for mortgage interest: each needs its
  revenue department's current instructions.

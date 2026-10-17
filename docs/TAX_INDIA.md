# India tax rules the app uses (tax year 2026-27)

Sprint G2 (india-tax). Every rule below was read in the primary text on **12 Oct 2026**:

- **Income-tax Act, 2025 (30 of 2025) as amended by the Finance Act, 2026**, Income Tax Department:
  https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf
- **Finance Act, 2026, First Schedule** (rates for tax year 2026-27 are Part I-B, "Income-tax under the Income-tax Act, 2025"):
  https://www.incometaxindia.gov.in/w/first-schedule-104
- **Finance Bill, 2026**, clause 2(4)(b) Table Sl. 10 (new-regime surcharge tops out at 25%):
  https://www.indiabudget.gov.in/doc/Finance_Bill.pdf

The 2025 Act replaced the 1961 Act from 1 April 2026 and renumbered almost everything. "Tax year 2026-27" is what used to be
"previous year 2026-27 / assessment year 2027-28". The return for FY 2025-26 (filed in 2026) still uses the 1961 Act.
Code: `engine/tax/india.py` (`SECTION_MAP`, the caps, `compare_regimes`), mirrored in `web/src/lib/regime-compare.ts`,
`india-tax-loans.ts`, `marginal-cost.ts`, `tax-projection.ts`; tables exported to `web/src/lib/tax-tables.json`.

## Section map (1961 → 2025)

| What | 1961 Act | Income-tax Act 2025 |
|---|---|---|
| Home-loan interest | 24(b) | 22(1)(b); caps in 22(2), aggregate 22(5) |
| Pre-construction interest, 5 instalments | Explanation to 24(b) | 22(1)(c) |
| 30% standard deduction on rent | 24(a) | 22(1)(a) |
| Self-occupied: annual value nil (2 houses) | 23(2) | 21(6), 21(7) |
| Co-owners each get the relief | 26 | 24 |
| House-property loss set-off ₹2L | 71(3A) | 109(1)(b) |
| 80C (₹1.5L, incl. home-loan principal) | 80C | 123 read with Schedule XV (para 1(r), 3, 4) |
| NPS | 80CCD | 124 |
| Health insurance | 80D | 126 |
| Education-loan interest | 80E | 129 |
| Rebate | 87A | 156 |
| New regime (default) | 115BAC | 202; option 202(4) |
| Standard deduction (salary) | 16(ia) | 19(1) Table Sl. 2 |
| Return due date | 139(1) | 263(1) |

## Rules, as the Act words them

- **New-regime slabs** — s.202(1) Table: nil to ₹4L; 5% to ₹8L; 10% to ₹12L; 15% to ₹16L; 20% to ₹20L; 25% to ₹24L; 30% above.
- **What the new regime takes away** — s.202(2)(a): no s.19(1) Sl. 1 (professional tax); no **s.22(1)(b) for properties in s.21(6)**
  (self-occupied interest); no Chapter VIII deduction except s.124(1), 124(2), 125(2), 146. s.202(2)(b)(ii): no set-off of a
  house-property loss against any other head. A let-out home's interest still comes off its rent.
- **Switching** — s.202(4): the new regime applies unless the person opts out "in such manner as may be prescribed". With income
  from business or profession: opt out on or before the s.263(1) due date; the option carries to later years; it "may be withdrawn
  only once"; after that the person "shall never be eligible to exercise the option … except where such person ceases to have any
  income from business or profession". Without business income: the option is made "along with the return of income" each year.
  (Secondary sources report that Rule 136 of the Income-tax Rules 2026 moves the business-income option into the return itself,
  replacing Form 10-IEA; not read in the Rules text in this sprint.)
- **Old-regime slabs** — First Schedule Part I-B, Paragraph A: nil to ₹2.5L, 5% to ₹5L, 20% to ₹10L, 30% above; 60–79: nil to ₹3L;
  80+: nil to ₹5L, 20% to ₹10L, 30% above. Surcharge 10% / 15% / 25% / 37% above ₹50L / ₹1Cr / ₹2Cr / ₹5Cr with marginal relief;
  new regime capped at 25%. Cess 4%.
- **Rebate** — s.156(1): resident, total income ≤ ₹5L, up to ₹12,500 (old). s.156(2): new regime, ≤ ₹12L, up to ₹60,000, with
  marginal relief just above ₹12L (s.156(2)(b)).
- **Standard deduction** — s.19(1) Table Sl. 2: ₹75,000 (or the salary, if less) under s.202(1); ₹50,000 otherwise. Salary only.
- **Home-loan interest cap** — s.22(2): for s.21(6) (self-occupied) properties, the deduction under s.22(1)(b) **and (c)** (the
  "(c)" was added by the Finance Act 2026, w.e.f. 1-4-2026) can't exceed ₹2,00,000 if the house was acquired or built with the loan
  within 5 years from the end of the tax year of borrowing (and the lender's certificate is held); ₹30,000 in any other case.
  s.22(5): ₹2,00,000 in aggregate across such properties.
- **Pre-construction interest** — s.22(1)(c): interest for the period before the tax year of acquisition/construction, "in five
  equal instalments for the said tax year and for each of the four immediately succeeding tax years".
- **Co-owners** — s.24(1): co-owners with definite shares are assessed separately on their share; s.24(2): the s.21(6) relief "as if
  each co-owner is individually entitled". So each co-owning co-borrower claims their own share of interest, each up to ₹2L, and
  their own principal inside their own ₹1.5L.
- **Set-off** — s.109(1)(b): a house-property loss is set off against other heads only up to ₹2,00,000; s.110 carries the rest
  forward against house-property income (not modelled).
- **80C / s.123** — ₹1,50,000 across Schedule XV items; para 1(r) "payment made for purchase or construction of a residential house
  property"; para 3(a)(iii): repayment of a loan from the Central/State Government, a bank (incl. co-operative bank), LIC, NHB, a
  housing finance public company, a public company or co-operative society financing houses, or certain employers; para 3(b)(iii)
  excludes anything deductible under s.22 (so interest isn't double-counted); para 4 / Table Sl. 3: sale within 5 years from the
  end of the tax year of possession reverses the deductions already taken.
- **80E / s.129** — interest on a loan from a financial institution (a bank, or one notified) or an approved charitable
  institution, for higher education of self or a relative (spouse, children, a student one is guardian of), paid from taxable
  income; allowed for "the initial tax year and seven tax years immediately succeeding", or until paid, if sooner. "Initial tax
  year" = the year interest is first paid. No cap.

## What the app does with them

- Each loan's tax shield (`engine/formulas.tax_shield_fraction`, `engine/marginal_cost.marginal_shield`, TS twins):
  self-occupied home — old regime only, the user's share (`tax_share`), one ₹2L pool across homes including this year's
  pre-construction instalment, ₹30k when `sec24_full_cap` is false; let-out — rent × share × 70% plus the remaining ₹2L set-off
  (old) or nothing more (new), "simplified" when no rent is given; education — old regime, share, and off once
  `tax_deduction_months_left` runs out (the web derives it from `edu_interest_start` every plan run).
- The Tax page (`/tax`) compares the regimes for this tax year with the loans counted (`compare_regimes`), shows the switching
  rule for the user's income mix, a home-loan what-if, each loan's inputs and the 80C room a home-loan prepayment can use.
- Interpretation to confirm: s.202(2)(a)(v) names only s.22(1)(b) for self-occupied homes. The app also gives no new-regime
  deduction for a self-occupied home's pre-construction instalments (s.22(1)(c)), as under the 1961 Act, where they were part of
  24(b). A footnote marker on clause (v) in the Department's consolidated text suggests the Finance Act 2026 touched it; read the
  amendment before relying on either reading.
- Not modelled: employer NPS (s.124(2)), capital gains and other special-rate income, agricultural income, house-property loss
  carried forward, HRA's least-of-three rule (the user enters the claim), 80D for parents, the 80+/60–79 split when only "60+" is
  known (the 60–79 table is used: it never understates old-regime tax).

## Refresh

Re-read the Act and the Finance Act each February (Budget) and when the Finance Act is notified (usually late March); update
`engine/tax/india.py`, run `python scripts/export_tax_tables.py` and `python scripts/export_regime_cases.py`, and update the
`TAX_LAW_AS_OF` date.

## Audit 80 (W2, 14 Oct 2026)

- **One ₹2L set-off (s.109(1)(b)).** A let-out home's loss gets only what is left of the ₹2L after self-occupied homes (engine `country_cap_home_loan(set_off_used)`, web `computeBreakdown(..., allLoans)`); both now agree with `compare_regimes`.
- **Forward vs total cost.** Payoff order, windfall and refinance/BT ranking use the forward rate (marginal shield, no sunk fees: `marginal_cost.user_forward_rates`); `formulas.effective_rate` is "what this loan costs in total" (True APR) only.
- **80C principal (s.123 + Schedule XV).** Old regime, when the user gives their other 80C items: while the year's ₹1.5L room is open, prepaying home-loan principal also saves marginal-rate tax that year; the plan tracks it per tax year (April reset).
- **Bracket from take-home.** With no gross pay on file, gross is solved from take-home everywhere (QuickSetup, life events, US MAGI), and labelled estimated.
- **Rate labels.** "30% slab + 4% cess = 31.2%", "No income tax on your pay (new regime)": never a bare "26.0%" or "0.0%".
- **Advance tax.** s.408(1) 15/45/75/100%; s.408(2) presumptive (s.58(2) Sl. 1/3, old 44AD/44ADA) one instalment by 15 March; s.425 [234C] 1% a month for 3/3/3/1 months on each cumulative shortfall, none for June at 12% or September at 36%; remaining instalments re-cut when the year's estimate moves > 10%. Source: incometax.gov.in e-filing help "Tax payments" FAQ 19; incometaxindia.gov.in/w/advance-tax-5 (read 14 Oct 2026).

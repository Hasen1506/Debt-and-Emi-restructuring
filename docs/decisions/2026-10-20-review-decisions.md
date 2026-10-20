# Decisions taken in the PR #90 / #93 review (20 Oct 2026)

Taken on the founder's behalf during the review of #90 and #93, and shipped in #94. Each one names the rule, why, and where it lives in the code, so it can be revisited.

## 1. A blank "Is this loan for a business?" answer

**Decision.** A blank answer still means a personal loan for home, auto, personal, education, two-wheeler, medical, home top-up and pay-later loans, so a floating-rate loan from an RBI-regulated lender is charged 0. For a **loan against property** and a **gold loan** a blank answer is "not known" when the purpose can change the fee: the form asks, and a typed or Key Facts Statement fee is kept. When the law is 0 whichever way the question is answered, the fee is 0 and a stored figure is ignored.

**Why.** Most people using the app have personal loans, and asking everyone would undo "ask each fact once". A loan against property or a gold loan is often taken for a business, where RBI lets many lenders charge, so silently zeroing a stored fee there would be wrong. That exception stops where both answers are already 0: a commercial bank from 2026 (Directions para 5(i) and 5(ii)(a)), a regional rural bank or co-operative bank before 2026 (the May 2014 circulars below, which were not limited to non-business loans), and a small finance bank, regional rural bank or HFC from 2026 when the sanctioned amount is ₹50 lakh or less (para 5(ii)(b)).

**Code.** `BUSINESS_CAPABLE_TYPES` in `engine/prepayment_fee.py` and `web/src/lib/prepayment-fee.ts`.

## 2. Floating-rate personal loans sanctioned before 2026

**Decision.** 0 for commercial banks, small finance banks, NBFCs, HFCs, regional rural banks, co-operative banks and an unknown lender. From 2026 every one of them is still 0 for a personal loan (2025 Directions, para 5(i), which applies to every entity in para 4).

**Why.** Checked against the circulars RBI still publishes, and against the annex of the 2 July 2025 Directions (the annex is what stays in force for loans sanctioned before 2026).
- Commercial banks, excluding regional rural banks: DBOD.Dir.BC.No.110/13.03.00/2013-14, 7 May 2014, no foreclosure charge on any floating-rate term loan to an individual borrower. DBR.Dir.BC.No.08/13.03.00/2019-20, 2 August 2019, addressed to scheduled commercial banks excluding RRBs, small finance banks and local area banks, limits that bar to purposes other than business. A personal loan stays at 0.
- NBFCs: DNBS(PD).CC.No.399/03.10.42/2014-15, 14 July 2014, the same "all floating-rate term loans to individual borrowers" rule. DNBR (PD) CC.No.101/03.10.001/2019-20, 2 August 2019, limits it to purposes other than business. A personal loan stays at 0.
- HFCs: the rule now in force before 2026 is paragraph 85.7 of the HFC Master Direction: no foreclosure charge on a floating-rate term loan sanctioned for purposes other than business to an individual borrower. That replaced NHB(ND)/DRS/Policy Circular No.63/2014-15, 14 August 2014 (all floating-rate term loans to individual borrowers; clarified by Policy Circular 66, 3 September 2014). The 2010–2012 NHB housing-loan instructions (Pol-No.36/2010, Pol.No.43/2011-12, Pol.No.51/2012-13) cover housing loans only. Citing "NHB 2012" as the reason every HFC personal loan is 0 was too narrow; the outcome for a personal loan is still 0.
- Regional rural banks, and state and central co-operative banks: RPCD.CO.RCBD.RRB.BC.No.102/07.51.013/2013-14, 27 May 2014. Urban co-operative banks: UBD.CO.BPD.PCB.Cir.No.64/12.05.001/2013-14, 26 May 2014. Both say the bank will not be permitted to charge foreclosure charges on all floating-rate term loans sanctioned to individual borrowers. The 2 August 2019 non-business clarification was not addressed to them, and the 2025 annex still lists these May 2014 circulars rather than a later narrowing. Asking, on the footing that no instruction covered them, was wrong. A personal loan is 0, including when the sanction year is missing. A business-purpose loan to an individual from one of these lenders is 0 before 2026 for the same reason; from 2026 it follows para 5(ii).
- An unknown lender stays at 0 because every RBI-regulated type above is 0 for a personal floating loan. A lender marked as outside RBI's directions stays "not known".

**Code.** `PRE_2026_ALL_INDIVIDUAL` in both rule files. The old `PRE_2026_UNCOVERED` set is gone.

## 3. One "spare" figure

**Decision.** Home uses the same spare figure as Cash flow's LEFT (take-home − spending − due). When part of it is set aside, Home names both parts: "₹28,304 is spare after the amount due: ₹8,304 is set aside and ₹20,000 is not added on top."

**Why.** There should be a single source of truth. Two different numbers both called "spare" on two screens reads as a bug.

**Code.** `homeThisMonthLine` in `web/src/lib/home-this-month.ts`.

## 4. Smaller calls made while fixing bugs

- **Fallback for no stored debt-budget choice.** It reads as "not chosen yet" (`'unset'`), not "all spare cash" (`web/src/lib/pay-this-month.ts`).
- **Cash flow LEFT note.** It gives the reason that matches the monthly total: all spare cash, a set total, or EMIs only.
- **Lender type.** The API accepts only the known lender types; anything else is a 422 (`api/schemas.py`).
- **The plan engine doesn't change its inputs.** It applies the RBI zero to copies of the loans (`engine/simulation.py`).
- **Loans from people at a fixed amount of interest.** That amount is charged every month until the loan is cleared. It does not shrink as the balance falls (`fixed_monthly_interest`). Ranking still uses today's-balance equivalent rate.
- **Share link.** It shows only the kind of loan (e.g. "Home loan"), never a nickname or lender name. A public view no longer writes to the database.
- **Spending cookie.** The logged-spending cookie keeps only the latest 24 months.
- **Change log.** It records "Logged spending" only for a new entry, not a delete.

## 5. Calls made while fixing the full-codebase review

- **Is a prepayment fee worth paying?** The plan checks this against the loan's minimum-payment schedule, not one that assumes extra payments keep landing. The old check stopped prepaying costly loans and could double the interest.
- **Interest-only loans.** The payment follows a rate change both ways, so a cut lowers it too.
- **Part-payment limit.** Two extra payments into the same loan in the same month count as one part-payment, so a small extra no longer blocks a larger one for the whole window.
- **Advance tax.** The s.87A rebate is judged on total income including equity gains. When gains push total income past the limit, the slab tax on salary is counted and the user is told salary TDS may fall short.
- **Penal charges on loan against property and home top-up.** They follow the home-loan GST treatment, the same as their other defaults. The underlying "home loan penal charges are GST-exempt" premise still needs checking against GST rules.
- **Profile tenure box.** A blank or invalid months box goes back to the derived tenure instead of saving 0.

## 6. Calls made in the second full-codebase pass

- **Capital-gains surcharge.** Capped at 15% for long-term gains on every asset type (Finance Act 2022), not 25%.
- **US collectible gains (gold).** Taxed at the ordinary rate, capped at 28% (s.1(h)(4)).
- **Card balance in credit.** A credit-report balance shown as negative or "CR" counts as nothing owed.
- **US CD early-withdrawal penalty.** The 1% figure is the India FD default, so on a US CD it still means "not set". An entered 0% is now kept.
- **Default "today".** API tools use the India date. US collection letters use the New York date.
- **Cards in another currency.** They can't be merged into one consolidation loan in the user's currency.
- **US underpayment penalty.** About 8% a year (Form 2210), not India's 1% a month.

## 7. Advance tax: s.87A marginal relief with share gains (new regime)

**Decision.** When total income, including equity STCG/LTCG, is above Rs 12L, the tax on total income (slab tax plus the special-rate tax on gains) may not exceed the income above Rs 12L. The relief can't be more than the slab tax, so the special-rate tax on the gains is never reduced. In effect the tax is max(income above Rs 12L, special-rate tax), whenever that is lower than the full tax. The rebate itself still applies only to slab tax when total income is Rs 12L or less.

**Why.**
- The Finance Act 2025 amendment to s.87A adds a second proviso: the deduction "shall not exceed the amount of income-tax payable as per the rates provided in sub-section (1A) of section 115BAC" (the slab rates).
- The Income Tax Department's FAQ says the rebate is not available on special-rate income.
- A worked practitioner example (CA Club India, Aug 2026: salary Rs 11.8L + LTCG Rs 40k) gives Rs 20,000, which this rule reproduces. A second check (Rs 11.5L slab + Rs 1L STCG) gives Rs 50,000 before cess.
- Some commentators (TaxGuru) say marginal relief doesn't apply to special-rate income at all. That reading taxes more. The statutory proviso supports the reading above, so this was settled without needing Twitter or Reddit.

**Code.** `engine/tax/advance_tax.py` (`salaried_advance_tax`).

## 8. Smaller calls in the final fix pass

- **A saved exchange rate keeps its own date** (from `fx_meta`), not today's. When the date is unknown, it is shown simply as "your saved rate".
- **A reply dated before the bank received the complaint is rejected.** The letters fuzz test now generates replies on or after receipt.
- **A gold loan with a blank business answer is asked** (decision 1). The shared fee table and its tests were regenerated to match.
- **Goals cookie format.** Tests read the compressed `z1.` goals cookie; the formatter baseline was updated for three data (not display) `toFixed` calls.

# Decisions taken in the PR #90 / #93 review (20 Oct 2026)

Taken on the founder's behalf during the review of #90 and #93, and shipped in #94. Each one names the rule, why, and where it lives in the code, so it can be revisited.

## 1. A blank "Is this loan for a business?" answer

**Decision.** A blank answer still means a personal loan for home, auto, personal, education, two-wheeler, medical, home top-up and pay-later loans, so a floating-rate loan from an RBI-regulated lender is charged 0. For a **loan against property** and a **gold loan** a blank answer is "not known": the form asks, and a typed or Key Facts Statement fee is kept.

**Why.** Most people using the app have personal loans, and asking everyone would undo "ask each fact once". A loan against property or a gold loan is often taken for a business, where RBI lets many lenders charge, so silently zeroing a stored fee there would be wrong.

**Code.** `BUSINESS_CAPABLE_TYPES` in `engine/prepayment_fee.py` and `web/src/lib/prepayment-fee.ts`.

## 2. Floating-rate personal loans sanctioned before 2026

**Decision.** 0 for commercial banks, small finance banks, NBFCs, HFCs and an unknown lender. **Asked** for regional rural banks and co-operative banks when the loan was sanctioned before 2026 or the year is not given. From 2026 every one of them is 0 (2025 Directions, para 4).

**Why.**
- Banks: DBOD.Dir.BC.No.110/13.03.00/2013-14, 7 May 2014. It excludes regional rural banks.
- NBFCs: DNBS(PD).CC.No.399/03.10.42/2014-15, 14 July 2014.
- HFCs: NHB 2012 instructions.
- Co-operative banks and RRBs: no earlier instruction was found that clearly covers them, so the app does not assume the charge is barred.
- An unknown lender stays at 0 because nearly every loan in the app is from a bank, NBFC or HFC.

**Code.** `PRE_2026_UNCOVERED` in both rule files.

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

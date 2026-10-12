# Bottlenecks

Known limits we have chosen to live with for now, and what would remove them.

## Legal review (privacy notice, terms, data handling) — sprint G8

No lawyer has checked the privacy notice (`/privacy`), the terms (`/terms`)
or docs/privacy-and-retention.md. Both pages say so. The alternative in place:
every legal statement cites the DPDP Act 2023 or DPDP Rules 2025 section it
rests on, read from the primary text on meity.gov.in (12 Oct 2026), and a test
(web/tests/g8-security-privacy.cjs) checks the notice still covers the items
rules 3, 9 and 14 ask for. **The right option** is a privacy lawyer's review
before 14 May 2027, when most DPDP duties apply, or before any paid tier.

## Processor contracts — sprint G8

DPDP Act s.8(2) asks for a valid contract with each Data Processor (Neon,
Render, Cloudflare, Resend, Sentry if used). We rely on each provider's
standard terms and data processing addendum; nothing has been reviewed or
signed specifically.

Known limits we've chosen to live with for now, and what would remove each.
Other sprint workstreams add their own sections; keep one heading per item.

## Exact payoff-order search optimises noise (grill #37, founder: "let it be as is, record it")
`engine/fee_order.py` tries every payoff order for up to 5 loans (120 simulator
runs) when a loan has a prepayment fee, and keeps a different order if it's
cheaper by more than `TIE` = ₹1 / $1. Inputs are user-typed balances and rates
that are often off by 5% or more, so a ₹1 win is within the error of the
inputs. On Render's free instance (a fraction of a CPU) 120 runs that take
about 11 ms each locally can add seconds to a page load.
- Kept as is (founder decision, 2026-10-12).
- What would remove it: change the order only when it saves more than
  max(₹500, 0.5% of the plan's interest) and otherwise say "within rounding";
  or cache the search per profile version; or move to a paid instance.

## Card minimum due: formulas are estimates (grill #26)
The issuer formulas in `engine/minimum_payments.py` / `web/src/lib/min-payment.ts`
have no published source on file (`FORMULA_SOURCE[...]["verified"] = False`).
The app labels them "estimated" and asks for the statement's Minimum Amount
Due. The founder doesn't want statement uploads, so the options to improve on
typing it once are: the bank's bill SMS parsed by G6's SMS parser ("Min Amt Due
Rs X"), Account Aggregator data (G6 research), or sourcing each issuer's MITC
PDF with a date and a refresh check.

## Unknown prepayment fees (grill #29)
No integration returns a loan's prepayment fee: Account Aggregator shares
balances and transactions, not agreement terms, and credit reports don't carry
it. The fee is user-typed or read from the KFS. `fee_order.unknown_fee_check`
asks only when a 4% (+GST) illustrative fee would change where the extra goes.

## GST clause text not re-read from CBIC (grill #27)
`engine/tax/gst.py` cites CBIC Notifications 12/2017 and 11/2017-Central Tax
(Rate). The sprint couldn't fetch the CBIC PDFs, so `GST_SOURCE["verified"]` is
False until someone reads the clauses and dates the check.

## Card new-spend interest is month-granular (grill #25)
RBI FAQ 6: while a card revolves, interest runs from each transaction's date.
The simulator works in months, so it charges a full month on that month's
spend (the most it could cost); spend spread through a month really costs
about half. A daily-balance model, or L5's statement goldens, would pin it.
A card paid in full every month ("transactor") pays no interest on spend, and
the simulator doesn't yet model that case separately.

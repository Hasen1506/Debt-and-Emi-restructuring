# Can a UPI link confirm that a payment went through?

Founder note on grill #2: "Fix the UPI pay web link so we can see whether payment is actually done and build the loop as well." Also #70b: "Want possibility for autopay or gpay, does both need a licence?"

Research as of 12 October 2026. Every rule below was read on the regulator's own site.

## Short answer

Not from the web link. A `upi://pay` link opens the phone's UPI app, and the app sends nothing back to a web page. Even a native Android app gets only what the payer's UPI app chooses to report back, not a confirmation from the payee's bank. RightDue also isn't the payee: the money goes to the lender's UPI ID. Only the payee's bank (or the payee's payment aggregator) learns the payment was received. So RightDue has no confirmation to read unless it becomes part of the payment chain.

What shipped instead is the honest loop: ask, remember the answer, and reconcile later (see "What shipped").

## The ways a payment can be confirmed, and what each needs

| Route | Would RightDue see the payment? | What it needs | Fits RightDue? |
|---|---|---|---|
| `upi://pay` deep link (today) | No | Nothing | Yes, with "did it go through?" |
| Collect the money through a payment aggregator (Razorpay, Cashfree, PhonePe PG), then pay the lender | Yes, the aggregator sends a webhook | RightDue becomes the merchant receiving the money, so it must then pass it on to the lender: that is handling customers' funds. A non-bank doing that as a business is a payment aggregator itself and needs RBI authorisation: net worth ₹15 crore at application, ₹25 crore by the end of the third year (RBI Master Direction on Regulation of Payment Aggregators, 15 Sep 2025, para 6(a)). Collecting as a merchant and forwarding to a lender is also not something aggregators' merchant terms allow. | No |
| Pay the lender through Bharat Connect (BBPS: "Loan Repayment" and "Credit Card" are biller categories) | Yes: the payment is confirmed by the biller, and the bill amount can be fetched first | Become an Agent Institution: certified by NBBL and onboarded by a Customer Operating Unit (a bank or authorised non-bank operator), using the operator's APIs and following Bharat Connect's front-end standards (RBI BBPS Directions 2024; NBBL procedural guidelines Nov 2025). Agent institutions don't need their own RBI licence; the operating unit does. | Possible later, through a partner COU. Costs and partner terms unknown. |
| UPI AutoPay mandate to the lender | The lender's bank sees it; RightDue doesn't | The lender must offer a UPI AutoPay mandate for its EMI (many use NACH instead). The payer sets it up in their UPI app. RightDue can't create a mandate for someone else's merchant. Mandates above ₹15,000 need the UPI PIN each time, except insurance, mutual funds and credit card bills (up to ₹1,00,000) (RBI e-mandate directions; NPCI AutoPay page). NPCI's UPI Consolidated Circular (v1.0, 18 Sep 2026, para 14.19, read in a published copy) lets users pause or revoke mandates in the app except for the loan-payment and EMI-collection categories, so an EMI mandate is a firm commitment. | Point users to it; not a RightDue feature |
| Account Aggregator: read the bank statement (with consent) and find the debit | Yes, after the fact | RightDue registers as a Financial Information User with a regulator and connects to AAs (G6 owns the research) | Later, for reconciliation |
| SMS parser: the bank's debit SMS | Yes, after the fact, if the user shares it | G6 builds the paste/share parser; automatic reading needs an Android app with READ_SMS | Use for reconciliation when it ships |

## Licences in one line each

- Getting paid as a merchant (for RightDue's own fees, e.g. the ₹299 Loan Check pack): no licence, sign up with any aggregator. Razorpay's standard fee is 2% + 18% GST per successful payment, including UPI (razorpay.com/pricing, read 12 Oct 2026). From 15 Oct 2026, UPI P2M payments above ₹2,000 carry a 0.4% MDR capped at ₹300 (Department of Financial Services FAQ, Sep 2026).
- Collecting users' loan payments and forwarding them: payment aggregator authorisation (₹15 crore net worth). Not realistic.
- Showing the user's bills and paying them through Bharat Connect: agent institution under a COU; the COU carries the licence.
- Starting a UPI payment and seeing its result in-app: being a UPI app (a TPAP) needs NPCI approval and a sponsor bank; not realistic.

## What shipped (G7)

1. After PAY VIA UPI, the row asks: "Did ₹X to <UPI ID> go through? RightDue can't see your bank, so tell us." YES records it as paid (same as MARK PAID). NO records nothing and says what RBI requires if money left anyway. NOT SURE keeps a check on this device, with the 12-digit UPI reference if the user has it, and Home asks again (`web/src/lib/upi-confirm.ts`, `components/home/UpiPay.tsx`).
2. The failed-payment rule shown after NO: for a UPI payment to a business where the account was debited but the payee didn't confirm, the bank must reverse it within T+5 days and pay ₹100 a day after that (RBI circular DPSS.CO.PD.No.629/02.14.006/2019-20, 20 Sep 2019, table item 4(b)). https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11693
3. Reconciliation later: the pending checks and any UTR are kept so the SMS parser (G6) or an AA statement can match them when those ship. Not wired yet.

## Sources

- RBI Master Direction on Regulation of Payment Aggregators, 15 Sep 2025: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12896&Mode=0
- RBI Bharat Bill Payment System Directions, 2024: https://rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12616
- NBBL Bharat Connect procedural guidelines v6 (Nov 2025): https://www.bharat-connect.com/strapi/uploads/Procedural_Guidelines_BBPS_V6_November_2025_Website_b15d06fcb5.pdf
- RBI e-mandate limits (₹15,000; ₹1,00,000 for insurance, mutual funds, card bills), 12 Dec 2023: https://www.rbi.org.in/scripts/FS_Notification.aspx?Id=12570&Mode=0&fn=9
- NPCI UPI AutoPay: https://www.npci.org.in/product/autopay
- RBI TAT for failed transactions, 20 Sep 2019: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11693
- NPCI UPI Consolidated Circular v1.0, 18 Sep 2026 (published copy): https://avantiscdnprodstorage.blob.core.windows.net/legalupdatedocs/59640/NPCI-issued-the-UPI-Consolidated-Circular-Version-1-0-SEP182026.pdf
- Razorpay pricing: https://razorpay.com/pricing/
- DFS FAQ on UPI P2M MDR (Sep 2026): https://financialservices.gov.in/sites/default/files/2026-09/FAQs---Merchant-Discount-Rate--MDR--on-Select-UPI--P2M--Transactions_0.pdf

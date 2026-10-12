# Account Aggregator (AA): what it would take (research only, nothing built)

Founder questions #11, #17, #23, #56 (grill). Sources opened 2026-10-12.

## What AA is
An Account Aggregator is an RBI-licensed NBFC (NBFC-AA) that moves a person's financial data, with their consent, from the institution holding it (Financial Information Provider, **FIP**: a bank, AMC, …) to an app that uses it (Financial Information User, **FIU**). The AA can't store, process or sell the data it moves. Sources: Sahamati, https://sahamati.org.in/account-aggregators/ and https://sahamati.org.in/financial-information-user-fiu/.

## Who can be an FIU
- "'Financial Information User' means an entity registered with and regulated by any financial sector regulator". That's RBI Master Direction NBFC-AA, para 3(12): https://rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=12936. The regulators are RBI, SEBI, IRDAI and PFRDA (Sahamati FIU page, https://sahamati.org.in/fiu).
- An RBI-regulated entity that joins as an FIU must also join as an FIP if it holds such data. Source: RBI/2023-24/77, https://rbi.org.in/Scripts/NotificationUser.aspx?Id=12558.
- **RightDue today (a Udyam sole proprietorship) is not eligible.** Udyam registration isn't regulation by any of the four.

## Steps for an eligible entity (Sahamati / Setu)
1. Hold a licence from RBI, SEBI, IRDAI or PFRDA. The purpose must match that licence (https://sahamati.org.in/license-types-by-financial-regulators-rbi-sebi-irdai-pfrda/).
2. Implement the ReBIT FIU API spec (consent request, FI request, FI fetch, notification callbacks).
3. Test against AA sandboxes. Finvu, OneMoney, Setu, Anumati, Saafe, NADL and others list public sandboxes (https://sahamati.org.in/how-to-join-the-account-aggregator-network-to-share-and-access-financial-data/).
4. Pass Sahamati certification through an empanelled auditor, then onboard on the Central Registry. Setu, as a Technical Service Provider, does the certification, the CX and legal checklists, and the registry onboarding for the FIU. The FIU still submits its own licence first (https://docs.setu.co/data/account-aggregator/licenses-and-go-live/go-live).
5. Pay the Sahamati annual membership fee, set by entity category (https://sahamati.org.in/wp-content/uploads/2025/09/Sahamati-Member-Fee-Policy.pdf).

## Costs (published)
- **Finvu:** ₹0.20–₹2.50 per data fetch, or ₹3–₹6 per active user × account per billing period; volume pricing bespoke; FIP charges passed through at actuals (https://finvu.in/pricing/index.html).
- **OneMoney:** "pricing … is linked to usage. No license or maintenance fees"; Sahamati certification charged separately (https://www.onemoney.in/docs/resources/FinSec%20AA%20Solutions%20Private%20Limited%20-%20FIPs%20and%20FIUs%20Integrate%20with%20Onemoney%20AA.pdf).
- **Setu:** pricing isn't published; contact sales.

## Does AA solve RightDue's data problem? Not today
Finvu's pricing page lists the data types currently available: "current and savings accounts, term and recurring deposits, mutual funds, equity shares, and NPS" (same page). Loan accounts and credit cards aren't in it. So even as an FIU, RightDue would see EMI debits on the savings account, not a loan's balance, rate or fees. AA would help later with income (salary credits) and assets, not with debt setup.

## Timeline (estimate, not published)
The steps above add up to months, not weeks, *after* a licence is held: licence, then build, then sandbox, then certification, then registry. Getting a licence (for example an NBFC, or a SEBI RIA/RA) is the long pole, and it changes the business, so it's a founder decision.

## Realistic routes
1. **Now (shipped):** user-brought data. Credit-report PDF upload, KFS upload, and pasted SMS. No licence needed: the user downloads their own report and hands it over.
2. **Later:** partner with a regulated FIU (a lender or an RIA) that holds the consent and passes on only what the user approves. This conflicts with "earns nothing from lenders" if the partner is a lender.
3. **Much later:** incorporate, then seek a SEBI or RBI registration that fits the product.

## Credit bureaus (for comparison)
Bureau data goes to members: Credit Institutions, or Specified Users under the Credit Information Companies (Regulation) Act, 2005 (https://www.transunioncibil.com/become-a-member). Experian's membership asks for a CIN, PAN, GST and an "RBI Certificate" (https://stg1.experian.in/business/bureau-membership). TransUnion CIBIL's API marketplace has a "DTC Consumer Connect" product for members (https://apimarketplace.transunioncibil.com/). So an automatic bureau pull also needs membership or a member partner.

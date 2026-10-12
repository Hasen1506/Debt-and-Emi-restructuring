"""India's GST on financial services: the one place the rate and its reach are set.

GST_RATE_IN is the rate. GST_APPLIES says which charge on a loan or card
carries it (grill #27, sprint G1, 2026-10-12): every caller asks
`gst_applies(kind)` instead of keeping its own list, and the web reads the
same table from tax-tables.json (scripts/export_tax_tables.py), so a GST
Council change is one edit.

The rule, in plain words:
* Interest on a loan is exempt from GST, but credit-card interest is not.
  CBIC Notification No. 12/2017-Central Tax (Rate), 28 June 2017, S.No. 27
  (services by way of extending deposits, loans or advances in so far as the
  consideration is represented by way of interest or discount, *other than
  interest involved in credit card services*).
* Fees and charges for a loan (processing, prepayment / foreclosure, late
  payment, penal charges, balance-transfer fee, card annual fee, cash-advance
  fee, bounce charges) are a taxable financial service at the standard rate,
  18% (CGST 9% + SGST 9%, or IGST 18%): Notification No. 11/2017-Central Tax
  (Rate), heading 9971, item (ii) at 9% CGST.
  https://cbic-gst.gov.in/gst-goods-services-rates.html
* Penal charges replaced "penal interest" from 1 Jan 2024 (RBI Fair Lending
  Practice - Penal Charges in Loan Accounts, 18 Aug 2023): they are a charge,
  so they carry GST; penal *interest* was interest.

What differs from lender to lender is the charge itself (the fee %, the late
fee in rupees), never the GST on it, so one table holds for every lender.

`verified`: the clause text above is cited from the notifications as
published; the sprint did not re-read the CBIC PDF itself (its site blocks
plain fetches), so the entry says so and docs/BOTTLENECKS.md lists it.
"""
from decimal import Decimal

GST_RATE_IN = Decimal("0.18")

GST_SOURCE = {
    "exempt_interest": "CBIC Notification 12/2017-Central Tax (Rate), 28 Jun 2017, S.No. 27",
    "fees": "CBIC Notification 11/2017-Central Tax (Rate), 28 Jun 2017, heading 9971 (18%)",
    "url": "https://cbic-gst.gov.in/gst-goods-services-rates.html",
    "as_of": "2026-10-12",
    "verified": False,
}

# charge kind -> does Indian GST apply to it?
GST_APPLIES: dict[str, bool] = {
    "card_interest": True,         # credit-card interest is carved out of the exemption
    "loan_interest": False,        # interest on any other loan: exempt (S.No. 27)
    "processing_fee": True,        # every loan type: home, personal, auto, gold, education, BNPL
    "prepayment_fee": True,        # part-prepayment and foreclosure charges
    "late_fee": True,              # card late-payment charge, loan late fee
    "penal_charge": True,          # RBI penal charges (from 1 Jan 2024)
    "bounce_charge": True,         # NACH / cheque return charges
    "balance_transfer_fee": True,
    "card_annual_fee": True,
    "cash_advance_fee": True,
}


def gst_applies(charge_kind: str) -> bool:
    """True when Indian GST is charged on this kind of charge. An unknown
    kind raises, so a new charge has to be added to the table on purpose."""
    try:
        return GST_APPLIES[charge_kind]
    except KeyError:
        raise ValueError(f"unknown charge kind for GST: {charge_kind!r}") from None


def gst_on(charge_kind: str, amount: Decimal) -> Decimal:
    """The GST on `amount` of this charge (0 when the charge is exempt)."""
    return amount * GST_RATE_IN if gst_applies(charge_kind) else Decimal("0")

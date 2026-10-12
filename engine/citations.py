"""The rules that findings and letters cite, in one place.

Each citation carries:
- `requirement`: a plain-language summary, as the app shows it;
- `clause`: the regulation's own words, copied verbatim (fragments of one
  paragraph are joined with " … ");
- `paragraph`, `url`, `checked_on`: where the words are and when they were
  last read;
- `verified_against_text`: True only when `clause` is a verbatim copy that
  appears in the saved source extract (engine/tests/fixtures/rbi_extracts/,
  named by `extract`) and the summary carries the clause's key facts. The
  test suite enforces both (engine/tests/test_citations.py).

Checked against the RBI's own text on 12 Oct 2026 (see the extracts for
the exact page and how it was read). What is in force on that day:

- Interest-rate rules for commercial banks: RBI (Commercial Banks – Interest
  Rates on Advances) Directions, 2025, RBI/DOR/2025-26/161,
  DOR.CRE.REC.80./13.03.000/2025-26, 28 Nov 2025. (An earlier version of
  this file gave DOR.RRC.REC.302/33-01-010/2025-26, which is the circular
  that repealed the old instructions, not the Directions.) Small finance
  banks have their own Directions with the same external-benchmark text
  (RBI/DOR/2025-26/192). The Directions for regional rural banks and
  co-operative banks have no external-benchmark rule, and housing finance
  companies (HFCs) and other NBFCs are not covered by any of them.
- Reset at a rate change (EMI / tenure choice, notice): Responsible
  Business Conduct Directions, 2025, for commercial banks (para 349) and
  NBFCs (para 31), which HFCs follow under para 176(3) of the HFC
  Directions, 2025.
- Internal Ombudsman: RBI (Commercial Banks – Internal Ombudsman)
  Directions, 2026 (14 Jan 2026). They repealed the 2023 Directions that
  an earlier version of this file cited.
- RBI Ombudsman: Reserve Bank – Integrated Ombudsman Scheme, 2026, in force
  from 1 Jul 2026. HFCs are outside it; their complaints go to the National
  Housing Bank.

The prepayment citation (PREPAYMENT_NO_CHARGE) is owned by the fee work
(engine/prepayment_fee.py) and stays a summary until that work quotes it.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Citation:
    rule: str
    requirement: str
    source: str
    verified_against_text: bool = False
    clause: str = ""
    paragraph: str = ""
    url: str = ""
    checked_on: str = ""
    # File in engine/tests/fixtures/rbi_extracts/ that holds the source text.
    extract: str = ""


CHECKED_ON = "2026-10-12"

INTEREST_RATES_DIRECTIONS_2025 = (
    "Reserve Bank of India (Commercial Banks – Interest Rates on Advances) "
    "Directions, 2025 (RBI/DOR/2025-26/161, DOR.CRE.REC.80./13.03.000/2025-26, "
    "28 November 2025)"
)
SFB_INTEREST_RATES_DIRECTIONS_2025 = (
    "Reserve Bank of India (Small Finance Banks – Interest Rates on Advances) "
    "Directions, 2025 (RBI/DOR/2025-26/192, 28 November 2025)"
)
EBLR_CIRCULAR_2019 = (
    "RBI circular DBR.DIR.BC.No.14/13.03.00/2019-20 (4 September 2019), "
    "External Benchmark Based Lending"
)
CB_CONDUCT_DIRECTIONS_2025 = (
    "Reserve Bank of India (Commercial Banks – Responsible Business Conduct) "
    "Directions, 2025 (RBI/DOR/2025-26/170, updated 1 October 2026)"
)
NBFC_CONDUCT_DIRECTIONS_2025 = (
    "Reserve Bank of India (Non-Banking Financial Companies – Responsible "
    "Business Conduct) Directions, 2025 (RBI/DOR/2025-26/362, updated 1 July 2026)"
)
HFC_DIRECTIONS_2025 = (
    "Reserve Bank of India (Housing Finance Companies) Directions, 2025 "
    "(RBI/DoR/2025-26/365, 28 November 2025)"
)
RBIOS_2026 = "Reserve Bank – Integrated Ombudsman Scheme, 2026"
IO_DIRECTIONS_2026 = (
    "Reserve Bank of India (Commercial Banks – Internal Ombudsman) Directions, "
    "2026 (RBI/CEPD/2025-26/381, 14 January 2026)"
)
# Kept for imports elsewhere; the 2023 Directions were repealed on 14 Jan 2026.
IO_DIRECTIONS_2023 = IO_DIRECTIONS_2026
PREPAYMENT_DIRECTIONS_2025 = "RBI (Pre-payment Charges on Loans) Directions, 2025 (2 July 2025)"

_URL_CB_IRA = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13149"
_URL_SFB_IRA = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13117"
_URL_EBLR_2019 = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11677&Mode=0"
_URL_CB_RBC = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13140"
_URL_NBFC_RBC = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12942"
_URL_HFC = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12939"
_URL_CB_IO = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13271"
_URL_RBIOS = "https://www.rbi.org.in/commonman/English/Scripts/FAQs.aspx?Id=3407"
_URL_NHB = "https://www.nhb.org.in/en/grievance-redressal-officer/"

# ── Interest-rate rules (banks) ──────────────────────────────────────────────

EBLR_SCOPE = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, paragraph 3; {SFB_INTEREST_RATES_DIRECTIONS_2025}, paragraph 3",
    requirement=(
        "The external-benchmark rules bind Commercial Banks (public, private "
        "and foreign banks, and the State Bank of India) and, through their own "
        "Directions with the same text, Small Finance Banks. They do not cover "
        "housing finance companies, other NBFCs, regional rural banks or "
        "co-operative banks."
    ),
    source="rbi.org.in, Master Directions, 28 Nov 2025",
    verified_against_text=True,
    clause=(
        "3. These Directions shall be applicable to Commercial Banks (hereinafter "
        "collectively referred to as 'banks' and individually as a 'bank') … "
        "3. These Directions shall be applicable to Small Finance Banks"
    ),
    paragraph="paragraph 3 (each Directions)",
    url=_URL_CB_IRA,
    checked_on=CHECKED_ON,
    extract="cb_interest_rates_2025.txt,sfb_interest_rates_2025.txt",
)

EBLR_MANDATE = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, paragraph 25; first required by {EBLR_CIRCULAR_2019}",
    requirement=(
        "All floating-rate personal or retail loans (housing, auto, etc.) from "
        "a bank must be benchmarked to an external benchmark rate, such as the "
        "RBI repo rate. The rule has applied to new loans since 1 October 2019."
    ),
    source="rbi.org.in, Master Directions, 28 Nov 2025; Notifications, 4 Sep 2019",
    verified_against_text=True,
    clause=(
        "25. All floating rate personal or retail loans (housing, auto, etc.), and "
        "floating rate loans extended by banks to Micro, Small and Medium "
        "Enterprises (MSME) shall be benchmarked to an External Benchmark Rate. … "
        "(a) All new floating rate personal or retail loans (housing, auto, etc.) "
        "and floating rate loans to Micro and Small Enterprises extended by banks "
        "from October 01, 2019 shall be benchmarked to one of the following:"
    ),
    paragraph="paragraph 25 (2025 Directions); paragraph 3.1(a) (2019 circular)",
    url=_URL_CB_IRA,
    checked_on=CHECKED_ON,
    extract="cb_interest_rates_2025.txt,eblr_circular_2019.txt",
)

EBLR_RESET = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, paragraph 38",
    requirement=(
        "The interest rate on a loan linked to an external benchmark must be "
        "reset at least once in three months."
    ),
    source="rbi.org.in, Master Directions, 28 Nov 2025",
    verified_against_text=True,
    clause="38. The interest rate under external benchmark shall be reset at least once in three months.",
    paragraph="paragraph 38",
    url=_URL_CB_IRA,
    checked_on=CHECKED_ON,
    extract="cb_interest_rates_2025.txt",
)

EBLR_SPREAD = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, paragraph 33",
    requirement=(
        "A bank sets the spread over the external benchmark, but the credit "
        "risk premium may change only when the borrower's credit assessment "
        "undergoes a substantial change, as agreed in the loan contract; other "
        "parts of the spread, including operating cost, may be changed once in "
        "three years (a bank may reduce them sooner)."
    ),
    source="rbi.org.in, Master Directions, 28 Nov 2025",
    verified_against_text=True,
    clause=(
        "33. A bank is free to decide the spread over the external benchmark. "
        "However, credit risk premium may undergo change only when borrower’s "
        "credit assessment undergoes a substantial change, as agreed upon in the "
        "loan contract. Further, other components of spread including operating "
        "cost could be altered once in three years."
    ),
    paragraph="paragraph 33",
    url=_URL_CB_IRA,
    checked_on=CHECKED_ON,
    extract="cb_interest_rates_2025.txt",
)

EBLR_SWITCH = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, paragraph 41",
    requirement=(
        "An MCLR or base-rate loan continues until it is repaid or renewed. A "
        "borrower who may prepay a floating-rate loan without charges (an "
        "individual, for a non-business purpose) may switch to the external "
        "benchmark without any charges or fees except reasonable "
        "administrative or legal costs, at the rate charged for a new loan of "
        "the same category, type, tenor and amount at the time the loan was "
        "first taken. Other borrowers may switch on mutually acceptable terms."
    ),
    source="rbi.org.in, Master Directions, 28 Nov 2025",
    verified_against_text=True,
    clause=(
        "Provided that floating rate term loans sanctioned to borrowers who, in "
        "terms of extant guidelines, are eligible to prepay a floating rate loan "
        "without pre-payment charges, shall be eligible for switchover to External "
        "Benchmark without any charges / fees, except reasonable administrative / "
        "legal costs. The final rate charged to this category of borrowers, post "
        "switchover to external benchmark, shall be same as the rate charged for a "
        "new loan of the same category, type, tenor and amount, at the time of "
        "origination of the loan. … Provided that other existing borrowers shall "
        "have the option to move to External Benchmark at mutually acceptable terms."
    ),
    paragraph="paragraph 41, first and second provisos",
    url=_URL_CB_IRA,
    checked_on=CHECKED_ON,
    extract="cb_interest_rates_2025.txt",
)

# ── Conduct rules at a reset (banks and HFCs) ───────────────────────────────

RESET_CHOICES_BANK = Citation(
    rule=f"{CB_CONDUCT_DIRECTIONS_2025}, paragraph 349",
    requirement=(
        "At sanction a bank must explain how a change in the benchmark rate can "
        "change the EMI or tenor, and must tell the borrower immediately of any "
        "increase in EMI or tenor. The borrower must be given the choice of a "
        "higher EMI, a longer tenor, or both, and of prepaying in part or in full."
    ),
    source="rbi.org.in, Master Directions (PDF), 28 Nov 2025, updated 1 Oct 2026",
    verified_against_text=True,
    clause=(
        "(1) At the time of sanction, the bank shall clearly communicate to the "
        "borrower about the possible impact of change in benchmark interest rate "
        "on the loan leading to changes in EMI and / or tenor or both. "
        "Subsequently, any increase in the EMI / tenor or both on account of the "
        "above shall be communicated to the borrower immediately through "
        "appropriate channels. … (3) The borrower shall also be given the choice "
        "to opt for (i) enhancement in EMI or elongation of tenor or for a "
        "combination of both options; and, (ii) to prepay, either in part or in "
        "full, at any point during the tenor of the loan."
    ),
    paragraph="paragraph 349(1) and (3)",
    url=_URL_CB_RBC,
    checked_on=CHECKED_ON,
    extract="cb_responsible_conduct_2025.txt",
)

RESET_CHOICES_NBFC = Citation(
    rule=(
        f"{NBFC_CONDUCT_DIRECTIONS_2025}, paragraph 31, which HFCs follow under "
        f"paragraph 176(3) of the {HFC_DIRECTIONS_2025}"
    ),
    requirement=(
        "At sanction a housing finance company or NBFC must explain how a "
        "change in its benchmark rate can change the EMI or tenor, must tell "
        "the borrower immediately of any increase in EMI or tenor, and must "
        "give the choice of a higher EMI, a longer tenor, or both, and of "
        "prepaying in part or in full. This applies whether the loan is linked "
        "to an external benchmark or to the lender's own internal benchmark."
    ),
    source="rbi.org.in, Master Directions (PDF), 28 Nov 2025, updated 1 Jul 2026",
    verified_against_text=True,
    clause=(
        "(1) At the time of sanction, an NBFC shall clearly communicate to the "
        "borrowers about the possible impact of change in benchmark interest rate "
        "on the loan leading to changes in EMI and / or tenor or both. "
        "Subsequently, any increase in the EMI / tenor or both on account of the "
        "above shall be communicated to the borrower immediately through "
        "appropriate channels. … (3) The borrowers shall also be given the choice "
        "to opt for (i) enhancement in EMI or elongation of tenor or for a "
        "combination of both options; and, (ii) to prepay, either in part or in "
        "full, at any point during the tenor of the loan. … irrespective of "
        "whether they are linked to an external benchmark or an internal benchmark."
    ),
    paragraph="paragraphs 31(1), 31(3) and 32 (NBFC Directions); 176(3) (HFC Directions)",
    url=_URL_NBFC_RBC,
    checked_on=CHECKED_ON,
    extract="nbfc_responsible_conduct_2025.txt",
)

PROSPECTIVE_BANK = Citation(
    rule=f"{CB_CONDUCT_DIRECTIONS_2025}, paragraph 337",
    requirement=(
        "A bank must give notice of any change in the terms, including interest "
        "rates, and changes in interest rates take effect only prospectively "
        "(from then on, never backdated)."
    ),
    source="rbi.org.in, Master Directions (PDF), 28 Nov 2025, updated 1 Oct 2026",
    verified_against_text=True,
    clause=(
        "The bank shall give notice of any change in the terms and conditions "
        "including interest rates, service charges etc. It shall also be ensured "
        "that changes in interest rates and charges are effected only prospectively."
    ),
    paragraph="paragraph 337",
    url=_URL_CB_RBC,
    checked_on=CHECKED_ON,
    extract="cb_responsible_conduct_2025.txt",
)

PROSPECTIVE_HFC = Citation(
    rule=f"{HFC_DIRECTIONS_2025}, paragraph 137, with paragraph 15 of the {NBFC_CONDUCT_DIRECTIONS_2025}",
    requirement=(
        "A housing finance company must give notice of any change in the "
        "terms, including interest rates, and changes in interest rates take "
        "effect only prospectively. If a change is to the borrower's "
        "disadvantage, the borrower may within 60 days close the loan or "
        "switch it without paying any extra charges or interest."
    ),
    source="HFC Directions as issued (copy hosted by NHB); NBFC Directions on rbi.org.in",
    verified_against_text=True,
    clause=(
        "If such change is to the disadvantage of the customer, he/ she may within "
        "60 days and without notice close his/ her account or switch it without "
        "having to pay any extra charges or interest … The NBFC shall also ensure "
        "that changes in interest rates and charges are effected only prospectively."
    ),
    paragraph="paragraph 137 (HFC Directions); paragraph 15 (NBFC Directions)",
    url=_URL_HFC,
    checked_on=CHECKED_ON,
    extract="hfc_directions_2025.txt,nbfc_responsible_conduct_2025.txt",
)

HFC_RATE_POLICY = Citation(
    rule=f"{NBFC_CONDUCT_DIRECTIONS_2025}, paragraph 22, which HFCs follow under paragraph 146 of the {HFC_DIRECTIONS_2025}",
    requirement=(
        "A housing finance company sets its own rates under an interest rate "
        "model adopted by its Board (cost of funds, margin and risk premium), "
        "and must disclose the rate and its approach to gradations of risk in "
        "the application form and the sanction letter. No RBI rule ties its "
        "rate to the repo rate."
    ),
    source="rbi.org.in, Master Directions (PDF), 28 Nov 2025, updated 1 Jul 2026",
    verified_against_text=True,
    clause=(
        "22. The Board of an NBFC shall adopt an interest rate model taking into "
        "account relevant factors such as cost of funds, margin and risk premium "
        "and determine the rate of interest to be charged for loans and advances. "
        "The rate of interest and the approach for gradations of risk and "
        "rationale for charging different rate of interest to different "
        "categories of borrowers shall be disclosed to the borrower or customer in "
        "the application form and communicated explicitly in the sanction letter."
    ),
    paragraph="paragraph 22 (NBFC Directions); paragraph 146 (HFC Directions)",
    url=_URL_NBFC_RBC,
    checked_on=CHECKED_ON,
    extract="nbfc_responsible_conduct_2025.txt",
)

HFC_PREPAY_FREE = Citation(
    rule=f"{HFC_DIRECTIONS_2025}, paragraph 163(1)",
    requirement=(
        "A housing finance company may not charge any pre-payment levy or "
        "penalty when a floating-rate housing loan is pre-closed from any source."
    ),
    source="HFC Directions as issued (copy hosted by NHB)",
    verified_against_text=True,
    clause=(
        "The HFC shall not charge pre-payment levy or penalty on pre-closure of "
        "housing loans under the following situations: … (1) Where the housing "
        "loan is on floating interest rate basis and pre-closed from any source."
    ),
    paragraph="paragraph 163(1)",
    url=_URL_HFC,
    checked_on=CHECKED_ON,
    extract="hfc_directions_2025.txt",
)

# ── Complaints ───────────────────────────────────────────────────────────────

IO_ESCALATION = Citation(
    rule=f"{IO_DIRECTIONS_2026}, clause 14(1) and 14(9)",
    requirement=(
        "A complaint that the bank's grievance desk has partially resolved or "
        "wholly rejected must be escalated automatically to the bank's Internal Ombudsman for review, "
        "and the final decision must reach the complainant within 30 days of "
        "the bank receiving the complaint."
    ),
    source="rbi.org.in, Master Directions, 14 Jan 2026",
    verified_against_text=True,
    clause=(
        "All complaints that are partially resolved or wholly rejected by the "
        "bank's internal grievance redress mechanism shall be auto escalated to "
        "the office of the IO for review; … (9) The bank shall ensure that the "
        "final decision is communicated to the complainant within a period of 30 "
        "days from the date of receipt of complaint by the bank."
    ),
    paragraph="clause 14(1) and 14(9)",
    url=_URL_CB_IO,
    checked_on=CHECKED_ON,
    extract="cb_internal_ombudsman_2026.txt",
)

RBIOS_ACCESS = Citation(
    rule=f"{RBIOS_2026} (in force from 1 July 2026), clause 10, as RBI's FAQ states it",
    requirement=(
        "A complaint may go to the RBI Ombudsman once it has been made to the "
        "regulated entity and there has been no reply within 30 days, or the "
        "reply does not satisfy the complainant. It must be filed within 90 "
        "days of the end of that period or of the entity's last communication, "
        "whichever is later. Filing is free."
    ),
    source="RBI FAQs on RB-IOS 2026 (rbi.org.in, Common Person section), updated 1 Jul 2026",
    verified_against_text=True,
    clause=(
        "A complaint can be filed before the RBI Ombudsman if the complainant has "
        "not received any reply within 30 days or within the time specified by "
        "RBI, NPCI or Card Network guidelines, if any, whichever is higher, after "
        "the Regulated Entity received the complaint; or if the complainant is not "
        "satisfied with the reply/resolution provided by the Regulated Entity. … "
        "The complaint must be made to the RBI Ombudsman within 90 days from the "
        "date on which the above timeline expires or the date of the last "
        "communication from the concerned Regulated Entity, whichever is later. … "
        "is a cost-free, expeditious and non-adversarial alternate grievance redress mechanism"
    ),
    paragraph="clause 10 (FAQ 17)",
    url=_URL_RBIOS,
    checked_on=CHECKED_ON,
    extract="rbios_2026_faq.txt",
)

RBIOS_COMPENSATION = Citation(
    rule=f"{RBIOS_2026} (in force from 1 July 2026), as RBI's FAQ states it",
    requirement=(
        "The RBI Ombudsman may award up to Rs 30 lakh for consequential loss and "
        "up to Rs 3 lakh for the complainant's time, expenses and harassment."
    ),
    source="RBI FAQs on RB-IOS 2026 (rbi.org.in, Common Person section), updated 1 Jul 2026",
    verified_against_text=True,
    clause=(
        "However, for any consequential loss suffered by the complainant, the RBI "
        "Ombudsman has the power to provide compensation up to Rs 30 lakh. In "
        "addition, the RBI Ombudsman may provide compensation up to Rs 3 lakh for "
        "loss of the complainant’s time, expenses incurred, harassment / mental "
        "anguish suffered, etc."
    ),
    paragraph="FAQ on compensation",
    url=_URL_RBIOS,
    checked_on=CHECKED_ON,
    extract="rbios_2026_faq.txt",
)

RBIOS_SCOPE = Citation(
    rule=f"{RBIOS_2026} (in force from 1 July 2026), coverage, as RBI's FAQ states it",
    requirement=(
        "The RBI Ombudsman covers all commercial banks, regional rural banks, "
        "and state, central and scheduled urban co-operative banks (and larger "
        "non-scheduled ones), and NBFCs above the size limits, excluding "
        "Housing Finance Companies."
    ),
    source="RBI FAQs on RB-IOS 2026 (rbi.org.in, Common Person section), updated 1 Jul 2026",
    verified_against_text=True,
    clause=(
        "Banks: all Commercial Banks, Regional Rural Banks, State Co-operative "
        "Banks, Central Co-operative Banks, Scheduled Primary (Urban) Co-operative "
        "Banks, and Non-Scheduled Primary (Urban) Co-operative Banks with deposit "
        "size of Rs 50 crore and above … NBFCs: all NBFCs registered with RBI, "
        "excluding Housing Finance Companies"
    ),
    paragraph="FAQ 13",
    url=_URL_RBIOS,
    checked_on=CHECKED_ON,
    extract="rbios_2026_faq.txt",
)

NHB_COMPLAINT = Citation(
    rule="National Housing Bank, Grievance Redressal (complaints against housing finance companies)",
    requirement=(
        "A complaint against a housing finance company goes to the company "
        "first. With no response within a period of one month, or an answer "
        "that does not satisfy, it can be lodged with the National Housing Bank "
        "through GRIDS (grids.nhbonline.org.in) or by post."
    ),
    source="nhb.org.in, Grievance Redressal page",
    verified_against_text=True,
    clause=(
        "Any aggrieved customer of HFC is advised to approach the HFC in the first "
        "instance for redressal of his/her complaints … and who does not receive "
        "response from the Housing Finance Company (HFC) within a period of one "
        "month or is dissatisfied with the response received from the HFC can "
        "lodge the complaint through GRIDS / Post in the prescribed form"
    ),
    paragraph="Grievance Redressal page",
    url=_URL_NHB,
    checked_on=CHECKED_ON,
    extract="nhb_grievance_2026.txt",
)

# ── Prepayment (summary only; owned by the fee work) ────────────────────────

PREPAYMENT_NO_CHARGE = Citation(
    rule=(
        f"{PREPAYMENT_DIRECTIONS_2025}, for loans sanctioned or renewed from "
        "1 January 2026; RBI circulars of 2012 and 2014 for older floating-rate loans"
    ),
    requirement=(
        "No pre-payment or foreclosure charge may be levied on a floating-rate "
        "loan taken by an individual for a non-business purpose, whether it is "
        "paid off in full or in part, from any source of funds, including a "
        "move to another lender."
    ),
    source="rbi.org.in, Notifications, 2 July 2025",
)

ALL = (
    EBLR_SCOPE, EBLR_MANDATE, EBLR_RESET, EBLR_SPREAD, EBLR_SWITCH,
    RESET_CHOICES_BANK, RESET_CHOICES_NBFC, PROSPECTIVE_BANK, PROSPECTIVE_HFC,
    HFC_RATE_POLICY, HFC_PREPAY_FREE,
    IO_ESCALATION, RBIOS_ACCESS, RBIOS_COMPENSATION, RBIOS_SCOPE, NHB_COMPLAINT,
    PREPAYMENT_NO_CHARGE,
)

"""The rules that findings and letters cite, in one place.

Each requirement is a plain-language summary, not a quotation. Until the
Phase 2 citation check compares a summary with the regulation's own text,
`verified_against_text` stays False and the app says the wording is a
summary. Re-checked against published summaries on 26 Sep 2026; the RBI
site itself could not be read from the build environment.

What is in force (26 Sep 2026):
- Interest-rate rules: RBI (Commercial Banks – Interest Rates on Advances)
  Directions, 2025 (28 Nov 2025). They carry forward the external-benchmark
  rules of the 4 Sep 2019 circular. A draft "Interest Rates on Loans and
  Advances Directions, 2026" would replace them from 1 Apr 2027 at the
  earliest; revisit then.
- Ombudsman: Reserve Bank – Integrated Ombudsman Scheme, 2026, in force
  from 1 Jul 2026. It replaced RB-IOS 2021 and cut the filing window from
  one year to 90 days.
- Internal Ombudsman: RBI (Internal Ombudsman for Regulated Entities)
  Directions, 2023; since Jan 2026 banks must escalate every wholly or
  partly rejected complaint automatically.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Citation:
    rule: str
    requirement: str
    source: str
    # Flipped by the Phase 2 citation check once the summary has been
    # compared with the regulation's own text.
    verified_against_text: bool = False


INTEREST_RATES_DIRECTIONS_2025 = (
    "RBI (Commercial Banks – Interest Rates on Advances) Directions, 2025 "
    "(DOR.RRC.REC.302/33-01-010/2025-26, 28 November 2025)"
)
EBLR_CIRCULAR_2019 = (
    "RBI circular DBR.DIR.BC.No.14/13.03.00/2019-20 (4 September 2019), "
    "External Benchmark Based Lending"
)
RBIOS_2026 = "Reserve Bank – Integrated Ombudsman Scheme, 2026"
IO_DIRECTIONS_2023 = (
    "RBI (Internal Ombudsman for Regulated Entities) Directions, 2023 "
    "(RBI/CEPD/2023-24/108, 29 December 2023)"
)

EBLR_RESET = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, carrying forward {EBLR_CIRCULAR_2019}",
    requirement=(
        "The interest rate on a floating-rate loan linked to an external "
        "benchmark must be reset at least once in three months."
    ),
    source="rbi.org.in, Notifications: 28 Nov 2025 (Directions) and 4 Sep 2019 (circular)",
)
EBLR_SPREAD = Citation(
    rule=f"{INTEREST_RATES_DIRECTIONS_2025}, carrying forward {EBLR_CIRCULAR_2019}",
    requirement=(
        "The credit risk premium may change only when the borrower's credit "
        "assessment changes substantially, as agreed in the loan contract; "
        "other parts of the spread, including operating cost, may change "
        "once in three years (a bank may reduce them sooner)."
    ),
    source="rbi.org.in, Notifications: 28 Nov 2025 (Directions) and 4 Sep 2019 (circular)",
)
EBLR_MANDATE = Citation(
    rule=EBLR_CIRCULAR_2019,
    requirement=(
        "From 1 October 2019, all new floating-rate personal and retail loans "
        "from scheduled commercial banks must be linked to an external "
        "benchmark such as the RBI repo rate. Existing MCLR / base-rate "
        "borrowers may switch to the external benchmark on mutually "
        "acceptable terms."
    ),
    source="rbi.org.in, Notifications, 4 September 2019",
)
IO_ESCALATION = Citation(
    rule=IO_DIRECTIONS_2023,
    requirement=(
        "A complaint the bank rejects wholly or partly must be escalated by "
        "the bank to its Internal Ombudsman, and the final decision must "
        "reach the complainant within 30 days of the bank receiving the "
        "complaint. Since January 2026 the escalation must be automatic."
    ),
    source="rbi.org.in, Notifications, 29 Dec 2023; RBI instructions of Jan 2026",
)
RBIOS_ACCESS = Citation(
    rule=f"{RBIOS_2026} (in force from 1 July 2026)",
    requirement=(
        "A complaint may go to the RBI Ombudsman once it has been made to the "
        "bank in writing and the bank has rejected it wholly or partly, or has "
        "not replied within 30 days of receiving it. It must be filed within "
        "90 days of the end of the bank's reply period or of the bank's last "
        "reply, whichever is later. Filing is free."
    ),
    source="RBI RB-IOS 2026 FAQ (rbi.org.in, Common Man section) and the Scheme text",
)
RBIOS_COMPENSATION = Citation(
    rule=f"{RBIOS_2026} (in force from 1 July 2026)",
    requirement=(
        "The RBI Ombudsman may award up to ₹30 lakh for consequential loss and "
        "up to ₹3 lakh for the complainant's time, expenses and harassment."
    ),
    source="RBI RB-IOS 2026 FAQ (rbi.org.in, Common Man section) and the Scheme text",
)

ALL = (EBLR_RESET, EBLR_SPREAD, EBLR_MANDATE, IO_ESCALATION, RBIOS_ACCESS, RBIOS_COMPENSATION)

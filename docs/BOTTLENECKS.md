# Bottlenecks

Things the app does with a known limit, the right fix, and why it is not
done yet. Each entry names the workstream that recorded it.

## Legal review of the complaint letters (critique #54, Sprint G5)

**Right option:** a lawyer (consumer-banking or RBI-regulation practice)
reviews the three India templates in `engine/complaints_in.py` — the
grievance letter, the Internal Ombudsman follow-up and the RBI Ombudsman
complaint — and signs off before they are promoted. Re-review whenever a
cited rule changes.

**Why not now:** no lawyer is available to the founder at present.

**What is done instead (Oct 2026):**
1. Every rule a letter cites is tied to the regulation's own words:
   `engine/citations.py` holds the verbatim clause, paragraph, URL and
   date checked, and `engine/tests/test_citations.py` fails if a clause is
   not found word for word in the saved source extract
   (`engine/tests/fixtures/rbi_extracts/`).
2. Every letter is labelled "Draft. Check before sending." and RightDue
   never sends it (`DRAFT_NOTICE`).
3. The screen asks the borrower to tick a self-check list (`SELF_CHECK`:
   details, starting rate, current rate, spread, lender type, the quoted
   rules, keeping a copy) before it offers copy or download.
4. Letters are generated only for lenders the repo-rate rule binds
   (commercial and small finance banks), never for housing finance
   companies, NBFCs, regional rural banks or co-operative banks.

**Next step when a lawyer is found:** give them the three templates, the
citation clauses and the self-check list; record the review date and any
changes here.

## RBI PDFs behind a captcha (Sprint G5)

RBI's updated Master Direction PDFs (rbidocs.rbi.org.in) show an image
captcha to scripted downloads. The HTML versions on rbi.org.in are read
directly; the conduct Directions (commercial banks, NBFCs) were read in a
browser and transcribed. The Housing Finance Companies Directions were read
from the copy the National Housing Bank hosts (as issued, 28 Nov 2025);
RBI's page shows a version updated 1 Oct 2026 that could not be opened.
Re-check paragraphs 137, 146, 163 and 176 against it when possible.

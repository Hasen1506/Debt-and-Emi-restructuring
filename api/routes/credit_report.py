"""POST /api/credit-report/read — read a user-downloaded credit report (grill #17 / #56).

The user uploads the PDF a bureau gave them (TransUnion CIBIL, Experian, CRIF
High Mark or Equifax), with its password if it has one, or pastes its text. The
reply is every account read, each value with the line it came from, and the
loans the form would add. **Nothing is saved**: the document is read in memory
and dropped, no user state is touched, and the web form shows every field for
the user to confirm, change or drop before anything is added.

No bureau link or licence is involved: the user brings their own report. The
PDF is read on RightDue's server, never stored, by plain-text rules
(engine/credit_report.py) in a child process with a timeout
(engine/pdf_text.py). The password is used once in memory and never logged,
returned or stored. Personal details (name, PAN, date of birth, addresses) are
not returned, and account numbers come back masked.

The handler is a plain ``def``: FastAPI runs it in its threadpool, so a slow PDF
never blocks the event loop (grill #60).

Errors are 422 with one user-facing message:
    {"detail": {"field": "password", "message": "This report is password-protected. ..."}}
"""
from __future__ import annotations

import base64
import binascii
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from api.schemas import _Base
from engine.credit_report import MAX_TEXT_CHARS, CreditReportReadError, pdf_text, read_credit_report, to_dict
from engine.pdf_text import MAX_PASSWORD_CHARS, MAX_PDF_BYTES

router = APIRouter(tags=["credit-report"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class CreditReportReadRequest(_Base):
    text: Optional[str] = Field(None, max_length=MAX_TEXT_CHARS)
    pdf_base64: Optional[str] = Field(None, max_length=(MAX_PDF_BYTES * 4) // 3 + 8)
    # The PDF's open password. Used once in memory, never kept.
    password: Optional[str] = Field(None, max_length=MAX_PASSWORD_CHARS)
    # Today on the user's clock ("YYYY-MM-DD"), to flag stale balances.
    as_of: Optional[str] = Field(None, max_length=10)


def _fail(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"field": field, "message": message})


@router.post("/credit-report/read")
def read(req: CreditReportReadRequest) -> dict:
    as_of = None
    if req.as_of:
        try:
            if not _DATE_RE.match(req.as_of):
                raise ValueError
            as_of = date.fromisoformat(req.as_of)
        except ValueError:
            raise _fail("as_of", "The date could not be read.")
    if req.pdf_base64:
        try:
            data = base64.b64decode(req.pdf_base64, validate=True)
        except (binascii.Error, ValueError):
            raise _fail("pdf_base64", "The file could not be read. Upload the credit report as a PDF.")
        try:
            text = pdf_text(data, req.password or None)
        except CreditReportReadError as exc:
            field = "password" if exc.kind in ("needs_password", "wrong_password") else "pdf_base64"
            raise _fail(field, str(exc))
        field = "pdf_base64"
    elif req.text and req.text.strip():
        text, field = req.text, "text"
    else:
        raise _fail("text", "Upload your credit report as a PDF, or paste its text.")
    try:
        result = read_credit_report(text, as_of=as_of)
    except CreditReportReadError as exc:
        raise _fail(field, str(exc))
    return to_dict(result)

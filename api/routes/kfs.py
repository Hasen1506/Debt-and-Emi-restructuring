"""POST /api/kfs/read — read a Key Facts Statement or sanction letter (roadmap PR G).

The user uploads the PDF (base64) or pastes its text. The reply is what was
read, each value with the line it came from, the EMI / APR / spread
cross-checks, and the loan the form would fill in. **Nothing is saved**: the
document is read in memory and dropped, no user state is touched, and the web
form shows every field for the user to confirm or change before they save.

Parsing is plain-text rules in engine/kfs.py (pypdf for the PDF's text
layer). No outside service or AI model sees the document.

Errors are 422 with one user-facing message:
    {"detail": {"field": "pdf_base64", "message": "This PDF has no text to read; ..."}}
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
from engine.kfs import MAX_PDF_BYTES, MAX_TEXT_CHARS, KfsReadError, pdf_text, read_kfs, to_dict

router = APIRouter(tags=["kfs"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class KfsReadRequest(_Base):
    text: Optional[str] = Field(None, max_length=MAX_TEXT_CHARS)
    # base64 of the PDF; 4 MB of PDF is about 5.6 MB of base64.
    pdf_base64: Optional[str] = Field(None, max_length=(MAX_PDF_BYTES * 4) // 3 + 8)
    # Today on the user's clock ("YYYY-MM-DD"), to count EMIs already due.
    as_of: Optional[str] = Field(None, max_length=10)


def _fail(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"field": field, "message": message})


@router.post("/kfs/read")
async def read(req: KfsReadRequest) -> dict:
    as_of = None
    if req.as_of:
        if not _DATE_RE.match(req.as_of):
            raise _fail("as_of", "The date could not be read.")
        try:
            as_of = date.fromisoformat(req.as_of)
        except ValueError:
            raise _fail("as_of", "The date could not be read.")
    if req.pdf_base64:
        try:
            data = base64.b64decode(req.pdf_base64, validate=True)
        except (binascii.Error, ValueError):
            raise _fail("pdf_base64", "The file could not be read. Upload the KFS as a PDF, or paste its text.")
        try:
            text = pdf_text(data)
        except KfsReadError as exc:
            raise _fail("pdf_base64", str(exc))
        field = "pdf_base64"
    elif req.text and req.text.strip():
        text, field = req.text, "text"
    else:
        raise _fail("text", "Upload the KFS as a PDF, or paste its text.")
    try:
        result = read_kfs(text, as_of=as_of)
    except KfsReadError as exc:
        raise _fail(field, str(exc))
    return to_dict(result)

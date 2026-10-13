"""Read the text layer of an uploaded PDF, safely (grill #18, #60).

Used by the Key Facts Statement import (engine/kfs.py) and the credit-report
import (engine/credit_report.py).

Why a child process: pypdf is pure Python and synchronous. A 4 MB, 40-page PDF
read with ``extraction_mode="layout"`` can take seconds of CPU, and a crafted
PDF can take far longer. The API runs one worker on a fraction of a CPU, so the
parse runs in a separate Python process (``python -m engine.pdf_text``) that is
killed after ``timeout`` seconds. The API route itself is a plain ``def`` so
FastAPI runs it in its threadpool and the event loop stays free.

Passwords: Indian bank and bureau PDFs are routinely locked with a password
built from the date of birth, the name, the PAN or the mobile number. The
password is passed to the child on stdin (never on the command line, where
``ps`` could see it), used once to decrypt in memory, and never logged,
returned or stored.

Limits apply before any text is extracted: the byte size, the ``%PDF`` header,
and a page cap (only the first ``max_pages`` pages are read).

Errors are a ``PdfTextError`` with a ``kind`` the caller turns into its own
user-facing words:
    too_big | not_pdf | needs_password | wrong_password | unreadable | scan | timeout
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

MAX_PDF_BYTES = 4 * 1024 * 1024
MAX_PDF_PAGES = 40
MAX_PASSWORD_CHARS = 64
DEFAULT_TIMEOUT_S = 15.0
# Fewer than this many non-space characters means there's no text layer (a scan).
MIN_TEXT_CHARS = 40

_ROOT = Path(__file__).resolve().parent.parent


class PdfTextError(ValueError):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _extract(data: bytes, password: str, max_pages: int, layout: bool) -> str:
    """In-process extraction. Raises PdfTextError. Runs inside the child."""
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise PdfTextError("unreadable") from exc
    if reader.is_encrypted:
        try:
            # An owner-only lock (no open password) opens with "".
            ok = reader.decrypt(password or "")
        except Exception as exc:  # noqa: BLE001 — e.g. an unsupported cipher
            raise PdfTextError("unreadable") from exc
        if not ok:
            raise PdfTextError("wrong_password" if password else "needs_password")
    pages = []
    try:
        # The page cap applies before any text is extracted.
        for page in reader.pages[:max_pages]:
            if layout:
                pages.append(page.extract_text(extraction_mode="layout") or "")
            else:
                pages.append(page.extract_text() or "")
    except PdfTextError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise PdfTextError("unreadable") from exc
    text = "\n".join(pages)
    if len(re.sub(r"\s", "", text)) < MIN_TEXT_CHARS:
        raise PdfTextError("scan")
    return text


def read_pdf_text(
    data: bytes,
    password: Optional[str] = None,
    *,
    max_pages: int = MAX_PDF_PAGES,
    layout: bool = True,
    timeout: float = DEFAULT_TIMEOUT_S,
) -> str:
    """The text of a PDF's first ``max_pages`` pages, read in a child process
    killed after ``timeout`` seconds."""
    if len(data) > MAX_PDF_BYTES:
        raise PdfTextError("too_big")
    if not data.startswith(b"%PDF"):
        raise PdfTextError("not_pdf")
    if password is not None and len(password) > MAX_PASSWORD_CHARS:
        raise PdfTextError("wrong_password")
    header = json.dumps({"password": password or "", "max_pages": int(max_pages), "layout": bool(layout)})
    env = dict(os.environ)
    env["PYTHONPATH"] = str(_ROOT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "engine.pdf_text"],
            input=header.encode("utf-8") + b"\n" + data,
            capture_output=True,
            timeout=timeout,
            cwd=str(_ROOT),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise PdfTextError("timeout") from exc
    try:
        out = json.loads(proc.stdout.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 — the child crashed
        raise PdfTextError("unreadable") from exc
    if "error" in out:
        raise PdfTextError(out["error"])
    return out["text"]


def _child() -> None:
    raw = sys.stdin.buffer.read()
    nl = raw.find(b"\n")
    try:
        opts = json.loads(raw[:nl].decode("utf-8"))
        data = raw[nl + 1:]
        text = _extract(data, opts.get("password", ""), int(opts.get("max_pages", MAX_PDF_PAGES)), bool(opts.get("layout", True)))
        out = {"text": text}
    except PdfTextError as exc:
        out = {"error": exc.kind}
    except Exception:  # noqa: BLE001
        out = {"error": "unreadable"}
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()


if __name__ == "__main__":
    _child()

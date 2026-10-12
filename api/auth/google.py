"""Sign in with Google, behind a flag that is off by default (live test #6,
sprint L3).

Email + code stays the main way in. When the founder sets these three
variables (DEPLOY.md, "Sign in with Google"), /login also shows a
"Continue with Google" button:

    GOOGLE_SIGNIN=1
    GOOGLE_OAUTH_CLIENT_ID=<…>.apps.googleusercontent.com
    GOOGLE_OAUTH_CLIENT_SECRET=<…>          (a secret: Render dashboard only)
    GOOGLE_OAUTH_REDIRECT_URI=https://rightdue.app/api/auth/google/callback
                                            (optional; built from WEB_ORIGIN)

Missing any of the first three, every route here answers 404 and the button
stays hidden.

Flow: OpenID Connect authorization-code flow with PKCE (RFC 7636), done on
the server:
  GET /api/auth/google/config    → {"enabled": bool}
  GET /api/auth/google/start     → 302 to Google, with state + S256 challenge
                                   kept in a short-lived httpOnly cookie
  GET /api/auth/google/callback  → checks state, swaps the code for tokens at
                                   Google's token endpoint (client secret +
                                   PKCE verifier), reads the ID token's
                                   claims, finds or creates the user by the
                                   verified email, sets the session cookie,
                                   302 to /login?google=1&next=… where the
                                   page loads the account's data as after a
                                   code sign-in.

The ID token comes straight from Google's token endpoint over TLS in answer
to our client secret, which is the case Google's OpenID Connect guide allows
without a signature check; its claims are still checked (iss, aud, exp,
email_verified). https://developers.google.com/identity/openid-connect/openid-connect
(section "Obtain user information from the ID token", checked 12 Oct 2026).

Only the email is used: no name, picture or Google profile is stored. A
Google sign-in for an email that already has a RightDue account signs in to
that account (Google has verified the address, as the emailed code would).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from typing import Annotated, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.session import (
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    generate_session_token,
    hash_session_token,
    session_expiry,
    utc_now,
)
from api.db.database import get_db
from api.db.models import Session, User

router = APIRouter(prefix="/auth/google", tags=["auth"])

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
FLOW_COOKIE = "rightdue_google_flow"
FLOW_TTL_S = 600
FLOW_PATH = "/api/auth/google"


def _settings() -> Optional[dict]:
    if os.environ.get("GOOGLE_SIGNIN", "0") != "1":
        return None
    cid = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if not cid or not secret:
        return None
    redirect = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
    if not redirect:
        origin = os.environ.get("WEB_ORIGIN", "").split(",")[0].strip().rstrip("/")
        if not origin:
            return None
        redirect = f"{origin}/api/auth/google/callback"
    return {"client_id": cid, "client_secret": secret, "redirect_uri": redirect}


def _require() -> dict:
    s = _settings()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return s


def safe_next(raw: Optional[str]) -> str:
    """A same-site path to land on after sign-in; anything else is "/"."""
    if not raw or not raw.startswith("/") or raw.startswith("//") or "\\" in raw or "\n" in raw or "\r" in raw:
        return "/"
    if raw.startswith("/login") or raw.startswith("/api/"):
        return "/"
    return raw[:512]


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _cookie_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "0") == "1"


@router.get("/config")
async def config() -> dict:
    return {"enabled": _settings() is not None}


@router.get("/start")
async def start(next: Annotated[Optional[str], Query()] = None) -> Response:
    s = _require()
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = _b64(hashlib.sha256(verifier.encode("ascii")).digest())
    params = {
        "client_id": s["client_id"],
        "redirect_uri": s["redirect_uri"],
        "response_type": "code",
        "scope": "openid email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{AUTH_URL}?{urlencode(params)}", status_code=status.HTTP_302_FOUND)
    flow = _b64(json.dumps({"s": state, "v": verifier, "n": safe_next(next), "t": int(time.time())}).encode())
    resp.set_cookie(FLOW_COOKIE, flow, max_age=FLOW_TTL_S, httponly=True, secure=_cookie_secure(),
                    samesite="lax", path=FLOW_PATH)
    resp.headers["Cache-Control"] = "no-store"
    return resp


async def exchange_code(code: str, verifier: str, s: dict) -> dict:
    """Google's token endpoint: the code (with our secret and the PKCE
    verifier) for tokens. Replaced in tests."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(TOKEN_URL, data={
            "code": code,
            "client_id": s["client_id"],
            "client_secret": s["client_secret"],
            "redirect_uri": s["redirect_uri"],
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        })
    if r.status_code != 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google did not accept the sign-in. Try again.")
    return r.json()


def id_token_claims(id_token: str) -> dict:
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google's answer could not be read.") from None


def verified_email(claims: dict, client_id: str, now: Optional[float] = None) -> str:
    now = time.time() if now is None else now
    if claims.get("iss") not in ISSUERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The sign-in did not come from Google.")
    aud = claims.get("aud")
    if aud != client_id and not (isinstance(aud, list) and client_id in aud):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The sign-in was meant for another app.")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The sign-in expired. Try again.")
    email = str(claims.get("email") or "").strip().lower()
    if not email or claims.get("email_verified") not in (True, "true"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google has not verified this email address.")
    return email


def _fail(message: str) -> Response:
    resp = RedirectResponse(f"/login?{urlencode({'google_error': message})}", status_code=status.HTTP_302_FOUND)
    resp.delete_cookie(FLOW_COOKIE, path=FLOW_PATH)
    return resp


@router.get("/callback")
async def callback(
    db: Annotated[AsyncSession, Depends(get_db)],
    code: Annotated[Optional[str], Query()] = None,
    state: Annotated[Optional[str], Query()] = None,
    error: Annotated[Optional[str], Query()] = None,
    flow_cookie: Annotated[Optional[str], Cookie(alias=FLOW_COOKIE)] = None,
) -> Response:
    s = _require()
    if error:
        return _fail("Google sign-in was cancelled.")
    try:
        flow = json.loads(base64.urlsafe_b64decode(flow_cookie + "=" * (-len(flow_cookie) % 4))) if flow_cookie else None
    except Exception:
        flow = None
    if not flow or not code or not state or not secrets.compare_digest(str(flow.get("s", "")), state):
        return _fail("The sign-in link was not started here or has expired. Try again.")
    if time.time() - float(flow.get("t", 0)) > FLOW_TTL_S:
        return _fail("The sign-in took too long. Try again.")
    try:
        tokens = await exchange_code(code, str(flow.get("v", "")), s)
        email = verified_email(id_token_claims(str(tokens.get("id_token", ""))), s["client_id"])
    except HTTPException as e:
        return _fail(str(e.detail))

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if user is None:
        try:
            async with db.begin_nested():
                user = User(email=email)
                db.add(user)
                await db.flush()
        except IntegrityError:
            res = await db.execute(select(User).where(User.email == email))
            user = res.scalar_one()
    user.last_login_at = utc_now()
    token = generate_session_token()
    db.add(Session(token=hash_session_token(token), user_id=user.id, expires_at=session_expiry()))
    await db.commit()

    resp = RedirectResponse(f"/login?{urlencode({'google': '1', 'next': safe_next(flow.get('n'))})}",
                            status_code=status.HTTP_302_FOUND)
    resp.set_cookie(SESSION_COOKIE_NAME, token, max_age=int(SESSION_TTL.total_seconds()), httponly=True,
                    secure=_cookie_secure(), samesite=os.environ.get("COOKIE_SAMESITE", "lax"), path="/")
    resp.delete_cookie(FLOW_COOKIE, path=FLOW_PATH)
    resp.headers["Cache-Control"] = "no-store"
    return resp

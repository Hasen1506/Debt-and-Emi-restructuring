"""SQLAlchemy models for auth + per-user state.

Tables:
- users: one row per *verified* email (created when a sign-in code is
  first verified, never on a code request; grill #59).
- otp_challenges: short-lived 6-digit codes, hashed, single-use, keyed by
  email so an unverified address never gets a users row.
- otp_codes: LEGACY (codes keyed by user_id, written before grill #59).
  Nothing writes it now; retention (api/auth/retention.py) empties it.
- sessions: opaque random tokens, looked up per request via cookie.
- user_state: per-user JSON blob (profile, lifecycle, activity, etc).
- rate_buckets: per-client request counters for the sign-in, admin and
  outcome routes, so limits survive a restart (api/rate_buckets.py).

No migrations yet: `create_all` only creates missing tables, which is
why the email-keyed codes are a new table rather than a changed one.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.db.database import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    otp_codes: Mapped[list["OtpCode"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    state: Mapped[Optional["UserState"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class OtpCode(Base):
    """LEGACY, read-only: see the module docstring."""

    __tablename__ = "otp_codes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="otp_codes")


class Session(Base):
    __tablename__ = "sessions"

    # New sessions store a prefixed digest of the opaque cookie token.
    # Legacy plaintext rows remain readable until their existing expiry.
    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class UserState(Base):
    __tablename__ = "user_state"

    # Single row per user — user_id is both PK and FK.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # Critique #63: a write counter, raised by every PATCH/PUT, and for each
    # top-level slice the counter value at which it last changed. A client
    # sends the version it last read; a slice another device changed since
    # then is refused (412) instead of being overwritten silently.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    slice_versions: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    # Which browser (the random device id it sends) last wrote each slice.
    slice_writers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped[User] = relationship(back_populates="state")


class OtpChallenge(Base):
    """A sign-in code sent to an email, before any account exists.

    `code_hash` is blanked once the code is used or expired (it is useless
    then, and a 6-digit hash can be reversed from a dump). The row itself
    is the record that a code was sent, kept for the retention period.
    """

    __tablename__ = "otp_challenges"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)


class RateBucket(Base):
    """One fixed-window counter: `key` is "<route prefix>|<keyed hash of
    the client address>|<window start, epoch seconds>". The address itself
    is never stored."""

    __tablename__ = "rate_buckets"

    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

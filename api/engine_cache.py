"""NEW-19: a small, bounded LRU cache of pure plan calculations.

/simulate, /baseline and /sensitivity/compare are deterministic functions of
their request body (the engine reads no clock, account or environment for
them). A Setup run, Plan load and a what-if often send the very same body
more than once (the same baseline for each strategy click, the same plan
for Setup's preview and Plan's first render), so on a 0.15-CPU host the
second identical request should cost a dictionary lookup, not a re-run.

Key: sha256 of the operation name, today's date (UTC, so nothing can outlive
a day even if a calculation ever comes to read the clock) and the canonical
JSON of the validated request (sorted keys, Decimal/date as strings).
Bounded by entry count; each value is one response model. Thread-safe:
FastAPI runs these sync endpoints in a thread pool.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Callable, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

DEFAULT_SIZE = 32


def canonical_key(operation: str, req: BaseModel) -> str:
    # The conversion reads the India-time month (schemas.current_month), so key on it too.
    from api.schemas import current_month
    body = req.model_dump(mode="json")
    day = datetime.now(timezone.utc).date().isoformat()
    raw = json.dumps([operation, day, current_month(), body], sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class EngineCache:
    def __init__(self, maxsize: int = DEFAULT_SIZE):
        self.maxsize = max(0, int(maxsize))
        self._data: "OrderedDict[str, BaseModel]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def __len__(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self.hits = self.misses = 0

    def get_or_run(self, operation: str, req: BaseModel, run: Callable[[], T]) -> T:
        if self.maxsize == 0:
            return run()
        key = canonical_key(operation, req)
        with self._lock:
            hit = self._data.get(key)
            if hit is not None:
                self._data.move_to_end(key)
                self.hits += 1
                # A deep copy, so no caller can change the cached answer.
                return hit.model_copy(deep=True)  # type: ignore[return-value]
            self.misses += 1
        value = run()
        with self._lock:
            self._data[key] = value.model_copy(deep=True)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)
        return value


engine_cache = EngineCache(int(os.environ.get("ENGINE_CACHE_SIZE", DEFAULT_SIZE)))

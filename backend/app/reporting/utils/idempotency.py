import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class IdempotencyKey:
    key: str


def build_idempotency_key(*parts: str) -> IdempotencyKey:
    raw = ":".join(part.strip() for part in parts if part is not None)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return IdempotencyKey(key=digest)


class IdempotencyStore:
    """Stub store for idempotency tracking (replace with persistent storage)."""

    def was_processed(self, key: str) -> bool:
        return False

    def mark_processed(self, key: str) -> None:
        return None

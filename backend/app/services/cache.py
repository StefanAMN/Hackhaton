"""
Cache service — Redis ca strat de caching pentru rezultatele analizei AI.

Strategia:
  - Key: SHA-256(chunk_content + language + llm_model)
  - Value: JSON serializat al ChunkAnalysis
  - TTL: configurabil (default 24h)

Fallback: dacă Redis nu este disponibil, operațiile sunt no-op (fail-open).
"""
import hashlib
import json
import logging
from typing import Optional

import redis.asyncio as aioredis

from app.core.config import Settings
from app.models.schemas import ChunkAnalysis

logger = logging.getLogger(__name__)


def compute_cache_key(
    content: str,
    language: str,
    model: str,
) -> str:
    """
    Generează o cheie deterministă SHA-256 pentru un chunk.

    Includem și limbajul și modelul în hash pentru a evita coliziunile
    între analize pe același cod cu modele/limbaje diferite.
    """
    raw = f"{language}::{model}::{content}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class CacheService:
    """Wraps un client Redis async cu operații tipizate."""

    def __init__(self, settings: Settings) -> None:
        self._ttl = settings.cache_ttl_seconds
        try:
            self._client: Optional[aioredis.Redis] = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        except Exception as exc:
            logger.warning("Redis indisponibil, caching dezactivat: %s", exc)
            self._client = None

    async def get(self, key: str) -> Optional[ChunkAnalysis]:
        """Returnează un ChunkAnalysis din cache sau None."""
        if self._client is None:
            return None
        try:
            raw = await self._client.get(key)
            if raw is None:
                return None
            data = json.loads(raw)
            return ChunkAnalysis(**data)
        except Exception as exc:
            logger.warning("Cache GET eșuat pentru key=%s: %s", key, exc)
            return None

    async def set(self, key: str, value: ChunkAnalysis) -> None:
        """Salvează un ChunkAnalysis în cache cu TTL."""
        if self._client is None:
            return
        try:
            await self._client.setex(
                key,
                self._ttl,
                value.model_dump_json(),
            )
        except Exception as exc:
            logger.warning("Cache SET eșuat pentru key=%s: %s", key, exc)

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

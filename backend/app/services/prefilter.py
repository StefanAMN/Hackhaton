"""
Prefilter service inspired by Elasticsearch candidate selection.

Workflow:
1) Run a cheap lexical + risk scan on all chunks.
2) Keep only top-k candidates for the expensive AI stage.
"""

from collections import Counter
from dataclasses import dataclass
from math import log1p
import logging
import re

from app.core.config import Settings
from app.services.chunker import CodeChunk

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ChunkCandidate:
    chunk: CodeChunk
    score: float
    reasons: tuple[str, ...]


_TERM_BOOSTS: dict[str, float] = {
    "sql": 2.8,
    "query": 1.8,
    "auth": 2.2,
    "token": 2.0,
    "password": 2.5,
    "secret": 2.5,
    "exec": 2.6,
    "eval": 2.8,
    "shell": 2.3,
    "subprocess": 2.4,
    "request": 1.3,
    "http": 1.1,
    "upload": 1.4,
    "file": 1.0,
    "sanitize": 1.6,
    "validate": 1.5,
    "csrf": 2.0,
    "xss": 2.2,
    "inject": 2.1,
    "encrypt": 1.6,
}


_RISK_PATTERNS: tuple[tuple[re.Pattern[str], float, str], ...] = (
    (re.compile(r"\beval\s*\("), 4.5, "eval-call"),
    (re.compile(r"\bexec\s*\("), 4.2, "exec-call"),
    (re.compile(r"subprocess\.(Popen|run)"), 3.1, "subprocess"),
    (re.compile(r"SELECT\s+.+\+.+FROM", re.IGNORECASE), 3.2, "possible-sql-concat"),
    (re.compile(r"INSERT\s+INTO\s+.+\+", re.IGNORECASE), 3.2, "possible-sql-concat"),
    (re.compile(r"(innerHTML\s*=|dangerouslySetInnerHTML)"), 3.4, "xss-sink"),
    (re.compile(r"(api[_-]?key|secret|password)\s*=\s*['\"]"), 2.8, "hardcoded-secret"),
    (re.compile(r"TODO|FIXME|HACK"), 1.2, "needs-review"),
)


_NAME_BOOST_PATTERNS: tuple[tuple[re.Pattern[str], float, str], ...] = (
    (re.compile(r"auth|login|permission|role", re.IGNORECASE), 1.6, "security-name"),
    (re.compile(r"payment|invoice|billing|checkout", re.IGNORECASE), 1.4, "money-flow"),
    (re.compile(r"upload|parse|deserialize", re.IGNORECASE), 1.1, "input-surface"),
)


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[A-Za-z_][A-Za-z0-9_]+", text.lower())


class PrefilterService:
    """
    Elasticsearch-inspired prefilter:
    - lexical BM25-like score
    - risk-pattern boosts
    - keep only top candidates for AI
    """

    strategy_name = "bm25-lite+risk-rules"

    def __init__(self, settings: Settings) -> None:
        self._max_chunks = max(1, settings.prefilter_max_chunks)
        self._min_score = max(0.0, settings.prefilter_min_score)

    def scan(self, chunks: list[CodeChunk]) -> list[ChunkCandidate]:
        candidates = [self._score_chunk(chunk) for chunk in chunks]
        candidates.sort(key=lambda item: item.score, reverse=True)
        return candidates

    def apply_memory_boost(
        self,
        candidates: list[ChunkCandidate],
        boosts: dict[str, float],
    ) -> list[ChunkCandidate]:
        """Aplică boost-uri provenite din knowledge graph peste scorul lexical."""
        if not candidates or not boosts:
            return candidates

        boosted: list[ChunkCandidate] = []
        for item in candidates:
            boost = boosts.get(item.chunk.name, 0.0)
            if boost <= 0:
                boosted.append(item)
                continue

            reasons = item.reasons + ("memory-boost",)
            boosted.append(
                ChunkCandidate(
                    chunk=item.chunk,
                    score=item.score + boost,
                    reasons=reasons,
                )
            )

        boosted.sort(key=lambda item: item.score, reverse=True)
        return boosted

    def select(self, candidates: list[ChunkCandidate]) -> list[CodeChunk]:
        if not candidates:
            return []

        strong = [c for c in candidates if c.score >= self._min_score][: self._max_chunks]
        if strong:
            return [c.chunk for c in strong]

        # If everything scores very low, keep largest chunks so AI still has context.
        fallback = sorted(candidates, key=lambda item: len(item.chunk.source), reverse=True)
        return [c.chunk for c in fallback[: self._max_chunks]]

    def preview(self, candidates: list[ChunkCandidate], limit: int = 3) -> str:
        if not candidates:
            return "none"

        top = candidates[: max(1, limit)]
        segments = []
        for item in top:
            reason = item.reasons[0] if item.reasons else "lexical"
            segments.append(f"{item.chunk.name}:{item.score:.2f} ({reason})")
        return "; ".join(segments)

    def _score_chunk(self, chunk: CodeChunk) -> ChunkCandidate:
        reasons: list[str] = []

        text = f"{chunk.name}\n{chunk.source}"
        tokens = _tokenize(text)
        token_counts = Counter(tokens)

        score = self._bm25_like(token_counts, doc_len=max(1, len(tokens)))
        if score > 0:
            reasons.append("lexical")

        for pattern, weight, reason in _RISK_PATTERNS:
            if pattern.search(chunk.source):
                score += weight
                reasons.append(reason)

        for pattern, weight, reason in _NAME_BOOST_PATTERNS:
            if pattern.search(chunk.name):
                score += weight
                reasons.append(reason)

        line_count = chunk.source.count("\n") + 1
        if line_count >= 80:
            score += 0.35 + min(0.75, log1p(line_count / 80))
            reasons.append("large-chunk")

        if chunk.kind == "unknown":
            score -= 0.25

        unique_reasons = tuple(dict.fromkeys(reasons))
        return ChunkCandidate(chunk=chunk, score=score, reasons=unique_reasons)

    @staticmethod
    def _bm25_like(token_counts: Counter[str], doc_len: int) -> float:
        """
        Small BM25-style scoring function.

        It is intentionally lightweight and deterministic, similar in spirit to
        Elasticsearch's candidate retrieval phase.
        """
        k1 = 1.2
        b = 0.75
        avgdl = 180.0
        length_norm = (1 - b) + b * (doc_len / avgdl)

        score = 0.0
        for term, weight in _TERM_BOOSTS.items():
            tf = token_counts.get(term, 0)
            if tf <= 0:
                continue
            numerator = tf * (k1 + 1)
            denominator = tf + k1 * length_norm
            score += weight * (numerator / denominator)

        return score
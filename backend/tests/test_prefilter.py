"""
Unit tests for PrefilterService.
"""

from unittest.mock import MagicMock

from app.services.chunker import CodeChunk
from app.services.prefilter import PrefilterService


def _settings(max_chunks: int = 2, min_score: float = 0.1):
    settings = MagicMock()
    settings.prefilter_max_chunks = max_chunks
    settings.prefilter_min_score = min_score
    return settings


def test_prefilter_ranks_risky_chunk_higher():
    service = PrefilterService(_settings(max_chunks=2, min_score=0.1))

    risky = CodeChunk(
        name="dangerous_exec",
        kind="function",
        source="def dangerous_exec(cmd):\n    return eval(cmd)",
        start_line=1,
        end_line=2,
        language="python",
    )
    safe = CodeChunk(
        name="sum_values",
        kind="function",
        source="def sum_values(a, b):\n    return a + b",
        start_line=1,
        end_line=2,
        language="python",
    )

    candidates = service.scan([safe, risky])

    assert candidates[0].chunk.name == "dangerous_exec"
    assert candidates[0].score > candidates[1].score


def test_prefilter_select_limits_to_top_k():
    service = PrefilterService(_settings(max_chunks=1, min_score=0.0))

    chunks = [
        CodeChunk(
            name="dangerous_exec",
            kind="function",
            source="def dangerous_exec(cmd):\n    return eval(cmd)",
            start_line=1,
            end_line=2,
            language="python",
        ),
        CodeChunk(
            name="do_work",
            kind="function",
            source="def do_work(x):\n    return x * 2",
            start_line=1,
            end_line=2,
            language="python",
        ),
    ]

    selected = service.select(service.scan(chunks))

    assert len(selected) == 1
    assert selected[0].name == "dangerous_exec"

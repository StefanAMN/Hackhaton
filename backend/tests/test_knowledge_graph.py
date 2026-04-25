"""
Unit tests for persistent KnowledgeGraphService memory.
"""

from types import SimpleNamespace

import pytest

from app.models.schemas import ChunkAnalysis
from app.services.chunker import CodeChunk
from app.services.knowledge_graph import KnowledgeGraphService


def _settings(store_path: str):
    return SimpleNamespace(
        knowledge_graph_enabled=True,
        knowledge_graph_store_path=store_path,
        knowledge_graph_max_nodes=500,
    )


@pytest.mark.asyncio
async def test_knowledge_graph_learns_and_returns_stats(tmp_path):
    store = tmp_path / "kg.json"
    graph = KnowledgeGraphService(_settings(str(store)))

    chunk = CodeChunk(
        name="dangerous_exec",
        kind="function",
        source="def dangerous_exec(cmd):\n    return eval(cmd)",
        start_line=1,
        end_line=2,
        language="python",
    )
    analysis = ChunkAnalysis(
        chunk_id="abc",
        chunk_name="dangerous_exec",
        source_code=chunk.source,
        cached=False,
        docstring="Doc",
        bugs_and_vulnerabilities=["eval() poate permite remote code execution"],
        junior_summary="Rezumat",
    )

    result = await graph.learn_from_analysis([chunk], [analysis])
    stats = await graph.get_stats()

    assert result["nodes_updated"] == 1
    assert stats["nodes"] >= 1
    assert stats["revision"] >= 1


@pytest.mark.asyncio
async def test_knowledge_graph_context_and_boost(tmp_path):
    store = tmp_path / "kg.json"
    graph = KnowledgeGraphService(_settings(str(store)))

    chunk = CodeChunk(
        name="dangerous_exec",
        kind="function",
        source="def dangerous_exec(cmd):\n    return eval(cmd)",
        start_line=1,
        end_line=2,
        language="python",
    )
    analysis = ChunkAnalysis(
        chunk_id="abc",
        chunk_name="dangerous_exec",
        source_code=chunk.source,
        cached=False,
        docstring="Doc",
        bugs_and_vulnerabilities=["eval() poate permite remote code execution"],
        junior_summary="Rezumat",
    )

    await graph.learn_from_analysis([chunk], [analysis])

    memory = await graph.build_memory_context([chunk], top_k=2)
    boosts = await graph.get_chunk_boosts([chunk])

    assert "dangerous_exec" in memory
    assert memory["dangerous_exec"].score > 0
    assert boosts.get("dangerous_exec", 0) > 0

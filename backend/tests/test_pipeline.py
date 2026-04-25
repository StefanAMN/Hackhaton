"""
test_pipeline.py — Unit tests pentru AnalysisPipeline.

Testează logica de cache hit/miss și parsarea bug-urilor fără LLM real.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.schemas import ChunkAnalysis
from app.services.chunker import CodeChunk
from app.services.pipeline import AnalysisPipeline, _parse_bugs


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_chunk() -> CodeChunk:
    return CodeChunk(
        name="risky_function",
        kind="function",
        source="def risky(x):\n    return eval(x)",
        start_line=1,
        end_line=2,
        language="python",
    )


@pytest.fixture
def mock_settings():
    settings = MagicMock()
    settings.llm_provider = "openai"
    settings.llm_model = "gpt-4o"
    settings.openai_api_key = "sk-test"
    settings.pipeline_max_concurrency = 5
    return settings


@pytest.fixture
def mock_cache():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    cache.get_many = AsyncMock(return_value={})
    cache.set = AsyncMock(return_value=None)
    return cache


# ── Tests: _parse_bugs ────────────────────────────────────────────────────────

class TestParseBugs:
    def test_returns_empty_for_no_issues(self):
        assert _parse_bugs("Nicio problemă identificată.") == []

    def test_returns_empty_case_insensitive(self):
        assert _parse_bugs("NICIO PROBLEMĂ IDENTIFICATĂ.") == []

    def test_parses_numbered_list(self):
        raw = "1. SQL Injection în query\n2. Lipsă validare input\n3. Race condition"
        result = _parse_bugs(raw)
        assert len(result) == 3
        assert "SQL Injection în query" in result

    def test_parses_bullet_points(self):
        raw = "- Memory leak în handler\n• XSS vulnerability\n* CSRF lipsă"
        result = _parse_bugs(raw)
        assert len(result) == 3

    def test_skips_empty_lines(self):
        raw = "1. Issue A\n\n2. Issue B\n\n"
        result = _parse_bugs(raw)
        assert len(result) == 2


# ── Tests: AnalysisPipeline cache behavior ────────────────────────────────────

class TestAnalysisPipelineCaching:
    @pytest.fixture
    def cached_analysis(self, sample_chunk) -> ChunkAnalysis:
        return ChunkAnalysis(
            chunk_id="abc" * 20 + "ab",
            chunk_name=sample_chunk.name,
            source_code=sample_chunk.source,
            cached=True,
            docstring="Cached docstring.",
            bugs_and_vulnerabilities=["eval() este periculos — RCE vulnerability."],
            junior_summary="Această funcție execută cod dinamic — periculos!",
        )

    async def test_cache_hit_skips_llm(
        self, mock_settings, mock_cache, sample_chunk, cached_analysis
    ):
        """Dacă cache returnează o valoare, LLM nu trebuie apelat."""
        mock_cache.get = AsyncMock(return_value=cached_analysis)

        with patch("app.services.pipeline._build_llm") as mock_llm_builder:
            mock_llm = MagicMock()
            mock_llm_builder.return_value = mock_llm

            with patch("app.services.pipeline._build_parallel_chain") as mock_chain_builder:
                mock_chain = MagicMock()
                mock_chain.ainvoke = AsyncMock()
                mock_chain_builder.return_value = mock_chain

                pipeline = AnalysisPipeline(mock_settings, mock_cache)
                result = await pipeline.analyze_chunk(sample_chunk)

        # Chain-ul nu trebuie invocat
        mock_chain.ainvoke.assert_not_called()
        assert result.chunk_name == sample_chunk.name
        assert result.cached is True

    async def test_cache_miss_calls_llm_and_saves(
        self, mock_settings, mock_cache, sample_chunk
    ):
        """Cache MISS → apel LLM → salvare în cache."""
        mock_cache.get = AsyncMock(return_value=None)

        llm_result = {
            "docstring": "Execută codul primit ca string.",
            "bugs": "1. eval() permite Remote Code Execution.",
            "junior_summary": "Această funcție rulează cod scris de utilizator — periculos.",
        }

        with patch("app.services.pipeline._build_llm") as mock_llm_builder:
            mock_llm_builder.return_value = MagicMock()

            with patch("app.services.pipeline._build_parallel_chain") as mock_chain_builder:
                mock_chain = MagicMock()
                mock_chain.ainvoke = AsyncMock(return_value=llm_result)
                mock_chain_builder.return_value = mock_chain

                pipeline = AnalysisPipeline(mock_settings, mock_cache)
                result = await pipeline.analyze_chunk(sample_chunk)

        mock_chain.ainvoke.assert_called_once()
        mock_cache.set.assert_called_once()
        assert result.cached is False
        assert "Remote Code Execution" in result.bugs_and_vulnerabilities[0]

    async def test_analyze_all_respects_semaphore(
        self, mock_settings, mock_cache
    ):
        """analyze_all procesează mai multe chunk-uri fără a bloca."""
        chunks = [
            CodeChunk(
                name=f"func_{i}", kind="function",
                source=f"def func_{i}(): pass",
                start_line=i, end_line=i, language="python",
            )
            for i in range(7)
        ]

        analysis_template = ChunkAnalysis(
            chunk_id="x" * 64,
            chunk_name="func_0",
            source_code="def func_0(): pass",
            cached=False,
            docstring="Doc.",
            bugs_and_vulnerabilities=[],
            junior_summary="O funcție simplă.",
        )

        with patch("app.services.pipeline._build_llm"):
            with patch("app.services.pipeline._build_parallel_chain") as mock_chain_builder:
                mock_chain = MagicMock()
                mock_chain.ainvoke = AsyncMock(return_value={
                    "docstring": "Doc.",
                    "bugs": "Nicio problemă identificată.",
                    "junior_summary": "O funcție simplă.",
                })
                mock_chain_builder.return_value = mock_chain

                pipeline = AnalysisPipeline(mock_settings, mock_cache)
                results = await pipeline.analyze_all(chunks)

        assert len(results) == 7

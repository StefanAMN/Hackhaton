"""
conftest.py — Fixture-uri pytest partajate pentru întregul test suite.

Strategia de mock:
  - Niciun test nu necesită Redis, PostgreSQL sau un LLM real.
  - CacheService și AnalysisPipeline sunt mock-uite.
  - app.state este populat cu mock-uri înainte de fiecare test (pattern
    compatibil cu dependency injection din app.state, nu din Depends).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport

from app.main import app
from app.models.schemas import ChunkAnalysis
from app.services.cache import CacheService
from app.services.pipeline import AnalysisPipeline


# ── Shared mock data ──────────────────────────────────────────────────────────

SAMPLE_PYTHON_CODE = """\
def calculate_discount(price: float, discount_pct: float) -> float:
    \"\"\"Calculates price after discount.\"\"\"
    if discount_pct < 0 or discount_pct > 100:
        raise ValueError("Discount must be between 0 and 100")
    return price * (1 - discount_pct / 100)

class ShoppingCart:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add_item(self, name: str, price: float) -> None:
        self.items.append({"name": name, "price": price})

    def total(self) -> float:
        return sum(item["price"] for item in self.items)
"""

MOCK_CHUNK_ANALYSIS = ChunkAnalysis(
    chunk_id="deadbeef" * 8,
    chunk_name="calculate_discount",
    source_code="def calculate_discount(price, discount_pct): ...",
    cached=False,
    docstring=(
        "Calculate the final price after applying a percentage discount.\n\n"
        "Args:\n    price: Original price.\n    discount_pct: Discount percentage (0-100).\n\n"
        "Returns:\n    Discounted price as float."
    ),
    bugs_and_vulnerabilities=[
        "Nu există validare pentru prețul negativ — ar trebui adăugat.",
    ],
    junior_summary=(
        "Această funcție primește un preț și un procent de reducere, "
        "apoi calculează cât costă produsul după aplicarea reducerii. "
        "De exemplu, dacă prețul e 100 și reducerea e 20%, rezultatul e 80."
    ),
)


# ── Cache mock (no-op) ────────────────────────────────────────────────────────

@pytest.fixture
def mock_cache() -> CacheService:
    """CacheService care returnează întotdeauna cache MISS (None pe get)."""
    cache = MagicMock(spec=CacheService)
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock(return_value=None)
    cache.close = AsyncMock(return_value=None)
    return cache


# ── Pipeline mock ─────────────────────────────────────────────────────────────

@pytest.fixture
def mock_pipeline(mock_cache) -> AnalysisPipeline:
    """AnalysisPipeline cu analyze_all mock-uit să returneze MOCK_CHUNK_ANALYSIS."""
    pipeline = MagicMock(spec=AnalysisPipeline)
    pipeline.analyze_all = AsyncMock(return_value=[MOCK_CHUNK_ANALYSIS])
    pipeline.analyze_chunk = AsyncMock(return_value=MOCK_CHUNK_ANALYSIS)
    return pipeline


# ── Async HTTP client cu app.state injectat ───────────────────────────────────

@pytest.fixture
async def client(mock_pipeline, mock_cache):
    """
    AsyncClient cu app.state populat cu mock-uri.
    Compatibil cu pattern-ul de singleton din lifespan.
    """
    # Injectăm mock-urile direct în app.state (bypass lifespan)
    app.state.cache = mock_cache
    app.state.pipeline = mock_pipeline

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac

    # Cleanup state după test
    if hasattr(app.state, "cache"):
        del app.state.cache
    if hasattr(app.state, "pipeline"):
        del app.state.pipeline


# ── Client fără overrides (pentru teste de infra / headers) ──────────────────

@pytest.fixture
async def raw_client():
    """
    AsyncClient fără mock-uri.
    ATENȚIE: testele care folosesc acest fixture nu pot apela /analyze
    fără să injecteze manual app.state.pipeline și app.state.cache.
    Util pentru /health și teste de security headers.
    """
    # State minimal pentru a nu crăpa la startup
    app.state.cache = MagicMock(spec=CacheService)
    app.state.pipeline = MagicMock(spec=AnalysisPipeline)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac

    if hasattr(app.state, "cache"):
        del app.state.cache
    if hasattr(app.state, "pipeline"):
        del app.state.pipeline

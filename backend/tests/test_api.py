"""
Integration tests pentru endpoint-ul /analyze.
Folosește mock-uri pentru LLM și Redis — nu necesită servicii externe.

Rulare: pytest tests/ -v
"""
import pytest

from tests.conftest import SAMPLE_PYTHON_CODE, MOCK_CHUNK_ANALYSIS


# ── Endpoint: POST /analyze/ (JSON) ──────────────────────────────────────────

async def test_analyze_json_success(client):
    response = await client.post(
        "/api/v1/analyze/",
        json={"code": SAMPLE_PYTHON_CODE, "language": "python"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["language_detected"] == "python"
    assert data["total_chunks"] >= 1
    assert "processing_time_ms" in data
    assert isinstance(data["chunks"], list)
    assert len(data["chunks"]) >= 1


async def test_analyze_json_chunk_structure(client):
    """Verifică că fiecare chunk are câmpurile obligatorii."""
    response = await client.post(
        "/api/v1/analyze/",
        json={"code": SAMPLE_PYTHON_CODE, "language": "python"},
    )

    assert response.status_code == 200
    chunk = response.json()["chunks"][0]

    required_fields = {
        "chunk_id", "chunk_name", "source_code", "cached",
        "docstring", "bugs_and_vulnerabilities", "junior_summary",
    }
    assert required_fields.issubset(chunk.keys()), (
        f"Câmpuri lipsă: {required_fields - chunk.keys()}"
    )


async def test_analyze_json_auto_language_detection(client):
    """Dacă language='auto', serverul trebuie să detecteze corect Python."""
    response = await client.post(
        "/api/v1/analyze/",
        json={"code": SAMPLE_PYTHON_CODE, "language": "auto"},
    )

    assert response.status_code == 200
    assert response.json()["language_detected"] == "python"


async def test_analyze_too_short_code(client):
    """Pydantic validare: min_length=10 pe câmpul 'code'."""
    response = await client.post(
        "/api/v1/analyze/",
        json={"code": "x=1", "language": "python"},
    )
    assert response.status_code == 422


async def test_analyze_missing_code_field(client):
    """Câmpul 'code' este obligatoriu."""
    response = await client.post(
        "/api/v1/analyze/",
        json={"language": "python"},
    )
    assert response.status_code == 422


async def test_analyze_invalid_language(client):
    """Limbaj necunoscut → 422 de la Pydantic (nu e în enum)."""
    response = await client.post(
        "/api/v1/analyze/",
        json={"code": SAMPLE_PYTHON_CODE, "language": "cobol"},
    )
    assert response.status_code == 422


# ── Endpoint: GET /health ─────────────────────────────────────────────────────

async def test_health_check(raw_client):
    response = await raw_client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "llm_provider" in data


async def test_memory_stats_endpoint(client):
    response = await client.get("/api/v1/analyze/memory/stats")
    assert response.status_code == 200
    data = response.json()
    assert "revision" in data
    assert "nodes" in data


# ── Security headers ──────────────────────────────────────────────────────────

async def test_security_headers_present(raw_client):
    """Toate request-urile trebuie să aibă security headers OWASP."""
    response = await raw_client.get("/health")

    expected_headers = {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
    }
    for header, expected_value in expected_headers.items():
        assert header in response.headers, f"Header lipsă: {header}"
        assert response.headers[header] == expected_value, (
            f"Header {header}: expected '{expected_value}', "
            f"got '{response.headers[header]}'"
        )


async def test_hsts_header(raw_client):
    """HSTS trebuie să fie prezent cu max-age corect."""
    response = await raw_client.get("/health")
    hsts = response.headers.get("strict-transport-security", "")
    assert "max-age=" in hsts
    assert "includeSubDomains" in hsts


# ── File upload endpoint ──────────────────────────────────────────────────────

async def test_analyze_file_upload(client):
    """Upload fișier Python via multipart/form-data."""
    file_content = SAMPLE_PYTHON_CODE.encode("utf-8")

    response = await client.post(
        "/api/v1/analyze/upload",
        files={"file": ("calculator.py", file_content, "text/plain")},
        data={"language": "python"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["language_detected"] == "python"
    assert data["total_chunks"] >= 1


async def test_analyze_file_upload_invalid_encoding(client):
    """Fișier binar (non-UTF-8) trebuie să returneze 422."""
    binary_content = bytes(range(256))

    response = await client.post(
        "/api/v1/analyze/upload",
        files={"file": ("binary.bin", binary_content, "application/octet-stream")},
        data={"language": "python"},
    )

    assert response.status_code == 422
    assert "UTF-8" in response.json()["detail"]

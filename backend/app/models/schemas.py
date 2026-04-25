"""
Pydantic schemas — contractul public al API-ului.
"""
from enum import StrEnum
from pydantic import BaseModel, Field


class SupportedLanguage(StrEnum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    JAVA = "java"
    GO = "go"
    AUTO = "auto"  # detectare automată


# ── Request ───────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    """Corpul cererii POST /analyze când codul este trimis ca text."""

    code: str = Field(
        ...,
        min_length=10,
        description="Codul sursă legacy de analizat.",
        examples=["def add(a, b):\n    return a + b"],
    )
    language: SupportedLanguage = Field(
        default=SupportedLanguage.AUTO,
        description="Limbajul de programare al codului.",
    )


# ── Chunk-level results ────────────────────────────────────────────────────────

class ChunkAnalysis(BaseModel):
    """Rezultatul analizei AI pentru un singur chunk (funcție/clasă)."""

    chunk_id: str = Field(description="SHA-256 al conținutului chunk-ului.")
    chunk_name: str = Field(description="Numele funcției sau clasei identificate.")
    source_code: str = Field(description="Codul sursă al chunk-ului.")
    cached: bool = Field(
        default=False,
        description="True dacă rezultatul a fost servit din cache (fără apel API).",
    )

    # Cele 3 output-uri ale pipeline-ului paralel
    docstring: str = Field(description="Docstring generat de AI.")
    bugs_and_vulnerabilities: list[str] = Field(
        description="Lista de bug-uri/vulnerabilități identificate."
    )
    junior_summary: str = Field(
        description="Explicație pe înțelesul unui junior developer."
    )


# ── Top-level response ────────────────────────────────────────────────────────

class AnalyzeResponse(BaseModel):
    """Răspunsul complet al endpoint-ului /analyze."""

    language_detected: str
    total_chunks: int
    chunks: list[ChunkAnalysis]
    processing_time_ms: float

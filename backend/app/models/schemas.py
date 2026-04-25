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
    chunks_detected: int = Field(
        default=0,
        description="Numărul de chunk-uri detectate înainte de prefilter.",
    )
    chunks_analyzed: int = Field(
        default=0,
        description="Numărul de chunk-uri trimise efectiv la AI.",
    )
    chunks_skipped_by_filter: int = Field(
        default=0,
        description="Numărul de chunk-uri eliminate în etapa de prefilter.",
    )
    filter_applied: bool = Field(
        default=False,
        description="True dacă s-a aplicat prefilter înainte de analiză AI.",
    )
    filter_strategy: str = Field(
        default="none",
        description="Strategia de filtrare folosită (de ex. bm25-lite+risk-rules).",
    )
    memory_enabled: bool = Field(
        default=False,
        description="True dacă knowledge graph memory a fost folosită în această analiză.",
    )
    memory_context_chunks: int = Field(
        default=0,
        description="Numărul de chunk-uri pentru care s-a găsit context în memorie.",
    )
    memory_boosted_chunks: int = Field(
        default=0,
        description="Numărul de chunk-uri care au primit memory boost la prefilter.",
    )
    memory_revision: int = Field(
        default=0,
        description="Revisia curentă a knowledge graph-ului.",
    )
    memory_nodes_total: int = Field(
        default=0,
        description="Numărul total de noduri din knowledge graph după ingest.",
    )
    chunks: list[ChunkAnalysis]
    processing_time_ms: float

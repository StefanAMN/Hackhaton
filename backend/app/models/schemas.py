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
    # Dependency graph data (built at scan stage, $0)
    dependency_graph_edges: int = Field(
        default=0,
        description="Numărul de relații de dependență extrase din cod (cost $0).",
    )
    high_impact_symbols: list[str] = Field(
        default_factory=list,
        description="Simbolurile cu cel mai mare impact (cele mai multe dependenți).",
    )
    chunks: list[ChunkAnalysis]
    processing_time_ms: float


# ── Ask endpoint models (graph-first, AI-last) ──────────────────────────────

class AskRequest(BaseModel):
    """Cerere pentru endpoint-ul /ask — graph-first, AI-last."""

    question: str = Field(
        ...,
        min_length=3,
        description="Întrebarea despre cod.",
        examples=["Ce se strică dacă modific funcția calculate_total?"],
    )
    session_id: str = Field(
        default="default",
        description="ID-ul sesiunii. Graful este stocat per sesiune.",
    )
    code: str = Field(
        default="",
        description="Cod sursă opțional. Dacă e furnizat, graful se construiește automat.",
    )
    language: str = Field(
        default="auto",
        description="Limbajul codului sursă.",
    )


class AskResponse(BaseModel):
    """Răspunsul endpoint-ului /ask."""

    question: str
    category: str = Field(description="Categoria întrebării: impact | structural | semantic")
    answered_by: str = Field(description="Cine a răspuns: 'graph' ($0) sau 'ai' (cost)")
    answer: str
    details: dict | None = Field(default=None, description="Detalii suplimentare (impact score, dependenți etc.)")
    graph_context_used: bool = Field(default=False, description="True dacă s-a folosit context din graf.")
    ai_cost_estimated: float = Field(default=0.0, description="Costul AI estimat ($0 dacă answered_by=graph).")
    processing_time_ms: float

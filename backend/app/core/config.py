"""
Core application configuration.
Uses pydantic-settings to load values from environment variables / .env file.
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # ── API ────────────────────────────────────────────────────────────────────
    app_name: str = "Legacy Code Analyzer"
    app_version: str = "0.1.0"
    debug: bool = False
    include_source_by_default: bool = False

    # ── LLM provider ──────────────────────────────────────────────────────────
    # Suportă: "openai" | "anthropic" | "google"
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o"

    # Chei API — setate în .env, niciodată hard-codate
    openai_api_key: str = ""
    openai_base_url: str | None = None
    anthropic_api_key: str = ""
    google_api_key: str = ""

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    cache_ttl_seconds: int = 86_400  # 24 h

    # ── PostgreSQL (opțional – pentru audit log) ───────────────────────────────
    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/code_analyzer"

    # ── Chunking ──────────────────────────────────────────────────────────────
    max_chunk_tokens: int = 2048
    supported_languages: list[str] = ["python", "javascript", "java", "go"]

    # ── Upload limits ─────────────────────────────────────────────────────────
    max_upload_bytes: int = 1_000_000  # 1 MB

    # ── Pipeline tuning ───────────────────────────────────────────────────────
    pipeline_max_concurrency: int = 5

    # ── Prefilter (candidate selection in stil Elasticsearch) ────────────────
    prefilter_upload_enabled: bool = True
    prefilter_json_enabled: bool = False
    prefilter_max_chunks: int = 8
    prefilter_min_score: float = 0.15

    # ── Rate limit ────────────────────────────────────────────────────────────
    rate_limit_max_requests: int = 20
    rate_limit_window_seconds: int = 60

    # ── Knowledge Graph Memory ────────────────────────────────────────────────
    knowledge_graph_enabled: bool = True
    knowledge_graph_store_path: str = "data/knowledge_graph.json"
    knowledge_graph_max_nodes: int = 10_000
    knowledge_graph_context_items: int = 3


@lru_cache
def get_settings() -> Settings:
    """Singleton cu cache — apelat via Depends(get_settings) în FastAPI."""
    return Settings()

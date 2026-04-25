"""
Core application configuration.
Uses pydantic-settings to load values from environment variables / .env file.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ── API ────────────────────────────────────────────────────────────────────
    app_name: str = "Legacy Code Analyzer"
    app_version: str = "0.1.0"
    debug: bool = False

    # ── LLM provider ──────────────────────────────────────────────────────────
    # Suportă: "openai" | "anthropic" | "google"
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o"

    # Chei API — setate în .env, niciodată hard-codate
    openai_api_key: str = ""
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


@lru_cache
def get_settings() -> Settings:
    """Singleton cu cache — apelat via Depends(get_settings) în FastAPI."""
    return Settings()

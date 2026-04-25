"""
main.py — Punctul de intrare al aplicației Legacy Code Analyzer.

Pornire locală:
    uvicorn app.main:app --reload --port 8000

Producție (exemplu):
    gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000

Arhitectură singleton:
    CacheService și AnalysisPipeline sunt inițializate O SINGURĂ DATĂ la startup
    și stocate în app.state. Refolosim conexiunea Redis și clientul LLM
    pentru TOATE request-urile, evitând overhead-ul de reconectare.
"""
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.middleware.security import RateLimitMiddleware, SecurityHeadersMiddleware
from app.routers.analyze import router as analyze_router
from app.services.cache import CacheService
from app.services.pipeline import AnalysisPipeline

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)
settings = get_settings()


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Gestionează resursele aplicației:
      - startup : inițializează CacheService și AnalysisPipeline ca singleton-uri
      - shutdown: închide conexiunea Redis

    De ce singleton și nu Depends()?
      Reconectarea Redis la fiecare request adaugă ~1-5ms latență inutilă
      și poate epuiza pool-ul de conexiuni sub load. Clientul LLM (OpenAI etc.)
      menține intern un httpx.AsyncClient — recrearea lui e costisitoare.
    """
    logger.info(
        "🚀 %s v%s pornit — provider LLM: %s / model: %s",
        settings.app_name,
        settings.app_version,
        settings.llm_provider,
        settings.llm_model,
    )
    logger.info("Redis URL: %s | Cache TTL: %ds", settings.redis_url, settings.cache_ttl_seconds)

    # ── Inițializare singleton-uri ─────────────────────────────────────────
    cache = CacheService(settings)
    pipeline = AnalysisPipeline(settings, cache)

    app.state.cache = cache
    app.state.pipeline = pipeline
    logger.info("✅ CacheService și AnalysisPipeline inițializate.")

    yield

    # ── Cleanup ────────────────────────────────────────────────────────────
    await cache.close()
    logger.info("🛑 Aplicație oprită — conexiuni închise.")


# ── Aplicație FastAPI ─────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "MVP Backend pentru analiza codului legacy folosind AI.\n\n"
        "**Features**: chunking AST/regex, pipeline paralel LangChain, "
        "caching Redis SHA-256, security headers OWASP."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


# ── Middleware (ordinea contează — primul adăugat = ultimul executat) ──────────

# 1. CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.debug else [],  # restrânge în producție!
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# 2. Rate limiting
app.add_middleware(
    RateLimitMiddleware,
    max_requests=20,
    window_seconds=60,
)

# 3. Security headers (OWASP)
app.add_middleware(SecurityHeadersMiddleware)


# ── Request timing middleware (logging) ───────────────────────────────────────

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s → %d  (%.1f ms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(analyze_router, prefix="/api/v1")


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["Infra"], summary="Health check")
async def health_check() -> dict:
    return {
        "status": "ok",
        "version": settings.app_version,
        "llm_provider": settings.llm_provider,
    }


# ── Global exception handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Eroare neașteptată pe %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Eroare internă de server. Verifică log-urile.",
            # Nu expune stack trace în producție
            "error": str(exc) if settings.debug else "Internal Server Error",
        },
    )


# ── Dev entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
        log_level="info",
    )

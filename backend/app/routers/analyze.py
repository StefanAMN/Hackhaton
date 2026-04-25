"""
Router pentru endpoint-ul /analyze.
Suportă două moduri de input:
  1. JSON body  (AnalyzeRequest)
  2. File upload (multipart/form-data)

Dependency design:
  Pipeline-ul și cache-ul sunt singleton-uri stocate în app.state (inițializate
  în lifespan din main.py). Dependenciele de mai jos le extrag din request.app.state,
  evitând crearea de noi instanțe la fiecare request.
"""
import time
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from app.core.config import Settings, get_settings
from app.models.schemas import AnalyzeRequest, AnalyzeResponse, SupportedLanguage
from app.services.cache import CacheService
from app.services.chunker import detect_language, get_chunker
from app.services.pipeline import AnalysisPipeline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["Analysis"])


# ── Dependency injection helpers ──────────────────────────────────────────────

def get_cache(request: Request) -> CacheService:
    """Extrage CacheService singleton din app.state (creat la startup)."""
    return request.app.state.cache


def get_pipeline(request: Request) -> AnalysisPipeline:
    """Extrage AnalysisPipeline singleton din app.state (creat la startup)."""
    return request.app.state.pipeline


# ── Endpoint 1: JSON body ─────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=AnalyzeResponse,
    summary="Analizează cod legacy (JSON)",
    description=(
        "Primește cod sursă ca text JSON și returnează docstrings, "
        "bug-uri/vulnerabilități și sumar junior pentru fiecare funcție/clasă."
    ),
)
async def analyze_json(
    body: AnalyzeRequest,
    pipeline: Annotated[AnalysisPipeline, Depends(get_pipeline)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AnalyzeResponse:
    return await _run_analysis(
        code=body.code,
        language_hint=body.language,
        pipeline=pipeline,
        settings=settings,
    )


# ── Endpoint 2: File upload ───────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=AnalyzeResponse,
    summary="Analizează cod legacy (fișier)",
    description="Primește un fișier sursă via multipart/form-data.",
)
async def analyze_file(
    pipeline: Annotated[AnalysisPipeline, Depends(get_pipeline)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(..., description="Fișierul sursă de analizat."),
    language: Optional[str] = Form(default="auto"),
) -> AnalyzeResponse:
    content = await file.read()
    try:
        code = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Fișierul nu poate fi decodat ca UTF-8. Verifică encoding-ul.",
        )

    lang_hint = SupportedLanguage(language) if language else SupportedLanguage.AUTO
    return await _run_analysis(
        code=code,
        language_hint=lang_hint,
        pipeline=pipeline,
        settings=settings,
    )


# ── Core logic (shared) ───────────────────────────────────────────────────────

async def _run_analysis(
    code: str,
    language_hint: SupportedLanguage,
    pipeline: AnalysisPipeline,
    settings: Settings,
) -> AnalyzeResponse:
    """
    Orchestrează fluxul complet:
    detectare limbaj → chunking → pipeline AI → agregare rezultate.
    """
    start_ms = time.perf_counter()

    # 1. Detectare limbaj
    language = detect_language(code, hint=language_hint.value)

    if language not in settings.supported_languages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Limbajul '{language}' nu este suportat. "
                f"Limbi acceptate: {settings.supported_languages}"
            ),
        )

    # 2. Chunking
    chunker = get_chunker(language)
    chunks = chunker.chunk(code, language)
    logger.info("Chunk-uri identificate: %d pentru limbajul '%s'", len(chunks), language)

    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nu au fost identificate structuri de cod (funcții/clase).",
        )

    # 3. Analiză AI paralelă
    chunk_results = await pipeline.analyze_all(chunks)

    elapsed_ms = (time.perf_counter() - start_ms) * 1000

    return AnalyzeResponse(
        language_detected=language,
        total_chunks=len(chunk_results),
        chunks=chunk_results,
        processing_time_ms=round(elapsed_ms, 2),
    )

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
import logging
import time
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status

from app.core.config import Settings, get_settings
from app.models.schemas import AnalyzeRequest, AnalyzeResponse, SupportedLanguage
from app.services.cache import CacheService
from app.services.chunker import detect_language, get_chunker, split_chunks_by_token_limit
from app.services.dependency_graph import DependencyGraphService
from app.services.knowledge_graph import KnowledgeGraphService
from app.services.pipeline import AnalysisPipeline
from app.services.prefilter import PrefilterService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["Analysis"])


# ── Dependency injection helpers ──────────────────────────────────────────────

def get_cache(request: Request) -> CacheService:
    """Extrage CacheService singleton din app.state (creat la startup)."""
    return request.app.state.cache


def get_pipeline(request: Request) -> AnalysisPipeline:
    """Extrage AnalysisPipeline singleton din app.state (creat la startup)."""
    return request.app.state.pipeline


def get_knowledge_graph(request: Request) -> KnowledgeGraphService:
    """Extrage KnowledgeGraphService singleton din app.state (creat la startup)."""
    return request.app.state.knowledge_graph


def get_dep_graph(request: Request) -> DependencyGraphService:
    """Extrage DependencyGraphService singleton din app.state (creat la startup)."""
    return request.app.state.dependency_graph


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
    knowledge_graph: Annotated[KnowledgeGraphService, Depends(get_knowledge_graph)],
    dep_graph: Annotated[DependencyGraphService, Depends(get_dep_graph)],
    settings: Annotated[Settings, Depends(get_settings)],
    include_source: Optional[bool] = Query(
        default=None,
        description="Include codul sursă în răspuns. Implicit false pentru payload mai mic.",
    ),
    use_prefilter: Optional[bool] = Query(
        default=None,
        description="Activează prefilter înainte de AI (candidate selection).",
    ),
) -> AnalyzeResponse:
    resolved_include_source = settings.include_source_by_default if include_source is None else include_source
    resolved_prefilter = settings.prefilter_json_enabled if use_prefilter is None else use_prefilter

    return await _run_analysis(
        code=body.code,
        language_hint=body.language,
        pipeline=pipeline,
        knowledge_graph=knowledge_graph,
        dep_graph=dep_graph,
        settings=settings,
        use_prefilter=resolved_prefilter,
        include_source=resolved_include_source,
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
    knowledge_graph: Annotated[KnowledgeGraphService, Depends(get_knowledge_graph)],
    dep_graph: Annotated[DependencyGraphService, Depends(get_dep_graph)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(..., description="Fișierul sursă de analizat."),
    language: Optional[str] = Form(default="auto"),
    include_source: Optional[bool] = Form(default=None),
    use_prefilter: Optional[bool] = Form(default=None),
) -> AnalyzeResponse:
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "Fișierul depășește limita permisă. "
                f"Maxim: {settings.max_upload_bytes} bytes."
            ),
        )

    try:
        code = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Fișierul nu poate fi decodat ca UTF-8. Verifică encoding-ul.",
        )

    language_value = (language or SupportedLanguage.AUTO.value).strip().lower()
    try:
        lang_hint = SupportedLanguage(language_value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Limbaj invalid pentru upload: '{language_value}'. "
                f"Valori acceptate: {[item.value for item in SupportedLanguage]}"
            ),
        )

    resolved_include_source = settings.include_source_by_default if include_source is None else include_source
    resolved_prefilter = settings.prefilter_upload_enabled if use_prefilter is None else use_prefilter

    return await _run_analysis(
        code=code,
        language_hint=lang_hint,
        pipeline=pipeline,
        knowledge_graph=knowledge_graph,
        dep_graph=dep_graph,
        settings=settings,
        use_prefilter=resolved_prefilter,
        include_source=resolved_include_source,
    )


@router.get(
    "/memory/stats",
    summary="Statistici knowledge graph",
    description="Returnează mărimea și revisia memoriei persistente.",
)
async def memory_stats(
    knowledge_graph: Annotated[KnowledgeGraphService, Depends(get_knowledge_graph)],
) -> dict:
    return await knowledge_graph.get_stats()


@router.get(
    "/global_graph",
    summary="Graful global de dependențe",
    description="Returnează snapshot-ul grafului global acumulat în memorie.",
)
async def get_global_graph(
    dep_graph: Annotated[DependencyGraphService, Depends(get_dep_graph)],
) -> dict:
    snapshot = dep_graph.get_snapshot()
    if not snapshot:
        return {"nodes": {}, "edges": []}
    return snapshot.to_dict()


# ── Core logic (shared) ───────────────────────────────────────────────────────

async def _run_analysis(
    code: str,
    language_hint: SupportedLanguage,
    pipeline: AnalysisPipeline,
    knowledge_graph: KnowledgeGraphService,
    dep_graph: DependencyGraphService,
    settings: Settings,
    use_prefilter: bool = False,
    include_source: bool = False,
) -> AnalyzeResponse:
    """
    Orchestrează fluxul complet:
    detectare limbaj → chunking + token budget → prefilter (opțional) → AI.
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
    raw_chunks = chunker.chunk(code, language)
    chunks = split_chunks_by_token_limit(raw_chunks, settings.max_chunk_tokens)
    logger.info("Chunk-uri identificate: %d pentru limbajul '%s'", len(chunks), language)

    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nu au fost identificate structuri de cod (funcții/clase).",
        )

    chunks_detected = len(chunks)
    chunks_for_ai = chunks
    filter_strategy = "none"
    memory_context_map: dict[str, str] = {}
    memory_boosts: dict[str, float] = {}
    memory_context_chunks = 0
    memory_boosted_chunks = 0
    memory_revision = 0
    memory_nodes_total = 0
    dep_graph_edges = 0
    high_impact_symbols: list[str] = []

    # 2b. Dependency graph (cost $0 — regex only)
    import hashlib
    session_id = hashlib.sha256(code.encode()).hexdigest()[:16]
    try:
        snapshot = dep_graph.build_from_chunks(session_id, chunks, code)
        dep_graph_edges = len(snapshot.edges)
        summary = dep_graph.get_summary(session_id)
        high_impact_symbols = [
            s["name"]
            for s in summary.get("high_impact_symbols", [])
        ]
        logger.info(
            "Dependency graph: %d edges, %d high-impact symbols",
            dep_graph_edges,
            len(high_impact_symbols),
        )
    except Exception as e:
        logger.warning("Dependency graph extraction failed (non-critical): %s", e)

    if settings.knowledge_graph_enabled:
        memory_contexts = await knowledge_graph.build_memory_context(
            chunks,
            top_k=settings.knowledge_graph_context_items,
        )
        memory_context_map = {
            chunk_name: context.text
            for chunk_name, context in memory_contexts.items()
        }
        memory_context_chunks = len(memory_context_map)

        memory_boosts = await knowledge_graph.get_chunk_boosts(chunks)
        memory_boosted_chunks = len(memory_boosts)
        memory_revision = await knowledge_graph.get_revision()

    # 3. Prefilter inspired by Elasticsearch: cheap scan first, AI after
    if use_prefilter and len(chunks) > 1:
        prefilter = PrefilterService(settings)
        candidates = prefilter.scan(chunks)

        if memory_boosts:
            candidates = prefilter.apply_memory_boost(candidates, memory_boosts)
            filter_strategy = f"{prefilter.strategy_name}+knowledge-graph"
        else:
            filter_strategy = prefilter.strategy_name

        chunks_for_ai = prefilter.select(candidates)

        logger.info(
            "Prefilter activ: detectate=%d, selectate=%d, top=%s",
            chunks_detected,
            len(chunks_for_ai),
            prefilter.preview(candidates),
        )

    # 4. Analiză AI paralelă doar pe candidații selectați
    selected_memory_context = {
        chunk.name: memory_context_map.get(
            chunk.name,
            "Nu există context istoric relevant.",
        )
        for chunk in chunks_for_ai
    }
    chunk_results = await pipeline.analyze_all(
        chunks_for_ai,
        memory_contexts=selected_memory_context,
        memory_revision=memory_revision,
    )

    if settings.knowledge_graph_enabled and chunk_results:
        await knowledge_graph.learn_from_analysis(chunks_for_ai, chunk_results)
        memory_stats_snapshot = await knowledge_graph.get_stats()
        memory_nodes_total = int(memory_stats_snapshot.get("nodes", 0))
        memory_revision = int(memory_stats_snapshot.get("revision", memory_revision))

    # 5. Payload trimming (mai rapid și mai ieftin la transfer)
    if not include_source:
        chunk_results = [
            result.model_copy(update={"source_code": ""})
            for result in chunk_results
        ]

    elapsed_ms = (time.perf_counter() - start_ms) * 1000

    return AnalyzeResponse(
        language_detected=language,
        total_chunks=len(chunk_results),
        chunks_detected=chunks_detected,
        chunks_analyzed=len(chunks_for_ai),
        chunks_skipped_by_filter=max(0, chunks_detected - len(chunks_for_ai)),
        filter_applied=use_prefilter,
        filter_strategy=filter_strategy,
        memory_enabled=settings.knowledge_graph_enabled,
        memory_context_chunks=memory_context_chunks,
        memory_boosted_chunks=memory_boosted_chunks,
        memory_revision=memory_revision,
        memory_nodes_total=memory_nodes_total,
        chunks=chunk_results,
        processing_time_ms=round(elapsed_ms, 2),
        dependency_graph_edges=dep_graph_edges,
        high_impact_symbols=high_impact_symbols,
    )

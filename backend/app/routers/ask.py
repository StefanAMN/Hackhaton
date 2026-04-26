"""
Router /ask — endpoint-ul inteligent graph-first, AI-last.

Flux:
  1. Clasifică întrebarea (regex, $0)
  2. Dacă e IMPACT sau STRUCTURAL → răspuns instant din graf ($0)
  3. Dacă e SEMANTIC → enriched context din graf + AI pipeline (cost redus)

Acest endpoint înlocuiește nevoia de a trimite tot codul la AI
pentru întrebări care pot fi rezolvate din structura codului.
"""
import logging
import time
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.models.schemas import AskRequest, AskResponse, SupportedLanguage
from app.services.chunker import detect_language, get_chunker, split_chunks_by_token_limit
from app.services.dependency_graph import DependencyGraphService
from app.services.knowledge_graph import KnowledgeGraphService
from app.services.pipeline import AnalysisPipeline
from app.services.question_router import QuestionRouter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ask", tags=["Ask (Graph-First)"])


# ── Dependency injection ──────────────────────────────────────────────────────

def get_dep_graph(request: Request) -> DependencyGraphService:
    return request.app.state.dependency_graph


def get_pipeline(request: Request) -> AnalysisPipeline:
    return request.app.state.pipeline


def get_knowledge_graph(request: Request) -> KnowledgeGraphService:
    return request.app.state.knowledge_graph


# ── POST /ask — graph-first, AI-last ─────────────────────────────────────────

@router.post(
    "/",
    response_model=AskResponse,
    summary="Întreabă despre cod (graph-first, AI-last)",
    description=(
        "Clasifică întrebarea și răspunde din dependency graph dacă e posibil. "
        "AI-ul este apelat doar ca fallback pentru întrebări semantice."
    ),
)
async def ask_question(
    body: AskRequest,
    dep_graph: Annotated[DependencyGraphService, Depends(get_dep_graph)],
    pipeline: Annotated[AnalysisPipeline, Depends(get_pipeline)],
    knowledge_graph: Annotated[KnowledgeGraphService, Depends(get_knowledge_graph)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AskResponse:
    start_ms = time.perf_counter()

    session_id = body.session_id
    question = body.question.strip()

    if not question:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Întrebarea nu poate fi goală.",
        )

    # Verifică dacă avem un graf pentru această sesiune
    snapshot = dep_graph.get_snapshot(session_id)

    # Dacă nu avem graf dar avem cod, construim graful pe loc
    if snapshot is None and body.code:
        language = detect_language(body.code, hint=body.language or "auto")
        chunker = get_chunker(language)
        chunks = chunker.chunk(body.code, language)
        chunks = split_chunks_by_token_limit(chunks, settings.max_chunk_tokens)
        dep_graph.build_from_chunks(session_id, chunks, body.code)

    # Clasificare + rutare
    question_router = QuestionRouter(dep_graph)
    answer = question_router.answer(question, session_id)

    # Dacă e semantic și avem cod, facem fallback la AI
    if answer.answered_by == "ai" and body.code:
        classified = question_router.classify(question)
        ai_answer = await _ai_fallback(
            question=question,
            code=body.code,
            language=body.language or "auto",
            graph_context=answer.graph_context,
            pipeline=pipeline,
            settings=settings,
            extracted_symbol=classified.extracted_symbol,
            dep_graph=dep_graph,
            session_id=session_id,
        )
        answer.answer = ai_answer
        answer.ai_cost = 0.002  # cost redus conform noii arhitecturi

    elif answer.answered_by == "ai" and not body.code:
        answer.answer = (
            "Această întrebare necesită analiză AI, dar nu am codul sursă. "
            "Te rog trimite și codul sau încarcă-l mai întâi prin /analyze."
        )

    elapsed_ms = (time.perf_counter() - start_ms) * 1000

    return AskResponse(
        question=answer.question,
        category=answer.category,
        answered_by=answer.answered_by,
        answer=answer.answer,
        details=answer.details,
        graph_context_used=bool(answer.graph_context),
        ai_cost_estimated=answer.ai_cost,
        processing_time_ms=round(elapsed_ms, 2),
    )


# ── POST /ask/scan — scan code and build graph ───────────────────────────────

@router.post(
    "/scan",
    summary="Scanează cod și construiește dependency graph ($0)",
    description=(
        "Analizează codul fără AI — doar construiește dependency graph. "
        "Cost: $0. Folosește sesiunea returnată pentru întrebări ulterioare."
    ),
)
async def scan_code(
    body: AskRequest,
    dep_graph: Annotated[DependencyGraphService, Depends(get_dep_graph)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    if not body.code:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Codul sursă este obligatoriu pentru scan.",
        )

    start_ms = time.perf_counter()

    language = detect_language(body.code, hint=body.language or "auto")
    chunker = get_chunker(language)
    chunks = chunker.chunk(body.code, language)
    chunks = split_chunks_by_token_limit(chunks, settings.max_chunk_tokens)

    snapshot = dep_graph.build_from_chunks(body.session_id, chunks, body.code)
    summary = dep_graph.get_summary(body.session_id)

    elapsed_ms = (time.perf_counter() - start_ms) * 1000

    return {
        "session_id": body.session_id,
        "language_detected": language,
        "scan_cost": 0.0,
        "nodes": summary.get("total_nodes", 0),
        "edges": summary.get("total_edges", 0),
        "edge_types": summary.get("edge_types", {}),
        "high_impact_symbols": summary.get("high_impact_symbols", []),
        "symbols": summary.get("symbols", []),
        "processing_time_ms": round(elapsed_ms, 2),
    }


# ── GET /ask/graph — get current graph ────────────────────────────────────────

@router.get(
    "/graph/{session_id}",
    summary="Obține dependency graph pentru o sesiune",
)
async def get_graph(
    session_id: str,
    dep_graph: Annotated[DependencyGraphService, Depends(get_dep_graph)],
) -> dict:
    snapshot = dep_graph.get_snapshot(session_id)
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nu există graf pentru sesiunea '{session_id}'. Scanează codul mai întâi.",
        )

    summary = dep_graph.get_summary(session_id)

    # Include edges for frontend visualization
    edges = [
        {"source": e.source, "target": e.target, "relation": e.relation}
        for e in snapshot.edges
    ]

    nodes = [
        {
            "name": n.name,
            "kind": n.kind,
            "in_degree": n.in_degree,
            "out_degree": n.out_degree,
            "start_line": n.start_line,
            "end_line": n.end_line,
        }
        for n in snapshot.nodes.values()
    ]

    return {
        "session_id": session_id,
        "nodes": nodes,
        "edges": edges,
        "summary": summary,
    }


# ── AI fallback (semantic questions only) ─────────────────────────────────────

async def _ai_fallback(
    question: str,
    code: str,
    language: str,
    graph_context: str,
    pipeline: AnalysisPipeline,
    settings: Settings,
    extracted_symbol: Optional[str] = None,
    dep_graph: Optional[DependencyGraphService] = None,
    session_id: Optional[str] = None,
) -> str:
    """
    Fallback AI pentru întrebări semantice.
    Folosește graph_context ca enrichment (reduce halucinările).
    IMPLEMENTARE FILTER (PASUL 02): Extrage doar codul relevant din dependency graph.
    """
    detected_lang = detect_language(code, hint=language)
    chunker = get_chunker(detected_lang)
    chunks = chunker.chunk(code, detected_lang)
    
    relevant_chunks = []
    
    # 02 FILTER: Find the route and extract only relevant connected code
    if extracted_symbol and dep_graph and session_id:
        snapshot = dep_graph.get_snapshot(session_id)
        if snapshot:
            related_symbols = {extracted_symbol}
            # Add direct callers and callees to the relevant set
            for e in snapshot.edges:
                if e.source == extracted_symbol:
                    related_symbols.add(e.target)
                elif e.target == extracted_symbol:
                    related_symbols.add(e.source)
            
            # Extract only the chunks that match our related symbols
            for c in chunks:
                if any(sym.lower() in c.name.lower() or sym in c.source for sym in related_symbols):
                    relevant_chunks.append(c)

    # Dacă filtrarea nu a găsit nimic sau nu am avut simbol extras, 
    # trimitem un fallback minimal (max 2 chunk-uri) pentru a nu face rate limit
    if not relevant_chunks:
        chunks = split_chunks_by_token_limit(chunks, settings.max_chunk_tokens)
        relevant_chunks = chunks[:2]
    else:
        # Ne asigurăm că și chunk-urile filtrate respectă limita de tokeni
        relevant_chunks = split_chunks_by_token_limit(relevant_chunks, settings.max_chunk_tokens)
        relevant_chunks = relevant_chunks[:3] # Max 3 context windows

    if not relevant_chunks:
        return "Nu am putut identifica structuri de cod pentru analiză."

    logger.info(f"02 FILTER: Extracted {len(relevant_chunks)} relevant chunks for AI based on dependency graph.")

    # 03 ANSWER: Ask the Expert (AI receives just the filtered context)
    results = await pipeline.analyze_all(
        relevant_chunks,
        memory_contexts={
            c.name: f"Context:\nUser question: {question}\n{graph_context}"
            for c in relevant_chunks
        },
    )

    if not results:
        return "Nu am putut genera un răspuns."

    # Combină rezultatele
    parts = []
    for r in results:
        if r.junior_summary:
            parts.append(f"**{r.chunk_name}**: {r.junior_summary}")
        if r.bugs_and_vulnerabilities:
            parts.append(f"Probleme potențiale: {', '.join(r.bugs_and_vulnerabilities[:3])}")

    return "\n\n".join(parts) if parts else "Analiza nu a returnat rezultate relevante."

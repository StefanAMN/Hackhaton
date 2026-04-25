"""
AI Pipeline — inima sistemului.

Pentru fiecare CodeChunk, rulează în PARALEL 3 task-uri LangChain:
  (a) Generare Docstring
  (b) Analiză Bug-uri & Vulnerabilități
  (c) Sumar pentru junior developer

Arhitectura:
  ┌─────────────────────────────────────────────────────────────┐
  │                     analyze_chunk()                         │
  │                                                             │
  │   chunk ──► cache hit? ──YES──► return cached result       │
  │                │                                            │
  │               NO                                            │
  │                │                                            │
  │         asyncio.gather()                                    │
  │         ┌─────┼──────────────┐                             │
  │         ▼     ▼              ▼                             │
  │    docstring  bugs    junior_summary                        │
  │         └─────┼──────────────┘                             │
  │               │                                            │
  │         ChunkAnalysis ──► cache.set() ──► return           │
  └─────────────────────────────────────────────────────────────┘

NOTE PRIVIND ZERO DATA RETENTION:
─────────────────────────────────
OpenAI:
  Setează header-ul `OpenAI-Project` și asigură-te că organizația ta are
  activată opțiunea "Zero Data Retention" în Settings → Privacy.
  Alternativ, foloseşte Azure OpenAI cu endpoint privat.

Anthropic:
  Anthropic nu reținere datele API în mod implicit (fără fine-tuning).
  Documentul „Usage Policy" confirmă: prompts nu sunt folosite la antrenare.
  Verifică: https://www.anthropic.com/legal/privacy

Google (Gemini):
  Folosește Vertex AI în loc de AI Studio pentru a beneficia de
  contractul DPA (Data Processing Amendment) care garantează că datele
  NU sunt folosite la antrenarea modelelor.
  Referință: https://cloud.google.com/vertex-ai/docs/generative-ai/data-governance
"""

import asyncio
import logging
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableParallel

from app.core.config import Settings
from app.models.schemas import ChunkAnalysis
from app.services.cache import CacheService, compute_cache_key
from app.services.chunker import CodeChunk

logger = logging.getLogger(__name__)


# ── Prompt templates ──────────────────────────────────────────────────────────

DOCSTRING_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Ești un expert în documentarea codului {language}. "
            "Generează un docstring concis și complet în stilul standard al limbajului "
            "(Google style pentru Python, JSDoc pentru JS etc.). "
            "Răspunde DOAR cu docstring-ul, fără explicații suplimentare.",
        ),
        (
            "human",
            "Generează docstring pentru:\n\n```{language}\n{code}\n```",
        ),
    ]
)

BUGS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Ești un senior security engineer și code reviewer. "
            "Analizează codul pentru: bug-uri logice, vulnerabilități de securitate (OWASP Top 10), "
            "race conditions, memory leaks, SQL injection, XSS, etc. "
            "Răspunde cu o listă numerotată de probleme găsite. "
            "Dacă nu există probleme, scrie exact: 'Nicio problemă identificată.'",
        ),
        (
            "human",
            "Context din knowledge graph (memorie istorică):\n"
            "{memory_context}\n\n"
            "Analizează codul următor:\n\n```{language}\n{code}\n```",
        ),
    ]
)

JUNIOR_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Ești un mentor care explică codul unui junior developer cu 0-1 ani experiență. "
            "Folosește analogii simple, evită jargonul, explică CE face codul și DE CE. "
            "Maxim 150 de cuvinte.",
        ),
        (
            "human",
            "Explică ce face acest cod:\n\n```{language}\n{code}\n```",
        ),
    ]
)


# ── LLM factory ───────────────────────────────────────────────────────────────

def _build_llm(settings: Settings) -> BaseChatModel:
    """
    Construiește clientul LLM pe baza provider-ului configurat.

    IMPORTANT — Zero Data Retention:
      - OpenAI  : asigură-te că organizația are ZDR activat sau folosește
                  `model="gpt-4o"` cu `store=False` (API param, beta).
      - Anthropic: datele API nu sunt reținute by default.
      - Google  : folosește Vertex AI, NU AI Studio, pentru garanții DPA.
    """
    provider = settings.llm_provider.lower()

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=settings.llm_model,
            api_key=settings.openai_api_key,
            temperature=0.2,
            # store=False  ← dezactivează logging-ul pe platforma OpenAI (beta feature)
            max_retries=3,
        )

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=settings.llm_model or "claude-3-5-sonnet-20241022",
            api_key=settings.anthropic_api_key,
            temperature=0.2,
            max_retries=3,
        )

    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=settings.llm_model or "gemini-2.5-flash",
            temperature=0.2,
            max_retries=3,
            api_key=settings.google_api_key,
        )

    raise ValueError(f"Provider LLM necunoscut: '{provider}'. Alege: openai | anthropic | google")


# ── Parallel chain builder ────────────────────────────────────────────────────

def _build_parallel_chain(llm: BaseChatModel) -> RunnableParallel:
    """
    Construiește un RunnableParallel care execută cele 3 task-uri simultan.

    Input așteptat: {"code": str, "language": str}
    Output: {"docstring": str, "bugs": str, "junior_summary": str}
    """
    parser = StrOutputParser()

    return RunnableParallel(
        docstring=DOCSTRING_PROMPT | llm | parser,
        bugs=BUGS_PROMPT | llm | parser,
        junior_summary=JUNIOR_PROMPT | llm | parser,
    )


# ── Bug parser ────────────────────────────────────────────────────────────────

def _parse_bugs(raw_bugs: str) -> list[str]:
    """
    Transformă răspunsul text al modelului într-o listă de string-uri.
    Gestionează formatul „1. bug\n2. bug" sau bullet points.
    """
    if "nicio problemă" in raw_bugs.lower():
        return []

    lines = raw_bugs.strip().splitlines()
    bugs: list[str] = []
    for line in lines:
        # Elimină prefixe de tip "1.", "-", "*", "•"
        cleaned = line.strip().lstrip("0123456789.-*•) ").strip()
        if cleaned:
            bugs.append(cleaned)
    return bugs


# ── Core service ──────────────────────────────────────────────────────────────

class AnalysisPipeline:
    """
    Orchestrează analiza AI pentru o listă de chunk-uri.

    Responsabilități:
      - Verificare cache înainte de apel API
      - Execuție paralelă a celor 3 task-uri per chunk
      - Scriere rezultate în cache
      - Agregarea rezultatelor finale
    """

    def __init__(self, settings: Settings, cache: CacheService) -> None:
        self._settings = settings
        self._cache = cache
        self._llm = _build_llm(settings)
        self._chain = _build_parallel_chain(self._llm)
        self._max_concurrency = max(1, settings.pipeline_max_concurrency)

    def _cache_key(self, chunk: CodeChunk, memory_revision: int = 0) -> str:
        return compute_cache_key(
            content=chunk.source,
            language=chunk.language,
            provider=self._settings.llm_provider,
            model=self._settings.llm_model,
            memory_revision=memory_revision,
        )

    async def _analyze_chunk_no_cache(
        self,
        chunk: CodeChunk,
        cache_key: str,
        memory_context: str,
    ) -> ChunkAnalysis:
        """Analizeaza un chunk fara lookup in cache; apelat doar pentru cache MISS."""
        chain_input: dict[str, Any] = {
            "code": chunk.source,
            "language": chunk.language,
            "memory_context": memory_context,
        }

        result: dict[str, str] = await self._chain.ainvoke(chain_input)

        analysis = ChunkAnalysis(
            chunk_id=cache_key,
            chunk_name=chunk.name,
            source_code=chunk.source,
            cached=False,
            docstring=result["docstring"],
            bugs_and_vulnerabilities=_parse_bugs(result["bugs"]),
            junior_summary=result["junior_summary"],
        )

        await self._cache.set(cache_key, analysis)
        return analysis

    async def analyze_chunk(
        self,
        chunk: CodeChunk,
        memory_context: str = "Nu există context istoric relevant.",
        memory_revision: int = 0,
    ) -> ChunkAnalysis:
        """Analizează un singur chunk — cu fallback din cache."""
        cache_key = self._cache_key(chunk, memory_revision=memory_revision)

        # ── 1. Cache lookup ───────────────────────────────────────────────────
        cached = await self._cache.get(cache_key)
        if cached is not None:
            logger.info("Cache HIT pentru chunk '%s' (key=%s…)", chunk.name, cache_key[:8])
            return cached.model_copy(update={"cached": True})

        logger.info("Cache MISS — apel API pentru chunk '%s'", chunk.name)
        return await self._analyze_chunk_no_cache(chunk, cache_key, memory_context)

    async def analyze_all(
        self,
        chunks: list[CodeChunk],
        memory_contexts: dict[str, str] | None = None,
        memory_revision: int = 0,
    ) -> list[ChunkAnalysis]:
        """
        Analizează toate chunk-urile cu pipeline optimizat:
        1) MGET cache pentru toate cheile
        2) AI doar pe MISS-uri
        3) menține ordinea chunk-urilor inițiale

        Atenție: pentru coduri cu sute de funcții, limitează concurența cu
        asyncio.Semaphore pentru a nu depăși rate limit-urile API.
        """
        if not chunks:
            return []

        memory_contexts = memory_contexts or {}
        keys = [self._cache_key(chunk, memory_revision=memory_revision) for chunk in chunks]
        cached_by_key = await self._cache.get_many(keys)

        ordered_results: list[ChunkAnalysis | None] = [None] * len(chunks)
        misses: list[tuple[int, CodeChunk, str]] = []

        for idx, (chunk, key) in enumerate(zip(chunks, keys)):
            cached = cached_by_key.get(key)
            if cached is not None:
                ordered_results[idx] = cached.model_copy(update={"cached": True})
                continue
            misses.append((idx, chunk, key))

        logger.info(
            "Batch cache lookup: %d hit-uri, %d miss-uri",
            len(chunks) - len(misses),
            len(misses),
        )

        sem = asyncio.Semaphore(self._max_concurrency)

        async def _bounded(idx: int, chunk: CodeChunk, key: str) -> tuple[int, ChunkAnalysis]:
            async with sem:
                memory_context = memory_contexts.get(
                    chunk.name,
                    "Nu există context istoric relevant.",
                )
                analysis = await self._analyze_chunk_no_cache(chunk, key, memory_context)
                return idx, analysis

        if misses:
            generated = await asyncio.gather(
                *[_bounded(idx, chunk, key) for idx, chunk, key in misses]
            )
            for idx, analysis in generated:
                ordered_results[idx] = analysis

        return [result for result in ordered_results if result is not None]

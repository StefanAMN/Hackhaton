# Legacy Code Analyzer

A compact, production-minded MVP that analyzes legacy code with a "graph-first, AI-last" strategy.

This repository combines lightweight static analysis (dependency graph, regex/tree-sitter chunking), a persistent knowledge graph memory, a lexical prefilter, Redis caching and an AI pipeline that runs targeted per-chunk analyses (docstrings, security/bug detection, and a junior-friendly summary).

## Features

- Graph-first question answering: many questions are answered from the dependency graph at zero AI cost.
- Targeted per-chunk AI analysis (docstring, bugs & vulnerabilities, junior summary).
- Prefilter (BM25-like + risk rules) to reduce AI calls and cost.
- Persistent knowledge graph memory to boost relevant chunks and improve future results.
- Redis caching with deterministic SHA-256 keys to reuse results across requests.
- Multi-provider LLM support: openai, anthropic (Claude), google (Gemini/Vertex).
- Security headers and a simple rate limiter for the API surface.

## Quick Architecture Overview

- FastAPI backend entry: [backend/app/main.py](backend/app/main.py#L1-L200) — initializes singletons: CacheService, KnowledgeGraphService, DependencyGraphService, AnalysisPipeline.
- Chunking: [backend/app/services/chunker.py](backend/app/services/chunker.py#L1-L300) — tree-sitter (preferred) or regex fallback; splits very large chunks into parts.
- Dependency graph (session/global): [backend/app/services/dependency_graph.py](backend/app/services/dependency_graph.py#L1-L420) — imports, calls, inheritance extraction + BFS impact analysis (zero-cost answers).
- Knowledge graph (persistent memory): [backend/app/services/knowledge_graph.py](backend/app/services/knowledge_graph.py#L1-L220) — stores node tokens, issue patterns and supplies memory contexts + chunk boosts.
- Prefilter: [backend/app/services/prefilter.py](backend/app/services/prefilter.py#L1-L180) — lexical scoring + risk boosts to select top-k candidates for AI.
- Cache (Redis): [backend/app/services/cache.py](backend/app/services/cache.py#L1-L200) — MGET/MSET-style helpers and TTL.
- AI Pipeline: [backend/app/services/pipeline.py](backend/app/services/pipeline.py#L1-L240) — builds a parallel runnable of 3 tasks (docstring, bugs, junior summary), does cache lookup, rate-limit coordination and retries.
- Question routing (graph-first): [backend/app/services/question_router.py](backend/app/services/question_router.py#L1-L200) — regex classifier for IMPACT/STRUCTURAL/SEMANTIC questions.

## End-to-end Flows

- POST /api/v1/analyze (JSON or file upload)
  1. Detect language → chunk code into logical `CodeChunk`s.
  2. Build dependency graph (cost $0).
  3. Query knowledge graph for memory contexts and boosts.
  4. Optionally run PrefilterService to select top candidates.
  5. AnalysisPipeline.analyze_all() performs a batch cache lookup and calls the LLM only for cache misses; each chunk runs three parallel tasks.
  6. Persist results to cache and update the knowledge graph.

- POST /api/v1/ask (graph-first, AI-last)
  1. Classify the question with regex rules (QuestionRouter).
  2. IMPACT / STRUCTURAL → answered from DependencyGraphService (zero AI cost).
  3. SEMANTIC → prepare graph context; filter relevant chunks from the graph and call AI fallback (limited context) only when required.

## API Endpoints (high level)

- GET /health — health and LLM provider info.
- POST /api/v1/analyze/ — analyze code (JSON body).
- POST /api/v1/analyze/upload — analyze uploaded file (multipart/form-data).
- GET /api/v1/analyze/memory/stats — knowledge graph stats.
- GET /api/v1/analyze/global_graph — snapshot of accumulated global dependency graph.
- POST /api/v1/ask/ — graph-first Q&A endpoint.
- POST /api/v1/ask/scan — build the dependency graph from provided code (no AI).

## Quickstart (local)

1. Backend (recommended for development):

bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env
# Edit .env: set API keys (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY), REDIS_URL, etc.
uvicorn app.main:app --reload --port 8000


2. Using Docker / docker-compose (root compose attempts to bring services together):

bash
docker-compose up --build
# or to run backend-only if provided:
docker-compose -f backend/docker-compose.yml up --build


3. Run tests (backend):

bash
cd backend
pytest -q


## Configuration (important env variables)

- LLM_PROVIDER (or llm_provider in settings): openai, anthropic, or google.
- LLM_MODEL (or llm_model): e.g. gpt-4o, claude-3-5-sonnet-20241022, gemini-2.0-flash.
- OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY — set the provider key you use.
- REDIS_URL — Redis connection for caching (fallback to no-cache if unavailable).
- CACHE_TTL_SECONDS, PREFILTER_MAX_CHUNKS, PREFILTER_MIN_SCORE, PIPELINE_MAX_CONCURRENCY, RATE_LIMIT_* — tunables in backend/app/core/config.py.

Refer to backend/env.example for a ready list of values.

## Provider & Privacy Notes

- The code treats LLM providers as interchangeable backends; you can switch via settings.
- For minimal data retention with OpenAI, consider disabling server-side storage and using the provider options (e.g., store=False where supported) and ensure your org has Zero Data Retention enabled.
- For Google, prefer Vertex AI over AI Studio for stronger DPA guarantees.

## Developer Notes & Next Steps

- Enable tree-sitter (tree-sitter-languages) for more reliable chunking in production.
- Move knowledge_graph to a small persistent DB if you need concurrency/scale beyond a JSON file.
- Improve prefilter tuning and add metrics (observability) for LLM cost tracking.
- Add more frontend integration tests and tighten the CORS policy for production.

## Key files

- Entry / lifecycle: [backend/app/main.py](backend/app/main.py#L1-L200)
- Chunking: [backend/app/services/chunker.py](backend/app/services/chunker.py#L1-L300)
- Pipeline (LLM orchestration): [backend/app/services/pipeline.py](backend/app/services/pipeline.py#L1-L240)
- Dependency graph: [backend/app/services/dependency_graph.py](backend/app/services/dependency_graph.py#L1-L420)
- Knowledge graph: [backend/app/services/knowledge_graph.py](backend/app/services/knowledge_graph.py#L1-L220)
- Prefilter: [backend/app/services/prefilter.py](backend/app/services/prefilter.py#L1-L180)
- Cache (Redis): [backend/app/services/cache.py](backend/app/services/cache.py#L1-L200)
- Question router: [backend/app/services/question_router.py](backend/app/services/question_router.py#L1-L200)

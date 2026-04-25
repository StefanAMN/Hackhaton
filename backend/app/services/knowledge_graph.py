"""
Persistent knowledge graph memory for incremental learning.

The graph stores symbols (nodes), relations (edges), and normalized issue
patterns extracted from previous analyses. It is used in two ways:
  1) retrieval context for current chunk analysis
  2) prefilter boost for chunk ranking before expensive AI calls
"""

from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from app.core.config import Settings
from app.models.schemas import ChunkAnalysis
from app.services.chunker import CodeChunk


_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]+")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _issue_signature(issue: str) -> str:
    normalized = issue.lower()
    normalized = re.sub(r"\d+", "#", normalized)
    normalized = re.sub(r"[^a-z0-9#\s_-]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized[:200]


@dataclass(frozen=True, slots=True)
class MemoryContext:
    text: str
    score: float


class KnowledgeGraphService:
    """
    JSON-backed knowledge graph used as long-term memory.

    Design goals:
      - deterministic and lightweight
      - safe concurrent access via asyncio.Lock
      - retrieval inspired by search-engine indexing (token overlap)
    """

    def __init__(self, settings: Settings) -> None:
        self._enabled = settings.knowledge_graph_enabled
        self._path = Path(settings.knowledge_graph_store_path)
        self._max_nodes = max(100, settings.knowledge_graph_max_nodes)
        self._lock = asyncio.Lock()

        self._graph: dict[str, Any] = {
            "version": 1,
            "revision": 0,
            "updated_at": _utc_now(),
            "nodes": {},
            "edges": {},
            "issue_patterns": {},
            "stats": {
                "ingestions": 0,
                "total_issues_observed": 0,
            },
        }
        self._token_index: dict[str, set[str]] = defaultdict(set)

        if self._enabled:
            self._load_from_disk()

    def _load_from_disk(self) -> None:
        if not self._path.exists():
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._persist()
            return

        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                return
            self._graph.update(raw)
        except Exception:
            # If file is corrupted, keep in-memory defaults.
            return

        self._rebuild_token_index()

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(self._graph, ensure_ascii=True, indent=2),
            encoding="utf-8",
        )

    def _rebuild_token_index(self) -> None:
        self._token_index.clear()
        nodes = self._graph.get("nodes", {})
        for node_id, node in nodes.items():
            for token in node.get("tokens", []):
                self._token_index[token].add(node_id)

    async def get_stats(self) -> dict[str, Any]:
        async with self._lock:
            return {
                "enabled": self._enabled,
                "revision": int(self._graph.get("revision", 0)),
                "nodes": len(self._graph.get("nodes", {})),
                "edges": len(self._graph.get("edges", {})),
                "issue_patterns": len(self._graph.get("issue_patterns", {})),
                "ingestions": int(self._graph.get("stats", {}).get("ingestions", 0)),
                "updated_at": self._graph.get("updated_at", _utc_now()),
            }

    async def get_revision(self) -> int:
        async with self._lock:
            return int(self._graph.get("revision", 0))

    async def build_memory_context(
        self,
        chunks: list[CodeChunk],
        top_k: int,
    ) -> dict[str, MemoryContext]:
        if not self._enabled or not chunks:
            return {}

        top_k = max(1, top_k)
        async with self._lock:
            nodes = self._graph.get("nodes", {})
            issue_patterns = self._graph.get("issue_patterns", {})
            out: dict[str, MemoryContext] = {}

            top_patterns = sorted(
                issue_patterns.values(),
                key=lambda p: p.get("count", 0),
                reverse=True,
            )[:top_k]

            for chunk in chunks:
                scored = self._find_related_nodes_locked(chunk, nodes)
                if not scored and not top_patterns:
                    continue

                lines: list[str] = []
                score = 0.0

                for item in scored[:top_k]:
                    node = item["node"]
                    similarity = item["similarity"]
                    if similarity <= 0:
                        continue
                    score += similarity
                    lines.append(
                        f"symbol={node['name']} issues={node.get('issue_count', 0)} "
                        f"seen={node.get('seen_count', 0)} sim={similarity:.2f}"
                    )

                for pattern in top_patterns[: max(1, top_k // 2)]:
                    example = pattern.get("example", "")
                    lines.append(
                        f"common_issue={example} freq={pattern.get('count', 0)}"
                    )

                if lines:
                    out[chunk.name] = MemoryContext(
                        text="\n".join(lines),
                        score=score,
                    )

            return out

    async def get_chunk_boosts(self, chunks: list[CodeChunk]) -> dict[str, float]:
        if not self._enabled or not chunks:
            return {}

        async with self._lock:
            nodes = self._graph.get("nodes", {})
            boosts: dict[str, float] = {}

            for chunk in chunks:
                scored = self._find_related_nodes_locked(chunk, nodes)
                boost = 0.0
                for item in scored[:3]:
                    node = item["node"]
                    similarity = item["similarity"]
                    issue_count = float(node.get("issue_count", 0))
                    seen_count = float(max(1, node.get("seen_count", 1)))
                    risk_factor = 1.0 + min(2.0, issue_count / seen_count)
                    boost += similarity * risk_factor

                if boost > 0:
                    boosts[chunk.name] = round(boost, 4)

            return boosts

    async def learn_from_analysis(
        self,
        chunks: list[CodeChunk],
        analyses: list[ChunkAnalysis],
    ) -> dict[str, int]:
        if not self._enabled or not chunks or not analyses:
            return {"nodes_updated": 0, "edges_updated": 0, "patterns_updated": 0}

        # Map analysis by chunk name; duplicate names are folded into latest result.
        analysis_by_name = {analysis.chunk_name: analysis for analysis in analyses}

        async with self._lock:
            nodes = self._graph.setdefault("nodes", {})
            edges = self._graph.setdefault("edges", {})
            issue_patterns = self._graph.setdefault("issue_patterns", {})
            stats = self._graph.setdefault("stats", {"ingestions": 0, "total_issues_observed": 0})

            nodes_updated = 0
            edges_updated = 0
            patterns_updated = 0

            ordered_node_ids: list[str] = []

            for chunk in chunks:
                analysis = analysis_by_name.get(chunk.name)
                if analysis is None:
                    continue

                node_id = hashlib.sha1(
                    f"{chunk.language}:{chunk.kind}:{chunk.name}".encode("utf-8")
                ).hexdigest()

                issue_count = len(analysis.bugs_and_vulnerabilities)
                node = nodes.get(node_id)
                new_node = node is None

                if node is None:
                    node = {
                        "id": node_id,
                        "name": chunk.name,
                        "language": chunk.language,
                        "kind": chunk.kind,
                        "seen_count": 0,
                        "issue_count": 0,
                        "tokens": [],
                        "updated_at": _utc_now(),
                    }

                node["seen_count"] = int(node.get("seen_count", 0)) + 1
                node["issue_count"] = int(node.get("issue_count", 0)) + issue_count
                node["updated_at"] = _utc_now()

                existing_tokens = set(node.get("tokens", []))
                merged_tokens = self._merge_tokens(existing_tokens, chunk.source, chunk.name)
                node["tokens"] = merged_tokens

                nodes[node_id] = node
                ordered_node_ids.append(node_id)
                if new_node:
                    nodes_updated += 1

                for issue in analysis.bugs_and_vulnerabilities:
                    signature = _issue_signature(issue)
                    if not signature:
                        continue

                    pattern = issue_patterns.get(signature)
                    if pattern is None:
                        pattern = {
                            "signature": signature,
                            "count": 0,
                            "example": issue[:240],
                            "updated_at": _utc_now(),
                        }
                        patterns_updated += 1

                    pattern["count"] = int(pattern.get("count", 0)) + 1
                    pattern["updated_at"] = _utc_now()
                    issue_patterns[signature] = pattern
                    stats["total_issues_observed"] = int(stats.get("total_issues_observed", 0)) + 1

            # Sequential co-occurrence edge between selected chunks from same file.
            for left, right in zip(ordered_node_ids, ordered_node_ids[1:]):
                edge_key = f"{left}->{right}"
                edge = edges.get(edge_key)
                if edge is None:
                    edge = {
                        "source": left,
                        "target": right,
                        "relation": "co_occurs",
                        "weight": 0,
                        "updated_at": _utc_now(),
                    }
                    edges_updated += 1

                edge["weight"] = int(edge.get("weight", 0)) + 1
                edge["updated_at"] = _utc_now()
                edges[edge_key] = edge

            self._trim_nodes_locked(nodes)
            self._rebuild_token_index()

            stats["ingestions"] = int(stats.get("ingestions", 0)) + 1
            self._graph["revision"] = int(self._graph.get("revision", 0)) + 1
            self._graph["updated_at"] = _utc_now()
            self._persist()

            return {
                "nodes_updated": nodes_updated,
                "edges_updated": edges_updated,
                "patterns_updated": patterns_updated,
            }

    def _trim_nodes_locked(self, nodes: dict[str, dict[str, Any]]) -> None:
        if len(nodes) <= self._max_nodes:
            return

        ranked = sorted(
            nodes.items(),
            key=lambda item: (
                int(item[1].get("seen_count", 0)) + int(item[1].get("issue_count", 0)),
                item[1].get("updated_at", ""),
            ),
            reverse=True,
        )
        kept = dict(ranked[: self._max_nodes])
        nodes.clear()
        nodes.update(kept)

    @staticmethod
    def _merge_tokens(existing: set[str], source: str, name: str) -> list[str]:
        bag = list(existing)
        bag.extend(_tokenize(name))
        bag.extend(_tokenize(source)[:200])

        freq = Counter(bag)
        # Keep the most relevant tokens only.
        return [token for token, _ in freq.most_common(80)]

    def _find_related_nodes_locked(
        self,
        chunk: CodeChunk,
        nodes: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        query_tokens = set(_tokenize(chunk.name) + _tokenize(chunk.source)[:120])
        if not query_tokens:
            return []

        candidate_ids: set[str] = set()
        for token in query_tokens:
            candidate_ids.update(self._token_index.get(token, set()))

        scored: list[dict[str, Any]] = []
        for node_id in candidate_ids:
            node = nodes.get(node_id)
            if node is None:
                continue
            if node.get("language") != chunk.language:
                continue

            node_tokens = set(node.get("tokens", []))
            if not node_tokens:
                continue

            inter = len(query_tokens.intersection(node_tokens))
            union = len(query_tokens.union(node_tokens))
            if union == 0:
                continue

            similarity = inter / union
            if similarity <= 0:
                continue

            scored.append(
                {
                    "node": node,
                    "similarity": similarity,
                }
            )

        scored.sort(key=lambda item: item["similarity"], reverse=True)
        return scored
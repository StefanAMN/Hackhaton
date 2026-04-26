"""
Dependency Graph — extrage relații reale din cod la faza de Scan ($0).

La diferență de knowledge_graph.py (care e memorie persistentă pe termen lung),
acest serviciu construiește un **graf de dependențe concrete** per sesiune:
  - import edges  (modulul A importă modulul B)
  - call edges    (funcția A cheamă funcția B)
  - inherit edges (clasa A moștenește clasa B)

Folosit în strategia graph-first, AI-last:
  - Întrebări de impact/structurale → răspuns instant din graf ($0)
  - Întrebări semantice → fallback la AI cu context enriched din graf
"""

from __future__ import annotations

import re
import logging
import json
import dataclasses
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

from app.services.chunker import CodeChunk

logger = logging.getLogger(__name__)


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class GraphEdge:
    """O relație direcționată între două simboluri."""
    source: str       # cine depinde / cheamă
    target: str       # de cine depinde / pe cine cheamă
    relation: str     # "imports" | "calls" | "inherits"


@dataclass
class GraphNode:
    """Un nod din dependency graph."""
    name: str
    kind: str               # "function" | "class" | "module" | "method"
    language: str
    start_line: int = 0
    end_line: int = 0
    in_degree: int = 0      # câți depind de mine
    out_degree: int = 0     # de câți depind eu


@dataclass
class ImpactResult:
    """Rezultatul unei analize de impact."""
    symbol: str
    direct_dependents: list[str] = field(default_factory=list)
    transitive_dependents: list[str] = field(default_factory=list)
    impact_score: float = 0.0   # 0-1, cât de "periculos" e să modifici acest simbol
    explanation: str = ""


@dataclass
class DependencySnapshot:
    """Snapshot complet al grafului."""
    nodes: dict[str, GraphNode] = field(default_factory=dict)
    edges: list[GraphEdge] = field(default_factory=list)
    adjacency: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    reverse_adj: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": {k: dataclasses.asdict(v) for k, v in self.nodes.items()},
            "edges": [dataclasses.asdict(e) for e in self.edges],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DependencySnapshot":
        snapshot = cls()
        for k, v in data.get("nodes", {}).items():
            snapshot.nodes[k] = GraphNode(**v)
        for e in data.get("edges", []):
            edge = GraphEdge(**e)
            snapshot.edges.append(edge)
            snapshot.adjacency[edge.source].add(edge.target)
            snapshot.reverse_adj[edge.target].add(edge.source)
        return snapshot


# ── Regex patterns for dependency extraction ──────────────────────────────────

# Python imports
_PY_IMPORT = re.compile(
    r"^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.,\s]+)", re.MULTILINE
)

# JavaScript/TypeScript imports
_JS_IMPORT = re.compile(
    r"""^\s*import\s+(?:"""
    r"""(?:\{[^}]+\}|[\w*]+(?:\s+as\s+\w+)?)\s+from\s+)?"""
    r"""['"]([^'"]+)['"]""",
    re.MULTILINE,
)
_JS_REQUIRE = re.compile(
    r"""(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)""",
    re.MULTILINE,
)

# Java imports
_JAVA_IMPORT = re.compile(r"^\s*import\s+([\w.]+);", re.MULTILINE)

# Go imports
_GO_IMPORT = re.compile(r'"([\w./]+)"')

# Function calls (language-agnostic heuristic)
_FUNC_CALL = re.compile(r"\b([A-Za-z_]\w*)\s*\(")

# Class inheritance
_PY_INHERIT = re.compile(r"class\s+(\w+)\s*\(([^)]+)\)")
_JS_INHERIT = re.compile(r"class\s+(\w+)\s+extends\s+(\w+)")
_JAVA_INHERIT = re.compile(r"class\s+(\w+)\s+extends\s+(\w+)")


# ── Core service ──────────────────────────────────────────────────────────────

class DependencyGraphService:
    """
    Construiește și interogează dependency graph-ul per sesiune.

    Design goals:
      - Zero cost AI (totul e regex + traversare graf)
      - Rapid (sub 50ms pentru codebases de 5000 linii)
      - Răspunsuri instant la întrebări de impact
    """

    def __init__(self, store_path: str = "dependency_graph_memory.json") -> None:
        self._path = Path(store_path)
        self._lock = Lock()
        self._global_snapshot = DependencySnapshot()
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            self._global_snapshot = DependencySnapshot.from_dict(raw)
            logger.info("Loaded global dependency graph with %d nodes, %d edges.", len(self._global_snapshot.nodes), len(self._global_snapshot.edges))
        except Exception as e:
            logger.error("Failed to load dependency graph from disk: %s", e)

    def _persist(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(self._global_snapshot.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.error("Failed to save dependency graph to disk: %s", e)

    def build_from_chunks(
        self,
        session_id: str,
        chunks: list[CodeChunk],
        full_source: str = "",
    ) -> DependencySnapshot:
        """
        Construiește dependency graph din chunk-uri + codul sursă complet.
        Apelat la faza de Scan — cost $0.
        """
        snapshot = DependencySnapshot()

        # 1. Adaugă toate chunk-urile ca noduri
        for chunk in chunks:
            snapshot.nodes[chunk.name] = GraphNode(
                name=chunk.name,
                kind=chunk.kind,
                language=chunk.language,
                start_line=chunk.start_line,
                end_line=chunk.end_line,
            )

        # 2. Extrage relații
        all_names = set(snapshot.nodes.keys())
        source_to_use = full_source or "\n".join(c.source for c in chunks)
        language = chunks[0].language if chunks else "python"

        # 2a. Import edges
        import_edges = self._extract_imports(source_to_use, language)
        for edge in import_edges:
            snapshot.edges.append(edge)
            snapshot.adjacency[edge.source].add(edge.target)
            snapshot.reverse_adj[edge.target].add(edge.source)

        # 2b. Call edges (per chunk)
        for chunk in chunks:
            calls = self._extract_calls(chunk, all_names)
            for edge in calls:
                snapshot.edges.append(edge)
                snapshot.adjacency[edge.source].add(edge.target)
                snapshot.reverse_adj[edge.target].add(edge.source)

        # 2c. Inheritance edges
        inherit_edges = self._extract_inheritance(source_to_use, language, all_names)
        for edge in inherit_edges:
            snapshot.edges.append(edge)
            snapshot.adjacency[edge.source].add(edge.target)
            snapshot.reverse_adj[edge.target].add(edge.source)

        # 3. Calculează degree-uri
        for name, node in snapshot.nodes.items():
            node.out_degree = len(snapshot.adjacency.get(name, set()))
            node.in_degree = len(snapshot.reverse_adj.get(name, set()))

        # 4. Merge into global snapshot
        with self._lock:
            for name, node in snapshot.nodes.items():
                self._global_snapshot.nodes[name] = node
            
            # Avoid duplicate edges
            existing_edges = set((e.source, e.target, e.relation) for e in self._global_snapshot.edges)
            for edge in snapshot.edges:
                key = (edge.source, edge.target, edge.relation)
                if key not in existing_edges:
                    self._global_snapshot.edges.append(edge)
                    self._global_snapshot.adjacency[edge.source].add(edge.target)
                    self._global_snapshot.reverse_adj[edge.target].add(edge.source)
                    existing_edges.add(key)
            
            # Recalculate global degrees
            for name, node in self._global_snapshot.nodes.items():
                node.out_degree = len(self._global_snapshot.adjacency.get(name, set()))
                node.in_degree = len(self._global_snapshot.reverse_adj.get(name, set()))
            
            self._persist()

        logger.info(
            "Dependency graph built: %d nodes, %d edges (session=%s). Global graph now has %d nodes.",
            len(snapshot.nodes),
            len(snapshot.edges),
            session_id[:8],
            len(self._global_snapshot.nodes)
        )
        return snapshot

    def get_snapshot(self, session_id: str = "") -> DependencySnapshot | None:
        """Returnează snapshot-ul grafului global."""
        return self._global_snapshot

    def get_impact(self, session_id: str, symbol: str) -> ImpactResult:
        """
        Analiză de impact: ce se strică dacă modific `symbol`?
        Traversare BFS pe reverse_adj (cine depinde de mine).
        Cost: $0, <1ms.
        """
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return ImpactResult(symbol=symbol, explanation="Nu există date în graf.")

        # Normalizare: caută și cu matching parțial
        resolved = self._resolve_symbol(symbol, snapshot)
        if not resolved:
            return ImpactResult(
                symbol=symbol,
                explanation=f"Simbolul '{symbol}' nu a fost găsit în graf.",
            )

        # BFS pe dependenți (cine mă folosește)
        direct = list(snapshot.reverse_adj.get(resolved, set()))
        transitive = self._bfs_reachable(resolved, snapshot.reverse_adj)
        transitive.discard(resolved)  # exclude self

        total_nodes = max(1, len(snapshot.nodes))
        impact_score = min(1.0, len(transitive) / total_nodes)

        # Generare explicație din graf (fără AI!)
        explanation_parts = [f"Simbolul **{resolved}** este de tip `{snapshot.nodes.get(resolved, GraphNode(name=resolved, kind='unknown', language='unknown')).kind}`."]

        if direct:
            explanation_parts.append(f"Este folosit direct de: {', '.join(sorted(direct))}.")
        else:
            explanation_parts.append("Nu este folosit direct de niciun alt simbol (leaf node).")

        if len(transitive) > len(direct):
            indirect = transitive - set(direct)
            explanation_parts.append(
                f"Indirect, modificarea poate afecta și: {', '.join(sorted(indirect))}."
            )

        if impact_score > 0.5:
            explanation_parts.append(
                f"⚠️ **Impact ridicat** ({impact_score:.0%}) — acest simbol este critic în codebase."
            )
        elif impact_score > 0.2:
            explanation_parts.append(
                f"⚡ **Impact mediu** ({impact_score:.0%}) — modificarea necesită atenție."
            )
        else:
            explanation_parts.append(
                f"✅ **Impact scăzut** ({impact_score:.0%}) — modificarea este relativ sigură."
            )

        return ImpactResult(
            symbol=resolved,
            direct_dependents=sorted(direct),
            transitive_dependents=sorted(transitive),
            impact_score=round(impact_score, 3),
            explanation=" ".join(explanation_parts),
        )

    def get_dependencies(self, session_id: str, symbol: str) -> dict[str, Any]:
        """Ce depinde `symbol` de? (outgoing edges)"""
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return {"symbol": symbol, "dependencies": [], "explanation": "Nu există date în graf."}

        resolved = self._resolve_symbol(symbol, snapshot)
        if not resolved:
            return {"symbol": symbol, "dependencies": [], "explanation": f"'{symbol}' negăsit."}

        deps = sorted(snapshot.adjacency.get(resolved, set()))
        edges = [
            e for e in snapshot.edges
            if e.source == resolved
        ]

        edge_details = [
            {"target": e.target, "relation": e.relation}
            for e in edges
        ]

        explanation = f"**{resolved}** depinde de {len(deps)} simboluri"
        if deps:
            explanation += f": {', '.join(deps)}."
        else:
            explanation += " (este independent)."

        return {
            "symbol": resolved,
            "dependencies": edge_details,
            "count": len(deps),
            "explanation": explanation,
        }

    def get_callers(self, session_id: str, symbol: str) -> dict[str, Any]:
        """Cine cheamă `symbol`?"""
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return {"symbol": symbol, "callers": [], "explanation": "Nu există date în graf."}

        resolved = self._resolve_symbol(symbol, snapshot)
        if not resolved:
            return {"symbol": symbol, "callers": [], "explanation": f"'{symbol}' negăsit."}

        callers = sorted(snapshot.reverse_adj.get(resolved, set()))
        explanation = f"**{resolved}** este apelat de {len(callers)} simboluri"
        if callers:
            explanation += f": {', '.join(callers)}."
        else:
            explanation += " (nu este apelat de nimeni)."

        return {"symbol": resolved, "callers": callers, "count": len(callers), "explanation": explanation}

    def get_callees(self, session_id: str, symbol: str) -> dict[str, Any]:
        """Pe cine cheamă `symbol`?"""
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return {"symbol": symbol, "callees": [], "explanation": "Nu există date în graf."}

        resolved = self._resolve_symbol(symbol, snapshot)
        if not resolved:
            return {"symbol": symbol, "callees": [], "explanation": f"'{symbol}' negăsit."}

        callees = sorted(snapshot.adjacency.get(resolved, set()))
        call_edges = [
            e.target for e in snapshot.edges
            if e.source == resolved and e.relation == "calls"
        ]
        explanation = f"**{resolved}** apelează {len(call_edges)} funcții"
        if call_edges:
            explanation += f": {', '.join(sorted(set(call_edges)))}."
        else:
            explanation += "."

        return {"symbol": resolved, "callees": callees, "count": len(callees), "explanation": explanation}

    def get_summary(self, session_id: str = "") -> dict[str, Any]:
        """Sumar al întregului graf global — fără AI."""
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return {"error": "Nu există date în graf."}

        # Top noduri după impact (in_degree)
        ranked = sorted(
            snapshot.nodes.values(),
            key=lambda n: n.in_degree,
            reverse=True,
        )

        high_impact = [
            {"name": n.name, "kind": n.kind, "in_degree": n.in_degree, "out_degree": n.out_degree}
            for n in ranked[:5]
            if n.in_degree > 0
        ]

        edge_types: dict[str, int] = defaultdict(int)
        for edge in snapshot.edges:
            edge_types[edge.relation] += 1

        return {
            "total_nodes": len(snapshot.nodes),
            "total_edges": len(snapshot.edges),
            "edge_types": dict(edge_types),
            "high_impact_symbols": high_impact,
            "symbols": [
                {"name": n.name, "kind": n.kind}
                for n in snapshot.nodes.values()
            ],
        }

    def explain_symbol(self, session_id: str, symbol: str) -> str:
        """
        Generează o explicație structurală a simbolului — doar din graf, fără AI.
        """
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return f"Nu există date în graf pentru a explica '{symbol}'."

        resolved = self._resolve_symbol(symbol, snapshot)
        if not resolved:
            return f"Simbolul '{symbol}' nu a fost găsit în graf."

        node = snapshot.nodes[resolved]
        callers = sorted(snapshot.reverse_adj.get(resolved, set()))
        callees = sorted(snapshot.adjacency.get(resolved, set()))

        parts = [f"**{resolved}** este un `{node.kind}` (liniile {node.start_line}-{node.end_line})."]

        if callees:
            call_edges = [e for e in snapshot.edges if e.source == resolved]
            imports = [e.target for e in call_edges if e.relation == "imports"]
            calls = [e.target for e in call_edges if e.relation == "calls"]
            inherits = [e.target for e in call_edges if e.relation == "inherits"]

            if imports:
                parts.append(f"Importă: {', '.join(imports)}.")
            if calls:
                parts.append(f"Cheamă: {', '.join(calls)}.")
            if inherits:
                parts.append(f"Moștenește: {', '.join(inherits)}.")

        if callers:
            parts.append(f"Este folosit de: {', '.join(callers)}.")
        else:
            parts.append("Nu este utilizat de alte simboluri din acest fișier.")

        impact = self.get_impact(session_id, resolved)
        parts.append(f"Impact score: {impact.impact_score:.0%}.")

        return " ".join(parts)

    def get_graph_context_for_ai(self, session_id: str, symbol: str) -> str:
        """
        Generează context din graf pentru a îmbogăți promptul AI.
        Folosit când întrebarea e semantică (fallback la AI).
        """
        snapshot = self._global_snapshot
        if not snapshot.nodes:
            return ""

        resolved = self._resolve_symbol(symbol, snapshot)
        if not resolved:
            return ""

        lines = [f"Graph context for {resolved}:"]

        callers = snapshot.reverse_adj.get(resolved, set())
        callees = snapshot.adjacency.get(resolved, set())

        if callers:
            lines.append(f"  Used by: {', '.join(sorted(callers))}")
        if callees:
            lines.append(f"  Depends on: {', '.join(sorted(callees))}")

        node = snapshot.nodes.get(resolved)
        if node:
            lines.append(f"  Type: {node.kind}, Lines: {node.start_line}-{node.end_line}")

        impact = self.get_impact(session_id, resolved)
        lines.append(f"  Impact: {impact.impact_score:.0%} ({len(impact.transitive_dependents)} transitive dependents)")

        return "\n".join(lines)

    # ── Private extraction methods ────────────────────────────────────────────

    def _extract_imports(self, source: str, language: str) -> list[GraphEdge]:
        """Extrage import edges din codul sursă complet."""
        edges: list[GraphEdge] = []

        if language == "python":
            for m in _PY_IMPORT.finditer(source):
                module = m.group(1) or ""
                names = m.group(2)
                for name in names.split(","):
                    name = name.strip().split(" as ")[0].strip()
                    if name and name != "*":
                        target = f"{module}.{name}" if module else name
                        # Simplify: use just the last part
                        target_simple = target.split(".")[-1]
                        edges.append(GraphEdge(
                            source="__module__",
                            target=target_simple,
                            relation="imports",
                        ))

        elif language == "javascript":
            for m in _JS_IMPORT.finditer(source):
                target = m.group(1).split("/")[-1]
                edges.append(GraphEdge(source="__module__", target=target, relation="imports"))
            for m in _JS_REQUIRE.finditer(source):
                target = m.group(1).split("/")[-1]
                edges.append(GraphEdge(source="__module__", target=target, relation="imports"))

        elif language == "java":
            for m in _JAVA_IMPORT.finditer(source):
                target = m.group(1).split(".")[-1]
                edges.append(GraphEdge(source="__module__", target=target, relation="imports"))

        elif language == "go":
            for m in _GO_IMPORT.finditer(source):
                target = m.group(1).split("/")[-1]
                edges.append(GraphEdge(source="__module__", target=target, relation="imports"))

        return edges

    def _extract_calls(self, chunk: CodeChunk, known_symbols: set[str]) -> list[GraphEdge]:
        """Extrage call edges din sursă — doar apeluri către funcții cunoscute."""
        edges: list[GraphEdge] = []
        seen: set[str] = set()

        # Skip built-in names we don't want
        builtins = {
            "print", "len", "range", "str", "int", "float", "list", "dict",
            "set", "tuple", "bool", "type", "super", "isinstance", "hasattr",
            "getattr", "setattr", "enumerate", "zip", "map", "filter", "sorted",
            "min", "max", "sum", "abs", "round", "open", "input", "format",
            "if", "else", "for", "while", "return", "yield", "raise", "try",
            "except", "finally", "with", "as", "pass", "break", "continue",
            "def", "class", "import", "from", "not", "and", "or", "in", "is",
            "None", "True", "False", "self", "cls",
            # JS builtins
            "console", "log", "require", "module", "exports", "async", "await",
            "const", "let", "var", "function", "new", "this", "null", "undefined",
            "Array", "Object", "String", "Number", "Boolean", "Math", "Date",
            "JSON", "Promise", "Error", "setTimeout", "setInterval",
        }

        for m in _FUNC_CALL.finditer(chunk.source):
            called = m.group(1)
            if (
                called != chunk.name
                and called not in builtins
                and called in known_symbols
                and called not in seen
            ):
                edges.append(GraphEdge(
                    source=chunk.name,
                    target=called,
                    relation="calls",
                ))
                seen.add(called)

        return edges

    def _extract_inheritance(
        self, source: str, language: str, known_symbols: set[str]
    ) -> list[GraphEdge]:
        """Extrage relații de moștenire."""
        edges: list[GraphEdge] = []

        patterns: list[re.Pattern[str]] = []
        if language == "python":
            patterns = [_PY_INHERIT]
        elif language in ("javascript", "java"):
            patterns = [_JS_INHERIT, _JAVA_INHERIT]

        for pattern in patterns:
            for m in pattern.finditer(source):
                child = m.group(1)
                parents_raw = m.group(2)
                for parent in parents_raw.split(","):
                    parent = parent.strip()
                    if parent and parent not in ("object", "Object", "ABC"):
                        edges.append(GraphEdge(
                            source=child,
                            target=parent,
                            relation="inherits",
                        ))

        return edges

    def _resolve_symbol(self, query: str, snapshot: DependencySnapshot) -> str | None:
        """Caută un simbol în graf — suportă match exact și parțial."""
        query_lower = query.lower().strip()

        # Exact match
        if query_lower in snapshot.nodes:
            return query_lower
        for name in snapshot.nodes:
            if name.lower() == query_lower:
                return name

        # Partial match (suffix)
        for name in snapshot.nodes:
            if name.lower().endswith(query_lower) or query_lower.endswith(name.lower()):
                return name

        # Contains match
        for name in snapshot.nodes:
            if query_lower in name.lower() or name.lower() in query_lower:
                return name

        return None

    def _bfs_reachable(self, start: str, adj: dict[str, set[str]]) -> set[str]:
        """BFS pentru a găsi toate nodurile accesibile din `start`."""
        visited: set[str] = set()
        queue = list(adj.get(start, set()))
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            queue.extend(adj.get(current, set()) - visited)
        return visited

"""
Question Router — clasifică întrebări fără AI ($0).

Strategia graph-first, AI-last:
  - IMPACT/STRUCTURAL → răspuns direct din dependency graph
  - SEMANTIC → fallback la AI cu context enriched din graf

Clasificarea se face prin keyword matching + regex patterns,
nu printr-un model AI, deci costul este zero.
"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.services.dependency_graph import DependencyGraphService

logger = logging.getLogger(__name__)


class QuestionCategory(StrEnum):
    IMPACT = "impact"
    STRUCTURAL = "structural"
    SEMANTIC = "semantic"


@dataclass(frozen=True, slots=True)
class ClassifiedQuestion:
    """Rezultatul clasificării unei întrebări."""
    original: str
    category: QuestionCategory
    extracted_symbol: str | None
    confidence: float   # 0-1


@dataclass
class QuestionAnswer:
    """Răspunsul la o întrebare."""
    question: str
    category: str
    answered_by: str        # "graph" | "ai"
    answer: str
    details: dict[str, Any] | None = None
    ai_cost: float = 0.0   # estimat
    graph_context: str = ""


# ── Classification patterns ──────────────────────────────────────────────────

_IMPACT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?:ce|what).*(?:se str[iî]c[aă]|breaks?|affected?|impact)", re.I), "impact-break"),
    (re.compile(r"(?:cine|who|what).*(?:folose[sș]te|uses?|depends?|calls?)\s+(.+)", re.I), "impact-usage"),
    (re.compile(r"(?:ce|what).*(?:afecteaz[aă]|affects?)\s+(.+)", re.I), "impact-affects"),
    (re.compile(r"(?:pot|can i|safe to).*(?:modific|change|refactor|delete|remove)\s+(.+)", re.I), "impact-safe"),
    (re.compile(r"(?:impact|efect|effect).*(?:modific|change|dac[aă]|if)\s+(.+)", re.I), "impact-change"),
    (re.compile(r"(?:dependen[tț]|dependent|downstream).*(.+)", re.I), "impact-deps"),
    (re.compile(r"(?:risc|risk|danger).*(?:modific|change)\s+(.+)", re.I), "impact-risk"),
    (re.compile(r"(?:cine|who).*(?:apeleaz[aă]|cheam[aă]|calls?)\s+(.+)", re.I), "impact-callers"),
]

_STRUCTURAL_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?:ce|what).*(?:func[tț]ii|functions?|metode|methods?).*(?:are|has|contains?)", re.I), "struct-functions"),
    (re.compile(r"(?:ce|what).*(?:import[aă]|imports?)\s+(.+)", re.I), "struct-imports"),
    (re.compile(r"(?:arat[aă]|show|list).*(?:dependen[tț]|dependenc)", re.I), "struct-deps"),
    (re.compile(r"(?:structur[aă]|structure|overview|sumar|summary)", re.I), "struct-overview"),
    (re.compile(r"(?:pe cine|what does).*(?:cheam[aă]|calls?)\s+(.+)", re.I), "struct-callees"),
    (re.compile(r"(?:graf|graph|diagram[aă]|map)", re.I), "struct-graph"),
    (re.compile(r"(?:câte|how many).*(?:func[tț]ii|functions?|clase|classes)", re.I), "struct-count"),
    (re.compile(r"(?:mo[sș]tene[sș]te|inherits?|extends?)\s+(.+)", re.I), "struct-inherit"),
    (re.compile(r"(?:clase|classes|modules)", re.I), "struct-classes"),
]

# Symbol extraction pattern
_SYMBOL_EXTRACT = re.compile(
    r"(?:func[tț]i[aei]|function|clasa|class|metoda|method|simbolul|symbol|"
    r"modulul|module)\s+['\"`]?(\w+)['\"`]?",
    re.I,
)

# Fallback: look for anything in quotes or backticks
_QUOTED_SYMBOL = re.compile(r"['\"`](\w+)['\"`]")

# Last word that looks like an identifier
_LAST_IDENT = re.compile(r"\b([A-Za-z_]\w+)\s*\??$")


class QuestionRouter:
    """
    Clasifică întrebări și le rutează către graph sau AI.
    Cost: $0 — totul e regex + keyword matching.
    """

    def __init__(self, dep_graph: DependencyGraphService) -> None:
        self._dep_graph = dep_graph

    def classify(self, question: str) -> ClassifiedQuestion:
        """Clasifică o întrebare în IMPACT, STRUCTURAL sau SEMANTIC."""
        question_clean = question.strip()

        # Try impact patterns first (highest value for graph-first)
        for pattern, reason in _IMPACT_PATTERNS:
            m = pattern.search(question_clean)
            if m:
                symbol = self._extract_symbol_from_match(m, question_clean)
                logger.info("Question classified as IMPACT (%s): '%s'", reason, question_clean[:60])
                return ClassifiedQuestion(
                    original=question_clean,
                    category=QuestionCategory.IMPACT,
                    extracted_symbol=symbol,
                    confidence=0.85,
                )

        # Try structural patterns
        for pattern, reason in _STRUCTURAL_PATTERNS:
            m = pattern.search(question_clean)
            if m:
                symbol = self._extract_symbol_from_match(m, question_clean)
                logger.info("Question classified as STRUCTURAL (%s): '%s'", reason, question_clean[:60])
                return ClassifiedQuestion(
                    original=question_clean,
                    category=QuestionCategory.STRUCTURAL,
                    extracted_symbol=symbol,
                    confidence=0.80,
                )

        # Default: semantic (needs AI)
        symbol = self._extract_symbol(question_clean)
        logger.info("Question classified as SEMANTIC (fallback): '%s'", question_clean[:60])
        return ClassifiedQuestion(
            original=question_clean,
            category=QuestionCategory.SEMANTIC,
            extracted_symbol=symbol,
            confidence=0.50,
        )

    def answer(self, question: str, session_id: str) -> QuestionAnswer:
        """
        Rutează întrebarea și generează răspunsul.
        - IMPACT/STRUCTURAL → din graf, cost $0
        - SEMANTIC → returnează context + flag că trebuie AI
        """
        classified = self.classify(question)

        if classified.category == QuestionCategory.IMPACT:
            return self._answer_impact(classified, session_id)

        if classified.category == QuestionCategory.STRUCTURAL:
            return self._answer_structural(classified, session_id)

        # SEMANTIC → returnăm context din graf ca boost pentru AI
        return self._prepare_semantic(classified, session_id)

    def _answer_impact(self, q: ClassifiedQuestion, session_id: str) -> QuestionAnswer:
        """Răspuns la întrebare de impact — 100% din graf."""
        if not q.extracted_symbol:
            # Try to answer with overall summary
            summary = self._dep_graph.get_summary(session_id)
            if "error" in summary:
                return QuestionAnswer(
                    question=q.original,
                    category=q.category.value,
                    answered_by="graph",
                    answer="Nu am un graf construit. Te rog să încarci mai întâi codul.",
                    ai_cost=0.0,
                )

            high_impact = summary.get("high_impact_symbols", [])
            if high_impact:
                parts = ["Simbolurile cu cel mai mare impact din codebase:\n"]
                for s in high_impact:
                    parts.append(f"- **{s['name']}** ({s['kind']}) — folosit de {s['in_degree']} alte simboluri")
                return QuestionAnswer(
                    question=q.original,
                    category=q.category.value,
                    answered_by="graph",
                    answer="\n".join(parts),
                    details=summary,
                    ai_cost=0.0,
                )

        impact = self._dep_graph.get_impact(session_id, q.extracted_symbol or "")
        callers = self._dep_graph.get_callers(session_id, q.extracted_symbol or "")

        answer_text = impact.explanation
        if callers.get("callers"):
            answer_text += f"\n\nApelat de: {', '.join(callers['callers'])}."

        return QuestionAnswer(
            question=q.original,
            category=q.category.value,
            answered_by="graph",
            answer=answer_text,
            details={
                "impact_score": impact.impact_score,
                "direct_dependents": impact.direct_dependents,
                "transitive_dependents": impact.transitive_dependents,
            },
            ai_cost=0.0,
        )

    def _answer_structural(self, q: ClassifiedQuestion, session_id: str) -> QuestionAnswer:
        """Răspuns la întrebare structurală — 100% din graf."""
        snapshot = self._dep_graph.get_snapshot(session_id)
        if not snapshot:
            return QuestionAnswer(
                question=q.original,
                category=q.category.value,
                answered_by="graph",
                answer="Nu am un graf construit. Te rog să încarci mai întâi codul.",
                ai_cost=0.0,
            )

        question_lower = q.original.lower()

        # Summary / overview request
        if any(kw in question_lower for kw in ("structur", "overview", "sumar", "summary", "graf", "graph")):
            summary = self._dep_graph.get_summary(session_id)
            parts = [
                f"**Graful are {summary['total_nodes']} simboluri și {summary['total_edges']} relații.**\n",
            ]
            edge_types = summary.get("edge_types", {})
            if edge_types:
                parts.append("Tipuri de relații: " + ", ".join(f"{k}: {v}" for k, v in edge_types.items()))

            high_impact = summary.get("high_impact_symbols", [])
            if high_impact:
                parts.append("\nSimboluri cu impact mare:")
                for s in high_impact:
                    parts.append(f"- **{s['name']}** ({s['kind']}) — {s['in_degree']} dependenți")

            return QuestionAnswer(
                question=q.original,
                category=q.category.value,
                answered_by="graph",
                answer="\n".join(parts),
                details=summary,
                ai_cost=0.0,
            )

        # Symbol-specific queries
        if q.extracted_symbol:
            if any(kw in question_lower for kw in ("cheam", "calls", "callees", "pe cine")):
                result = self._dep_graph.get_callees(session_id, q.extracted_symbol)
                return QuestionAnswer(
                    question=q.original,
                    category=q.category.value,
                    answered_by="graph",
                    answer=result["explanation"],
                    details=result,
                    ai_cost=0.0,
                )

            if any(kw in question_lower for kw in ("import", "dependen")):
                result = self._dep_graph.get_dependencies(session_id, q.extracted_symbol)
                return QuestionAnswer(
                    question=q.original,
                    category=q.category.value,
                    answered_by="graph",
                    answer=result["explanation"],
                    details=result,
                    ai_cost=0.0,
                )

            # Default: explain symbol
            explanation = self._dep_graph.explain_symbol(session_id, q.extracted_symbol)
            return QuestionAnswer(
                question=q.original,
                category=q.category.value,
                answered_by="graph",
                answer=explanation,
                ai_cost=0.0,
            )

        # Fallback: list all symbols
        symbols = [
            f"- **{n.name}** (`{n.kind}`)"
            for n in snapshot.nodes.values()
        ]
        answer = f"Am identificat {len(symbols)} simboluri:\n" + "\n".join(symbols[:20])
        if len(symbols) > 20:
            answer += f"\n... și încă {len(symbols) - 20} simboluri."

        return QuestionAnswer(
            question=q.original,
            category=q.category.value,
            answered_by="graph",
            answer=answer,
            ai_cost=0.0,
        )

    def _prepare_semantic(self, q: ClassifiedQuestion, session_id: str) -> QuestionAnswer:
        """
        Întrebare semantică → nu putem răspunde din graf.
        Returnăm context enriched din graf pentru AI.
        """
        graph_context = ""
        if q.extracted_symbol:
            graph_context = self._dep_graph.get_graph_context_for_ai(
                session_id, q.extracted_symbol
            )

        return QuestionAnswer(
            question=q.original,
            category=q.category.value,
            answered_by="ai",
            answer="",  # va fi completat de AI pipeline
            ai_cost=0.01,  # estimat
            graph_context=graph_context,
        )

    def _extract_symbol_from_match(self, m: re.Match, question: str) -> str | None:
        """Extrage simbolul din match-ul regex sau din întrebare."""
        # Try captured group from match
        try:
            if m.lastindex and m.lastindex >= 1:
                candidate = m.group(m.lastindex).strip().rstrip("?.,!")
                # Clean up common prefixes
                candidate = re.sub(r"^(funcția|functi[ae]|clasa|metoda|simbolul|function|class|method)\s+", "", candidate, flags=re.I)
                candidate = candidate.strip("'\"`")
                if candidate and re.match(r"^[A-Za-z_]\w*$", candidate):
                    return candidate
        except (IndexError, AttributeError):
            pass

        return self._extract_symbol(question)

    @staticmethod
    def _extract_symbol(question: str) -> str | None:
        """Extrage un simbol dintr-o întrebare."""
        # Try explicit symbol patterns
        m = _SYMBOL_EXTRACT.search(question)
        if m:
            return m.group(1)

        # Try quoted/backticked
        m = _QUOTED_SYMBOL.search(question)
        if m:
            return m.group(1)

        # Try last identifier-like word
        m = _LAST_IDENT.search(question)
        if m:
            candidate = m.group(1)
            # Filter out common non-symbol words
            stopwords = {
                "este", "sunt", "are", "this", "that", "the", "code", "codul",
                "fișier", "fisier", "file", "proiect", "project", "tot", "all",
            }
            if candidate.lower() not in stopwords:
                return candidate

        return None

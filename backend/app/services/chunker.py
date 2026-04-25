"""
Chunker — împarte codul sursă în unități logice (funcții, clase, metode).

Strategie în două niveluri:
  1. PRIMARY  — tree-sitter (AST exact, recomandat pentru producție).
  2. FALLBACK — regex heuristic (zero dependențe externe, suficient pentru MVP
                și limbi nesuportate de tree-sitter).

Instalare tree-sitter (opțional):
    pip install tree-sitter tree-sitter-languages
"""
import re
import logging
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class CodeChunk:
    """O unitate logică extrasă din codul sursă."""

    name: str          # ex: "MyClass.my_method" sau "calculate_tax"
    kind: str          # "function" | "class" | "method" | "unknown"
    source: str        # conținutul brut al chunk-ului
    start_line: int
    end_line: int
    language: str


# ── Protocol (pentru extensibilitate) ────────────────────────────────────────

class ChunkerProtocol(Protocol):
    def chunk(self, code: str, language: str) -> list[CodeChunk]: ...


# ── Tree-sitter chunker ───────────────────────────────────────────────────────

class TreeSitterChunker:
    """
    Chunker bazat pe tree-sitter — parsare AST reală.

    Suportă Python, JavaScript, Java, Go via pachetul `tree-sitter-languages`.
    Dacă tree-sitter nu este instalat, ridică ImportError și se face fallback.
    """

    _LANGUAGE_MAP: dict[str, str] = {
        "python": "python",
        "javascript": "javascript",
        "java": "java",
        "go": "go",
    }

    _NODE_KINDS: dict[str, list[str]] = {
        "python": ["function_definition", "class_definition"],
        "javascript": ["function_declaration", "class_declaration", "method_definition"],
        "java": ["method_declaration", "class_declaration"],
        "go": ["function_declaration", "method_declaration"],
    }

    def chunk(self, code: str, language: str) -> list[CodeChunk]:
        # Import lazy — tree-sitter este opțional
        from tree_sitter_languages import get_language, get_parser  # type: ignore

        ts_lang = self._LANGUAGE_MAP.get(language, language)
        parser = get_parser(ts_lang)
        tree = parser.parse(code.encode("utf-8"))
        lines = code.splitlines()

        target_kinds = self._NODE_KINDS.get(language, ["function_definition"])
        chunks: list[CodeChunk] = []

        def _walk(node, parent_name: str = "") -> None:
            if node.type in target_kinds:
                # Extrage numele nodului (primul child de tip `identifier`)
                name_node = next(
                    (c for c in node.children if c.type == "identifier"), None
                )
                raw_name = name_node.text.decode() if name_node else "anonymous"
                full_name = f"{parent_name}.{raw_name}" if parent_name else raw_name

                start = node.start_point[0]  # (row, col)
                end = node.end_point[0]
                source = "\n".join(lines[start : end + 1])

                chunks.append(
                    CodeChunk(
                        name=full_name,
                        kind=node.type.replace("_definition", "").replace("_declaration", ""),
                        source=source,
                        start_line=start + 1,
                        end_line=end + 1,
                        language=language,
                    )
                )
                # Recursie cu context de clasă
                for child in node.children:
                    _walk(child, parent_name=full_name if "class" in node.type else parent_name)
            else:
                for child in node.children:
                    _walk(child, parent_name)

        _walk(tree.root_node)
        return chunks or _fallback_single_chunk(code, language)


# ── Regex fallback chunker ────────────────────────────────────────────────────

# Patterns pentru detectarea capetelor de funcții/clase per limbaj
_REGEX_PATTERNS: dict[str, list[tuple[str, str]]] = {
    "python": [
        (r"^(class\s+(\w+).*?:)", "class"),
        (r"^((?:async\s+)?def\s+(\w+)\s*\(.*?\)\s*(?:->.+?)?:)", "function"),
    ],
    "javascript": [
        (r"^((?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\()", "function"),
        (r"^(class\s+(\w+))", "class"),
        (r"^\s*((\w+)\s*[:=]\s*(?:async\s+)?(?:function|\(.*?\)\s*=>))", "function"),
    ],
    "java": [
        (r"^(\s*(?:public|private|protected|static|final|abstract|\s)*\s+\w+\s+(\w+)\s*\()", "function"),
        (r"^(\s*(?:public|private|protected)?\s*class\s+(\w+))", "class"),
    ],
    "go": [
        (r"^(func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\()", "function"),
    ],
}


class RegexChunker:
    """
    Chunker heuristic bazat pe regex.

    Limitări cunoscute:
      - Nu gestionează corect funcțiile nested complexe.
      - Delimitarea end_line se bazează pe indentare / linii goale.
      - Suficient pentru MVP și pentru limbaje fără suport tree-sitter.
    """

    def chunk(self, code: str, language: str) -> list[CodeChunk]:
        patterns = _REGEX_PATTERNS.get(language, _REGEX_PATTERNS["python"])
        lines = code.splitlines()
        chunks: list[CodeChunk] = []

        i = 0
        while i < len(lines):
            line = lines[i]
            matched = False

            for pattern, kind in patterns:
                m = re.match(pattern, line, re.MULTILINE)
                if m:
                    name = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
                    start = i
                    end = _find_block_end(lines, i, language)
                    source = "\n".join(lines[start : end + 1])

                    chunks.append(
                        CodeChunk(
                            name=name,
                            kind=kind,
                            source=source,
                            start_line=start + 1,
                            end_line=end + 1,
                            language=language,
                        )
                    )
                    i = end + 1
                    matched = True
                    break

            if not matched:
                i += 1

        return chunks or _fallback_single_chunk(code, language)


def _find_block_end(lines: list[str], start: int, language: str) -> int:
    """
    Estimează linia de sfârșit a unui bloc.

    Python  → bazat pe indentare.
    Altele  → numără acolade deschise/închise.
    """
    if language == "python":
        base_indent = len(lines[start]) - len(lines[start].lstrip())
        for j in range(start + 1, len(lines)):
            stripped = lines[j].strip()
            if not stripped:
                continue
            current_indent = len(lines[j]) - len(lines[j].lstrip())
            if current_indent <= base_indent and stripped:
                return j - 1
        return len(lines) - 1
    else:
        depth = 0
        for j in range(start, len(lines)):
            depth += lines[j].count("{") - lines[j].count("}")
            if j > start and depth <= 0:
                return j
        return len(lines) - 1


def _fallback_single_chunk(code: str, language: str) -> list[CodeChunk]:
    """Dacă nu găsim nicio structură, tratăm tot fișierul ca un singur chunk."""
    return [
        CodeChunk(
            name="__module__",
            kind="unknown",
            source=code,
            start_line=1,
            end_line=len(code.splitlines()),
            language=language,
        )
    ]


def _estimate_tokens(text: str) -> int:
    """Estimare rapidă: ~1 token la 4 caractere (heuristic)."""
    return max(1, len(text) // 4)


def split_chunks_by_token_limit(chunks: list[CodeChunk], max_tokens: int) -> list[CodeChunk]:
    """
    Taie chunk-urile foarte mari pentru a limita costul prompturilor LLM.

    Partitiile pastreaza ordinea si adauga sufixul `#partN` la nume.
    """
    if max_tokens <= 0:
        return chunks

    output: list[CodeChunk] = []
    for chunk in chunks:
        if _estimate_tokens(chunk.source) <= max_tokens:
            output.append(chunk)
            continue

        parts = _split_source_by_lines(chunk.source, max_tokens=max_tokens)
        line_cursor = chunk.start_line

        for idx, part in enumerate(parts, start=1):
            line_count = max(1, part.count("\n") + 1)
            end_line = line_cursor + line_count - 1
            output.append(
                CodeChunk(
                    name=f"{chunk.name}#part{idx}",
                    kind=chunk.kind,
                    source=part,
                    start_line=line_cursor,
                    end_line=end_line,
                    language=chunk.language,
                )
            )
            line_cursor = end_line + 1

    return output


def _split_source_by_lines(source: str, max_tokens: int) -> list[str]:
    """Imparte un text mare in parti bazate pe linii si limita de tokeni."""
    max_chars = max(32, max_tokens * 4)
    lines = source.splitlines()

    if not lines:
        return [source]

    parts: list[str] = []
    current: list[str] = []
    current_size = 0

    for line in lines:
        line_size = len(line) + 1

        if current and current_size + line_size > max_chars:
            parts.append("\n".join(current))
            current = [line]
            current_size = line_size
            continue

        if not current and line_size > max_chars:
            # Linie foarte mare: o taiem in bucati fixe.
            for i in range(0, len(line), max_chars):
                parts.append(line[i : i + max_chars])
            current = []
            current_size = 0
            continue

        current.append(line)
        current_size += line_size

    if current:
        parts.append("\n".join(current))

    return parts or [source]


# ── Public factory ────────────────────────────────────────────────────────────

def get_chunker(language: str) -> ChunkerProtocol:
    """
    Returnează cel mai bun chunker disponibil pentru limbajul dat.

    Încearcă tree-sitter; dacă nu e instalat, face fallback la regex.
    """
    try:
        chunker = TreeSitterChunker()
        # Validăm că importul funcționează efectiv
        from tree_sitter_languages import get_parser  # type: ignore  # noqa: F401
        logger.debug("TreeSitterChunker activ pentru '%s'", language)
        return chunker
    except ImportError:
        logger.info(
            "tree-sitter-languages nu este instalat — folosesc RegexChunker pentru '%s'",
            language,
        )
        return RegexChunker()


def detect_language(code: str, hint: str = "auto") -> str:
    """
    Detectare simplă a limbajului pe baza cuvintelor cheie, dacă hint='auto'.
    """
    if hint != "auto":
        return hint.lower()

    if re.search(r"\bdef\b|\bimport\b|\bclass\b.*:", code):
        return "python"
    if re.search(r"\bfunction\b|\b=>\b|\bconst\b|\blet\b|\bvar\b", code):
        return "javascript"
    if re.search(r"\bpublic\s+class\b|\bSystem\.out\b", code):
        return "java"
    if re.search(r"\bfunc\b.*\{|\bpackage\s+main\b", code):
        return "go"

    return "python"  # default rezonabil

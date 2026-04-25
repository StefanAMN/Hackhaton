"""
Test suite pentru chunker-ul regex.
Nu necesită dependențe externe (tree-sitter, Redis, LLM).

Rulare: pytest tests/ -v
"""
import pytest

from app.services.chunker import RegexChunker, detect_language


PYTHON_CODE = """\
class Calculator:
    def add(self, a: int, b: int) -> int:
        return a + b

    def divide(self, a: float, b: float) -> float:
        if b == 0:
            raise ValueError("Division by zero")
        return a / b

def standalone_function(x: int) -> str:
    return str(x * 2)
"""

JS_CODE = """\
function greet(name) {
    return `Hello, ${name}!`;
}

class Animal {
    constructor(name) {
        this.name = name;
    }
}
"""


class TestRegexChunker:
    def setup_method(self):
        self.chunker = RegexChunker()

    def test_python_extracts_class_and_functions(self):
        chunks = self.chunker.chunk(PYTHON_CODE, "python")
        names = [c.name for c in chunks]

        assert "Calculator" in names
        assert "standalone_function" in names

    def test_python_chunk_has_correct_kind(self):
        chunks = self.chunker.chunk(PYTHON_CODE, "python")
        kinds = {c.name: c.kind for c in chunks}

        assert kinds.get("Calculator") == "class"
        assert kinds.get("standalone_function") == "function"

    def test_python_chunk_source_not_empty(self):
        chunks = self.chunker.chunk(PYTHON_CODE, "python")
        for chunk in chunks:
            assert chunk.source.strip(), f"Chunk '{chunk.name}' are source gol"

    def test_js_extracts_function_and_class(self):
        chunks = self.chunker.chunk(JS_CODE, "javascript")
        names = [c.name for c in chunks]

        assert "greet" in names or any("greet" in n for n in names)
        assert "Animal" in names or any("Animal" in n for n in names)

    def test_empty_code_returns_fallback(self):
        chunks = self.chunker.chunk("   \n   ", "python")
        assert len(chunks) == 1
        assert chunks[0].name == "__module__"

    def test_line_numbers_are_positive(self):
        chunks = self.chunker.chunk(PYTHON_CODE, "python")
        for chunk in chunks:
            assert chunk.start_line >= 1
            assert chunk.end_line >= chunk.start_line


class TestLanguageDetection:
    def test_detects_python(self):
        assert detect_language("def foo(): pass") == "python"

    def test_detects_javascript(self):
        assert detect_language("const x = () => 42;") == "javascript"

    def test_detects_java(self):
        assert detect_language("public class Foo { System.out.println(); }") == "java"

    def test_detects_go(self):
        assert detect_language("package main\nfunc main() {}") == "go"

    def test_hint_overrides_detection(self):
        assert detect_language("def foo(): pass", hint="javascript") == "javascript"

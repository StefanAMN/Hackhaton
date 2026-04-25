## Makefile — comenzi uzuale pentru development

.PHONY: help install dev test lint clean redis-up redis-down

# Default target
help:
	@echo ""
	@echo "Legacy Code Analyzer — comenzi disponibile:"
	@echo "  make install     Instalează dependențele Python"
	@echo "  make dev         Pornește serverul FastAPI în mod development"
	@echo "  make test        Rulează test suite-ul (fără servicii externe)"
	@echo "  make lint        Rulează ruff + mypy"
	@echo "  make redis-up    Pornește Redis și PostgreSQL via Docker"
	@echo "  make redis-down  Oprește containerele Docker"
	@echo "  make clean       Șterge cache-urile Python"
	@echo ""

install:
	pip install -r requirements.txt

dev:
	uvicorn app.main:app --reload --port 8000 --log-level info

test:
	pytest tests/ -v --tb=short

lint:
	@command -v ruff >/dev/null 2>&1 && ruff check app/ tests/ || echo "ruff not installed, skip"
	@command -v mypy >/dev/null 2>&1 && mypy app/ --ignore-missing-imports || echo "mypy not installed, skip"

redis-up:
	docker compose up -d redis postgres

redis-down:
	docker compose down

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	find . -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true

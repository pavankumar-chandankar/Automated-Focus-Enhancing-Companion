.PHONY: install test smoke serve evaluate lint
install:
	python -m pip install -e '.[dev]'
test:
	python -m pytest -q
smoke:
	python scripts/dev_smoke.py
serve:
	uvicorn focusbuddy.api.app:app --reload --host 127.0.0.1 --port 8000 --no-access-log
evaluate:
	python -m focusbuddy.cli evaluate-prompts --output results/prompt-contract-scores.json
lint:
	ruff check backend tests

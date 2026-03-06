.PHONY: help setup-js setup-ocr run-vmill run-ocr run-all hosts-hint

help:
	@echo "VMill helper targets"
	@echo "  make setup-js    - install frontend dependencies"
	@echo "  make setup-ocr   - create .venv_ocr and install OCR dependencies"
	@echo "  make run-vmill   - run vmill_server.py on :8080"
	@echo "  make run-ocr     - run ocr_server.py on :8081"
	@echo "  make run-all     - run both servers"
	@echo "  make hosts-hint  - print LAN host mapping hints"

setup-js:
	npm ci

setup-ocr:
	python3 -m venv .venv_ocr
	. .venv_ocr/bin/activate && python -m pip install --upgrade pip && pip install -r requirements_ocr.txt

run-vmill:
	./scripts/run_vmill.sh

run-ocr:
	./scripts/run_ocr.sh

run-all:
	./scripts/run_all.sh

hosts-hint:
	./scripts/hosts_hint.sh

.PHONY: help setup-js setup-ocr setup-pack run-vmill run-ocr run-all hosts-hint build-vmill-linux build-ocr-linux build-portable-linux stress-sync stress-ocr

help:
	@echo "VMill helper targets"
	@echo "  make setup-js    - install frontend dependencies"
	@echo "  make setup-ocr   - create .venv_ocr and install OCR dependencies"
	@echo "  make setup-pack  - install PyInstaller for local python"
	@echo "  make run-vmill   - run vmill_server.py on :8080"
	@echo "  make run-ocr     - run ocr_server.py on :8081"
	@echo "  make run-all     - run both servers"
	@echo "  make hosts-hint  - print LAN host mapping hints"
	@echo "  make build-vmill-linux   - build portable vmill_server bundle"
	@echo "  make build-ocr-linux     - build portable ocr_server bundle"
	@echo "  make build-portable-linux - build both portable bundles"
	@echo "  make stress-sync - run sync/API stress test against isolated server"
	@echo "  make stress-ocr  - run OCR API stress test"

setup-js:
	npm ci

setup-ocr:
	python3 -m venv .venv_ocr
	. .venv_ocr/bin/activate && python -m pip install --upgrade pip && pip install -r requirements_ocr.txt

setup-pack:
	python3 -m pip install --upgrade pip pyinstaller

run-vmill:
	./scripts/run_vmill.sh

run-ocr:
	./scripts/run_ocr.sh

run-all:
	./scripts/run_all.sh

hosts-hint:
	./scripts/hosts_hint.sh

build-vmill-linux:
	./scripts/build_portable_vmill_linux.sh

build-ocr-linux:
	./scripts/build_portable_ocr_linux.sh

build-portable-linux:
	./scripts/build_portable_all_linux.sh

stress-sync:
	python3 ./scripts/stress_sync_test.py

stress-ocr:
	python3 ./scripts/stress_ocr_test.py

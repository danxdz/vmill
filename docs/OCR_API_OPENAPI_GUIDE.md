# OCR API OpenAPI Guide

This OCR server already exposes native FastAPI OpenAPI docs.

## Live docs URLs

- Swagger UI: `/docs`
- ReDoc: `/redoc`
- Raw OpenAPI JSON: `/openapi.json`

Example local URLs:

- `http://localhost:8081/docs`
- `http://localhost:8081/openapi.json`

## Quick endpoint map

- `GET /` health + docs links
- `POST /ocr/process` OCR from uploaded image/PDF (multipart)
- `POST /ocr/process-path` OCR from server file path (query)
- `POST /ocr/process-center` OCR around a center point / rectangle (json)
- `POST /ocr/process-with-lines` OCR + line detection (json)
- `POST /ocr/get-text-properties` text properties lookup (json)
- `POST /ocr/process-baseline` OCR near baseline line (json)
- `POST /blueprint/quick-validate` quick blueprint validation (multipart)
- `GET /blueprint/stats` OCR capability stats
- `POST /export/pdf` export PDF report (multipart)
- `POST /export/excel` export bilingual Excel report (json)
- `POST /training/save-zone` save training sample (json)
- `GET /training-data/list` list training samples
- `GET /training-data/{sample_id}` fetch one sample
- `PUT /training-data/{sample_id}` update sample
- `DELETE /training-data/{sample_id}` delete sample
- `GET /training-data/stats` training stats
- `POST /training-data/{sample_id}/validate` revalidate sample
- `GET /telegram/status` telegram integration status

## Example calls

### 1) Health

```bash
curl -s http://localhost:8081/ | jq
```

### 2) OCR on upload

```bash
curl -s -X POST "http://localhost:8081/ocr/process?mode=hardcore&rotation=0" \
  -F "file=@/path/to/blueprint.jpg" | jq
```

### 3) Quick blueprint validate

```bash
curl -s -X POST "http://localhost:8081/blueprint/quick-validate" \
  -F "file=@/path/to/blueprint.jpg" | jq
```

### 4) Export excel

```bash
curl -s -X POST "http://localhost:8081/export/excel" \
  -H "Content-Type: application/json" \
  -d '{"part_number":"P001","zones":[]}' \
  -o report.xlsx
```

### 5) List training data

```bash
curl -s "http://localhost:8081/training-data/list" | jq
```

## OpenAPI import

- Postman/Insomnia: import from URL `http://localhost:8081/openapi.json`.
- You can also use the static reference spec: `docs/ocr_openapi.v1.yaml`.


# Policy Ingestion Pipeline

A controlled ingestion pipeline for policy documents (PDF, DOCX, TXT) designed for the Unitree Go2 Edu robot.

## Features
- **Strict Validation**: Rejects any file that isn't a PDF, DOCX, or TXT using MIME type verification.
- **Robust Extraction**:
  - PDF extraction via `pdfplumber`.
  - DOCX extraction via `python-docx`.
  - TXT extraction via UTF-8 read.
  - **OCR Fallback**: Automatically attempts OCR via `pytesseract` if a PDF page has no extractable text layer.
- **Basic Cleanup**: Normalizes whitespace, removes duplicate lines, and strips basic repeated headers/footers.
- **Structure Detection**: Detects headings, numbered sections, and bullet points without performing semantic analysis.

## Requirements
- Python 3.8+
- [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) (Required for OCR fallback on scanned PDFs)

## Installation
```bash
pip install -r requirements.txt
```

## Usage
The pipeline runs in two stages: Ingestion and Drafting.

1. **Ingest the document**:
```bash
python main.py <path_to_file> --output outputs/stage1.json
```
2. **Draft the rules**:
```bash
python draft_rules.py outputs/stage1.json --output-dir outputs
```

Example:
```bash
python main.py sample_policy.pdf --output outputs/stage1.json
python draft_rules.py outputs/stage1.json --output-dir outputs
```

## Output Format

### Stage 1: Ingestion
The first stage produces an intermediate JSON object containing:
- `status`: "success", "rejected", or "error"
- `raw_text`: The cleaned, extracted text.
- `document_structure`: A list of detected sections, headings, and bullets with line numbers.
- `ingestion_log`: Metadata about the processing, including page count, timestamp, and whether OCR was used.

### Stage 2: Drafting
The drafting stage generates the following structured outputs in the specified output directory:
- `policy_constraint.yaml`: Strict operational constraints and rules formatted for the robot.
- `policy_constraint.md`: Human-readable formatted rules document.
- `audit_logs.json`: Audit log templates with necessary fields (time, zone, action, etc.) for the robot to populate.
- `draft_rules.json`: Detailed JSON representation of high-confidence parsed rules.
- `ambiguous_items.json`: Sentences the AI couldn't fully classify.
- `inference_suggestions.json`: Implied or advisory rules (e.g., "should" instead of "must").

## Constraints Adhered To
- ❌ No rule extraction during ingestion.
- ❌ No semantic analysis during ingestion.
- ❌ No ML models during ingestion.
- ✅ Immediate rejection on invalid MIME types.
- ✅ OCR as last resort only.

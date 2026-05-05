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
Run the pipeline on a document:
```bash
python main.py <path_to_file> --output <output_json_path>
```

Example:
```bash
python main.py sample_policy.pdf --output result.json
```

## Output Format
The pipeline produces a JSON object containing:
- `status`: "success", "rejected", or "error"
- `raw_text`: The cleaned, extracted text.
- `document_structure`: A list of detected sections, headings, and bullets with line numbers.
- `ingestion_log`: Metadata about the processing, including page count, timestamp, and whether OCR was used.

## Constraints Adhered To
- ❌ No rule extraction.
- ❌ No semantic analysis.
- ❌ No ML models.
- ✅ Immediate rejection on invalid MIME types.
- ✅ OCR as last resort only.

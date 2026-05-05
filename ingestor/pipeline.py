import datetime
import os
import json
from ingestor.validator import PolicyValidator
from ingestor.extractor import PolicyExtractor
from ingestor.cleaner import PolicyCleaner
from ingestor.structurer import PolicyStructurer

class PolicyIngestionPipeline:
    def __init__(self):
        self.logs = []

    def log(self, message):
        timestamp = datetime.datetime.now().isoformat()
        self.logs.append(f"[{timestamp}] {message}")
        print(f"LOG: {message}")

    def process(self, file_path):
        filename = os.path.basename(file_path)
        self.log(f"Starting ingestion for: {filename}")
        
        # 1. MIME Validation
        is_valid, mime_type, file_type = PolicyValidator.validate(file_path)
        if not is_valid:
            error_msg = f"Rejection: Invalid file type {mime_type}. Only PDF, DOCX, and TXT are allowed."
            self.log(error_msg)
            return {
                "status": "rejected",
                "error": error_msg,
                "ingestion_log": {
                    "file_name": filename,
                    "type": mime_type,
                    "timestamp": datetime.datetime.now().isoformat(),
                    "errors": [error_msg]
                }
            }
        
        self.log(f"File validated as {file_type} ({mime_type})")

        # 2. Extraction
        try:
            raw_text, page_count, used_ocr = PolicyExtractor.extract(file_path, file_type, self.log)
            if used_ocr:
                self.log("OCR was used as a fallback for text extraction.")
        except Exception as e:
            error_msg = f"Extraction failed: {str(e)}"
            self.log(error_msg)
            return {
                "status": "error",
                "error": error_msg,
                "ingestion_log": {
                    "file_name": filename,
                    "type": file_type,
                    "timestamp": datetime.datetime.now().isoformat(),
                    "errors": [error_msg]
                }
            }

        # 3. Cleanup
        cleaned_text = PolicyCleaner.clean(raw_text)
        self.log("Text cleanup completed.")

        # 4. Structure Detection
        structure = PolicyStructurer.detect_structure(cleaned_text)
        self.log(f"Structure detection completed. Found {len(structure)} elements.")

        # Final Output
        output = {
            "status": "success",
            "raw_text": cleaned_text,
            "document_structure": structure,
            "ingestion_log": {
                "file_name": filename,
                "type": file_type,
                "page_count": page_count,
                "timestamp": datetime.datetime.now().isoformat(),
                "ocr_used": used_ocr,
                "processing_history": self.logs
            }
        }
        
        return output

if __name__ == "__main__":
    # Example usage (can be used for testing)
    import sys
    if len(sys.argv) > 1:
        pipeline = PolicyIngestionPipeline()
        result = pipeline.process(sys.argv[1])
        print(json.dumps(result, indent=2))

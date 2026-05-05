import json
import argparse
import os
import uuid
from drafter.segmenter import PolicySegmenter
from drafter.classifier import RuleClassifier
from drafter.rule_extractor import RuleExtractor
from drafter.router import RuleRouter

class RuleDraftingPipeline:
    def __init__(self, output_dir="output"):
        print("Initializing Drafting Pipeline...")
        self.segmenter = PolicySegmenter()
        self.classifier = RuleClassifier()
        self.extractor = RuleExtractor()
        self.router = RuleRouter(output_dir)

    def process(self, raw_text):
        print("Segmenting text into sentences...")
        sentences = self.segmenter.segment(raw_text)
        print(f"Processing {len(sentences)} sentences...")
        
        for sentence in sentences:
            # 1. Classification
            confidence = self.classifier.classify(sentence)
            
            # Skip obvious garbage / pure headers (e.g. "1. OPERATIONAL BOUNDARIES" or "END OF DOCUMENT")
            words = sentence.split()
            if confidence < 0.1 and (len(words) <= 4 or sentence.isupper()):
                print(f"Skipping non-rule garbage: {sentence}")
                continue

            # 2. Extraction
            extracted = self.extractor.extract_all(sentence)
            
            # 3. Inference check
            is_inferred = any(w in sentence.lower() for w in ["should", "recommend", "suggest", "advisory", "optional"])
            
            # 4. Create Draft Rule Object
            rule_draft = {
                "id": f"DR-{uuid.uuid4().hex[:4].upper()}",
                "source_sentence": sentence,
                "condition": extracted["condition"],
                "action_suggestion": extracted["action_suggestion"],
                "entities": extracted["entities"],
                "severity_suggestion": extracted["severity_suggestion"],
                "confidence": round(confidence, 2),
                "status": "draft",
                "active": False,
                "is_inferred": is_inferred,
                "label": "DRAFT ONLY - NON-ACTIVE"
            }
            
            # 5. Routing
            self.router.route(rule_draft)
            
        print("Saving outputs...")
        return self.router.save_outputs()

def main():
    parser = argparse.ArgumentParser(description="AI-Assisted Rule Drafting Pipeline")
    parser.add_argument("input_json", help="Path to the JSON output from Stage 1")
    parser.add_argument("--output-dir", help="Directory to save the draft rules", default="drafts")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input_json):
        print(f"Error: {args.input_json} not found.")
        return
        
    with open(args.input_json, "r", encoding="utf-8") as f:
        stage1_data = json.load(f)
        
    raw_text = stage1_data.get("raw_text", "")
    if not raw_text:
        print("Error: No raw_text found in input JSON.")
        return
        
    pipeline = RuleDraftingPipeline(args.output_dir)
    results = pipeline.process(raw_text)
    
    print("\nDrafting complete.")
    for filename, data in results.items():
        print(f"- {filename}: {len(data)} items")

if __name__ == "__main__":
    main()

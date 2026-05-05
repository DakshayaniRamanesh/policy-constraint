import json
import os

class RuleRouter:
    def __init__(self, output_dir):
        self.output_dir = output_dir
        self.draft_rules = []
        self.ambiguous_items = []
        self.inference_suggestions = []
        
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

    def route(self, candidate):
        confidence = candidate.get("confidence", 0)
        
        # Inferred rules (those that aren't explicit but suggested)
        # For now, we'll assume candidates are explicit unless flagged.
        if candidate.get("is_inferred", False):
            self.inference_suggestions.append(candidate)
        elif confidence >= 0.50:
            if confidence < 0.80:
                candidate["flag"] = "medium_confidence"
            self.draft_rules.append(candidate)
        else:
            self.ambiguous_items.append(candidate)

    def save_outputs(self):
        outputs = {
            "draft_rules.json": self.draft_rules,
            "ambiguous_items.json": self.ambiguous_items,
            "inference_suggestions.json": self.inference_suggestions
        }
        
        for filename, data in outputs.items():
            path = os.path.join(self.output_dir, filename)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
        
        return outputs

import re
try:
    from transformers import pipeline
except ImportError:
    pipeline = None

class RuleClassifier:
    RULE_KEYWORDS = [
        r"\bmust\b", r"\bshall\b", r"\bshould\b", r"\bprohibited\b", 
        r"\bnot allowed\b", r"\brestricted to\b", r"\bonly when\b",
        r"\brequired\b", r"\bforbidden\b", r"\bpermit(ted)?\b",
        r"\bensure\b", r"\btrigger\b", r"\bwill\b", r"\ballowed\b", r"\bmay\b"
    ]

    def __init__(self):
        self.classifier = None
        if pipeline:
            try:
                print("Loading ML classifier (this may take a few minutes on first run)...")
                # Use a small, efficient model for classification
                self.classifier = pipeline("zero-shot-classification", 
                                          model="cross-encoder/nli-distilroberta-base-v2",
                                          device=-1) # -1 for CPU
                print("ML classifier loaded.")
            except Exception as e:
                print(f"Warning: Could not load ML classifier: {e}")

    def get_keyword_score(self, sentence):
        score = 0
        found = False
        for pattern in self.RULE_KEYWORDS:
            if re.search(pattern, sentence, re.IGNORECASE):
                score += 0.2
                found = True
        
        if found:
            return min(0.95, 0.5 + score)
        return 0.0

    def classify(self, sentence):
        """
        Classifies a sentence as a rule and returns a confidence score.
        """
        keyword_score = self.get_keyword_score(sentence)
        
        if self.classifier:
            try:
                result = self.classifier(sentence, candidate_labels=["policy rule", "general information"])
                # Combine keyword heuristic with ML prediction
                ml_score = result['scores'][result['labels'].index("policy rule")]
                # Weighted average: 30% keyword, 70% ML
                final_score = (keyword_score * 0.3) + (ml_score * 0.7)
                return final_score
            except:
                return keyword_score
        
        return keyword_score

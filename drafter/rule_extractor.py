import re
import spacy

class RuleExtractor:
    def __init__(self, nlp_model="en_core_web_sm"):
        try:
            self.nlp = spacy.load(nlp_model)
        except OSError:
            spacy.cli.download(nlp_model)
            self.nlp = spacy.load(nlp_model)

    def extract_action(self, sentence):
        sentence = sentence.lower()
        if any(w in sentence for w in ["must not", "shall not", "prohibited", "forbidden", "not allowed"]):
            return "BLOCK"
        if any(w in sentence for w in ["must", "shall", "required", "allowed", "permitted"]):
            return "ALLOW"
        if any(w in sentence for w in ["alert", "notify", "log", "report"]):
            return "ALERT"
        if any(w in sentence for w in ["escalate", "emergency stop", "e-stop"]):
            return "ESCALATE"
        return "ALERT" # Default fallback

    def extract_severity(self, sentence):
        sentence = sentence.lower()
        if any(w in sentence for w in ["emergency", "critical", "danger", "immediately"]):
            return "CRITICAL"
        if any(w in sentence for w in ["must", "prohibited", "forbidden", "strict"]):
            return "HIGH"
        if any(w in sentence for w in ["shall", "required"]):
            return "MEDIUM"
        return "LOW"

    def extract_entities(self, sentence):
        doc = self.nlp(sentence)
        entities = []
        for ent in doc.ents:
            if ent.label_ in ["GPE", "LOC", "FAC", "ORG", "PERSON"]:
                entities.append(ent.text)
        
        # Custom regex for zones and robots
        zones = re.findall(r"Zone [A-Z0-9]+", sentence, re.IGNORECASE)
        entities.extend(zones)
        if "robot" in sentence.lower():
            entities.append("robot")
        
        return list(set(entities))

    def extract_condition(self, sentence):
        condition = {}
        
        # Time patterns
        time_match = re.search(r"(after|before|at|during|between) \d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm|o'clock)?", sentence)
        if time_match:
            condition["time"] = time_match.group(0)
            
        # Zone patterns
        zone_match = re.search(r"in (Zone [A-Z0-9]+)", sentence, re.IGNORECASE)
        if zone_match:
            condition["zone"] = zone_match.group(1)
            
        # Trigger patterns
        if "if " in sentence.lower():
            if_match = re.search(r"if (.*?),", sentence, re.IGNORECASE)
            if if_match:
                condition["trigger"] = if_match.group(1)
                
        return condition

    def extract_all(self, sentence):
        return {
            "condition": self.extract_condition(sentence),
            "action_suggestion": self.extract_action(sentence),
            "entities": self.extract_entities(sentence),
            "severity_suggestion": self.extract_severity(sentence)
        }

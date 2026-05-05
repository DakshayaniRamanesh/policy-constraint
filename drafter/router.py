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

        # Generate YAML for the robot
        yaml_path = os.path.join(self.output_dir, "policy_constraint.yaml")
        with open(yaml_path, "w", encoding="utf-8") as f:
            f.write("rules:\n")
            for rule in self.draft_rules:
                f.write(f"  - id: {rule['id']}\n")
                f.write(f"    action: {rule['action_suggestion']}\n")
                f.write(f"    severity: {rule['severity_suggestion']}\n")
                if rule.get('condition'):
                    f.write("    condition:\n")
                    for k, v in rule['condition'].items():
                        f.write(f"      {k}: \"{v}\"\n")
                if rule.get('entities'):
                    f.write("    entities:\n")
                    for ent in rule['entities']:
                        f.write(f"      - {ent}\n")

        # Generate Markdown for humans
        md_path = os.path.join(self.output_dir, "policy_constraint.md")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write("# Policy Constraints\n\n")
            for rule in self.draft_rules:
                f.write(f"## Rule {rule['id']}\n")
                f.write(f"**Source:** {rule['source_sentence']}\n\n")
                f.write(f"- **Action:** {rule['action_suggestion']}\n")
                f.write(f"- **Severity:** {rule['severity_suggestion']}\n")
                if rule.get('condition'):
                    f.write("- **Conditions:**\n")
                    for k, v in rule['condition'].items():
                        f.write(f"  - {k}: {v}\n")
                if rule.get('entities'):
                    f.write(f"- **Entities:** {', '.join(rule['entities'])}\n")
                f.write("\n")

        # Generate JSON for audit logs
        audit_path = os.path.join(self.output_dir, "audit_logs.json")
        audit_logs = []
        for rule in self.draft_rules:
            log_entry = {
                "rule_id": rule["id"],
                "timestamp": "<TIMESTAMP_PLACEHOLDER>",
                "zone": rule.get("condition", {}).get("zone", "UNKNOWN"),
                "entities_involved": rule.get("entities", []),
                "action_taken": rule["action_suggestion"],
                "severity": rule["severity_suggestion"],
                "trigger_event": rule.get("condition", {}).get("trigger", "UNKNOWN")
            }
            audit_logs.append(log_entry)
            
        with open(audit_path, "w", encoding="utf-8") as f:
            json.dump({"audit_templates": audit_logs}, f, indent=4)
        
        return outputs

import json
import os
import hashlib
import hmac
import datetime
import uuid
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import subprocess

from ingestor.pipeline import PolicyIngestionPipeline
from draft_rules import RuleDraftingPipeline

app = FastAPI()

print("Pre-loading NLP models...")
ingestor_pipeline = PolicyIngestionPipeline()
draft_dir = os.path.join(os.path.dirname(__file__), "..", "outputs")
drafting_pipeline = RuleDraftingPipeline(output_dir=draft_dir)
print("NLP models loaded successfully!")

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
SECRET_KEY = b"unitree-go2-edu-secret-key-2026"
CURRENT_MAP_VERSION = "v1.0"
VALID_ZONES = ["GLOBAL", "Zone A", "Zone B", "Zone C", "Zone D"]
VALID_ACTIONS = ["ALLOW", "BLOCK", "ALERT", "ESCALATE"]
VALID_ROLES = ["authorized_personnel", "delivery_robot", "unknown"]

# Paths
DRAFTS_DIR = os.path.join(os.getcwd(), "..", "outputs")
MAP_PATH = "facility_map.json"
AUDIT_LOG_PATH = "audit_log.json"
BUNDLE_PATH = "signed_policy_bundle.acsr"

# Models
class Rule(BaseModel):
    id: str
    source_sentence: str
    condition: Dict
    action_suggestion: str
    entities: List[str]
    severity_suggestion: str
    confidence: float
    status: str
    active: bool
    is_inferred: bool
    label: str
    zone: Optional[str] = None
    role: Optional[str] = None
    action: Optional[str] = None
    severity: Optional[str] = None
    entity_requires_identity_resolution: bool = False
    operator_id: Optional[str] = None

class ApprovalBundle(BaseModel):
    operator_id: str
    rules: List[Rule]

class RobotCommand(BaseModel):
    command: str
    operator_id: str

class AuditEntry(BaseModel):
    timestamp: str
    operator: str
    role: str
    type: str
    action: str
    action_sub: str
    severity: str
    rule_id: str

# Helper functions
def get_audit_logs():
    if os.path.exists(AUDIT_LOG_PATH):
        with open(AUDIT_LOG_PATH, "r") as f:
            try:
                return json.load(f)
            except:
                return []
    return []

def add_audit_entry(entry: Dict):
    logs = get_audit_logs()
    logs.insert(0, entry)  # Newest first
    with open(AUDIT_LOG_PATH, "w") as f:
        json.dump(logs, f, indent=4)

def get_drafts():
    draft_rules = []
    ambiguous = []
    inferences = []
    
    if os.path.exists(os.path.join(DRAFTS_DIR, "draft_rules.json")):
        with open(os.path.join(DRAFTS_DIR, "draft_rules.json"), "r") as f:
            draft_rules = json.load(f)
            
    if os.path.exists(os.path.join(DRAFTS_DIR, "ambiguous_items.json")):
        with open(os.path.join(DRAFTS_DIR, "ambiguous_items.json"), "r") as f:
            ambiguous = json.load(f)
            
    if os.path.exists(os.path.join(DRAFTS_DIR, "inference_suggestions.json")):
        with open(os.path.join(DRAFTS_DIR, "inference_suggestions.json"), "r") as f:
            inferences = json.load(f)
            
    return {
        "draft_rules": draft_rules,
        "ambiguous_items": ambiguous,
        "inference_suggestions": inferences
    }

# Endpoints
@app.get("/audit")
def read_audit():
    return get_audit_logs()

@app.post("/audit")
def create_audit(entry: AuditEntry):
    data = entry.dict()
    if not data.get("timestamp"):
        data["timestamp"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    add_audit_entry(data)
    return {"status": "success"}

@app.get("/drafts")
def read_drafts():
    return get_drafts()

@app.get("/facility-map")
def read_map():
    if os.path.exists(MAP_PATH):
        with open(MAP_PATH, "r") as f:
            return json.load(f)
    return {"zones": VALID_ZONES, "version": CURRENT_MAP_VERSION}

@app.post("/upload")
async def upload_policy(file: UploadFile = File(...)):
    inputs_dir = os.path.join("..", "inputs")
    os.makedirs(inputs_dir, exist_ok=True)
    file_path = os.path.join(inputs_dir, file.filename)
    
    with open(file_path, "wb") as f:
        f.write(await file.read())
        
    stage1_result = ingestor_pipeline.process(file_path)
    raw_text = stage1_result.get("raw_text", "")
    
    if raw_text:
        drafting_pipeline.process(raw_text)
        
    return get_drafts()

@app.post("/sign")
def sign_bundle(bundle_data: ApprovalBundle):
    approved_rules = bundle_data.rules
    operator_id = bundle_data.operator_id
    
    # 1. Validation Checks
    for rule in approved_rules:
        # Schema check
        for field in ["id", "condition", "action", "entities", "severity", "zone", "role"]:
            if field not in rule.dict() or rule.dict()[field] is None:
                raise HTTPException(status_code=400, detail=f"Rule {rule.id} missing field {field}")
        
        # Vocabulary check
        if rule.action not in VALID_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Rule {rule.id} has invalid action {rule.action}")
        if rule.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Rule {rule.id} has invalid role {rule.role}")

    # 2. Cryptographic Signing
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    bundle = {
        "rules": [r.dict() for r in approved_rules],
        "approved_by": operator_id,
        "timestamp": timestamp,
        "map_version": CURRENT_MAP_VERSION,
        "policy_version": f"POL-{uuid.uuid4().hex[:6].upper()}"
    }
    
    bundle_json = json.dumps(bundle, sort_keys=True)
    bundle["signature"] = hmac.new(
        SECRET_KEY,
        bundle_json.encode(),
        hashlib.sha256
    ).hexdigest()
    
    # 3. Save Bundle
    with open(BUNDLE_PATH, "w") as f:
        json.dump(bundle, f, indent=4)
        
    # 4. Generate Audit Entries
    for r in approved_rules:
        entry = {
            "timestamp": timestamp,
            "operator": operator_id,
            "role": "superbase user",
            "type": "APPROVED",
            "action": f"Rule {r.id} approved. {r.action} access to {r.zone}.",
            "action_sub": f"Confidence: {int(r.confidence*100)}%. Source: {r.source_sentence[:50]}...",
            "severity": r.severity,
            "rule_id": r.id
        }
        add_audit_entry(entry)
        
    return {"status": "signed", "bundle_path": BUNDLE_PATH, "audit_log": AUDIT_LOG_PATH}

@app.post("/command")
def send_command(cmd: RobotCommand):
    print(f"Direct Command to Robot from {cmd.operator_id}: {cmd.command}")
    
    # Also record in audit log
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = {
        "timestamp": timestamp,
        "operator": cmd.operator_id,
        "role": "superbase user",
        "type": "DIRECT COMMAND",
        "action": f"Manual command executed: {cmd.command}",
        "action_sub": "Command sent via real-time interface bypass.",
        "severity": "MEDIUM",
        "rule_id": "SYS-CMD"
    }
    add_audit_entry(entry)
    
    return {"status": "success", "message": f"Command received: {cmd.command}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

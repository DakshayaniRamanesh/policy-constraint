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
AUDIT_LOG_PATH = "approval_audit_record.json"
BUNDLE_PATH = "signed_policy_bundle.acsr"

# State
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
    # Fields to be added during human review
    zone: Optional[str] = None
    role: Optional[str] = None
    action: Optional[str] = None
    severity: Optional[str] = None
    entity_requires_identity_resolution: bool = False
    operator_id: Optional[str] = None

class AuditAction(BaseModel):
    rule_id: str
    decision: str
    change: Optional[str] = None
    reason: Optional[str] = None

class ApprovalBundle(BaseModel):
    operator_id: str
    rules: List[Rule]

class RobotCommand(BaseModel):
    command: str
    operator_id: str

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
        # Zone is dynamically extracted, so we skip strict VALID_ZONES checking
        if rule.action not in VALID_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Rule {rule.id} has invalid action {rule.action}")
        if rule.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Rule {rule.id} has invalid role {rule.role}")

    # 2. Cryptographic Signing
    timestamp = datetime.datetime.now().isoformat()
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
        
    # 4. Generate Audit Record
    audit_record = {
        "operator_id": operator_id,
        "timestamp": timestamp,
        "actions": [{"rule_id": r.id, "decision": "APPROVED"} for r in approved_rules],
        "signature_valid": True
    }
    with open(AUDIT_LOG_PATH, "w") as f:
        json.dump(audit_record, f, indent=4)
        
    return {"status": "signed", "bundle_path": BUNDLE_PATH, "audit_path": AUDIT_LOG_PATH}

@app.post("/command")
def send_command(cmd: RobotCommand):
    print(f"Direct Command to Robot from {cmd.operator_id}: {cmd.command}")
    return {"status": "success", "message": f"Command received: {cmd.command}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

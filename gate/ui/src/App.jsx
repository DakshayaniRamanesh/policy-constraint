import { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldCheck, AlertTriangle, Check, X, Edit2, Key } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

const VALID_ZONES = ["GLOBAL", "Zone A", "Zone B", "Zone C", "Zone D"];
const VALID_ACTIONS = ["ALLOW", "BLOCK", "ALERT", "ESCALATE"];
const VALID_ROLES = ["authorized_personnel", "delivery_robot", "unknown"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function App() {
  const [drafts, setDrafts] = useState([]);
  const [approvedRules, setApprovedRules] = useState([]);
  const [operatorId, setOperatorId] = useState('OPR-001');
  const [facilityMap, setFacilityMap] = useState({ zones: VALID_ZONES, version: "v1.0" });
  const [error, setError] = useState(null);
  const [signStatus, setSignStatus] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [draftRes, mapRes] = await Promise.all([
        axios.get(`${API_BASE}/drafts`),
        axios.get(`${API_BASE}/facility-map`)
      ]);
      
      setFacilityMap(mapRes.data);
      
      const allDrafts = [
        ...draftRes.data.draft_rules.map(r => ({ ...r, category: r.confidence >= 0.8 ? 'High' : 'Medium' })),
        ...draftRes.data.ambiguous_items.map(r => ({ ...r, category: 'Low' })),
        ...draftRes.data.inference_suggestions.map(r => ({ ...r, category: 'Inferred' }))
      ];
      
      // Initialize edit state for each rule
      const initializedDrafts = allDrafts.map(r => {
        const sentenceLower = r.source_sentence.toLowerCase();
        let defaultRole = "unknown";
        if (sentenceLower.includes("robot")) defaultRole = "delivery_robot";
        else if (sentenceLower.includes("personnel") || sentenceLower.includes("staff") || sentenceLower.includes("authorized")) defaultRole = "authorized_personnel";

        return {
          ...r,
          zone: r.condition?.zone || "GLOBAL",
          action: r.action_suggestion || VALID_ACTIONS[0],
          role: defaultRole,
          severity: r.severity_suggestion || SEVERITIES[0],
          entity_requires_identity_resolution: sentenceLower.includes('personnel') || sentenceLower.includes('authorized'),
          identityConfirmed: false
        };
      });

      setDrafts(initializedDrafts);
    } catch (err) {
      setError("Failed to fetch data from backend. Ensure server.py is running.");
      console.error(err);
    }
  };

  const detectConflicts = (ruleToTest) => {
    // Check against approved rules and other pending drafts
    const allRules = [...approvedRules, ...drafts.filter(r => r.id !== ruleToTest.id)];
    for (const r of allRules) {
      // Conflict exists if they apply to the same Zone AND same Role but have contradictory Actions
      if (r.zone === ruleToTest.zone && r.role === ruleToTest.role && r.action !== ruleToTest.action) {
        return `Conflict with ${r.id}: ${r.action} vs ${ruleToTest.action} for ${r.role} in ${r.zone}`;
      }
    }
    return null;
  };

  const handleUpdateField = (id, field, value) => {
    setDrafts(drafts.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleApprove = (rule) => {
    // Schema & Closed Vocab Validation
    if (!VALID_ZONES.includes(rule.zone) || !facilityMap.zones.includes(rule.zone)) {
      alert(`Invalid Zone: ${rule.zone}`);
      return;
    }
    if (!VALID_ACTIONS.includes(rule.action)) {
      alert("Invalid Action"); return;
    }
    if (!VALID_ROLES.includes(rule.role)) {
      alert("Invalid Role"); return;
    }
    if (rule.entity_requires_identity_resolution && !rule.identityConfirmed) {
      alert("You must confirm Identity Resolution (YOLO+ID) is available.");
      return;
    }
    
    const conflict = detectConflicts(rule);
    if (conflict) {
      alert(`Cannot approve: ${conflict}. Please edit to resolve.`);
      return;
    }

    setDrafts(drafts.filter(r => r.id !== rule.id));
    setApprovedRules([...approvedRules, rule]);
  };

  const handleReject = (id) => {
    setDrafts(drafts.filter(r => r.id !== id));
  };

  const signBundle = async () => {
    if (drafts.length > 0) {
      alert("You must review all pending rules before signing.");
      return;
    }
    try {
      const response = await axios.post(`${API_BASE}/sign`, {
        operator_id: operatorId,
        rules: approvedRules
      });
      setSignStatus(`Success! Signed bundle saved to ${response.data.bundle_path}`);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to sign bundle.");
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Human Validation Gate</h1>
        <div className="operator-id-input">
          <ShieldCheck size={24} color="var(--accent-green)" />
          <input 
            type="text" 
            value={operatorId} 
            onChange={e => setOperatorId(e.target.value)} 
            placeholder="Operator ID"
          />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="section-title">Pending Review ({drafts.length})</div>
      
      {drafts.map(rule => {
        const conflict = detectConflicts(rule);
        return (
          <div key={rule.id} className="glass-panel rule-card">
            <div className="rule-header">
              <div>
                <strong>{rule.id}</strong>
                <span style={{marginLeft:'1rem'}} className={`badge ${rule.category.toLowerCase()}`}>
                  {rule.category} Confidence ({rule.confidence})
                </span>
                {rule.is_inferred && <span style={{marginLeft:'0.5rem'}} className="badge inferred">Inferred</span>}
                {conflict && <span style={{marginLeft:'0.5rem'}} className="badge conflict"><AlertTriangle size={12} style={{display:'inline', marginBottom:'-2px', marginRight:'2px'}}/> Conflict</span>}
              </div>
            </div>
            
            <div className="source-sentence">
              "{rule.source_sentence}"
            </div>

            <div className="edit-form">
              <div className="form-group">
                <label>Zone (must exist in facility map)</label>
                <select value={rule.zone} onChange={(e) => handleUpdateField(rule.id, 'zone', e.target.value)}>
                  {facilityMap.zones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Action</label>
                <select value={rule.action} onChange={(e) => handleUpdateField(rule.id, 'action', e.target.value)}>
                  {VALID_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={rule.role} onChange={(e) => handleUpdateField(rule.id, 'role', e.target.value)}>
                  {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Severity</label>
                <select value={rule.severity} onChange={(e) => handleUpdateField(rule.id, 'severity', e.target.value)}>
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {rule.entity_requires_identity_resolution && (
              <div className="checkbox-wrapper">
                <input 
                  type="checkbox" 
                  id={`id-res-${rule.id}`}
                  checked={rule.identityConfirmed}
                  onChange={(e) => handleUpdateField(rule.id, 'identityConfirmed', e.target.checked)}
                />
                <label htmlFor={`id-res-${rule.id}`}>
                  ⚠️ This rule requires YOLO + identity layer at runtime. Confirm available?
                </label>
              </div>
            )}

            <div className="actions">
              <button className="btn-reject" onClick={() => handleReject(rule.id)}>
                <X size={16} /> {rule.category === 'Inferred' ? 'Discard' : 'Reject'}
              </button>
              
              {rule.category === 'Low' ? (
                <button className="btn-edit" onClick={() => handleApprove(rule)}>
                  <Edit2 size={16} /> Edit & Approve
                </button>
              ) : (
                <button 
                  className={`btn-approve ${conflict ? 'btn-disabled' : ''}`} 
                  onClick={() => handleApprove(rule)}
                >
                  <Check size={16} /> {rule.category === 'Inferred' ? 'Explicitly Accept' : 'Approve'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {approvedRules.length > 0 && (
        <>
          <div className="section-title approved-list">Approved Rules ({approvedRules.length})</div>
          {approvedRules.map(rule => (
            <div key={rule.id} className="glass-panel" style={{ opacity: 0.6, padding: '1rem' }}>
              <strong>{rule.id}</strong>: {rule.action} {rule.role} in {rule.zone} ({rule.severity})
            </div>
          ))}
        </>
      )}

      <div className="sign-bundle-section">
        <h2>Ready to Deploy?</h2>
        <p style={{color: 'var(--text-secondary)', marginTop: '0.5rem'}}>
          Ensure all conflicts are resolved. By cryptographically signing this bundle, you take full responsibility for its execution in Stage 4.
        </p>
        <button 
          className={`sign-btn ${drafts.length > 0 ? 'btn-disabled' : ''}`}
          onClick={signBundle}
        >
          <Key size={20} /> Sign Policy Bundle
        </button>
        {signStatus && <div style={{marginTop: '1rem', color: 'var(--accent-green)', fontWeight: 'bold'}}>{signStatus}</div>}
      </div>
    </div>
  );
}

export default App;

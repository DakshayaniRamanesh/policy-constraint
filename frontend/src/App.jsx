import React, { useState } from 'react';
import './index.css';

function App() {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rules, setRules] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = () => {
    if (!file) return;
    setIsProcessing(true);

    // Simulate parsing the file and extracting draft rules
    setTimeout(() => {
      setRules([
        {
          id: "DR-1A2B",
          source_sentence: "The robot must remain within the designated testing area.",
          action_suggestion: "BLOCK",
          zone: "Testing Area",
          severity_suggestion: "HIGH",
          confidence: 0.85,
          status: "pending"
        },
        {
          id: "DR-3C4D",
          source_sentence: "Indoor speed: Max 0.5 m/s",
          action_suggestion: "ALLOW",
          zone: "Indoor",
          severity_suggestion: "MEDIUM",
          confidence: 0.92,
          status: "pending"
        },
        {
          id: "DR-5E6F",
          source_sentence: "If the robot loses connection, it must sit down immediately.",
          action_suggestion: "ESCALATE",
          zone: "Any",
          severity_suggestion: "CRITICAL",
          confidence: 0.60,
          status: "pending"
        }
      ]);
      setIsProcessing(false);
    }, 1500);
  };

  const handleConfidenceChange = (id, newConfidence) => {
    setRules(rules.map(rule =>
      rule.id === id ? { ...rule, confidence: parseFloat(newConfidence) } : rule
    ));
  };

  const handleActionChange = (id, newAction) => {
    setRules(rules.map(rule =>
      rule.id === id ? { ...rule, action_suggestion: newAction } : rule
    ));
  };

  const handleZoneChange = (id, newZone) => {
    setRules(rules.map(rule =>
      rule.id === id ? { ...rule, zone: newZone } : rule
    ));
  };

  const handleSeverityChange = (id, newSeverity) => {
    setRules(rules.map(rule =>
      rule.id === id ? { ...rule, severity_suggestion: newSeverity } : rule
    ));
  };

  const handleStatusChange = (id, newStatus) => {
    setRules(rules.map(rule =>
      rule.id === id ? { ...rule, status: newStatus } : rule
    ));
  };

  const handleSubmitToML = () => {
    const acceptedRules = rules.filter(r => r.status === 'accepted');
    alert(`Successfully submitted ${acceptedRules.length} accepted rules to the ML Pipeline!`);
    setRules(null);
    setFile(null);
  };

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <div className="sidebar">
        <div className="sidebar-logo">Policy Engine</div>
        <ul className="sidebar-nav">
          <li className="active">Policy Review</li>
          <li>System Dashboard</li>
          <li>History & Logs</li>
          <li>Settings</li>
        </ul>
      </div>

      {/* Main Area */}
      <div className="main-content">
        {/* Topbar */}
        <div className="topbar">
          <div className="topbar-title">Policy Extraction Pipeline</div>
          <div className="topbar-user">
            <span>Admin</span>
            <div className="user-avatar">A</div>
          </div>
        </div>

        {/* Content Area */}
        <div className="content-area">
          <div className="container">
            <div className="header">
              <h1>Policy Review Dashboard</h1>
              <p>Upload policies, adjust parsed data, and approve rules for the ML Pipeline.</p>
            </div>

            {!rules && (
              <>
                <div className="info-cards">
                  <div className="info-card">
                    <div className="info-card-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#0066cc" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div className="info-card-title">Automated Extraction</div>
                    <div className="info-card-desc">NLP-powered parsing identifies constraint clauses, actions, zones, and severity levels from raw policy documents.</div>
                  </div>
                  <div className="info-card">
                    <div className="info-card-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#0066cc" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </div>
                    <div className="info-card-title">Human-in-the-Loop Review</div>
                    <div className="info-card-desc">Each extracted rule is surfaced for human validation — adjust confidence, zone, severity, and action before approval.</div>
                  </div>
                  <div className="info-card">
                    <div className="info-card-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#0066cc" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>
                    </div>
                    <div className="info-card-title">ML Pipeline Ready</div>
                    <div className="info-card-desc">Accepted rules are packaged and forwarded to the downstream ML execution pipeline for deployment on the Unitree Go2.</div>
                  </div>
                </div>

                <div className="upload-section">
                  <div className="upload-header">
                    <h3>Upload Policy Document</h3>
                    <p>Supported formats: <span className="badge-format">.pdf</span> <span className="badge-format">.docx</span> <span className="badge-format">.txt</span></p>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={handleFileChange}
                  />
                  {file && (
                    <div className="file-info">
                      Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={handleUpload}
                    disabled={!file || isProcessing}
                  >
                    {isProcessing ? 'Parsing Document...' : 'Upload & Parse'}
                  </button>
                  <p className="upload-note">The pipeline will extract constraint rules and surface them for your review. No data is sent externally.</p>
                </div>

                <div className="pipeline-steps">
                  <div className="step">
                    <div className="step-number">1</div>
                    <div className="step-text"><strong>Ingest</strong><br />Document is parsed and segmented into policy clauses.</div>
                  </div>
                  <div className="step-arrow">→</div>
                  <div className="step">
                    <div className="step-number">2</div>
                    <div className="step-text"><strong>Extract</strong><br />Rules, zones, entities and actions are identified by the NLP engine.</div>
                  </div>
                  <div className="step-arrow">→</div>
                  <div className="step">
                    <div className="step-number">3</div>
                    <div className="step-text"><strong>Review</strong><br />You validate, adjust, and approve each rule before submission.</div>
                  </div>
                  <div className="step-arrow">→</div>
                  <div className="step">
                    <div className="step-number">4</div>
                    <div className="step-text"><strong>Deploy</strong><br />Accepted rules are forwarded to the ML execution pipeline.</div>
                  </div>
                </div>
              </>
            )}

            {rules && (
              <div className="rules-section">
                <h2>
                  <span>Extracted Draft Rules</span>
                  <span style={{ fontSize: '14px', color: '#666', fontWeight: 'normal' }}>
                    Pending Review: {rules.filter(r => r.status === 'pending').length}
                  </span>
                </h2>

                {rules.map(rule => (
                  <div key={rule.id} className={`rule-card ${rule.status}`}>
                    <div className="rule-header">
                      <span className="rule-id">{rule.id}</span>
                      <span style={{ color: rule.confidence < 0.7 ? '#dc3545' : '#28a745', fontWeight: 'bold' }}>
                        Confidence: {(rule.confidence * 100).toFixed(0)}%
                      </span>
                    </div>

                    <div className="rule-source">
                      "{rule.source_sentence}"
                    </div>

                    <div className="rule-details">
                      <div className="detail-item">
                        <span className="detail-label">Action Override</span>
                        <select
                          className="detail-select"
                          value={rule.action_suggestion}
                          onChange={(e) => handleActionChange(rule.id, e.target.value)}
                        >
                          <option value="ALLOW">ALLOW</option>
                          <option value="BLOCK">BLOCK</option>
                          <option value="ALERT">ALERT</option>
                          <option value="ESCALATE">ESCALATE</option>
                        </select>
                      </div>

                      <div className="detail-item">
                        <span className="detail-label">Zone Override</span>
                        <select
                          className="detail-select"
                          value={rule.zone}
                          onChange={(e) => handleZoneChange(rule.id, e.target.value)}
                        >
                          <option value="Any">Any Zone</option>
                          <option value="Testing Area">Testing Area</option>
                          <option value="Indoor">Indoor</option>
                          <option value="Outdoor">Outdoor</option>
                          <option value="Charging Station">Charging Station</option>
                          <option value="Restricted">Restricted</option>
                        </select>
                      </div>

                      <div className="detail-item">
                        <span className="detail-label">Severity Override</span>
                        <select
                          className="detail-select"
                          value={rule.severity_suggestion}
                          onChange={(e) => handleSeverityChange(rule.id, e.target.value)}
                        >
                          <option value="CRITICAL">CRITICAL</option>
                          <option value="HIGH">HIGH</option>
                          <option value="MEDIUM">MEDIUM</option>
                          <option value="LOW">LOW</option>
                        </select>
                      </div>

                      <div className="confidence-slider">
                        <span className="detail-label">Confidence Score</span>
                        <input
                          type="range"
                          min="0" max="1" step="0.01"
                          value={rule.confidence}
                          onChange={(e) => handleConfidenceChange(rule.id, e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="rule-actions">
                      {rule.status === 'accepted' ? (
                        <button className="btn btn-accepted" onClick={() => handleStatusChange(rule.id, 'pending')}>✓ Accepted</button>
                      ) : (
                        <button className="btn btn-accept" onClick={() => handleStatusChange(rule.id, 'accepted')}>Accept Rule</button>
                      )}

                      {rule.status === 'rejected' ? (
                        <button className="btn btn-rejected" onClick={() => handleStatusChange(rule.id, 'pending')}>✕ Rejected</button>
                      ) : (
                        <button className="btn btn-reject" onClick={() => handleStatusChange(rule.id, 'rejected')}>Reject Rule</button>
                      )}
                    </div>
                  </div>
                ))}

                <div className="submit-section">
                  <button
                    className="btn"
                    style={{ padding: '15px 30px', fontSize: '18px' }}
                    onClick={handleSubmitToML}
                    disabled={rules.some(r => r.status === 'pending')}
                  >
                    {rules.some(r => r.status === 'pending')
                      ? 'Review all rules before submitting'
                      : 'Submit Accepted Rules to ML Pipeline'
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

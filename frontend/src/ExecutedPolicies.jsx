import React, { useState, useMemo } from "react";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";

const P = {
  bg: "#f4f6f8",
  surface: "#ffffff",
  border: "#dde1e7",
  accent: "#0066cc",
  text: "#1a1a2e",
  textDim: "#5a6478",
};

const TypeCell = ({ type }) => (
  <span style={{
    fontSize: 12, fontFamily: FONT, fontWeight: 700,
    color: type === "FORCE STOP" || type === "VIOLATION" ? "#002080" : P.textDim,
    textTransform: "uppercase", letterSpacing: "0.02em",
  }}>
    {type}
  </span>
);

const SevCell = ({ sev }) => {
  const color = { CRITICAL: "#002080", HIGH: "#0044bb", MEDIUM: P.accent, LOW: "#5599ee" }[sev] || P.textDim;
  return (
    <span style={{ color, fontWeight: 700, fontSize: 12, fontFamily: FONT, letterSpacing: "0.02em" }}>
      {sev}
    </span>
  );
};

const AUDIT = [
  {
    timestamp: "2024-05-06\n14:02:15",
    operator: "admin", role: "superbase user",
    type: "FORCE STOP",
    action: "Emergency stop issued. All robot motion halted immediately.",
    actionSub: "System reset to AUTONOMOUS mode after intervention.",
    severity: "CRITICAL", ruleId: "SYS-ESTOP",
  },
  {
    timestamp: "2024-05-06\n13:58:40",
    operator: "admin", role: "superbase user",
    type: "MODE SWITCH",
    action: "Control mode switched from AUTONOMOUS to MANUAL.",
    actionSub: "Session ID: OP-0047. Reason: scheduled maintenance check.",
    severity: "HIGH", ruleId: "SYS-MODE",
  },
  {
    timestamp: "2024-05-06\n13:54:38",
    operator: "Policy Engine", role: "Automated Agent",
    type: "RULE MATCH",
    action: "Rule R-003 triggered. ALERT raised for unrecognized human detection.",
    actionSub: "Zone: LAB-B. Time: 13:54:38. Proximity: 3.8 m.",
    severity: "HIGH", ruleId: "R-003",
  },
  {
    timestamp: "2024-05-06\n13:47:10",
    operator: "admin", role: "superbase user",
    type: "APPROVED",
    action: "Rule DR-001 approved. BLOCK access to Zone C after 22:00.",
    actionSub: "Confidence: 97%. Category: High Confidence.",
    severity: "CRITICAL", ruleId: "DR-001",
  },
  {
    timestamp: "2024-05-06\n13:45:22",
    operator: "admin", role: "superbase user",
    type: "EDITED",
    action: "Rule DR-005 edited. Severity escalated from HIGH to CRITICAL.",
    actionSub: "Zone override changed from Indoor to Stairwell.",
    severity: "CRITICAL", ruleId: "DR-005",
  },
  {
    timestamp: "2024-05-06\n13:40:05",
    operator: "admin", role: "superbase user",
    type: "REJECTED",
    action: "Rule DR-007 rejected due to insufficient confidence score.",
    actionSub: "Confidence: 58%. Reason: ambiguous source clause.",
    severity: "LOW", ruleId: "DR-007",
  },
  {
    timestamp: "2024-05-06\n13:33:18",
    operator: "Policy Engine", role: "Automated Agent",
    type: "VIOLATION",
    action: "Speed limit violation detected. Robot was travelling at 1.8 m/s indoors.",
    actionSub: "Rule R-002 enforcement triggered automatically.",
    severity: "HIGH", ruleId: "R-002",
  },
  {
    timestamp: "2024-05-06\n13:22:44",
    operator: "admin", role: "superbase user",
    type: "APPROVED",
    action: "Rule DR-003 approved. ALLOW standard patrol from 06:00 to 22:00.",
    actionSub: "Zone: Patrol Grid A. Category: Medium Confidence.",
    severity: "MEDIUM", ruleId: "DR-003",
  },
];

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const COL = "130px 160px 120px 1fr 90px 110px";

export default function ExecutedPolicies() {
  const [search, setSearch]       = useState("");
  const [filterSev, setFilterSev] = useState("ALL");
  const [sortSev, setSortSev]     = useState("NONE");

  // Derived filtered+sorted list — recalculated only when inputs change
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = AUDIT.filter(r => {
      const matchQ = !q ||
        r.operator.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        r.ruleId.toLowerCase().includes(q) ||
        r.severity.toLowerCase().includes(q);
      const matchS = filterSev === "ALL" || r.severity === filterSev;
      return matchQ && matchS;
    });
    if (sortSev === "ASC")  list = [...list].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    if (sortSev === "DESC") list = [...list].sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]);
    return list;
  }, [search, filterSev, sortSev]);

  const inputBase = {
    padding: "7px 10px",
    background: P.surface,
    border: `1px solid ${P.border}`,
    borderRadius: 0,
    fontSize: 12,
    color: P.text,
    fontFamily: FONT,
    outline: "none",
    height: 34,
    boxSizing: "border-box",
  };

  return (
    <div style={{ background: P.bg, width: "100%", fontFamily: FONT }}>

      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: P.text, margin: "0 0 4px", fontFamily: FONT }}>
            Policy Audit Log
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: P.textDim }}>
            Full record of operator actions, rule matches, and system interventions.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Search — controlled, isolated from border side-effects */}
          <div style={{ position: "relative" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.textDim} strokeWidth="2"
              style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search logs..."
              style={{ ...inputBase, paddingLeft: 28, width: 190 }}
            />
          </div>

          {/* Filter */}
          <select value={filterSev} onChange={e => setFilterSev(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          {/* Sort */}
          <select value={sortSev} onChange={e => setSortSev(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
            <option value="NONE">Sort: Default</option>
            <option value="ASC">Severity: Low to Critical</option>
            <option value="DESC">Severity: Critical to Low</option>
          </select>

          {/* Reset */}
          <button
            onClick={() => { setSearch(""); setFilterSev("ALL"); setSortSev("NONE"); }}
            style={{
              padding: "0 16px", height: 34,
              background: P.accent, color: "#fff",
              border: "none", borderRadius: 0,
              fontSize: 12, fontWeight: 700,
              fontFamily: FONT, letterSpacing: "0.04em",
              cursor: "pointer", textTransform: "uppercase",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: P.surface, border: `1px solid ${P.border}`, width: "100%", overflow: "hidden" }}>

        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: COL, background: "#f0f3f7", borderBottom: `2px solid ${P.border}` }}>
          {["TIMESTAMP", "OPERATOR", "TYPE", "ACTION", "SEVERITY", "RULE ID"].map((h, i) => (
            <div key={h} style={{
              padding: "10px 14px",
              fontSize: 10, fontFamily: FONT, fontWeight: 800,
              letterSpacing: "0.1em", textTransform: "uppercase", color: P.textDim,
              borderRight: i < 5 ? `1px solid ${P.border}` : "none",
            }}>
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: P.textDim, fontSize: 14 }}>
            No matching records found.
          </div>
        ) : rows.map((row, idx) => (
          <div key={idx} style={{
            display: "grid",
            gridTemplateColumns: COL,
            borderBottom: idx < rows.length - 1 ? `1px solid ${P.border}` : "none",
          }}>
            <div style={{ padding: "12px 14px", fontFamily: MONO, fontSize: 11, color: P.textDim, borderRight: `1px solid ${P.border}`, lineHeight: 1.7, whiteSpace: "pre-line", display: "flex", alignItems: "center" }}>
              {row.timestamp}
            </div>
            <div style={{ padding: "12px 14px", borderRight: `1px solid ${P.border}`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: P.text }}>{row.operator}</div>
              <div style={{ fontSize: 11, color: P.textDim, marginTop: 2 }}>{row.role}</div>
            </div>
            <div style={{ padding: "12px 14px", borderRight: `1px solid ${P.border}`, display: "flex", alignItems: "center" }}>
              <TypeCell type={row.type} />
            </div>
            <div style={{ padding: "12px 14px", borderRight: `1px solid ${P.border}`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 12, color: P.text, fontWeight: 500, lineHeight: 1.5 }}>{row.action}</div>
              <div style={{ fontSize: 11, color: P.textDim, marginTop: 3, lineHeight: 1.5 }}>{row.actionSub}</div>
            </div>
            <div style={{ padding: "12px 14px", borderRight: `1px solid ${P.border}`, display: "flex", alignItems: "center" }}>
              <SevCell sev={row.severity} />
            </div>
            <div style={{ padding: "12px 14px", fontFamily: MONO, fontSize: 12, fontWeight: 700, color: P.accent, display: "flex", alignItems: "center" }}>
              {row.ruleId}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: P.textDim }}>
        Showing {rows.length} of {AUDIT.length} records
      </div>
    </div>
  );
}

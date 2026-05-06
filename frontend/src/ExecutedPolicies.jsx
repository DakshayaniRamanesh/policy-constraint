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

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const COL = "130px 160px 120px 1fr 90px 110px";

export default function ExecutedPolicies() {
  const [auditData, setAuditData] = React.useState([]);
  const [search, setSearch]       = useState("");
  const [filterSev, setFilterSev] = useState("ALL");
  const [sortSev, setSortSev]     = useState("NONE");

  React.useEffect(() => {
    fetch("http://localhost:8000/audit")
      .then(res => res.json())
      .then(data => setAuditData(data))
      .catch(err => console.error("Error fetching audit logs:", err));
  }, []);

  // Derived filtered+sorted list — recalculated only when inputs change
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = auditData.filter(r => {
      const matchQ = !q ||
        r.operator.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        r.rule_id.toLowerCase().includes(q) ||
        r.severity.toLowerCase().includes(q);
      const matchS = filterSev === "ALL" || r.severity === filterSev;
      return matchQ && matchS;
    });
    if (sortSev === "ASC")  list = [...list].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    if (sortSev === "DESC") list = [...list].sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]);
    return list;
  }, [auditData, search, filterSev, sortSev]);

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
              {row.rule_id}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

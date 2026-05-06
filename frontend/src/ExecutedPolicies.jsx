import React, { useState } from "react";
import {
  CheckCircle, XCircle, Bell, ChevronDown, Cpu, Search, Clock
} from "lucide-react";

// ─── Palette & Theme ───────────────────────────────────────────────────────────
const theme = {
  bg: "#f4f6f8",
  surface: "#ffffff",
  border: "#e1e4e8",
  borderHover: "#cccccc",
  accent: "#0066cc",
  accentGlow: "#e6f2ff",
  green: "#28a745",
  greenGlow: "#d4edda",
  red: "#dc3545",
  redGlow: "#f8d7da",
  amber: "#ffc107",
  amberGlow: "#fff3cd",
  purple: "#6f42c1",
  purpleGlow: "#e2d9f3",
  text: "#333333",
  textDim: "#666666",
  textBright: "#111111",
};

// ─── Placeholder Data ──────────────────────────────────────────────────────────
const RULES = [
  {
    id: "R-001", confidence: 0.97, action: "BLOCK",
    severity: "CRITICAL",
    source: "The robot must never enter restricted laboratory zones during active experiments.",
    conditions: { time: "Any", zone: "LAB-A, LAB-B, LAB-C", trigger: "Zone proximity < 2m" },
    entities: ["robot_unit_go2", "lab_zones", "experiment_active_flag"],
    ambiguous: false,
  },
  {
    id: "R-002", confidence: 0.94, action: "BLOCK",
    severity: "CRITICAL",
    source: "Maximum operational speed shall not exceed 1.5 m/s in indoor environments.",
    conditions: { time: "Any", zone: "Indoor", trigger: "Speed sensor" },
    entities: ["velocity_controller", "indoor_env_classifier"],
    ambiguous: false,
  },
  {
    id: "R-003", confidence: 0.91, action: "ALERT",
    severity: "HIGH",
    source: "Alert security personnel if the robot detects an unrecognized human within 5 meters after 22:00.",
    conditions: { time: "22:00–06:00", zone: "All", trigger: "Unrecognized face detected" },
    entities: ["facial_recognition", "security_api", "proximity_sensor"],
    ambiguous: false,
  },
  {
    id: "R-004", confidence: 0.89, action: "BLOCK",
    severity: "HIGH",
    source: "Battery level below 15% must trigger immediate return-to-base protocol.",
    conditions: { time: "Any", zone: "Any", trigger: "Battery ≤ 15%" },
    entities: ["battery_monitor", "nav_controller", "base_station"],
    ambiguous: false,
  },
  {
    id: "R-005", confidence: 0.88, action: "ALLOW",
    severity: "MEDIUM",
    source: "Authorized maintenance staff may override speed limits using verified admin credentials.",
    conditions: { time: "08:00–18:00", zone: "Maintenance Bay", trigger: "Admin auth token" },
    entities: ["auth_service", "maintenance_staff", "velocity_controller"],
    ambiguous: false,
  },
  {
    id: "R-006", confidence: 0.85, action: "ALERT",
    severity: "MEDIUM",
    source: "Log all interactions with external visitors and alert supervisor after third consecutive visit.",
    conditions: { time: "Any", zone: "Reception", trigger: "Visitor badge scan × 3" },
    entities: ["visitor_log", "badge_scanner", "supervisor_notify"],
    ambiguous: false,
  },
  {
    id: "R-007", confidence: 0.82, action: "BLOCK",
    severity: "HIGH",
    source: "Prevent autonomous staircase traversal without explicit human operator confirmation.",
    conditions: { time: "Any", zone: "Stairwell", trigger: "Stair detection signal" },
    entities: ["terrain_classifier", "human_operator_ui", "motor_controller"],
    ambiguous: false,
  },
  {
    id: "R-008", confidence: 0.78, action: "ALLOW",
    severity: "LOW",
    source: "Standard patrol routes may be executed between 06:00 and 22:00 on weekdays.",
    conditions: { time: "06:00–22:00 Weekdays", zone: "Patrol Grid A", trigger: "Schedule trigger" },
    entities: ["patrol_scheduler", "nav_controller"],
    ambiguous: false,
  },
];

// ─── Severity config ───────────────────────────────────────────────────────────
const SEV = {
  CRITICAL: { color: theme.red, glow: theme.redGlow, label: "CRITICAL" },
  HIGH:     { color: theme.amber, glow: theme.amberGlow, label: "HIGH" },
  MEDIUM:   { color: theme.accent, glow: theme.accentGlow, label: "MEDIUM" },
  LOW:      { color: theme.green, glow: theme.greenGlow, label: "LOW" },
};

const ACTION_CFG = {
  BLOCK: { color: theme.red, icon: XCircle, glow: theme.redGlow },
  ALLOW: { color: theme.green, icon: CheckCircle, glow: theme.greenGlow },
  ALERT: { color: theme.amber, icon: Bell, glow: theme.amberGlow },
};

// ─── Micro components ──────────────────────────────────────────────────────────
const GlowBadge = ({ label, color, glow }) => (
  <span style={{
    background: glow, color, border: `1px solid ${color}`,
    borderRadius: 4, padding: "2px 8px", fontSize: 10,
    fontFamily: "monospace", fontWeight: 700,
    letterSpacing: "0.08em", whiteSpace: "nowrap",
  }}>{label}</span>
);

const ActionBadge = ({ action }) => {
  const cfg = ACTION_CFG[action];
  const Icon = cfg.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: cfg.glow, color: cfg.color, border: `1px solid ${cfg.color}`,
      borderRadius: 4, padding: "2px 8px", fontSize: 10,
      fontFamily: "monospace", fontWeight: 700,
    }}>
      <Icon size={10} /> {action}
    </span>
  );
};

const ConfidenceBar = ({ value }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{
      flex: 1, height: 4, background: theme.border,
      borderRadius: 2, overflow: "hidden", minWidth: 60,
    }}>
      <div style={{
        width: `${value * 100}%`, height: "100%",
        background: value > 0.9 ? theme.green : value > 0.75 ? theme.accent : theme.amber,
        borderRadius: 2, transition: "width 0.6s ease",
      }} />
    </div>
    <span style={{ color: theme.textDim, fontSize: 10, fontFamily: "monospace", minWidth: 34 }}>
      {(value * 100).toFixed(0)}%
    </span>
  </div>
);

// ─── Rule Card ─────────────────────────────────────────────────────────────────
const RuleCard = ({ rule }) => {
  const [expanded, setExpanded] = useState(false);
  const sev = SEV[rule.severity];
  return (
    <div style={{
      position: "relative", background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderLeft: `3px solid ${sev.color}`,
      borderRadius: 8, overflow: "hidden",
      transition: "border-color 0.2s",
      boxShadow: expanded ? `0 2px 8px rgba(0,0,0,0.1)` : "0 1px 3px rgba(0,0,0,0.05)",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = theme.borderHover}
      onMouseLeave={e => e.currentTarget.style.borderColor = theme.border}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <span style={{ color: theme.textBright, fontWeight: "bold", fontSize: 12, fontFamily: "monospace", minWidth: 48 }}>{rule.id}</span>
        <ActionBadge action={rule.action} />
        <GlowBadge label={sev.label} color={sev.color} glow={sev.glow} />
        <p style={{ flex: 1, color: theme.text, fontSize: 13, margin: 0, lineHeight: 1.5, minWidth: 160, fontWeight: 500 }}>
          {rule.source}
        </p>
        <ConfidenceBar value={rule.confidence} />
        <div style={{ color: theme.textDim, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
          <ChevronDown size={14} />
        </div>
      </div>

      {expanded && (
        <div style={{
          borderTop: `1px solid ${theme.border}`, padding: "14px 16px",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16,
          background: "#fafafa"
        }}>
          <div>
            <div style={{ color: theme.textDim, fontSize: 10, fontFamily: "monospace", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              <Clock size={10} style={{ display: "inline", marginRight: 4 }} />Conditions
            </div>
            {Object.entries(rule.conditions).map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                <span style={{ color: theme.textDim, fontSize: 12, minWidth: 60, textTransform: "capitalize" }}>{k}:</span>
                <span style={{ color: theme.accent, fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ color: theme.textDim, fontSize: 10, fontFamily: "monospace", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              <Cpu size={10} style={{ display: "inline", marginRight: 4 }} />Entities
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {rule.entities.map(e => (
                <span key={e} style={{
                  background: theme.accentGlow, border: `1px solid ${theme.accent}40`,
                  borderRadius: 4, padding: "2px 7px", fontSize: 11,
                  color: theme.accent, fontFamily: "monospace",
                }}>{e}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function ExecutedPolicies() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState("ALL");
  const [filterSev, setFilterSev] = useState("ALL");

  const filtered = RULES.filter(r => {
    const q = searchQuery.toLowerCase();
    const matchQ = !q || r.id.toLowerCase().includes(q) || r.source.toLowerCase().includes(q) || r.entities.some(e => e.toLowerCase().includes(q));
    const matchA = filterAction === "ALL" || r.action === filterAction;
    const matchS = filterSev === "ALL" || r.severity === filterSev;
    return matchQ && matchA && matchS;
  });

  return (
    <div style={{ background: theme.bg, color: theme.text }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", paddingBottom: "40px" }}>
        
        <h2 style={{ marginBottom: 20, color: theme.textBright }}>Executed Policies</h2>

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 250 }}>
            <Search size={14} color={theme.textDim} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search rules, entities..."
              style={{
                width: "100%", padding: "10px 14px 10px 36px",
                background: theme.surface, border: `1px solid ${theme.border}`,
                borderRadius: 6, color: theme.textBright, fontSize: 14,
                outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
              }}
              onFocus={e => e.target.style.borderColor = theme.accent}
              onBlur={e => e.target.style.borderColor = theme.border}
            />
          </div>
          {[
            { label: "Action", value: filterAction, set: setFilterAction, opts: ["ALL", "BLOCK", "ALLOW", "ALERT"] },
            { label: "Severity", value: filterSev, set: setFilterSev, opts: ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          ].map(f => (
            <select key={f.label} value={f.value} onChange={e => f.set(e.target.value)} style={{
              background: theme.surface, border: `1px solid ${theme.border}`,
              borderRadius: 6, color: theme.textBright, fontSize: 13, padding: "10px 14px",
              cursor: "pointer", outline: "none", fontWeight: 500,
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
            }}>
              {f.opts.map(o => <option key={o} value={o}>{f.label}: {o}</option>)}
            </select>
          ))}
          <div style={{ color: theme.textDim, fontSize: 12, fontWeight: "bold", marginLeft: 8 }}>
            {filtered.length} / {RULES.length} rules
          </div>
        </div>

        {/* Column headers */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "60px 80px 100px 1fr 140px",
          gap: 12, padding: "8px 16px", marginBottom: 8,
          color: theme.textDim, fontSize: 11,
          fontFamily: "monospace", fontWeight: "bold",
          letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          <span>ID</span><span>ACTION</span><span>SEVERITY</span><span>SOURCE</span><span>CONFIDENCE</span>
        </div>

        {/* Rule cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: theme.textDim, fontSize: 15, background: theme.surface, borderRadius: 8, border: `1px solid ${theme.border}` }}>
              No rules match your filter.
            </div>
          ) : filtered.map(rule => <RuleCard key={rule.id} rule={rule} />)}
        </div>
      </div>
    </div>
  );
}

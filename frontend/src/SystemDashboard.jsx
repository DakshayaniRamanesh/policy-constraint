import React, { useState, useEffect } from "react";
import {
  Shield, Cpu, Battery, MapPin, Box
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
  amber: "#ffc107",
  amberGlow: "#fff3cd",
  text: "#333333",
  textDim: "#666666",
  textBright: "#111111",
};

const AUDIT_LOGS = [
  { time: "13:54:41", level: "INFO", message: "Zone transition from LAB-A to LAB-B completed." },
  { time: "13:54:38", level: "WARN", message: "Proximity alert: Unrecognized human within 4m." },
  { time: "13:54:38", level: "EXEC", message: "Policy R-003 triggered (After-Hours Intruder Alert)." },
  { time: "13:54:35", level: "INFO", message: "Velocity controller nominal at 1.2 m/s." },
  { time: "13:54:20", level: "INFO", message: "Battery level updated to 78%." },
  { time: "13:53:10", level: "INFO", message: "Patrol grid A scan initiated." },
  { time: "13:50:00", level: "INFO", message: "System diagnostics passed." },
];

// ─── Stat Card ─────────────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, color, glow }) => (
  <div style={{
    position: "relative", background: theme.surface,
    border: `1px solid ${theme.border}`, borderRadius: 8, padding: "14px 18px",
    display: "flex", alignItems: "center", gap: 14,
    overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
  }}>
    <div style={{
      width: 40, height: 40, borderRadius: 8,
      background: glow, border: `1px solid ${color}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <Icon size={18} color={color} />
    </div>
    <div>
      <div style={{ color: theme.textDim, fontSize: 10, fontFamily: "monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 26, fontWeight: 800, lineHeight: 1.2, fontFamily: "monospace" }}>{value}</div>
    </div>
  </div>
);

// ─── Main Dashboard Component ──────────────────────────────────────────────────
export default function SystemDashboard() {
  const [pulse, setPulse] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setPulse(p => !p), 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ background: theme.bg, color: theme.text }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", paddingBottom: "40px" }}>
        
        {/* Top Header Section */}
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", background: theme.surface, padding: "16px 20px", borderRadius: 8, border: `1px solid ${theme.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
             <div style={{
              width: 36, height: 36, borderRadius: 6,
              background: theme.accentGlow, border: `1px solid ${theme.accent}`,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <Shield size={20} color={theme.accent} />
            </div>
            <div>
              <div style={{ color: theme.textBright, fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>UNITREE GO2 EDU · COMMAND CENTER</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: pulse ? theme.green : "#888", transition: "all 0.4s" }} />
                <span style={{ color: theme.textDim, fontSize: 11, fontFamily: "monospace", letterSpacing: "0.05em" }}>PIPELINE ACTIVE</span>
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: theme.textDim, fontSize: 11, fontFamily: "monospace", letterSpacing: "0.05em" }}>UNIT · GO2-EDU-0047</div>
            <div style={{ color: theme.textBright, fontSize: 14, fontWeight: "bold", fontFamily: "monospace", marginTop: 4 }}>{time.toLocaleTimeString()}</div>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
          <StatCard icon={Battery} label="Battery Level" value="78%" color={theme.green} glow={theme.greenGlow} />
          <StatCard icon={MapPin} label="Current Zone" value="LAB-B" color={theme.accent} glow={theme.accentGlow} />
          <StatCard icon={Cpu} label="GPU Usage" value="42%" color={theme.amber} glow={theme.amberGlow} />
          <StatCard icon={Box} label="TBD" value="--" color={theme.textDim} glow="#f0f0f0" />
        </div>

        {/* ─── AUDIT LOG ─── */}
        <div style={{ background: "#1e1e1e", borderRadius: 8, padding: 16, fontFamily: "monospace", color: "#d4d4d4", height: 500, overflowY: "auto", border: `1px solid ${theme.border}`, boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", borderBottom: "1px solid #333", paddingBottom: 8 }}>
            <span style={{ color: "#888", fontSize: 12 }}>System Event Feed</span>
            <span style={{ color: theme.green, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: theme.green }} />
              LIVE
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {AUDIT_LOGS.map((log, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                <span style={{ color: "#888", marginRight: 12 }}>[{log.time}]</span>
                <span style={{ 
                  color: log.level === "INFO" ? "#4fc1ff" : log.level === "WARN" ? "#ffcc66" : log.level === "EXEC" ? "#c586c0" : "#d4d4d4",
                  fontWeight: "bold", marginRight: 12, minWidth: 40, display: "inline-block"
                }}>{log.level}</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

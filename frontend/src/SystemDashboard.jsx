import React, { useState, useEffect, useRef } from "react";

// ─── Palette ───────────────────────────────────────────────────────────────────
const P = {
  bg: "#f4f6f8",
  surface: "#ffffff",
  border: "#dde1e7",
  accent: "#0066cc",
  green: "#1a8a3a",
  amber: "#b07800",
  text: "#1a1a2e",
  textDim: "#5a6478",
  // Match body font from index.css / Policy Review section
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
};

const batteryColor = (pct) => pct > 50 ? P.green : pct >= 20 ? P.amber : P.accent;
const gpuColor = (pct) => pct >= 85 ? "#003d99" : pct >= 60 ? P.accent : "#3399ff";

// ─── SVG Icons ─────────────────────────────────────────────────────────────────
const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={P.textDim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const UnitreeLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 18L6 14H18L20 18" stroke={P.accent} strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 14V10C8 8.89543 8.89543 8 10 8H14C15.1046 8 16 8.89543 16 10V14" stroke={P.accent} strokeWidth="2"/>
    <circle cx="10" cy="11" r="1" fill={P.accent}/>
    <circle cx="14" cy="11" r="1" fill={P.accent}/>
    <path d="M12 5V8" stroke={P.accent} strokeWidth="2" strokeLinecap="round"/>
    <path d="M10 5H14" stroke={P.accent} strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const BatteryIcon = ({ color }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="18" height="10" rx="1" />
    <path d="M22 11v2" />
    <line x1="5" y1="12" x2="13" y2="12" stroke={color} strokeWidth="2" />
  </svg>
);

const PinIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const RobotIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="1" />
    <path d="M12 11V7" />
    <circle cx="12" cy="5" r="2" />
    <path d="M8 15h0M16 15h0" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M3 16H1M23 16h-2" />
  </svg>
);

const ChipIcon = ({ color }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="7" width="10" height="10" rx="1" />
    <path d="M9 7V4M12 7V4M15 7V4M9 17v3M12 17v3M15 17v3M7 9H4M7 12H4M7 15H4M17 9h3M17 12h3M17 15h3" />
  </svg>
);

// ─── Stat Card — sharp edges, colored top border ───────────────────────────────
const StatCard = ({ label, value, icon, topColor, valueColor }) => (
  <div style={{
    background: P.surface,
    border: `1px solid ${P.border}`,
    borderTop: `3px solid ${topColor}`,
    flex: 1,
    minWidth: 0,
    padding: "20px 22px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    position: "relative",
  }}>
    {/* Icon — top right */}
    <div style={{ position: "absolute", top: 16, right: 18, opacity: 0.55 }}>
      {icon}
    </div>
    {/* Label — system font, small caps */}
    <div style={{
      fontSize: 11,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: P.textDim,
      fontWeight: 600,
      fontFamily: P.font,
    }}>
      {label}
    </div>
    {/* Value */}
    <div style={{
      fontSize: 34,
      fontWeight: 800,
      lineHeight: 1.1,
      color: valueColor || P.text,
      fontFamily: P.font,
      marginTop: 4,
    }}>
      {value}
    </div>
  </div>
);

// ─── Log data ──────────────────────────────────────────────────────────────────
const INIT_LOGS = [
  { time: "13:54:41", level: "INFO", msg: "Zone transition: LAB-A → LAB-B completed." },
  { time: "13:54:38", level: "WARN", msg: "Proximity alert — unrecognized human within 4 m." },
  { time: "13:54:38", level: "EXEC", msg: "Policy R-003 triggered (After-Hours Intruder)." },
  { time: "13:54:35", level: "INFO", msg: "Velocity controller nominal at 1.2 m/s." },
  { time: "13:54:20", level: "INFO", msg: "Battery level updated to 78%." },
  { time: "13:53:10", level: "INFO", msg: "Patrol grid A scan initiated." },
  { time: "13:50:00", level: "INFO", msg: "System diagnostics passed." },
  { time: "13:48:17", level: "EXEC", msg: "Rule R-008 matched — ALLOW patrol route." },
  { time: "13:45:05", level: "WARN", msg: "Visitor badge scan #3 detected at Reception." },
  { time: "13:42:30", level: "INFO", msg: "LiDAR scan nominal — 360° coverage active." },
  { time: "13:40:11", level: "INFO", msg: "Speed limiter active — indoor mode engaged." },
  { time: "13:38:00", level: "EXEC", msg: "Rule R-004 evaluated — battery above threshold." },
];

const NEW_LOGS = [
  { level: "INFO", msg: "Heartbeat OK — uptime 4h 12m." },
  { level: "INFO", msg: "Patrol waypoint WP-07 reached." },
  { level: "WARN", msg: "Low light conditions detected in Zone C." },
  { level: "EXEC", msg: "Policy R-002 enforced — speed capped at 1.5 m/s." },
  { level: "INFO", msg: "Camera feed nominal — 30 fps." },
  { level: "WARN", msg: "Obstacle detected — rerouting around object." },
  { level: "EXEC", msg: "Rule R-003 re-evaluated at boundary crossing." },
  { level: "INFO", msg: "IMU calibration check passed." },
];

const LEVEL_COLOR = {
  INFO: "#4fc1ff",
  WARN: "#ffcc66",
  EXEC: "#c586c0",
  ERR:  "#f44747",
};

// ─── Main Component ────────────────────────────────────────────────────────────
export default function SystemDashboard() {
  const battery = 78;
  const gpu = 42;
  const zone = "LAB-B";
  const status = "Patrolling";

  const [logs, setLogs] = useState(INIT_LOGS);
  const logRef = useRef(null);

  // Simulate new log entries every 4 s
  useEffect(() => {
    let idx = 0;
    const id = setInterval(() => {
      const entry = NEW_LOGS[idx % NEW_LOGS.length];
      const now = new Date();
      const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      setLogs(prev => [{ time: t, level: entry.level, msg: entry.msg }, ...prev].slice(0, 80));
      idx++;
    }, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [logs]);

  return (
    <div style={{ background: P.bg, width: "100%", boxSizing: "border-box" }}>

      {/* ── Section heading ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <HomeIcon />
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color: P.textDim,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontFamily: P.font,
          }}>
            Dashboard
          </span>
          <span style={{ color: "#8a95a5", fontSize: 13, marginLeft: 2 }}>/ System Overview</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", padding: "6px 12px", border: `1px solid ${P.border}` }}>
          <UnitreeLogo />
          <span style={{ fontSize: 11, fontWeight: 800, color: P.text, letterSpacing: "1px", fontFamily: P.mono }}>GO2-EDU-0047</span>
        </div>
      </div>

      {/* ── 4 Stat Cards — gapped row ── */}
      <div style={{
        display: "flex",
        gap: 16,
        marginBottom: 24,
      }}>
        <StatCard
          label="Battery Level"
          value={`${battery}%`}
          icon={<BatteryIcon color={batteryColor(battery)} />}
          topColor={batteryColor(battery)}
          valueColor={batteryColor(battery)}
        />
        <StatCard
          label="Current Zone"
          value={zone}
          icon={<PinIcon />}
          topColor={P.accent}
          valueColor={P.accent}
        />
        <StatCard
          label="Robot Status"
          value={status}
          icon={<RobotIcon />}
          topColor={P.accent}
          valueColor={P.text}
        />
        <StatCard
          label="GPU Usage"
          value={`${gpu}%`}
          icon={<ChipIcon color={gpuColor(gpu)} />}
          topColor={gpuColor(gpu)}
          valueColor={gpuColor(gpu)}
        />
      </div>

      {/* ── Full-width System Event Feed ── */}
      <div style={{
        background: "#141414",
        border: "1px solid #2a2a2a",
        borderTop: `3px solid ${P.accent}`,
        display: "flex",
        flexDirection: "column",
        height: 440,
        overflow: "hidden",
      }}>
        {/* Terminal header */}
        <div style={{
          padding: "10px 18px",
          borderBottom: "1px solid #2a2a2a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#1a1a1a",
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: P.font,
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#888",
            fontWeight: 700,
          }}>
            System Event Feed
          </span>
          <span style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: P.mono,
            fontSize: 11,
            color: P.green,
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: P.green,
              display: "inline-block",
            }} />
            LIVE
          </span>
        </div>

        {/* Log lines */}
        <div
          ref={logRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 7,
            fontFamily: P.mono,
          }}
        >
          {logs.map((log, i) => (
            <div key={i} style={{ fontSize: 12, display: "flex", gap: 12, lineHeight: 1.5 }}>
              <span style={{ color: "#555", flexShrink: 0, userSelect: "none" }}>[{log.time}]</span>
              <span style={{
                color: LEVEL_COLOR[log.level] || "#d4d4d4",
                fontWeight: 700,
                flexShrink: 0,
                minWidth: 38,
              }}>
                {log.level}
              </span>
              <span style={{ color: "#cccccc" }}>{log.msg}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

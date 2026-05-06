import React, { useState, useEffect, useMemo } from "react";

const P = {
  bg: "#f4f6f8",
  surface: "#ffffff",
  border: "#dde1e7",
  accent: "#0066cc",
  text: "#1a1a2e",
  textDim: "#5a6478",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
};

const AlertItem = ({ alert, isCritical }) => (
  <div style={{
    display: "flex",
    gap: 20,
    padding: "14px 0",
    borderBottom: `1px solid ${P.border}`,
    alignItems: "flex-start",
  }}>
    {/* Time */}
    <div style={{
      width: 140,
      flexShrink: 0,
      fontFamily: P.mono,
      fontSize: 11,
      fontWeight: 700,
      color: isCritical ? "#002080" : P.textDim,
      letterSpacing: "0.02em",
    }}>
      {alert.timestamp}
    </div>

    {/* Message Content */}
    <div style={{ flex: 1 }}>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: P.text,
        marginBottom: 4,
        fontFamily: P.font,
      }}>
        {alert.action}
      </div>
      <div style={{
        fontSize: 11,
        color: P.textDim,
        fontFamily: P.font,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
      }}>
        Type: {alert.type} • ID: {alert.rule_id}
      </div>
    </div>
  </div>
);

export default function SystemAlerts() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    fetch("http://localhost:8000/audit")
      .then(res => res.json())
      .then(data => setAlerts(data))
      .catch(err => console.error("Error fetching alerts:", err));
  }, []);

  const { critical, general } = useMemo(() => {
    return {
      critical: alerts.filter(a => a.severity === 'CRITICAL' || a.type === 'VIOLATION' || a.type === 'FORCE STOP'),
      general: alerts.filter(a => a.severity !== 'CRITICAL' && a.type !== 'VIOLATION' && a.type !== 'FORCE STOP'),
    };
  }, [alerts]);

  return (
    <div style={{ background: P.bg, width: "100%", boxSizing: "border-box", fontFamily: P.font }}>
      
      {/* Critical Section */}
      <div style={{ marginBottom: 40 }}>
        <h3 style={{ 
          fontSize: 12, 
          fontWeight: 800, 
          color: "#002080", 
          letterSpacing: "0.1em", 
          textTransform: "uppercase",
          borderBottom: "2px solid #002080",
          paddingBottom: 8,
          marginBottom: 10,
        }}>
          Critical System Alerts
        </h3>
        {critical.length === 0 ? (
          <div style={{ padding: "20px 0", color: P.textDim, fontSize: 13 }}>No critical alerts detected.</div>
        ) : critical.map((a, i) => <AlertItem key={i} alert={a} isCritical={true} />)}
      </div>

      {/* Normal Section */}
      <div>
        <h3 style={{ 
          fontSize: 12, 
          fontWeight: 800, 
          color: P.textDim, 
          letterSpacing: "0.1em", 
          textTransform: "uppercase",
          borderBottom: "2px solid #dde1e7",
          paddingBottom: 8,
          marginBottom: 10,
        }}>
          General System Notifications
        </h3>
        {general.length === 0 ? (
          <div style={{ padding: "20px 0", color: P.textDim, fontSize: 13 }}>No system notifications.</div>
        ) : general.map((a, i) => <AlertItem key={i} alert={a} isCritical={false} />)}
      </div>

    </div>
  );
}

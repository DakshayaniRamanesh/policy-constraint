import React, { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// CameraPanel.jsx  (Phase 2)
//
// Displays the Unitree Go2's forward-facing Intel RealSense D435i camera feed.
//
// Data sources (priority order):
//   1. Real MJPEG stream from slam_server.py  → http://localhost:8001/camera/mjpeg
//      - Actual hardware when RealSense is connected
//      - Synthetic corridor render from robot_bridge.py when not
//   2. Canvas simulation fallback (no server needed)
//
// YOLO bounding boxes received via the parent's WebSocket JSON stream are
// drawn on a <canvas> overlay positioned exactly on top of the <img> element.
// ─────────────────────────────────────────────────────────────────────────────

const MJPEG_URL  = 'http://localhost:8001/camera/mjpeg';
const PANEL_W    = 272;
const PANEL_H    = 180;

// State badge colors
const STATE_COLORS = {
  PATROLLING: '#00ffcc', DETECTED: '#ff8800',
  THINKING:   '#ffcc00', BLOCKED:  '#ff3333',
};

// ── Canvas-only simulation (used when server is unreachable) ──────────────────
function drawSimCorridor(ctx, t, approaching, W, H) {
  ctx.fillStyle = '#050810'; ctx.fillRect(0, 0, W, H);
  const ceil = ctx.createLinearGradient(0, 0, 0, H * 0.45);
  ceil.addColorStop(0, '#050810'); ceil.addColorStop(1, '#0a1520');
  ctx.fillStyle = ceil; ctx.fillRect(0, 0, W, H * 0.45);
  ctx.fillStyle = '#0d1f1a'; ctx.fillRect(0, H * 0.42, W, H * 0.16);
  const fl = ctx.createLinearGradient(0, H * 0.55, 0, H);
  fl.addColorStop(0, '#0a1a10'); fl.addColorStop(1, '#030808');
  ctx.fillStyle = fl; ctx.fillRect(0, H * 0.55, W, H);

  const vx = W / 2, vy = H / 2;
  ctx.strokeStyle = '#1a3a30'; ctx.lineWidth = 1;
  [[0,0],[0,H*0.3],[0,H*0.6],[0,H],[W,0],[W,H*0.3],[W,H*0.6],[W,H]].forEach(([px,py]) => {
    ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(vx,vy); ctx.stroke();
  });

  if (approaching) {
    const s = 0.22 + 0.12 * Math.sin(t * 0.8);
    const dw = 38*s, dh = 62*s;
    ctx.strokeStyle = '#ff3333'; ctx.lineWidth = 1.5;
    ctx.strokeRect(vx - dw/2, vy - dh*0.65, dw, dh);
  }
}

function drawSimHUD(ctx, t, robotState, W, H) {
  ctx.font = 'bold 8px monospace';
  ctx.fillStyle = 'rgba(0,255,180,0.7)';
  ctx.textAlign = 'left';
  ctx.fillText('CAM: SIM MODE — START slam_server.py', 5, 12);
  ctx.fillStyle = STATE_COLORS[robotState] ?? '#00ffcc';
  ctx.fillText(`◉ ${robotState}`, 5, H - 6);
  ctx.fillStyle = 'rgba(80,120,100,0.6)';
  ctx.font = '7px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleTimeString('en-GB'), W - 4, H - 6);
  ctx.textAlign = 'left';
  // Scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  const sy = ((t * 60) % H);
  const sg = ctx.createLinearGradient(0, sy-2, 0, sy+2);
  sg.addColorStop(0,'rgba(0,255,180,0)'); sg.addColorStop(0.5,'rgba(0,255,180,0.07)'); sg.addColorStop(1,'rgba(0,255,180,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, sy-2, W, 4);
}

// ── YOLO box overlay (drawn on canvas over the MJPEG img) ────────────────────
function drawYOLOOverlay(ctx, detections, robotState, t, W, H) {
  ctx.clearRect(0, 0, W, H);

  // Draw policy-engine detections (from WebSocket JSON)
  detections.forEach((det, i) => {
    const pulse = 0.6 + 0.4 * Math.sin(t * 6 + i);
    const col   = det.verdict === 'BLOCKED'
                ? `rgba(255,40,40,${pulse})`
                : `rgba(0,255,120,${pulse})`;

    // Bounding box — centred on canvas (approximated without real pixel coords)
    const bx = 68, by = 38, bw = 136, bh = 104;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, bh);

    // Corner accents
    const cs = 10; ctx.lineWidth = 2.5;
    [[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]].forEach(([cx,cy], j) => {
      ctx.beginPath();
      ctx.moveTo(cx + (j%2===0 ? cs : -cs), cy);
      ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + (j<2 ? cs : -cs));
      ctx.stroke();
    });

    // Label
    const label = `${det.type ?? 'DOOR'} • ${det.zone}`;
    ctx.font = 'bold 8px monospace';
    const tw  = ctx.measureText(label).width + 8;
    ctx.fillStyle = det.verdict === 'BLOCKED' ? 'rgba(200,0,0,0.8)' : 'rgba(0,140,60,0.8)';
    ctx.fillRect(bx, by - 15, tw, 13);
    ctx.fillStyle = '#fff'; ctx.fillText(label, bx + 4, by - 5);
  });

  // Live YOLO detections from real camera (label + conf from bridge)
  // These arrive via the /camera/detections endpoint polled by the component

  // HUD overlay: state + timestamp (always shown)
  ctx.font = 'bold 8px monospace';
  ctx.fillStyle = 'rgba(0,255,180,0.65)';
  ctx.fillText('◉ REALSENSE D435i', 5, 12);

  const stateCol = STATE_COLORS[robotState] ?? '#00ffcc';
  ctx.fillStyle = stateCol;
  ctx.fillText(`${robotState}`, 5, H - 6);

  ctx.font = '7px monospace';
  ctx.fillStyle = 'rgba(80,120,100,0.6)';
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleTimeString('en-GB'), W - 4, H - 6);
  ctx.textAlign = 'left';

  if (robotState === 'THINKING') {
    const p = 0.6 + 0.4 * Math.sin(t * 7);
    ctx.fillStyle = `rgba(255,200,0,${p})`;
    ctx.font = 'bold 7px monospace';
    ctx.fillText('QUERYING POLICY GATE...', 5, 24);
  }
  if (robotState === 'BLOCKED') {
    const p = 0.6 + 0.4 * Math.sin(t * 12);
    ctx.fillStyle = `rgba(255,60,60,${p})`;
    ctx.font = 'bold 7px monospace';
    ctx.fillText('ACCESS DENIED — REVERSING', 5, 24);
  }

  // Scanline effect over the video
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
}


// ─────────────────────────────────────────────────────────────────────────────
export default function CameraPanel({ robotState = 'PATROLLING', detections = [] }) {
  const canvasRef    = useRef(null);   // simulation canvas (shown when server offline)
  const overlayRef   = useRef(null);   // YOLO overlay canvas (shown over MJPEG img)
  const rafRef       = useRef(null);
  const tRef         = useRef(0);

  // Whether the MJPEG stream is reachable
  const [streamLive, setStreamLive] = useState(false);

  // ── Probe MJPEG availability ────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.onload  = () => setStreamLive(true);
    img.onerror = () => setStreamLive(false);
    // Use a short-lived fetch to check if the endpoint is up
    fetch(MJPEG_URL, { method: 'GET', signal: AbortSignal.timeout(1500) })
      .then(() => setStreamLive(true))
      .catch(() => setStreamLive(false));
  }, []);

  // ── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      tRef.current  += 0.016;
      const t = tRef.current;

      if (!streamLive) {
        // ── Canvas simulation ────────────────────────────────────────────────
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const approaching = robotState !== 'PATROLLING' && detections.length > 0;
        drawSimCorridor(ctx, t, approaching, PANEL_W, PANEL_H);
        drawSimHUD(ctx, t, robotState, PANEL_W, PANEL_H);
      } else {
        // ── YOLO overlay on top of real MJPEG feed ───────────────────────────
        const ov = overlayRef.current;
        if (!ov) return;
        const ctx = ov.getContext('2d');
        drawYOLOOverlay(ctx, detections, robotState, t, PANEL_W, PANEL_H);
      }
    };

    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [streamLive, robotState, detections]);

  const borderColor = STATE_COLORS[robotState] ?? '#00ffcc';

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Panel label */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#556677', letterSpacing: 1.5 }}>
          ■ FPV CAMERA
        </span>
        <span style={{
          fontFamily: 'monospace', fontSize: 8,
          color: streamLive ? '#00ff88' : '#ff4444',
        }}>
          {streamLive ? '⬤ LIVE' : '⬤ SIM'}
        </span>
      </div>

      {/* Viewport container */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: `${PANEL_W}/${PANEL_H}`,
                    borderRadius: 5, overflow: 'hidden',
                    border: `1px solid ${borderColor}44`,
                    boxShadow: robotState === 'BLOCKED'  ? `0 0 12px ${borderColor}33` : 'none',
                    transition: 'border-color 0.3s, box-shadow 0.3s' }}>

        {/* ── Simulation canvas (hidden when stream is live) */}
        <canvas
          ref={canvasRef}
          width={PANEL_W} height={PANEL_H}
          style={{ display: streamLive ? 'none' : 'block', width: '100%', height: '100%' }}
        />

        {/* ── Real MJPEG image (hidden when stream is offline) */}
        {streamLive && (
          <img
            src={MJPEG_URL}
            alt="RealSense D435i"
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}

        {/* ── YOLO + HUD overlay canvas (always on top of the MJPEG img) */}
        {streamLive && (
          <canvas
            ref={overlayRef}
            width={PANEL_W} height={PANEL_H}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                     pointerEvents: 'none' }}
          />
        )}
      </div>
    </div>
  );
}

import React, { useState, useRef } from 'react';
import './index.css';

// Perfectly aligned grid coordinates (Maximizing width)
const GRID = {
  TOP: 5,
  BOTTOM: 495,
  LEFT: 5,
  RIGHT: 495,
  H_SPLIT_1: 175,
  H_SPLIT_2: 325,
  V_SPLIT_1: 165,
  V_SPLIT_2: 335
};

const INITIAL_ZONES = [
  { id: 'SERVER_INFRA', name: 'Server Room', points: [{x: GRID.LEFT, y: GRID.TOP}, {x: GRID.V_SPLIT_1, y: GRID.TOP}, {x: GRID.V_SPLIT_1, y: GRID.H_SPLIT_1}, {x: GRID.LEFT, y: GRID.H_SPLIT_1}], color: 'rgba(220, 53, 69, 0.12)', stroke: '#dc3545' },
  { id: 'EXEC_OFFICE', name: 'Exec Office', points: [{x: GRID.V_SPLIT_1, y: GRID.TOP}, {x: GRID.V_SPLIT_2, y: GRID.TOP}, {x: GRID.V_SPLIT_2, y: GRID.H_SPLIT_1}, {x: GRID.V_SPLIT_1, y: GRID.H_SPLIT_1}], color: 'rgba(56, 189, 248, 0.1)', stroke: '#38bdf8' },
  { id: 'BREAK_ROOM', name: 'Break Room', points: [{x: GRID.V_SPLIT_2, y: GRID.TOP}, {x: GRID.RIGHT, y: GRID.TOP}, {x: GRID.RIGHT, y: GRID.H_SPLIT_1}, {x: GRID.V_SPLIT_2, y: GRID.H_SPLIT_1}], color: 'rgba(255, 193, 7, 0.1)', stroke: '#ffc107' },
  { id: 'HALLWAY', name: 'Main Corridor', points: [{x: GRID.LEFT, y: GRID.H_SPLIT_1}, {x: GRID.RIGHT, y: GRID.H_SPLIT_1}, {x: GRID.RIGHT, y: GRID.H_SPLIT_2}, {x: GRID.LEFT, y: GRID.H_SPLIT_2}], color: 'rgba(255, 255, 255, 0.03)', stroke: '#4b5563' },
  { id: 'STORAGE', name: 'Storage', points: [{x: GRID.LEFT, y: GRID.H_SPLIT_2}, {x: GRID.V_SPLIT_1, y: GRID.H_SPLIT_2}, {x: GRID.V_SPLIT_1, y: GRID.BOTTOM}, {x: GRID.LEFT, y: GRID.BOTTOM}], color: 'rgba(107, 114, 128, 0.15)', stroke: '#6b7280' },
  { id: 'CONF_ROOM', name: 'Conf Room', points: [{x: GRID.V_SPLIT_1, y: GRID.H_SPLIT_2}, {x: GRID.V_SPLIT_2, y: GRID.H_SPLIT_2}, {x: GRID.V_SPLIT_2, y: GRID.BOTTOM}, {x: GRID.V_SPLIT_1, y: GRID.BOTTOM}], color: 'rgba(139, 92, 246, 0.12)', stroke: '#8b5cf6' },
  { id: 'OPEN_WORKSPACE', name: 'Open Workspace', points: [{x: GRID.V_SPLIT_2, y: GRID.H_SPLIT_2}, {x: GRID.RIGHT, y: GRID.H_SPLIT_2}, {x: GRID.RIGHT, y: GRID.BOTTOM}, {x: GRID.V_SPLIT_2, y: GRID.BOTTOM}], color: 'rgba(16, 185, 129, 0.1)', stroke: '#10b981' }
];

export default function ZoneMapping() {
  const [zones, setZones] = useState(INITIAL_ZONES);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const svgRef = useRef(null);

  const getSvgCoordinates = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.round(svgP.x), y: Math.round(svgP.y) };
  };

  const handleSvgClick = (e) => {
    if (isDrawing) {
      const pt = getSvgCoordinates(e);
      setDrawPoints([...drawPoints, pt]);
    }
  };

  const handleFinishDrawing = () => {
    if (drawPoints.length < 3) {
      alert("Please plot at least 3 points for the zone.");
      return;
    }
    const zoneName = prompt("Enter Zone Name (e.g., Lounge):");
    if (!zoneName) return;
    const newId = zoneName.toUpperCase().replace(/\s+/g, '_');
    setZones([...zones, {
      id: newId,
      name: zoneName,
      points: [...drawPoints],
      color: 'rgba(0, 255, 204, 0.15)',
      stroke: '#00ffcc'
    }]);
    setDrawPoints([]);
    setIsDrawing(false);
  };

  const generatePath = (points) => {
    if (!points || points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  };

  return (
    <div className="zone-mapping-container dark-theme">
      <div className="office-interface-layout">
        
        {/* Left Sidebar */}
        <div className="interface-sidebar">
          <div className="interface-panel">
            <div className="panel-title">■ ROBOT FPV CAMERA</div>
            <div className="panel-content">
              <div className="fpv-placeholder patrol-active">
                <div className="patrol-visual">
                  <div className="wall-left"></div>
                  <div className="wall-right"></div>
                  <div className="floor-grid"></div>
                </div>
                <div className="fpv-overlay">
                  <div className="rec-dot"></div>
                  <div className="telemetry-overlay">
                    <div>ALT: 0.82m</div>
                    <div>SPD: 1.4 m/s</div>
                  </div>
                  <div className="target-box patrol-target"></div>
                  <div className="yolo-label">PATROLLING...</div>
                </div>
                <div className="scan-line"></div>
              </div>
            </div>
          </div>

          <div className="interface-panel">
            <div className="panel-title">■ SYSTEM STATUS</div>
            <div className="panel-content">
              <div className="sensor-grid">
                <div className="sensor-item">
                  <span className="s-label">Unit:</span>
                  <span className="s-value">Unitree Go2</span>
                </div>
                <div className="sensor-item">
                  <span className="s-label">Battery:</span>
                  <span className="s-value" style={{color: '#00ffcc'}}>78%</span>
                </div>
                <div className="sensor-item">
                  <span className="s-label">Signal:</span>
                  <span className="s-value" style={{color: '#00ffcc'}}>EXCELLENT</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width Map Viewer */}
        <div className="map-viewer-main enlarged">
          <div className="map-header-bar">
            <div className="map-title">OFFICE FACILITY MAP - LIVE NODE TRACKING</div>
            <div className="map-controls">
              {isDrawing ? (
                <div className="draw-actions">
                  <button className="map-ctrl-btn finish-btn" onClick={handleFinishDrawing}>FINISH & LABEL</button>
                  <button className="map-ctrl-btn cancel-btn" onClick={() => { setIsDrawing(false); setDrawPoints([]); }}>CANCEL</button>
                </div>
              ) : (
                <button className="map-ctrl-btn" onClick={() => setIsDrawing(true)}>+ DRAW MANUAL ZONE</button>
              )}
            </div>
          </div>

          <div className="svg-map-wrapper full-width-map">
            <svg 
              ref={svgRef}
              width="100%" height="100%" 
              viewBox="0 0 500 500" 
              className="floor-map-svg"
              onClick={handleSvgClick}
            >
              <defs>
                <pattern id="grid-dark" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#222" strokeWidth="0.5"/>
                </pattern>
                <filter id="glow-heavy">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              
              <rect width="100%" height="100%" fill="url(#grid-dark)" />

              {/* Perfectly Aligned Room Walls */}
              <g className="walls" stroke="#374151" strokeWidth="3" fill="none">
                <rect x={GRID.LEFT} y={GRID.TOP} width={GRID.RIGHT - GRID.LEFT} height={GRID.BOTTOM - GRID.TOP} />
                <line x1={GRID.LEFT} y1={GRID.H_SPLIT_1} x2={GRID.RIGHT} y2={GRID.H_SPLIT_1} />
                <line x1={GRID.LEFT} y1={GRID.H_SPLIT_2} x2={GRID.RIGHT} y2={GRID.H_SPLIT_2} />
                <line x1={GRID.V_SPLIT_1} y1={GRID.TOP} x2={GRID.V_SPLIT_1} y2={GRID.H_SPLIT_1} />
                <line x1={GRID.V_SPLIT_2} y1={GRID.TOP} x2={GRID.V_SPLIT_2} y2={GRID.H_SPLIT_1} />
                <line x1={GRID.V_SPLIT_1} y1={GRID.H_SPLIT_2} x2={GRID.V_SPLIT_1} y2={GRID.BOTTOM} />
                <line x1={GRID.V_SPLIT_2} y1={GRID.H_SPLIT_2} x2={GRID.V_SPLIT_2} y2={GRID.BOTTOM} />
              </g>

              {/* Room Specific Assets */}
              <g className="furniture" fill="#1f2937" stroke="#374151" strokeWidth="1">
                {/* Server Room - Racks */}
                {[20, 55, 90, 125].map(x => <rect key={x} x={x} y={20} width="15" height="130" rx="1" fill="#000" stroke="#dc3545" opacity="0.6" />)}
                
                {/* Exec Office - Desk & Chair */}
                <rect x={215} y={30} width="70" height="25" rx="2" fill="#2a2a35" />
                <circle cx={250} cy={75} r="7" fill="#111" />

                {/* Break Room - Table */}
                <circle cx={415} cy={90} r="30" fill="#2a2a35" />
                
                {/* Conf Room - Long Table */}
                <rect x={185} y={370} width="130" height="60" rx="30" fill="#2a2a35" />

                {/* Open Workspace - Desk Rows */}
                {[360, 420].map(x => (
                  <React.Fragment key={x}>
                    <rect x={x} y={345} width="35" height="25" rx="1" />
                    <rect x={x} y={395} width="35" height="25" rx="1" />
                    <rect x={x} y={445} width="35" height="25" rx="1" />
                  </React.Fragment>
                ))}
              </g>

              {/* Static Zones Rendering */}
              {zones.map(zone => (
                <g key={zone.id}>
                  <path d={generatePath(zone.points)} fill={zone.color} stroke={zone.stroke} strokeWidth="2" strokeDasharray="4 2" />
                  <text 
                    x={getCenter(zone.points).x} y={getCenter(zone.points).y} 
                    fill={zone.stroke} fontSize="8" fontWeight="800" textAnchor="middle" opacity="0.8"
                  >
                    {zone.id}
                  </text>
                </g>
              ))}

              {/* Drawing Preview */}
              {isDrawing && drawPoints.length > 0 && (
                <g>
                  <path d={drawPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} fill="none" stroke="#00ffcc" strokeWidth="2" strokeDasharray="5" />
                  {drawPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="#00ffcc" />)}
                </g>
              )}

              {/* SINGLE GO2 ROBOT MARKER (The Dog) */}
              <g className="robot-marker-dog">
                <circle cx={250} cy={250} r="10" fill="rgba(0, 255, 204, 0.15)">
                  <animate attributeName="r" values="10;18;10" dur="1.5s" repeatCount="indefinite" />
                </circle>
                <circle cx={250} cy={250} r="6" fill="#00ffcc" filter="url(#glow-heavy)" />
              </g>

            </svg>
          </div>
        </div>

      </div>
    </div>
  );
}

function getCenter(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

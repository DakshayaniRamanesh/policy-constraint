import React, { useState, useRef, useEffect } from 'react';
import './index.css';

const INITIAL_ZONES = [
  { 
    id: 'MAP_BOUNDS', 
    name: 'Map Boundaries', 
    points: [
      {x: 50, y: 50}, 
      {x: 450, y: 50}, 
      {x: 450, y: 450}, 
      {x: 50, y: 450}
    ], 
    color: 'rgba(255, 255, 255, 0.05)', 
    stroke: '#5a6478' 
  }
];

export default function ZoneMapping() {
  const [zones, setZones] = useState(INITIAL_ZONES);
  const [activeZoneId, setActiveZoneId] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const [draggedPoint, setDraggedPoint] = useState(null);
  const svgRef = useRef(null);

  const activeZone = zones.find(z => z.id === activeZoneId);

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
    if (draggedPoint) return;
    
    if (isDrawing) {
      const pt = getSvgCoordinates(e);
      setDrawPoints([...drawPoints, pt]);
    } else {
      setActiveZoneId(null);
    }
  };

  const handleSvgMouseMove = (e) => {
    if (!draggedPoint) return;
    const pt = getSvgCoordinates(e);

    if (draggedPoint.type === 'drawPoint') {
      const newPoints = [...drawPoints];
      newPoints[draggedPoint.index] = pt;
      setDrawPoints(newPoints);
    } else if (draggedPoint.type === 'zonePoint') {
      setZones(zones.map(z => {
        if (z.id === draggedPoint.zoneId) {
          const newPoints = [...z.points];
          newPoints[draggedPoint.index] = pt;
          return { ...z, points: newPoints };
        }
        return z;
      }));
    }
  };

  const handleSvgMouseUp = () => {
    setDraggedPoint(null);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => setDraggedPoint(null);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const handleFinishDrawing = () => {
    if (drawPoints.length < 3) {
      alert("A polygon needs at least 3 points!");
      return;
    }
    
    const zoneId = prompt("Enter Zone ID (e.g., NEW_ZONE):");
    if (!zoneId) return;
    
    const zoneName = prompt("Enter Zone Name (e.g., New Zone):") || zoneId;
    
    const hues = [280, 320, 160, 40, 10];
    const hue = hues[zones.length % hues.length];
    
    const newZone = {
      id: zoneId.toUpperCase(),
      name: zoneName,
      points: [...drawPoints],
      color: `hsla(${hue}, 70%, 50%, 0.2)`,
      stroke: `hsl(${hue}, 70%, 50%)`
    };
    
    setZones([...zones, newZone]);
    setDrawPoints([]);
    setIsDrawing(false);
  };

  const handleCancelDrawing = () => {
    setDrawPoints([]);
    setIsDrawing(false);
  };

  const generatePath = (points) => {
    if (!points || points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  };

  const generateOpenPath = (points) => {
    if (!points || points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  return (
    <div className="zone-mapping-container">
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>2D Zone Mapping</h1>
          <p>Live view of the environment scanned by the robot, segmented into policy enforcement zones.</p>
        </div>
        <div className="drawing-controls">
          {!isDrawing ? (
            <button className="btn btn-accept" onClick={() => setIsDrawing(true)}>
              + Draw Manual Zone
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-accept" onClick={handleFinishDrawing}>Finish Polygon</button>
              <button className="btn btn-reject" onClick={handleCancelDrawing}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {isDrawing && (
        <div className="alert-card normal-alert" style={{ marginBottom: '20px', padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="alert-msg" style={{ fontSize: '1.1em' }}><strong>Drawing Mode Active</strong></span>
            <span style={{ fontWeight: 'bold', color: '#0066cc', fontSize: '1.1em' }}>Points: {drawPoints.length}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', color: '#5a6478', lineHeight: '1.5', fontSize: '0.95em' }}>
            <li><strong>Click anywhere</strong> on the map to plot a vertex for your zone.</li>
            <li>Plot <strong>at least 3 points</strong> to form a closed polygon.</li>
            <li><strong>Drag any dot</strong> to adjust the shape dynamically.</li>
            <li>Click <strong>Finish Polygon</strong> to save and name your new zone.</li>
          </ul>
        </div>
      )}
      
      {!isDrawing && (
        <div className="alert-card normal-alert" style={{ marginBottom: '20px', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="alert-msg"><strong>Tip:</strong> Click on any zone (including the map boundary) to view its details and drag its vertices to reshape it.</span>
        </div>
      )}

      <div className="map-layout">
        <div className="map-viewer" style={{ cursor: isDrawing ? (draggedPoint ? 'grabbing' : 'crosshair') : (draggedPoint ? 'grabbing' : 'default') }}>
          <div className="map-wrapper">
             <svg 
               ref={svgRef}
               width="100%" 
               height="100%" 
               viewBox="0 0 500 500" 
               className="floor-map"
               onClick={handleSvgClick}
               onMouseMove={handleSvgMouseMove}
               onMouseUp={handleSvgMouseUp}
               onMouseLeave={handleSvgMouseUp}
               style={{ touchAction: 'none' }}
             >
               <defs>
                 <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                   <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#2a2a35" strokeWidth="1"/>
                 </pattern>
               </defs>
               <rect width="100%" height="100%" fill="url(#grid)" onClick={(e) => {
                 if (!isDrawing) setActiveZoneId(null);
               }} />
               
               {zones.map(zone => {
                 const isActive = activeZoneId === zone.id;
                 
                 return (
                   <g key={zone.id} 
                      onClick={(e) => {
                        if (!isDrawing) {
                          e.stopPropagation();
                          setActiveZoneId(zone.id);
                        }
                      }}
                      style={{ 
                        cursor: isDrawing ? 'crosshair' : 'pointer', 
                        transition: draggedPoint ? 'none' : 'all 0.3s ease', 
                        pointerEvents: isDrawing ? 'none' : 'auto' 
                      }}
                      className={isActive ? 'zone-active' : ''}
                   >
                     <path 
                       d={generatePath(zone.points)} 
                       fill={isActive ? zone.color.replace('0.2', '0.4') : zone.color} 
                       stroke={zone.stroke} 
                       strokeWidth="2"
                       className="zone-path"
                     />
                     <text 
                       x={getCenter(zone.points).x} 
                       y={getCenter(zone.points).y} 
                       fill="#ffffff" 
                       fontSize="14" 
                       fontWeight="bold" 
                       textAnchor="middle"
                       dominantBaseline="middle"
                       style={{ pointerEvents: 'none' }}
                     >
                       {zone.id}
                     </text>

                     {isActive && !isDrawing && zone.points.map((p, i) => (
                       <circle 
                         key={`zone-pt-${i}`}
                         cx={p.x} cy={p.y} r="6" 
                         fill="#fff" stroke={zone.stroke} strokeWidth="2"
                         style={{ cursor: draggedPoint ? 'grabbing' : 'grab', pointerEvents: 'auto' }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           setDraggedPoint({ type: 'zonePoint', zoneId: zone.id, index: i });
                         }}
                         onClick={(e) => e.stopPropagation()}
                       />
                     ))}
                   </g>
                 );
               })}

               {isDrawing && drawPoints.length > 0 && (
                 <g style={{ pointerEvents: 'auto' }}>
                   <path 
                     d={generateOpenPath(drawPoints) + (drawPoints.length > 2 ? ' Z' : '')}
                     fill="rgba(153, 50, 204, 0.2)"
                     stroke="#9932cc"
                     strokeWidth="2"
                     strokeDasharray="4 4"
                     style={{ pointerEvents: 'none' }}
                   />
                   {drawPoints.map((p, i) => (
                     <circle 
                       key={`draw-pt-${i}`} 
                       cx={p.x} cy={p.y} r="6" 
                       fill="#fff" stroke="#9932cc" strokeWidth="2"
                       style={{ cursor: draggedPoint ? 'grabbing' : 'grab' }}
                       onMouseDown={(e) => {
                         e.stopPropagation();
                         setDraggedPoint({ type: 'drawPoint', index: i });
                       }}
                       onClick={(e) => e.stopPropagation()}
                     />
                   ))}
                 </g>
               )}

               <circle cx="150" cy="120" r="6" fill="#00ffcc" style={{ pointerEvents: 'none' }}>
                 <animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" />
                 <animate attributeName="opacity" values="1;0;1" dur="2s" repeatCount="indefinite" />
               </circle>
               <circle cx="150" cy="120" r="4" fill="#00ffcc" style={{ pointerEvents: 'none' }} />
             </svg>
          </div>
        </div>

        <div className="zone-details-panel">
          {activeZone ? (
            <div className="zone-info-card animate-fade-in">
              <h3>{activeZone.name}</h3>
              <div className="zone-stat">
                <span className="stat-label">Zone ID:</span>
                <span className="stat-value">{activeZone.id}</span>
              </div>
              <div className="zone-stat">
                <span className="stat-label">Security Level:</span>
                <span className="stat-value" style={{ color: activeZone.id === 'SERVER_ROOM' ? '#dc3545' : '#1a8a3a' }}>
                  {['SERVER_ROOM', 'MAP_BOUNDS'].includes(activeZone.id) ? 'RESTRICTED' : 'STANDARD'}
                </span>
              </div>
              <div className="zone-stat">
                <span className="stat-label">Area:</span>
                <span className="stat-value">{(Math.random() * 50 + 20).toFixed(1)} sq m</span>
              </div>
              
              <div className="active-policies mt-4">
                <h4>Active Policies in Zone</h4>
                <ul className="policy-list">
                  <li>Speed limit: {activeZone.id === 'HALLWAY' ? '2.0' : '1.0'} m/s</li>
                  {activeZone.id === 'SERVER_ROOM' && <li>Unauthorized personnel: ALERT</li>}
                  {activeZone.id === 'LAB-A' && <li>Safety goggles required: LOG</li>}
                  {activeZone.id === 'RECEPTION' && <li>Greet visitors: ENABLED</li>}
                  {!['SERVER_ROOM', 'LAB-A', 'RECEPTION', 'HALLWAY', 'LAB-B'].includes(activeZone.id) && (
                    <li>Custom policy rules pending configuration...</li>
                  )}
                </ul>
              </div>
            </div>
          ) : (
            <div className="empty-zone-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#5a6478" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {isDrawing ? (
                <p>Drawing Mode: Click to add points, drag dots to refine.</p>
              ) : (
                <p>Select a zone to view its details or drag its vertices.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getCenter(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

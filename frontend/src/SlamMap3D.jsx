import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import CameraPanel from './CameraPanel';

// ─── Zone Definitions (world units, matching 2D layout proportions) ───────────
const ZONE_DEFS = [
  {
    id: 'SERVER_INFRA',
    name: 'Server Room',
    color: 0xdc3545,
    x: -7,  z: -6,  w: 5.5, d: 5.5, h: 3.5,
  },
  {
    id: 'EXEC_OFFICE',
    name: 'Exec Office',
    color: 0x38bdf8,
    x: -0.5, z: -6,  w: 5.5, d: 5.5, h: 3.5,
  },
  {
    id: 'BREAK_ROOM',
    name: 'Break Room',
    color: 0xffc107,
    x: 6,  z: -6,  w: 5.5, d: 5.5, h: 3.5,
  },
  {
    id: 'STORAGE',
    name: 'Storage',
    color: 0x6b7280,
    x: -7,  z: 6,  w: 5.5, d: 5.5, h: 3.5,
  },
  {
    id: 'CONF_ROOM',
    name: 'Conf Room',
    color: 0x8b5cf6,
    x: -0.5, z: 6,  w: 5.5, d: 5.5, h: 3.5,
  },
  {
    id: 'OPEN_WORKSPACE',
    name: 'Open Workspace',
    color: 0x10b981,
    x: 6,  z: 6,  w: 5.5, d: 5.5, h: 3.5,
  },
];

// Hallway occupies the strip z ∈ [-1.5, 1.5]
const FLOOR_W = 22;
const FLOOR_D = 18;

// ─── Door definitions — must match slam_server.py DOORS list ─────────────────
// These are rendered as 3D door frames in the scene.
// verdict drives the color: red = BLOCKED, green = ALLOWED
const DOOR_DEFS = [
  { id: 'DOOR-001', x: -7.0,  z: -2.8, zone: 'SERVER_INFRA', verdict: 'BLOCKED', color: 0xff3333 },
  { id: 'DOOR-002', x: -0.5,  z: -2.8, zone: 'EXEC_OFFICE',  verdict: 'BLOCKED', color: 0xff3333 },
  { id: 'DOOR-003', x:  6.0,  z: -2.8, zone: 'BREAK_ROOM',   verdict: 'ALLOWED', color: 0x00ff88 },
];

const DETECTION_RADIUS = 1.8; // metres — robot stops this far from a door

// Simulated humans inside BLOCKED zones (fake data — matches slam_server.py)
const SIMULATED_HUMANS = [
  { id: 'HUMAN-001', zone: 'SERVER_INFRA', x: -7.2, y: 0.0, z: -5.8, label: 'Technician' },
  { id: 'HUMAN-002', zone: 'SERVER_INFRA', x: -6.1, y: 0.0, z: -6.4, label: 'Security'   },
  { id: 'HUMAN-003', zone: 'EXEC_OFFICE',  x: -0.3, y: 0.0, z: -5.6, label: 'Executive'  },
  { id: 'HUMAN-004', zone: 'EXEC_OFFICE',  x:  0.6, y: 0.0, z: -6.7, label: 'Assistant'  },
];

// Colour map for each robot patrol state — used by HUD badge + body tint
const STATE_COLORS = {
  PATROLLING: '#00ffcc',
  DETECTED:   '#ff8800',
  THINKING:   '#ffcc00',
  BLOCKED:    '#ff3333',
};

// ─── JS-side robot simulator (mirrors Python RobotSimulator) ─────────────────
class LocalRobotSim {
  constructor() {
    this.x = -8.0; this.z = 0.0; this.y = 0.35;
    this.direction = 1; this.direction_z = 1; this.heading = Math.PI / 2; this.speed = 2.0;
    this.state = 'PATROLLING'; this.stateTimer = 0.0;
    this.activeDoor = null; this.targetDoor = null; this.targetZone = null; this.targetZ = 0.0;
    this.detections = []; this.eventLog = [];
    this.checkedDoors = new Set();
  }
  setTargetZone(zoneId) {
    const door = DOOR_DEFS.find(d => d.zone === zoneId);
    if (door) {
      this.targetZone = zoneId;
      this.targetDoor = door;
      this.state = 'NAV_TO_DOOR';
      this.activeDoor = null;
      this._log(`[CMD] Navigating to ${zoneId}`);
    }
  }
  _log(msg) {
    const ts = new Date().toLocaleTimeString('en-GB');
    this.eventLog.unshift({ time: ts, msg });
    if (this.eventLog.length > 10) this.eventLog.pop();
  }
  _humansInZone(zoneId) { return SIMULATED_HUMANS.filter(h => h.zone === zoneId); }
  update(dt) {
    if (this.state === 'PATROLLING') {
      this.x += this.speed * this.direction * dt;
      this.z  = Math.sin(this.x * 0.22) * 0.5;
      for (const door of DOOR_DEFS) {
        if (this.checkedDoors.has(door.id)) continue;
        const dist = Math.abs(this.x - door.x);
        const approaching = (this.direction > 0 && this.x < door.x) || (this.direction < 0 && this.x > door.x);
        if (dist < DETECTION_RADIUS && approaching) {
          const humans = this._humansInZone(door.zone);
          this.state = 'DETECTED'; this.stateTimer = 0.8;
          this.activeDoor = door;
          this.detections = [{ ...door, human_count: humans.length, type: 'DOOR' }];
          this._log(`[SENSOR] ${door.id} → ${door.zone} (${humans.length > 0 ? humans.length + ' human(s)' : 'policy check'})`);
          break;
        }
      }
      if      (this.x >  8.5) { this.direction = -1; this.heading = -Math.PI / 2; this.checkedDoors.clear(); this._log('[ROBOT] End of corridor — reversing'); }
      else if (this.x < -8.5) { this.direction =  1; this.heading =  Math.PI / 2; this.checkedDoors.clear(); this._log('[ROBOT] Start of corridor — reversing'); }
    } else if (this.state === 'NAV_TO_DOOR') {
      if (!this.targetDoor) { this.state = 'PATROLLING'; return; }
      const dx = this.targetDoor.x - this.x;
      if (Math.abs(dx) > 0.15) {
        this.direction = dx > 0 ? 1 : -1;
        this.x += this.speed * this.direction * dt;
        this.heading = this.direction === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        this.x = this.targetDoor.x;
        this.heading = this.targetDoor.z < 0 ? 0 : Math.PI;
        this.state = 'DETECTED'; this.stateTimer = 0.8;
        this.activeDoor = this.targetDoor;
        const humans = this._humansInZone(this.targetDoor.zone);
        this.detections = [{ ...this.targetDoor, human_count: humans.length, type: 'DOOR' }];
        this._log(`[SENSOR] ${this.targetDoor.id} → Policy check`);
      }
    } else if (this.state === 'DETECTED') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'THINKING'; this.stateTimer = 2.2; this._log(`[POLICY] Querying gate for ${this.activeDoor?.zone ?? '?'}...`); }
    } else if (this.state === 'THINKING') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        const door = this.activeDoor;
        const humans = door ? this._humansInZone(door.zone) : [];
        let verdict = door?.verdict ?? 'BLOCKED';
        if (humans.length > 0) { verdict = 'BLOCKED'; this._log(`[POLICY] BLOCKED — ${humans.length} human(s) in ${door.zone}`); }
        else { this._log(`[POLICY] Result: ${verdict} — ${door?.zone ?? '?'}`); }
        if (verdict === 'BLOCKED') {
          this.state = 'BLOCKED'; this.stateTimer = 2.0;
          if (door) this.checkedDoors.add(door.id);
        } else {
          if (this.targetDoor && door && this.targetDoor.id === door.id) {
            this.state = 'ENTERING_ROOM';
            this.targetZ = this.targetDoor.z < 0 ? -6.0 : 6.0;
            this._log(`[ROBOT] Access GRANTED — entering ${door.zone}`);
          } else {
            this.state = 'PATROLLING'; this.detections = [];
            if (door) this.checkedDoors.add(door.id);
            this._log(`[ROBOT] Access GRANTED — bypassing ${door?.zone}`);
          }
        }
      }
    } else if (this.state === 'BLOCKED') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'PATROLLING'; this.activeDoor = null; this.targetDoor = null; this.targetZone = null; this.detections = [];
        this._log('[ROBOT] Resuming patrol — bypassing restricted area');
      }
    } else if (this.state === 'ENTERING_ROOM') {
      const dz = this.targetZ - this.z;
      if (Math.abs(dz) > 0.15) {
        this.direction_z = dz > 0 ? 1 : -1;
        this.z += this.speed * this.direction_z * dt;
      } else {
        this.z = this.targetZ;
        this.state = 'IN_ROOM'; this.stateTimer = 5.0;
        this._log(`[ROBOT] Inside ${this.targetDoor.zone}`);
      }
    } else if (this.state === 'IN_ROOM') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'EXITING_ROOM'; this.targetZ = 0.0;
        this.heading = this.z < 0 ? Math.PI : 0;
        this._log('[ROBOT] Exiting room');
      }
    } else if (this.state === 'EXITING_ROOM') {
      const dz = this.targetZ - this.z;
      if (Math.abs(dz) > 0.15) {
        this.direction_z = dz > 0 ? 1 : -1;
        this.z += this.speed * this.direction_z * dt;
      } else {
        this.z = 0.0;
        this.state = 'PATROLLING'; this.targetDoor = null; this.targetZone = null;
        this.direction = 1; this.heading = Math.PI / 2;
        this._log('[ROBOT] Resuming hallway patrol');
      }
    }
  }
  toState() { return { x: this.x, y: this.y, z: this.z, heading: this.heading, state: this.state }; }
}

function generatePointCloud(density) {
  // density: 0-100, maps to ~500–8000 points
  const count = Math.floor(500 + (density / 100) * 7500);
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);

  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const rand = Math.random();
    let x, y, z;

    if (rand < 0.55) {
      // Floor scatter
      x = (Math.random() - 0.5) * FLOOR_W;
      z = (Math.random() - 0.5) * FLOOR_D;
      y = Math.random() * 0.15;
    } else if (rand < 0.70) {
      // North wall (z ~ -9)
      x = (Math.random() - 0.5) * FLOOR_W;
      z = -FLOOR_D / 2 + Math.random() * 0.2;
      y = Math.random() * 3.8;
    } else if (rand < 0.85) {
      // South wall (z ~ +9)
      x = (Math.random() - 0.5) * FLOOR_W;
      z =  FLOOR_D / 2 - Math.random() * 0.2;
      y = Math.random() * 3.8;
    } else if (rand < 0.92) {
      // West wall (x ~ -11)
      x = -FLOOR_W / 2 + Math.random() * 0.2;
      z = (Math.random() - 0.5) * FLOOR_D;
      y = Math.random() * 3.8;
    } else {
      // East wall (x ~ +11)
      x =  FLOOR_W / 2 - Math.random() * 0.2;
      z = (Math.random() - 0.5) * FLOOR_D;
      y = Math.random() * 3.8;
    }

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Height-map coloring: floor=blue/cyan → mid=green → ceiling=warm orange
    // This mimics how real LiDAR colorizers display point elevation.
    const yNorm = Math.min(y / 3.8, 1.0);
    color.setHSL(0.55 - yNorm * 0.45, 0.9, 0.18 + yNorm * 0.42 + Math.random() * 0.08);
    colors[i * 3]     = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  return { positions, colors, count };
}

export default function SlamMap3D() {
  const mountRef  = useRef(null);
  const sceneRef  = useRef(null);
  const cameraRef = useRef(null);
  const rendRef   = useRef(null);
  const frameRef  = useRef(null);
  const controlsRef = useRef(null); // manual orbit state
  const pointsRef = useRef(null);
  const zonesRef  = useRef({});     // id -> THREE.LineSegments
  const zoneHitboxesRef = useRef([]); // invisible meshes for clicking
  const robotRef  = useRef(null);
  const robotTimeRef = useRef(0);
  const isOrbitingRef = useRef(false);
  const lastMouseRef  = useRef({ x: 0, y: 0 });
  const orbitStateRef = useRef({ theta: Math.PI / 6, phi: Math.PI / 4, radius: 28 });

  // Holds the live WebSocket instance so we can close it on unmount
  const wsRef = useRef(null);

  // Boolean ref readable inside the animation loop closure (React state is stale there)
  // True only when the server is actively sending JSON frames
  const wsLiveRef = useRef(false);

  // Timestamp (ms) of the last JSON frame received — used to detect stale connections
  // If no JSON arrives within 1500ms despite wsLiveRef=true, local fallback kicks in
  const lastJsonRef = useRef(0);

  // Stores force-field plane meshes keyed by door id — toggled in animation loop
  const forceFieldsRef = useRef({});
  const localSimRef        = useRef(null); // JS-side LocalRobotSim (offline mode)
  const humanAlertRingsRef = useRef([]);   // pulsing rings on each human figure

  const [zoneVisible, setZoneVisible] = useState(() =>
    Object.fromEntries(ZONE_DEFS.map(z => [z.id, true]))
  );
  const [density, setDensity] = useState(60);
  const [camPreset, setCamPreset] = useState('iso');

  // Tracks WebSocket connection state so the HUD badge updates
  const [wsStatus, setWsStatus] = useState('connecting'); // 'connecting' | 'live' | 'offline'

  // Server-pushed robot state (position + patrol state) updated every WS JSON frame
  const robotStateRef = useRef({ x: -8, y: 0.35, z: 0, heading: Math.PI/2, state: 'PATROLLING' });
  const densityRef = useRef(density);

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  // React state for the detection event log panel and current robot state badge
  const [robotState,  setRobotState]  = useState('PATROLLING');
  const [eventLog,    setEventLog]    = useState([]);
  const [detections,  setDetections]  = useState([]);

  // Robot click info panel (shown when user clicks the robot mesh)
  const [robotInfoOpen, setRobotInfoOpen] = useState(false);

  // ── Build scene once ──────────────────────────────────────────────────────
  useEffect(() => {
    const W = mountRef.current.clientWidth;
    const H = mountRef.current.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x0a0d14, 1);
    mountRef.current.appendChild(renderer.domElement);
    rendRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0d14, 0.025);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
    cameraRef.current = camera;
    applyOrbitState(camera, orbitStateRef.current);

    // Ambient + point lights
    scene.add(new THREE.AmbientLight(0x112233, 2));
    const pt1 = new THREE.PointLight(0x00ffcc, 1.5, 30);
    pt1.position.set(0, 8, 0);
    scene.add(pt1);

    // ── Point cloud ──────────────────────────────────────────────────────
    const geo = new THREE.BufferGeometry();
    const { positions, colors, count } = generatePointCloud(density);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    pointsRef.current = pts;

    // ── Hallway floor highlight ────────────────────────────────────────
    const hallGeo = new THREE.PlaneGeometry(FLOOR_W, 3.2);
    const hallMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.03, side: THREE.DoubleSide });
    const hallPlane = new THREE.Mesh(hallGeo, hallMat);
    hallPlane.rotation.x = -Math.PI / 2;
    hallPlane.position.y = 0.01;
    scene.add(hallPlane);

    // ── Zone wireframe boxes ───────────────────────────────────────────
    ZONE_DEFS.forEach(def => {
      const boxGeo = new THREE.BoxGeometry(def.w, def.h, def.d);
      const edges   = new THREE.EdgesGeometry(boxGeo);
      const lineMat = new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.85 });
      const wireframe = new THREE.LineSegments(edges, lineMat);
      wireframe.position.set(def.x, def.h / 2, def.z);

      // Label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `#${def.color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.id, 128, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(4, 1, 1);
      sprite.position.set(0, def.h / 2 + 0.7, 0);
      wireframe.add(sprite);

      scene.add(wireframe);
      zonesRef.current[def.id] = wireframe;

      // Invisible hitbox for raycasting
      const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const hitbox = new THREE.Mesh(boxGeo, hitMat);
      hitbox.position.set(def.x, def.h / 2, def.z);
      hitbox.userData = { isZone: true, zoneId: def.id };
      scene.add(hitbox);
      zoneHitboxesRef.current.push(hitbox);
    });

    // ── Robot indicator (Go2) ─────────────────────────────────────────
    const robotGroup = new THREE.Group();

    // ── Detailed Go2 robot body ──────────────────────────────────────────
    // Built from Three.js primitives to approximate the Unitree Go2 silhouette.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.4, roughness: 0.3 });
    const legMat  = new THREE.MeshStandardMaterial({ color: 0x00bbaa, emissive: 0x003322, roughness: 0.7 });

    // Torso (main flat body)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 1.0), bodyMat);
    torso.position.y = 0.09;
    robotGroup.add(torso);

    // Sensor head (front-mounted, slightly elevated — mimics RealSense housing)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.14), bodyMat);
    head.position.set(0, 0.17, 0.52);
    robotGroup.add(head);

    // LiDAR unit on top of torso (small cylinder)
    const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 8), bodyMat);
    lidar.position.set(0, 0.22, 0);
    robotGroup.add(lidar);

    // 4 legs: [xOffset, zOffset] pairs for FL, FR, RL, RR
    [[-0.26, 0.40], [0.26, 0.40], [-0.26, -0.40], [0.26, -0.40]].forEach(([lx, lz]) => {
      // Upper leg segment
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.07), legMat);
      upper.position.set(lx, -0.12, lz);
      upper.rotation.x = lz > 0 ? 0.25 : -0.25;
      robotGroup.add(upper);
      // Lower leg + foot
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.055), legMat);
      lower.position.set(lx, -0.34, lz + (lz > 0 ? 0.07 : -0.07));
      robotGroup.add(lower);
    });

    // Pulsing ring
    const ringGeo = new THREE.RingGeometry(0.5, 0.65, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.17;
    robotGroup.add(ring);

    // Glow light
    const glow = new THREE.PointLight(0x00ffcc, 2, 3);
    robotGroup.add(glow);

    robotGroup.position.set(-8, 0.35, 0);
    scene.add(robotGroup);
    robotRef.current = { group: robotGroup, ring };

    // ── Initialise JS-side robot simulator ───────────────────────────────
    localSimRef.current = new LocalRobotSim();

    // ── Simulated human figures inside restricted zones ─────────────────
    const alertRings = [];
    SIMULATED_HUMANS.forEach(h => {
      const hGrp = new THREE.Group();
      const hMat = new THREE.MeshStandardMaterial({
        color: 0xff3333, emissive: 0xff1100, emissiveIntensity: 0.55, roughness: 0.5,
      });
      // Torso
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.65, 8), hMat);
      torso.position.set(0, 0.93, 0);
      hGrp.add(torso);
      // Head
      const hhead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), hMat);
      hhead.position.set(0, 1.50, 0);
      hGrp.add(hhead);
      // Legs
      [[-0.10, 0], [0.10, 0]].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.50, 6), hMat);
        leg.position.set(lx, 0.35, lz);
        hGrp.add(leg);
      });
      // Pulsing alert ring on the floor
      const aRingGeo = new THREE.RingGeometry(0.28, 0.38, 16);
      const aRingMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      const aRing = new THREE.Mesh(aRingGeo, aRingMat);
      aRing.rotation.x = -Math.PI / 2;
      aRing.position.y = 0.02;
      hGrp.add(aRing);
      alertRings.push(aRing);
      // Label sprite
      const hcv = document.createElement('canvas');
      hcv.width = 192; hcv.height = 44;
      const hctx = hcv.getContext('2d');
      hctx.fillStyle = '#ff4444'; hctx.font = 'bold 15px monospace';
      hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
      hctx.fillText(`⚠ ${h.label}`, 96, 22);
      const hSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hcv), transparent: true }));
      hSp.scale.set(2.2, 0.5, 1);
      hSp.position.set(0, 2.05, 0);
      hGrp.add(hSp);

      hGrp.position.set(h.x, 0, h.z);
      scene.add(hGrp);
    });
    humanAlertRingsRef.current = alertRings;

    // ── Door frame objects ─────────────────────────────────────────────
    // Each door is a wireframe arch: two posts + top beam + translucent face.
    DOOR_DEFS.forEach(def => {
      const grp = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.75 });
      const faceColor = def.verdict === 'BLOCKED' ? 0xff3333 : 0x00ff88;

      // Left and right vertical posts
      [-0.55, 0.55].forEach(ox => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), mat);
        post.position.set(ox, 1.1, 0);
        grp.add(post);
      });

      // Horizontal top beam
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.08, 0.08), mat);
      beam.position.set(0, 2.2, 0);
      grp.add(beam);

      // Semi-transparent door face
      const faceMat = new THREE.MeshBasicMaterial({ color: faceColor, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), faceMat);
      face.position.set(0, 1.1, 0);
      grp.add(face);

      // Canvas label sprite (BLOCKED / ALLOWED)
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 56;
      const cx = cv.getContext('2d');
      cx.fillStyle = def.verdict === 'BLOCKED' ? '#ff4444' : '#00ff88';
      cx.font = 'bold 18px monospace';
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(def.verdict === 'BLOCKED' ? '⛔ RESTRICTED' : '✓ ACCESSIBLE', 128, 28);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
      sp.scale.set(3, 0.7, 1);
      sp.position.set(0, 2.8, 0);
      grp.add(sp);

      grp.position.set(def.x, 0, def.z);
      scene.add(grp);
    });

    // ── Force-field planes (one per BLOCKED door) ──────────────────────
    // These are invisible by default. The animation loop makes them visible
    // and pulses their opacity whenever the robot is BLOCKED at that door.
    const ffMeshes = {};
    DOOR_DEFS.filter(d => d.verdict === 'BLOCKED').forEach(def => {
      const ffMat  = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0, side: THREE.DoubleSide });
      const ffMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.8), ffMat);
      ffMesh.position.set(def.x, 1.9, def.z);
      ffMesh.visible = false;
      scene.add(ffMesh);
      ffMeshes[def.id] = ffMesh;
    });
    forceFieldsRef.current = ffMeshes;

    // ── Resize handler ─────────────────────────────────────────────────
    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // ── Animation loop ─────────────────────────────────────────────────
    let t = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      try {
        t += 0.016;
        robotTimeRef.current = t;

        // ── Local sim: state machine (PATROLLING→DETECTED→THINKING→BLOCKED) ─────────
        // Runs when WS is offline or no JSON has arrived in the last 1.5 s.
        const mssSinceJson = Date.now() - lastJsonRef.current;
        const useLocalAnim = !wsLiveRef.current || mssSinceJson > 1500;

        if (useLocalAnim && localSimRef.current) {
          localSimRef.current.update(0.016);
          robotStateRef.current = localSimRef.current.toState();
        }

        // Pulse human alert rings
        humanAlertRingsRef.current.forEach((aRing, i) => {
          if (!aRing?.material) return;
          const p = 0.3 + 0.55 * Math.sin(t * 3.5 + i * 1.3);
          aRing.material.opacity = p;
          const sc = 1 + 0.25 * Math.sin(t * 3.5 + i * 1.3);
          aRing.scale.set(sc, sc, 1);
        });

        // Read whichever source (server or local) wrote the latest position
        const rs = robotStateRef.current;
        if (!rs) return;
        
        robotGroup.position.set(rs.x, rs.y, rs.z);
        robotGroup.rotation.y = rs.heading;

        // Robot body color changes based on state — traverse all MeshStandardMaterial meshes
        const stateColor = rs.state === 'THINKING' ? 0xffcc00
                         : rs.state === 'BLOCKED'   ? 0xff3333
                         : rs.state === 'DETECTED'  ? 0xff8800
                         : 0x00ffcc;
        robotGroup.traverse(child => {
          if (child.isMesh && child.material && child.material.emissive !== undefined) {
            child.material.color.setHex(stateColor);
            child.material.emissive.setHex(stateColor);
          }
        });

        // Pulse ring — faster when THINKING, normal otherwise
        const speed = rs.state === 'THINKING' ? 8 : 3;
        const pulse = 0.5 + 0.5 * Math.sin(t * speed);
        ring.material.color.setHex(stateColor);
        ring.material.opacity = 0.15 + pulse * 0.4;
        const s = 1 + pulse * (rs.state === 'THINKING' ? 0.6 : 0.25);
        ring.scale.set(s, s, 1);

        // Force-field visibility — proper 3-D distance to door threshold
        Object.values(forceFieldsRef.current).forEach(ff => { ff.visible = false; });
        if (rs.state === 'BLOCKED' || rs.state === 'THINKING') {
          DOOR_DEFS.forEach(def => {
            const ff = forceFieldsRef.current[def.id];
            if (!ff) return;
            const dx = rs.x - def.x, dz = rs.z - def.z;
            if (Math.sqrt(dx * dx + dz * dz) < 4.0) {
              ff.visible = true;
              const pf = 0.5 + 0.5 * Math.sin(t * (rs.state === 'BLOCKED' ? 14 : 7));
              ff.material.opacity = pf * (rs.state === 'BLOCKED' ? 0.45 : 0.18);
            }
          });
        }

        renderer.render(scene, camera);
      } catch (err) {
        console.error("[SLAM] Animation loop error:", err);
      }
    };
    animate();

    // ── Robot click detection (raycaster) ──────────────────────────────
    // Distinguish a click from a drag: if mouse moved more than 4px between
    // mousedown and mouseup it's a drag (orbit), not a click.
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();
    let mouseDownPos = { x: 0, y: 0 };

    const onMouseDown = (e) => { mouseDownPos = { x: e.clientX, y: e.clientY }; };

    const onMouseUp = (e) => {
      const dx = Math.abs(e.clientX - mouseDownPos.x);
      const dy = Math.abs(e.clientY - mouseDownPos.y);
      if (dx > 4 || dy > 4) return;   // was a drag, ignore

      const canvas = renderer.domElement;
      const rect   = canvas.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // Collect objects for raycasting: robot meshes and zone hitboxes
      const targets = [...zoneHitboxesRef.current];
      robotRef.current?.group?.traverse(child => {
        if (child.isMesh) targets.push(child);
      });

      const hits = raycaster.intersectObjects(targets);
      if (hits.length > 0) {
        const hit = hits[0].object;
        if (hit.userData && hit.userData.isZone) {
          // Clicked a room
          const zoneId = hit.userData.zoneId;
          console.log(`[UI] Clicked zone: ${zoneId}`);
          if (wsLiveRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'GO_TO_ZONE', zone_id: zoneId }));
          } else if (localSimRef.current) {
            localSimRef.current.setTargetZone(zoneId);
          }
        } else {
          // Clicked the robot
          setRobotInfoOpen(true);
        }
      } else {
        setRobotInfoOpen(false);
      }
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mouseup',   onMouseUp);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mouseup',   onMouseUp);
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket → Live point cloud stream ──────────────────────────────────
  // Connects to slam_server.py on port 8001. Each message is a raw binary
  // payload of Float32 values laid out as [x0,y0,z0, x1,y1,z1, ...]
  // We parse it with Float32Array and push it straight into the GPU buffer.
  useEffect(() => {
    // Use the secure variant (wss) automatically if the page is on HTTPS
    const WS_URL = 'ws://localhost:8001/ws/slam-map';
    let ws;

    const connect = () => {
      setWsStatus('connecting');
      ws = new WebSocket(WS_URL);

      // Binary frames — tell the browser to hand us an ArrayBuffer, not a Blob
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[SLAM] WebSocket connected to slam_server.py');
        wsLiveRef.current = true;   // switch animation loop to server-driven mode
        setWsStatus('live');
      };

      ws.onmessage = (event) => {
        // ── JSON frame: robot state, detections, event log ──────────────
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            // Stamp the heartbeat so the animation loop knows data is fresh
            lastJsonRef.current = Date.now();
            // Push robot position into the ref so the animation loop picks it up
            robotStateRef.current = data.robot;
            // Update React state for the UI panel (batched, low cost)
            setRobotState(data.robot.state);
            setDetections(data.detections || []);
            setEventLog(data.event_log  || []);
          } catch { /* ignore malformed JSON */ }
          return;
        }

        // ── Binary frame: Float32 point cloud [x,y,z, x,y,z, ...] ───────
        const floats = new Float32Array(event.data);
        if (floats.length === 0 || floats.length % 3 !== 0) return;
        const geo = pointsRef.current?.geometry;
        if (!geo) return;
        
        const count = floats.length / 3;
        const drawCount = Math.floor(count * (densityRef.current / 100));
        
        // Generate corresponding colors for the live points so WebGL doesn't mismatch buffers
        const colors = new Float32Array(floats.length);
        const color = new THREE.Color();
        for (let i = 0; i < count; i++) {
          const y = floats[i * 3 + 1];
          const yNorm = Math.min(y / 3.8, 1.0);
          color.setHSL(0.55 - yNorm * 0.45, 0.9, 0.18 + yNorm * 0.42);
          colors[i * 3]     = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }

        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.BufferAttribute(floats, 3));
        newGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        newGeo.setDrawRange(0, drawCount);
        newGeo.computeBoundingSphere();
        pointsRef.current.geometry.dispose();
        pointsRef.current.geometry = newGeo;
      };

      ws.onclose = () => {
        console.warn('[SLAM] WebSocket closed — falling back to local animation.');
        wsLiveRef.current = false;  // re-enable local fallback patrol
        setWsStatus('offline');
      };

      ws.onerror = () => {
        // onerror always fires before onclose, so just log here
        console.error('[SLAM] WebSocket error.');
      };

      // Store the instance so the cleanup function can close it
      wsRef.current = ws;
    };

    connect();

    // Cleanup: close the socket when the component unmounts or the tab changes
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  // Run once on mount — no dependencies needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update zone visibility ────────────────────────────────────────────────
  useEffect(() => {
    ZONE_DEFS.forEach(def => {
      if (zonesRef.current[def.id]) {
        zonesRef.current[def.id].visible = zoneVisible[def.id];
      }
    });
  }, [zoneVisible]);

  // ── Rebuild point cloud locally (only when WebSocket is offline) ──────────
  // When the live server is running this effect is bypassed — the WebSocket
  // onmessage handler owns the buffer. When offline the slider still works.
  useEffect(() => {
    if (!pointsRef.current) return;
    // Don't override live server data with local generation
    if (wsStatus === 'live') return;
    const { positions, colors } = generatePointCloud(density);
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    newGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    newGeo.computeBoundingSphere();
    pointsRef.current.geometry.dispose();
    pointsRef.current.geometry = newGeo;
  }, [density, wsStatus]);

  // ── Sync React state from local sim (100 ms poll — only when WS is offline) ───
  useEffect(() => {
    const id = setInterval(() => {
      if (wsLiveRef.current) return; // WS is live — it handles state updates
      const sim = localSimRef.current;
      if (!sim) return;
      setRobotState(sim.state);
      setDetections([...sim.detections]);
      setEventLog([...sim.eventLog]);
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ── Camera preset transitions ─────────────────────────────────────────────
  useEffect(() => {
    if (!cameraRef.current) return;
    if (camPreset === 'topdown') {
      orbitStateRef.current = { theta: 0, phi: 0.01, radius: 30 };
    } else {
      orbitStateRef.current = { theta: Math.PI / 5, phi: Math.PI / 4, radius: 28 };
    }
    applyOrbitState(cameraRef.current, orbitStateRef.current);
  }, [camPreset]);

  // ── Manual orbit (mouse drag) ─────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    isOrbitingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isOrbitingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    const state = orbitStateRef.current;
    state.theta -= dx * 0.008;
    state.phi    = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, state.phi + dy * 0.008));
    applyOrbitState(cameraRef.current, state);
  }, []);

  const handleMouseUp = useCallback(() => {
    isOrbitingRef.current = false;
  }, []);

  const handleWheel = useCallback((e) => {
    const state = orbitStateRef.current;
    state.radius = Math.max(8, Math.min(60, state.radius + e.deltaY * 0.05));
    applyOrbitState(cameraRef.current, state);
  }, []);

  const toggleZone = (id) => {
    setZoneVisible(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0a0d14', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>

      {/* ── 3D Canvas ─────────────────────────────────────────────────────── */}
      <div
        ref={mountRef}
        style={{ flex: 1, position: 'relative', cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* HUD overlay — top-left corner status badges */}
        <div style={{
          position: 'absolute', top: 12, left: 12, pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', gap: 4
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#00ffcc', opacity: 0.7 }}>◉ SLAM 3D LIVE</span>
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#8899aa' }}>Drag to orbit · Scroll to zoom · <span style={{color:'#00ffcc88'}}>Click robot for info</span></span>

          {/* WebSocket connection status badge — updates reactively via wsStatus state */}
          <span style={{
            fontFamily: 'monospace', fontSize: 9, marginTop: 4,
            color: wsStatus === 'live' ? '#00ffcc' : wsStatus === 'connecting' ? '#ffc107' : '#dc3545',
          }}>
            {wsStatus === 'live'       && '⬤ WS STREAM: LIVE (port 8001)'}
            {wsStatus === 'connecting' && '⬤ WS STREAM: CONNECTING...'}
            {wsStatus === 'offline'    && '⬤ WS STREAM: OFFLINE — local fallback'}
          </span>
        </div>

        {/* Robot position HUD — bottom left, state-aware color */}
        <div style={{
          position: 'absolute', bottom: 12, left: 12, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.5)', border: `1px solid ${STATE_COLORS[robotState] ?? '#00ffcc'}44`,
          borderRadius: 6, padding: '6px 10px', minWidth: 180,
        }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: STATE_COLORS[robotState] ?? '#00ffcc' }}>
            ■ UNITREE GO2 — {robotState}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#8899aa', marginTop: 2 }}>ZONE: HALLWAY</div>
          {detections.length > 0 && (
            <div style={{ marginTop: 4, borderTop: '1px solid #ff333333', paddingTop: 4 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#ff4444' }}>
                ⚠ {detections[0].id} · {detections[0].zone}
              </div>
              {detections[0].human_count > 0 && (
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#ff6666', marginTop: 2 }}>
                  👤 {detections[0].human_count} human(s) in restricted zone
                </div>
              )}
            </div>
          )}
          {detections.length === 0 && SIMULATED_HUMANS.length > 0 && (
            <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 8, color: '#ff444488' }}>
              {SIMULATED_HUMANS.length} humans in restricted zones
            </div>
          )}
        </div>

        {/* Event log panel — bottom right of canvas ────────────────────── */}
        <div style={{
          position: 'absolute', bottom: 12, right: 12, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.6)', border: '1px solid #1e2d3d',
          borderRadius: 6, padding: '8px 10px', width: 260,
        }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#556677', letterSpacing: 1.5, marginBottom: 5 }}>EVENT LOG</div>
          {eventLog.length === 0 && (
            <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#334 ' }}>Waiting for events...</div>
          )}
          {eventLog.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#445566', flexShrink: 0 }}>{ev.time}</span>
              <span style={{
                fontFamily: 'monospace', fontSize: 8,
                color: ev.msg.includes('BLOCKED') ? '#ff4444'
                     : ev.msg.includes('ALLOWED') ? '#00ff88'
                     : ev.msg.includes('POLICY')  ? '#ffcc00'
                     : '#8899aa',
              }}>{ev.msg}</span>
            </div>
          ))}
        </div>

        {/* ── Robot info popup (click the robot to open) ─────────────────── */}
        {robotInfoOpen && (
          <div style={{
            position:'absolute', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            background:'rgba(8,14,24,0.93)',
            border:`1px solid ${STATE_COLORS[robotState] ?? '#00ffcc'}66`,
            borderRadius:10, padding:'18px 22px', minWidth:265,
            backdropFilter:'blur(12px)',
            boxShadow:`0 0 30px ${STATE_COLORS[robotState] ?? '#00ffcc'}22`,
            zIndex:99, pointerEvents:'all',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <span style={{fontFamily:'monospace',fontSize:11,color:STATE_COLORS[robotState]??'#00ffcc',fontWeight:'bold',letterSpacing:1.5}}>
                ■ UNITREE GO2 EDU
              </span>
              <button onClick={()=>setRobotInfoOpen(false)} style={{background:'none',border:'none',color:'#556677',cursor:'pointer',fontFamily:'monospace',fontSize:14}}>✕</button>
            </div>
            {[
              ['Unit ID',  'GO2-EDU-001'],
              ['Status',   robotState],
              ['Position', `X:${robotStateRef.current.x.toFixed(1)}  Z:${robotStateRef.current.z.toFixed(1)}`],
              ['Zone',     detections.length>0 ? detections[0].zone : 'HALLWAY'],
              ['Battery',  '78%  ▓▓▓▓▓▓▓░░░'],
              ['LiDAR',    'Unitree L1 · 360° · 12m'],
              ['Camera',   'RealSense D435i · 30fps'],
              ['SDK',      wsStatus==='live' ? 'unitree_sdk2py (SIM)' : 'LOCAL FALLBACK'],
            ].map(([k,v])=>(
              <div key={k} style={{display:'flex',justifyContent:'space-between',marginBottom:7,gap:12}}>
                <span style={{fontFamily:'monospace',fontSize:8,color:'#445566',flexShrink:0}}>{k}</span>
                <span style={{fontFamily:'monospace',fontSize:8,textAlign:'right',
                  color: k==='Status' ? (STATE_COLORS[robotState]??'#00ffcc') : '#8899aa'}}>{v}</span>
              </div>
            ))}
            {detections.length>0&&(
              <div style={{marginTop:10,padding:'6px 8px',background:'rgba(255,50,50,0.08)',border:'1px solid #ff333344',borderRadius:5}}>
                <div style={{fontFamily:'monospace',fontSize:8,color:'#ff4444'}}>⚠ ACTIVE DETECTION</div>
                <div style={{fontFamily:'monospace',fontSize:8,color:'#8899aa',marginTop:3}}>
                  {detections[0].id} · {detections[0].zone} · {detections[0].verdict}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Control Panel Sidebar ─────────────────────────────────────────── */}
      <div style={{
        width: 230,
        background: '#0d1117',
        borderLeft: '1px solid #1e2d3d',
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        overflowY: 'auto',
        flexShrink: 0,
      }}>

        {/* Simulated RealSense camera feed with YOLO overlays */}
        <CameraPanel robotState={robotState} detections={detections} />

        {/* Header */}
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#00ffcc', letterSpacing: 2, marginBottom: 4 }}>■ SLAM CONTROLS</div>
          <div style={{ height: 1, background: 'linear-gradient(90deg,#00ffcc33,transparent)' }} />
        </div>

        {/* Camera Presets */}
        <div>
          <div style={labelStyle}>CAMERA PRESET</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              onClick={() => setCamPreset('topdown')}
              style={presetBtnStyle(camPreset === 'topdown')}
            >
              Top-Down<br /><span style={{ fontSize: 9, opacity: 0.7 }}>2D View</span>
            </button>
            <button
              onClick={() => setCamPreset('iso')}
              style={presetBtnStyle(camPreset === 'iso')}
            >
              Isometric<br /><span style={{ fontSize: 9, opacity: 0.7 }}>3D View</span>
            </button>
          </div>
        </div>

        {/* LiDAR Density Slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>LiDAR POINT DENSITY</div>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#00ffcc' }}>{density}%</span>
          </div>
          <input
            type="range" min={5} max={100} value={density}
            onChange={e => setDensity(Number(e.target.value))}
            style={{ width: '100%', marginTop: 8, accentColor: '#00ffcc', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#445', marginTop: 2, fontFamily: 'monospace' }}>
            <span>Sparse</span><span>Dense</span>
          </div>
        </div>

        {/* Zone Toggles */}
        <div>
          <div style={labelStyle}>SECURITY ZONES</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ZONE_DEFS.map(def => (
              <label
                key={def.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', padding: '5px 8px',
                  borderRadius: 4,
                  background: zoneVisible[def.id] ? `${hexToRgba(def.color, 0.08)}` : 'transparent',
                  border: `1px solid ${zoneVisible[def.id] ? hexToRgba(def.color, 0.35) : '#1e2d3d'}`,
                  transition: 'all 0.2s',
                }}
              >
                <input
                  type="checkbox"
                  checked={zoneVisible[def.id]}
                  onChange={() => toggleZone(def.id)}
                  style={{ accentColor: `#${def.color.toString(16).padStart(6, '0')}`, cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: `#${def.color.toString(16).padStart(6, '0')}`, fontWeight: 'bold' }}>
                    {def.id}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#556677' }}>{def.name}</div>
                </div>
                <div
                  style={{
                    marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
                    background: zoneVisible[def.id] ? `#${def.color.toString(16).padStart(6, '0')}` : '#334',
                    boxShadow: zoneVisible[def.id] ? `0 0 6px #${def.color.toString(16).padStart(6, '0')}` : 'none',
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #1e2d3d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ffcc', boxShadow: '0 0 6px #00ffcc' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#8899aa' }}>Unitree Go2 (Live)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 2, background: '#334466' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#8899aa' }}>LiDAR Point Cloud</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function applyOrbitState(camera, { theta, phi, radius }) {
  if (!camera) return;
  camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
  camera.position.y = radius * Math.cos(phi);
  camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
  camera.lookAt(0, 1, 0);
}

function hexToRgba(hex, alpha) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8)  & 0xff;
  const b =  hex        & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const labelStyle = {
  fontFamily: 'monospace',
  fontSize: 9,
  color: '#556677',
  letterSpacing: 1.5,
  textTransform: 'uppercase',
};

const presetBtnStyle = (active) => ({
  flex: 1,
  padding: '7px 4px',
  fontSize: 10,
  fontFamily: 'monospace',
  textAlign: 'center',
  cursor: 'pointer',
  borderRadius: 4,
  lineHeight: 1.5,
  border: active ? '1px solid #00ffcc' : '1px solid #1e2d3d',
  background: active ? 'rgba(0,255,204,0.1)' : '#0d1117',
  color: active ? '#00ffcc' : '#556677',
  transition: 'all 0.2s',
});

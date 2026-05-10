"""
slam_server.py  (Phase 2 — Real Hardware + Simulation Fallback)
───────────────────────────────────────────────────────────────
WebSocket + HTTP server streaming data from the Unitree Go2 Edu.

Endpoints:
  WS  /ws/slam-map       – binary point cloud + JSON robot state @ 10 FPS
  GET /camera/mjpeg      – MJPEG camera stream (real RealSense or synthetic)
  GET /camera/detections – latest YOLO bounding boxes as JSON

Run with:
    uvicorn slam_server:app --host 0.0.0.0 --port 8001

Hardware auto-detected at startup via robot_bridge.py.
Falls back to simulation if hardware is unavailable.
"""

import asyncio, json, math, datetime, time
from contextlib import asynccontextmanager
import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import sys
from functools import wraps

# ── Suppress Windows asyncio ConnectionResetError spam ─────────────────────────
if sys.platform == "win32":
    import asyncio.proactor_events
    def silence_event_loop_closed(func):
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            try:
                return func(self, *args, **kwargs)
            except ConnectionResetError:
                pass
        return wrapper
    asyncio.proactor_events._ProactorBasePipeTransport._call_connection_lost = silence_event_loop_closed(
        asyncio.proactor_events._ProactorBasePipeTransport._call_connection_lost
    )

# ── Import hardware bridge (graceful — won't crash if libs missing) ───────────
from robot_bridge import RobotBridge

# ─── Door / Zone Definitions ─────────────────────────────────────────────────
# Must match ZONE_DEFS / DOOR_DEFS in SlamMap3D.jsx
DOORS = [
    {"id": "DOOR-001", "x": -7.0, "z": -2.8, "zone": "SERVER_INFRA", "verdict": "BLOCKED"},
    {"id": "DOOR-002", "x": -0.5, "z": -2.8, "zone": "EXEC_OFFICE",  "verdict": "BLOCKED"},
    {"id": "DOOR-003", "x":  6.0, "z": -2.8, "zone": "BREAK_ROOM",   "verdict": "ALLOWED"},
]

# ─── Fake Humans in Restricted Zones (simulation data) ───────────────────────
# Each entry has a position inside a BLOCKED zone so the robot sees them and
# refuses to enter.  These are broadcast in the JSON frame and rendered by the
# frontend as red humanoid meshes inside the zone wireframes.
SIMULATED_HUMANS = [
    # SERVER_INFRA zone  (zone centre ≈ x=-7, z=-6)
    {"id": "HUMAN-001", "zone": "SERVER_INFRA", "x": -7.2, "y": 0.0, "z": -5.8, "label": "Technician"},
    {"id": "HUMAN-002", "zone": "SERVER_INFRA", "x": -6.1, "y": 0.0, "z": -6.4, "label": "Security"},
    # EXEC_OFFICE zone  (zone centre ≈ x=-0.5, z=-6)
    {"id": "HUMAN-003", "zone": "EXEC_OFFICE",  "x": -0.3, "y": 0.0, "z": -5.6, "label": "Executive"},
    {"id": "HUMAN-004", "zone": "EXEC_OFFICE",  "x":  0.6, "y": 0.0, "z": -6.7, "label": "Assistant"},
]

DETECTION_RADIUS = 1.8   # metres — robot stops this far from a door


# ─── Robot State Machine (simulation) ─────────────────────────────────────────
class RobotSimulator:
    """
    Simulates the Unitree Go2 patrolling a hallway.

    Patrol range x ∈ [-8.5, +8.5].  When the robot comes within
    DETECTION_RADIUS of a door it runs DETECTED → THINKING → BLOCKED/PASS.

    BLOCKED zones also have simulated humans.  The verdict field on each door
    determines whether the robot is allowed through after querying the policy
    gate.
    """

    def __init__(self):
        self.x         = -8.0
        self.z         = 0.0
        self.y         = 0.35
        self.direction = 1          # +1 = moving right, -1 = left
        self.heading   = math.pi / 2
        self.speed     = 2.0       # m/s (simulated)
        self.state     = "PATROLLING"
        self.state_timer   = 0.0
        self.active_door   = None
        self.target_zone   = None
        self.target_door   = None
        self.target_z      = 0.0
        self.direction_z   = 1
        self.detections    = []
        self.event_log     = []
        self._checked_doors: set = set()   # doors already processed this pass

    def set_target_zone(self, zone_id: str):
        door = next((d for d in DOORS if d["zone"] == zone_id), None)
        if door:
            self.target_zone = zone_id
            self.target_door = door
            self.state = "NAV_TO_DOOR"
            self.active_door = None
            self._log(f"[CMD] Navigating to {zone_id}")

    # ── Internal helpers ──────────────────────────────────────────────────────
    def _log(self, msg: str):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        self.event_log.insert(0, {"time": ts, "msg": msg})
        self.event_log = self.event_log[:10]

    def _humans_in_zone(self, zone_id: str) -> list:
        return [h for h in SIMULATED_HUMANS if h["zone"] == zone_id]

    # ── Update (called at 10 Hz from the WS loop) ─────────────────────────────
    def update(self, dt: float = 0.1):
        if self.state == "PATROLLING":
            self.x += self.speed * self.direction * dt
            # Gentle sine weave so the path isn't perfectly straight
            self.z = math.sin(self.x * 0.22) * 0.5

            # Check proximity to each door (only once per direction pass)
            for door in DOORS:
                if door["id"] in self._checked_doors:
                    continue
                dist = abs(self.x - door["x"])
                # Only trigger if robot is actively APPROACHING the door
                approaching = (
                    (self.direction > 0 and self.x < door["x"]) or
                    (self.direction < 0 and self.x > door["x"])
                )
                if dist < DETECTION_RADIUS and approaching:
                    humans = self._humans_in_zone(door["zone"])
                    self.state       = "DETECTED"
                    self.state_timer = 0.8
                    self.active_door = door
                    # Build detection payload
                    self.detections = [{
                        **door,
                        "human_count": len(humans),
                        "humans": [h["id"] for h in humans],
                        "type": "DOOR",
                    }]
                    reason = f"{len(humans)} human(s) detected" if humans else "policy check"
                    self._log(f"[SENSOR] {door['id']} → {door['zone']} ({reason})")
                    break

            # Reverse at corridor ends
            if   self.x >  8.5:
                self.direction = -1
                self.heading   = -math.pi / 2
                self._checked_doors.clear()
                self._log("[ROBOT] End of corridor — reversing")
            elif self.x < -8.5:
                self.direction =  1
                self.heading   =  math.pi / 2
                self._checked_doors.clear()
                self._log("[ROBOT] Start of corridor — reversing")

        elif self.state == "NAV_TO_DOOR":
            if not self.target_door:
                self.state = "PATROLLING"
                return
            dx = self.target_door["x"] - self.x
            if abs(dx) > 0.15:
                self.direction = 1 if dx > 0 else -1
                self.x += self.speed * self.direction * dt
                self.heading = math.pi / 2 if self.direction == 1 else -math.pi / 2
            else:
                self.x = self.target_door["x"]
                self.heading = 0 if self.target_door["z"] < 0 else math.pi
                self.state = "DETECTED"
                self.state_timer = 0.8
                self.active_door = self.target_door
                humans = self._humans_in_zone(self.target_door["zone"])
                self.detections = [{
                    **self.target_door,
                    "human_count": len(humans),
                    "humans": [h["id"] for h in humans],
                    "type": "DOOR",
                }]
                self._log(f"[SENSOR] {self.target_door['id']} → Policy check")

        elif self.state == "DETECTED":
            self.state_timer -= dt
            if self.state_timer <= 0:
                self.state       = "THINKING"
                self.state_timer = 2.2
                zone = self.active_door["zone"] if self.active_door else "?"
                self._log(f"[POLICY] Querying gate for {zone}...")

        elif self.state == "THINKING":
            self.state_timer -= dt
            if self.state_timer <= 0:
                verdict = self.active_door["verdict"] if self.active_door else "BLOCKED"
                zone    = self.active_door["zone"]    if self.active_door else "?"
                humans  = self._humans_in_zone(zone)

                # Humans in zone always force BLOCKED regardless of door verdict
                if humans:
                    verdict = "BLOCKED"
                    self._log(f"[POLICY] BLOCKED — {len(humans)} human(s) in {zone}")
                else:
                    self._log(f"[POLICY] Result: {verdict} — {zone}")

                if verdict == "BLOCKED":
                    self.state       = "BLOCKED"
                    self.state_timer = 2.0
                    if self.active_door:
                        self._checked_doors.add(self.active_door["id"])
                else:
                    if self.target_door and self.active_door and self.target_door["id"] == self.active_door["id"]:
                        self.state = "ENTERING_ROOM"
                        self.target_z = -6.0 if self.target_door["z"] < 0 else 6.0
                        self._log(f"[ROBOT] Access GRANTED — entering {zone}")
                    else:
                        self.state       = "PATROLLING"
                        self.detections  = []
                        if self.active_door:
                            self._checked_doors.add(self.active_door["id"])
                        self._log(f"[ROBOT] Access GRANTED — bypassing {zone}")

        elif self.state == "BLOCKED":
            self.state_timer -= dt
            if self.state_timer <= 0:
                self.state       = "PATROLLING"
                self.active_door = None
                self.target_door = None
                self.target_zone = None
                self.detections  = []
                self._log("[ROBOT] Resuming patrol — bypassing restricted area")
                
        elif self.state == "ENTERING_ROOM":
            dz = self.target_z - self.z
            if abs(dz) > 0.15:
                self.direction_z = 1 if dz > 0 else -1
                self.z += self.speed * self.direction_z * dt
            else:
                self.z = self.target_z
                self.state = "IN_ROOM"
                self.state_timer = 5.0
                self._log(f"[ROBOT] Inside {self.target_door['zone']}")
                
        elif self.state == "IN_ROOM":
            self.state_timer -= dt
            if self.state_timer <= 0:
                self.state = "EXITING_ROOM"
                self.target_z = 0.0
                self.heading = math.pi if self.z < 0 else 0
                self._log("[ROBOT] Exiting room")
                
        elif self.state == "EXITING_ROOM":
            dz = self.target_z - self.z
            if abs(dz) > 0.15:
                self.direction_z = 1 if dz > 0 else -1
                self.z += self.speed * self.direction_z * dt
            else:
                self.z = 0.0
                self.state = "PATROLLING"
                self.target_door = None
                self.target_zone = None
                self.direction = 1
                self.heading = math.pi / 2
                self._log("[ROBOT] Resuming hallway patrol")

    def to_dict(self) -> dict:
        return {
            "robot": {
                "x":       round(self.x, 3),
                "y":       self.y,
                "z":       round(self.z, 3),
                "heading": round(self.heading, 3),
                "state":   self.state,
                "source":  "SIMULATION",
            },
            "detections":       self.detections,
            "event_log":        self.event_log,
            "doors":            DOORS,
            "simulated_humans": SIMULATED_HUMANS,
        }


# ─── LiDAR Simulation ────────────────────────────────────────────────────────
def generate_room_lidar(n: int = 70000) -> np.ndarray:
    """Structured synthetic room scan — used when real LiDAR is not available."""
    parts = []
    nf = int(n * 0.55)
    parts.append(np.column_stack([
        np.random.uniform(-11, 11, nf),
        np.random.uniform(0.0, 0.12, nf),
        np.random.uniform(-9, 9, nf),
    ]))
    nw = (n - nf) // 4
    for axis, val in [(0, -11.), (0, 11.), (2, -9.), (2, 9.)]:
        w = np.random.uniform(-11, 11, (nw, 3))
        w[:, axis] = val + np.random.uniform(-0.08, 0.08, nw)
        w[:, 1]    = np.random.uniform(0.0, 3.6, nw)
        parts.append(w)
    return np.vstack(parts).astype(np.float32)


def voxel_downsample(pts: np.ndarray, voxel: float = 0.15) -> np.ndarray:
    idx = np.floor(pts / voxel).astype(np.int32)
    _, ui = np.unique(idx, axis=0, return_index=True)
    return pts[ui]


# ─── App + Bridge ─────────────────────────────────────────────────────────────
bridge = RobotBridge(network_interface="eth0", yolo_model="yolov8n.pt")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI modern lifespan — replaces deprecated on_event."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, bridge.start)
    print("[Server] Robot bridge initialised.")
    yield
    bridge.stop()
    print("[Server] Robot bridge stopped.")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


# ─── WebSocket — Point Cloud + Robot State ────────────────────────────────────
@app.websocket("/ws/slam-map")
async def slam_stream(websocket: WebSocket):
    await websocket.accept()
    print("[WS] Client connected.")
    robot_sim = RobotSimulator()

    async def _receive_loop():
        try:
            while True:
                msg = await websocket.receive_text()
                data = json.loads(msg)
                if data.get("type") == "GO_TO_ZONE":
                    robot_sim.set_target_zone(data.get("zone_id"))
        except Exception:
            pass

    recv_task = asyncio.create_task(_receive_loop())

    loop = asyncio.get_event_loop()
    last_time = time.time()

    try:
        while True:
            current_time = time.time()
            dt = current_time - last_time
            last_time = current_time
            dt = min(dt, 0.5)

            # ── 1. Robot state ────────────────────────────────────────────────
            hw_state = bridge.get_robot_state()

            if hw_state.get("mode") == "SDK":
                robot_sim.x       = hw_state["x"]
                robot_sim.z       = hw_state["z"]
                robot_sim.heading = hw_state["heading"]
                robot_sim.update(dt=dt)
                state_dict = robot_sim.to_dict()
                state_dict["robot"].update({
                    "speed":   hw_state.get("speed", 0),
                    "battery": hw_state.get("battery", 78),
                    "source":  "SDK",
                })
            else:
                robot_sim.update(dt=dt)
                state_dict = robot_sim.to_dict()

            # Merge live YOLO detections from bridge (camera) if any
            live_dets = bridge.get_detections()
            if live_dets:
                state_dict["yolo_detections"] = live_dets

            # ── 2. Send JSON state frame ──────────────────────────────────────
            await websocket.send_text(json.dumps(state_dict))

            # ── 3. Point cloud ────────────────────────────────────────────────
            hw_cloud = bridge.get_point_cloud()
            if len(hw_cloud) > 100:
                filtered = await loop.run_in_executor(None, voxel_downsample, hw_cloud, 0.12)
            else:
                raw      = await loop.run_in_executor(None, generate_room_lidar, 70000)
                filtered = await loop.run_in_executor(None, voxel_downsample, raw, 0.15)

            await websocket.send_bytes(filtered.tobytes())

            # ── 4. 10 FPS ─────────────────────────────────────────────────────
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        print("[WS] Client disconnected.")
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        recv_task.cancel()


# ─── MJPEG Camera Stream ──────────────────────────────────────────────────────
async def _mjpeg_generator():
    boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
    while True:
        frame = bridge.get_camera_frame()
        if frame:
            yield boundary + frame + b"\r\n"
        await asyncio.sleep(0.033)   # ~30 FPS


@app.get("/camera/mjpeg")
async def camera_mjpeg():
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
    )


# ─── YOLO Detections JSON ─────────────────────────────────────────────────────
@app.get("/camera/detections")
async def camera_detections():
    return {"detections": bridge.get_detections(), "ts": time.time()}


# ─── Simulated Humans JSON ────────────────────────────────────────────────────
@app.get("/humans")
async def get_simulated_humans():
    """Expose the static fake-human list so frontends can pre-load it."""
    return {"humans": SIMULATED_HUMANS}

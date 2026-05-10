"""
robot_bridge.py
───────────────
Hardware abstraction layer for the Unitree Go2 Edu.

Wraps three hardware sources:
  1. unitree_sdk2py  – robot state (battery, joints, speed, position via odometry)
  2. pyrealsense2    – Intel RealSense D435i RGB + depth frames
  3. ultralytics     – YOLOv8 real-time object detection on the RGB stream

Every import is guarded so the server starts successfully even when:
  - The SDK is not installed / robot not connected
  - No RealSense camera is attached
  - ultralytics / GPU not available

In all fallback cases the bridge signals SIMULATION_MODE and
slam_server.py uses its synthetic generators instead.

Run with:
    uvicorn slam_server:app --host 0.0.0.0 --port 8001
"""

import threading
import time
import math
import numpy as np

# ─── Optional: Unitree SDK2 ───────────────────────────────────────────────────
try:
    from unitree_sdk2py.core.channel import (
        ChannelSubscriber, ChannelFactory
    )
    from unitree_sdk2py.idl.unitree_go.msg.dds_ import (
        SportModeState_ as SportModeState,
        LowState_       as LowState,
    )
    from unitree_sdk2py.idl.sensor_msgs.msg.dds_ import PointCloud2_ as PointCloud2
    SDK_AVAILABLE = True
    print("[Bridge] unitree_sdk2py found — SDK mode enabled.")
except ImportError:
    SDK_AVAILABLE = False
    print("[Bridge] unitree_sdk2py not found — robot state will be simulated.")

# ─── Optional: Intel RealSense ───────────────────────────────────────────────
try:
    import pyrealsense2 as rs
    REALSENSE_AVAILABLE = True
    print("[Bridge] pyrealsense2 found — attempting camera connection.")
except ImportError:
    REALSENSE_AVAILABLE = False
    print("[Bridge] pyrealsense2 not found — camera feed will be simulated.")

# ─── Optional: YOLOv8 via ultralytics ────────────────────────────────────────
try:
    from ultralytics import YOLO as _YOLO
    import cv2
    YOLO_AVAILABLE = True
    print("[Bridge] ultralytics found — YOLOv8 detection enabled.")
except ImportError:
    YOLO_AVAILABLE = False
    print("[Bridge] ultralytics not found — detections will be simulated.")

# OpenCV needed for image encoding even in simulation
try:
    import cv2 as _cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("[Bridge] opencv-python not found — install it for camera encoding.")


# ─── RobotBridge ─────────────────────────────────────────────────────────────
class RobotBridge:
    """
    Single entry point for all hardware data.

    Usage:
        bridge = RobotBridge()
        bridge.start()           # begins background threads
        state  = bridge.get_robot_state()
        cloud  = bridge.get_point_cloud()
        frame  = bridge.get_camera_frame()   # JPEG bytes or None
        dets   = bridge.get_detections()
        bridge.stop()
    """

    def __init__(self, network_interface: str = "eth0", yolo_model: str = "yolov8n.pt"):
        self._lock        = threading.Lock()
        self._running     = False

        # ── Robot state snapshot (updated by SDK subscriber or simulation) ──
        self._robot_state = {
            "x": 0.0, "y": 0.0, "z": 0.35,
            "heading":  0.0,
            "speed":    0.0,
            "battery":  78,       # %
            "mode":     "SIMULATED",
        }

        # ── Point cloud buffer (N×3 float32) ────────────────────────────────
        self._point_cloud: np.ndarray = np.zeros((0, 3), dtype=np.float32)

        # ── Camera frame (JPEG bytes) ────────────────────────────────────────
        self._camera_frame: bytes | None = None

        # ── YOLO detections list ─────────────────────────────────────────────
        self._detections: list[dict] = []

        # ── Hardware handles ─────────────────────────────────────────────────
        self._rs_pipeline = None
        self._yolo_model  = None
        self._network_if  = network_interface
        self._yolo_path   = yolo_model

    # ── Start ─────────────────────────────────────────────────────────────────
    def start(self):
        self._running = True

        # Unitree SDK subscriber
        if SDK_AVAILABLE:
            self._start_sdk()

        # RealSense pipeline
        if REALSENSE_AVAILABLE:
            self._start_realsense()

        # YOLOv8 model load
        if YOLO_AVAILABLE:
            self._load_yolo()

        # Camera + YOLO loop (background thread)
        t = threading.Thread(target=self._camera_loop, daemon=True)
        t.start()

    # ── Stop ──────────────────────────────────────────────────────────────────
    def stop(self):
        self._running = False
        if self._rs_pipeline:
            try: self._rs_pipeline.stop()
            except Exception: pass

    # ── Public getters ────────────────────────────────────────────────────────
    def get_robot_state(self) -> dict:
        with self._lock:
            return dict(self._robot_state)

    def get_point_cloud(self) -> np.ndarray:
        """Returns the latest point cloud as float32 (N, 3) array."""
        with self._lock:
            return self._point_cloud.copy() if len(self._point_cloud) else np.zeros((0,3), dtype=np.float32)

    def get_camera_frame(self) -> bytes | None:
        """Returns the latest JPEG-encoded RGB frame, or None."""
        with self._lock:
            return self._camera_frame

    def get_detections(self) -> list[dict]:
        with self._lock:
            return list(self._detections)

    # ── SDK setup ─────────────────────────────────────────────────────────────
    def _start_sdk(self):
        try:
            ChannelFactory.Instance().Init(0, self._network_if)

            # Subscribe to SportModeState (position, speed, mode)
            sub_sport = ChannelSubscriber("rt/sportmodestate", SportModeState)
            sub_sport.Init(self._on_sport_state, 10)

            # Subscribe to LowState (battery, joint positions)
            sub_low = ChannelSubscriber("rt/lowstate", LowState)
            sub_low.Init(self._on_low_state, 10)

            print("[Bridge] SDK subscribers registered.")
        except Exception as e:
            print(f"[Bridge] SDK init failed: {e} — falling back to simulation.")

    def _on_sport_state(self, msg: "SportModeState"):
        with self._lock:
            pos = msg.position          # [x, y, z]
            self._robot_state.update({
                "x":       pos[0],
                "y":       pos[2],      # z in ROS = height
                "z":       pos[1],
                "heading": msg.imu_state.rpy[2],   # yaw
                "speed":   math.sqrt(msg.velocity[0]**2 + msg.velocity[1]**2),
                "mode":    "SDK",
            })

    def _on_low_state(self, msg: "LowState"):
        with self._lock:
            # Battery reported as 0–1 voltage fraction; scale to %
            batt = int(msg.bms_state.soc)
            self._robot_state["battery"] = batt

    # ── RealSense setup ───────────────────────────────────────────────────────
    def _start_realsense(self):
        try:
            pipeline = rs.pipeline()
            cfg      = rs.config()
            cfg.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
            cfg.enable_stream(rs.stream.depth, 640, 480, rs.format.z16,  30)
            pipeline.start(cfg)
            self._rs_pipeline = pipeline
            print("[Bridge] RealSense D435i started (640×480 @ 30fps).")
        except Exception as e:
            print(f"[Bridge] RealSense start failed: {e} — camera will be simulated.")
            self._rs_pipeline = None

    # ── YOLO load ─────────────────────────────────────────────────────────────
    def _load_yolo(self):
        try:
            self._yolo_model = _YOLO(self._yolo_path)
            print(f"[Bridge] YOLOv8 model loaded: {self._yolo_path}")
        except Exception as e:
            print(f"[Bridge] YOLO load failed: {e}")
            self._yolo_model = None

    # ── Camera + YOLO loop ────────────────────────────────────────────────────
    def _camera_loop(self):
        """Background thread: capture frame → YOLO → encode JPEG → store."""
        if not CV2_AVAILABLE:
            print("[Bridge] cv2 unavailable — camera loop disabled.")
            return
        import cv2

        while self._running:
            try:
                if self._rs_pipeline:
                    # ── Real RealSense frame ──────────────────────────────────
                    frames = self._rs_pipeline.wait_for_frames(timeout_ms=200)
                    color_frame = frames.get_color_frame()
                    if not color_frame:
                        time.sleep(0.033)
                        continue
                    bgr = np.asanyarray(color_frame.get_data())
                else:
                    # ── Synthetic frame (dark corridor render) ────────────────
                    bgr = self._render_synthetic_frame()

                # ── YOLOv8 inference ─────────────────────────────────────────
                detections = []
                if self._yolo_model is not None:
                    results = self._yolo_model.predict(bgr, verbose=False, conf=0.4)[0]
                    for box in results.boxes:
                        x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                        cls_id   = int(box.cls[0])
                        label    = results.names[cls_id]
                        conf     = float(box.conf[0])
                        color    = (0, 255, 120)
                        # Draw on frame
                        cv2.rectangle(bgr, (x1, y1), (x2, y2), color, 2)
                        cv2.putText(bgr, f"{label} {conf:.2f}", (x1, y1 - 6),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
                        detections.append({"label": label, "conf": round(conf, 2),
                                           "box": [x1, y1, x2, y2]})

                # ── Encode to JPEG ────────────────────────────────────────────
                _, jpg = cv2.imencode('.jpg', bgr, [cv2.IMWRITE_JPEG_QUALITY, 70])
                with self._lock:
                    self._camera_frame = jpg.tobytes()
                    self._detections   = detections

            except Exception as e:
                print(f"[Bridge] Camera loop error: {e}")
                time.sleep(0.1)

            time.sleep(0.033)   # ~30 FPS cap

    # ── Synthetic frame renderer ──────────────────────────────────────────────
    def _render_synthetic_frame(self) -> np.ndarray:
        """
        Draws a minimal corridor first-person view using OpenCV when
        no real camera is available. This keeps the MJPEG endpoint alive
        so the React frontend can always connect.
        """
        import cv2
        W, H = 640, 480
        frame = np.zeros((H, W, 3), dtype=np.uint8)

        # Sky / ceiling
        frame[:H//2, :] = (12, 18, 10)
        # Floor
        frame[H//2:, :] = (8, 20, 12)
        # Horizon strip
        frame[H//2 - 8 : H//2 + 8, :] = (20, 35, 25)

        # Vanishing point lines
        vx, vy = W // 2, H // 2
        for px, py in [(0,0),(0,H//3),(0,2*H//3),(0,H),(W,0),(W,H//3),(W,2*H//3),(W,H)]:
            cv2.line(frame, (px, py), (vx, vy), (30, 55, 40), 1)

        # Timestamp + label
        ts = time.strftime("%H:%M:%S")
        cv2.putText(frame, f"CAM: REALSENSE D435i (SIM)  {ts}",
                    (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 140), 1)
        cv2.putText(frame, "CONNECT HARDWARE TO ENABLE LIVE FEED",
                    (W//2 - 160, H//2 + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60, 90, 70), 1)
        return frame

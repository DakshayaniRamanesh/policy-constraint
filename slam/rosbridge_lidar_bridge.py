#!/usr/bin/env python3
"""
ASCAR-E Rosbridge LiDAR Bridge
================================
Connects to the Unitree Go2 via its rosbridge websocket (port 9090)
instead of requiring local ROS 2 DDS discovery. Works perfectly over
wired Ethernet (RJ45) where DDS multicast can fail.

Pipeline:
  Go2 rosbridge WS (port 9090)
    → /utlidar/cloud_deskewed  (PointCloud2 as base64 JSON)
    → decode binary → numpy (N,3)
    → outlier + range filter
    → Open3D voxel downsample
    → MQTT JSON → ascar/lidar
    → batch_recorder.py  / blender_mcp.py

Usage:
  python3 rosbridge_lidar_bridge.py
  python3 rosbridge_lidar_bridge.py --host 192.168.123.18 --topic /utlidar/cloud_deskewed
"""

import argparse
import base64
import json
import struct
import threading
import time
import socket
import hashlib
import numpy as np

import paho.mqtt.client as mqtt
from paho.mqtt.client import CallbackAPIVersion

try:
    import open3d as o3d
    OPEN3D_AVAILABLE = True
except Exception:
    OPEN3D_AVAILABLE = False
    print("⚠  open3d unavailable (numpy/import conflict) — using built-in grid decimation")

# ── Configuration ──────────────────────────────────────────────────────────────
DEFAULT_HOST        = "192.168.123.18"
DEFAULT_PORT        = 9090
DEFAULT_TOPIC       = "/utlidar/cloud_deskewed"
MQTT_BROKER         = "127.0.0.1"
MQTT_PORT           = 1883
MQTT_TOPIC          = "ascar/lidar"
MAX_RANGE           = 30.0   # metres — Hesai XT16 max range
VOXEL_SIZE          = 0.05   # metres — 5 cm voxels
LOG_EVERY_N_FRAMES  = 5
# ───────────────────────────────────────────────────────────────────────────────


class WebSocketClient:
    """Minimal, dependency-free WebSocket client (no websockets lib needed)."""

    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.sock = None
        self._recv_buf = b""

    def connect(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(10)
        self.sock.connect((self.host, self.port))

        # WebSocket upgrade handshake
        raw_key = b"antigravity_ascar_bridge"
        key = base64.b64encode(raw_key).decode()
        handshake = (
            f"GET / HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(handshake.encode())

        # Read until we get the full HTTP response header
        while b"\r\n\r\n" not in self._recv_buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("Connection closed during handshake")
            self._recv_buf += chunk

        # Split off the HTTP headers, leave any leftover data in buffer
        header_end = self._recv_buf.index(b"\r\n\r\n") + 4
        headers = self._recv_buf[:header_end].decode("utf-8", errors="ignore")
        self._recv_buf = self._recv_buf[header_end:]

        if "101 Switching Protocols" not in headers:
            raise ConnectionError(f"WS upgrade failed:\n{headers}")

        # Switch to blocking with longer timeout for streaming data
        self.sock.settimeout(30)

    def send_text(self, message: str):
        """Send a WebSocket text frame (opcode 0x1), client→server (masked)."""
        data = message.encode("utf-8")
        length = len(data)
        frame = bytearray()
        frame.append(0x81)  # FIN=1, opcode=text

        if length < 126:
            frame.append(0x80 | length)
        elif length < 65536:
            frame.append(0x80 | 126)
            frame.extend(struct.pack(">H", length))
        else:
            frame.append(0x80 | 127)
            frame.extend(struct.pack(">Q", length))

        # Masking key (required for client→server)
        mask = bytes([0x37, 0x42, 0x13, 0x27])
        frame.extend(mask)
        frame.extend(bytes(b ^ m for b, m in zip(data, mask * (length // 4 + 1))))
        self.sock.sendall(bytes(frame))

    def recv_frame(self) -> bytes:
        """Read one complete WebSocket frame and return its payload."""
        def read_exactly(n):
            buf = b""
            while len(buf) < n:
                if self._recv_buf:
                    take = min(n - len(buf), len(self._recv_buf))
                    buf += self._recv_buf[:take]
                    self._recv_buf = self._recv_buf[take:]
                else:
                    chunk = self.sock.recv(65536)
                    if not chunk:
                        raise ConnectionError("Connection closed mid-frame")
                    self._recv_buf += chunk
            return buf

        # Read header (2 bytes minimum)
        header = read_exactly(2)
        # fin = (header[0] & 0x80) != 0
        opcode = header[0] & 0x0F
        masked = (header[1] & 0x80) != 0
        length = header[1] & 0x7F

        if length == 126:
            length = struct.unpack(">H", read_exactly(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", read_exactly(8))[0]

        mask_key = read_exactly(4) if masked else b""
        payload = bytearray(read_exactly(length))

        if masked:
            for i in range(length):
                payload[i] ^= mask_key[i % 4]

        if opcode == 0x8:  # close frame
            raise ConnectionError("Server sent WebSocket close frame")
        if opcode == 0x9:  # ping
            self.send_pong(bytes(payload))
            return self.recv_frame()  # recurse to get real frame

        return bytes(payload)

    def send_pong(self, payload: bytes):
        frame = bytearray([0x8A, len(payload)]) + bytearray(payload)
        self.sock.sendall(bytes(frame))

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass


def decode_pointcloud2(ros_msg: dict) -> np.ndarray:
    """
    Decode a ROS 2 PointCloud2 message (as delivered by rosbridge JSON).
    rosbridge encodes the binary 'data' field as a base64 string.
    Returns a (N, 3) float64 numpy array of [x, y, z] points.
    """
    fields = {f["name"]: f for f in ros_msg.get("fields", [])}

    # Offsets for x, y, z within each point
    x_off = fields["x"]["offset"]
    y_off = fields["y"]["offset"]
    z_off = fields["z"]["offset"]
    point_step = ros_msg["point_step"]
    width = ros_msg["width"]
    height = ros_msg["height"]
    n_points = width * height

    # The binary blob
    raw_b64 = ros_msg.get("data", "")
    raw = base64.b64decode(raw_b64)

    pts = np.empty((n_points, 3), dtype=np.float32)
    for i in range(n_points):
        base = i * point_step
        pts[i, 0] = struct.unpack_from("<f", raw, base + x_off)[0]
        pts[i, 1] = struct.unpack_from("<f", raw, base + y_off)[0]
        pts[i, 2] = struct.unpack_from("<f", raw, base + z_off)[0]

    return pts.astype(np.float64)


class RosbridgeLidarBridge:
    def __init__(self, host, port, lidar_topic, voxel_size, max_range):
        self.host = host
        self.port = port
        self.lidar_topic = lidar_topic
        self.voxel_size = voxel_size
        self.max_range = max_range
        self.frame_count = 0
        self.ws = None

        # MQTT setup
        self.mqtt_client = mqtt.Client(CallbackAPIVersion.VERSION1)
        self.mqtt_client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        self.mqtt_client.loop_start()
        print(f"✅  MQTT connected to {MQTT_BROKER}:{MQTT_PORT} → topic '{MQTT_TOPIC}'")

    def run(self):
        print(f"\n{'='*60}")
        print(f"  ASCAR-E Rosbridge LiDAR Bridge")
        print(f"{'='*60}")
        print(f"  Go2 rosbridge : ws://{self.host}:{self.port}")
        print(f"  LiDAR topic   : {self.lidar_topic}")
        print(f"  Max range     : {self.max_range} m")
        print(f"  Voxel size    : {self.voxel_size} m")
        print(f"  MQTT out      : {MQTT_BROKER}:{MQTT_PORT} → {MQTT_TOPIC}")
        print(f"{'='*60}\n")

        while True:
            try:
                self._connect_and_stream()
            except (ConnectionError, OSError, TimeoutError) as e:
                print(f"⚠  Connection lost: {e}. Reconnecting in 3 s…")
                time.sleep(3)
            except KeyboardInterrupt:
                print("\nStopping bridge.")
                self.mqtt_client.loop_stop()
                if self.ws:
                    self.ws.close()
                break

    def _connect_and_stream(self):
        self.ws = WebSocketClient(self.host, self.port)
        self.ws.connect()
        print(f"🔗  WebSocket connected to {self.host}:{self.port}")

        # Subscribe to the LiDAR topic via rosbridge protocol
        subscribe_msg = json.dumps({
            "op": "subscribe",
            "id": "ascar_lidar_sub",
            "topic": self.lidar_topic,
            "type": "sensor_msgs/msg/PointCloud2",
            "throttle_rate": 100,   # ms — limit to ~10 Hz max
            "queue_length": 1,       # only latest frame
            "compression": "none"    # we need raw base64 binary
        })
        self.ws.send_text(subscribe_msg)
        print(f"📡  Subscribed to {self.lidar_topic} — waiting for data…\n")

        while True:
            raw = self.ws.recv_frame()
            try:
                msg = json.loads(raw.decode("utf-8", errors="ignore"))
            except json.JSONDecodeError:
                continue

            if msg.get("op") != "publish":
                continue

            ros_msg = msg.get("msg", {})
            self._process_frame(ros_msg)

    def _process_frame(self, ros_msg: dict):
        self.frame_count += 1

        # ── Decode ──────────────────────────────────────────────────────
        try:
            pts = decode_pointcloud2(ros_msg)
        except Exception as e:
            print(f"⚠  Decode error frame {self.frame_count}: {e}")
            return

        if len(pts) == 0:
            return

        # ── Filter ──────────────────────────────────────────────────────
        finite_mask = np.all(np.isfinite(pts), axis=1)
        range_mask  = np.linalg.norm(pts, axis=1) < self.max_range
        pts = pts[finite_mask & range_mask]

        if len(pts) == 0:
            return

        # ── Voxel downsample ────────────────────────────────────────────
        if OPEN3D_AVAILABLE:
            cloud = o3d.geometry.PointCloud()
            cloud.points = o3d.utility.Vector3dVector(pts)
            try:
                downsampled = cloud.voxel_down_sample(voxel_size=self.voxel_size)
                compressed = np.asarray(downsampled.points).tolist()
            except RuntimeError as e:
                print(f"⚠  Voxel error: {e}")
                return
        else:
            # Fallback: simple grid-based decimation without open3d
            grid = np.floor(pts / self.voxel_size).astype(int)
            _, unique_idx = np.unique(grid, axis=0, return_index=True)
            compressed = pts[unique_idx].tolist()

        # ── Publish to MQTT ─────────────────────────────────────────────
        stamp = ros_msg.get("header", {}).get("stamp", {})
        payload = json.dumps({
            "stamp_sec":  stamp.get("sec", 0),
            "stamp_nsec": stamp.get("nanosec", 0),
            "frame_id":   ros_msg.get("header", {}).get("frame_id", "lidar"),
            "n_raw":      len(pts),
            "points":     compressed
        })
        self.mqtt_client.publish(MQTT_TOPIC, payload, qos=0)

        # ── Log ─────────────────────────────────────────────────────────
        if self.frame_count % LOG_EVERY_N_FRAMES == 0:
            ratio = 100.0 * len(compressed) / len(pts) if len(pts) else 0
            print(f"  Frame {self.frame_count:5d} | "
                  f"{len(pts):6d} raw → {len(compressed):4d} compressed "
                  f"({ratio:.1f}%) | MQTT ✓")


def main():
    parser = argparse.ArgumentParser(description="ASCAR-E Rosbridge LiDAR Bridge")
    parser.add_argument("--host",    default=DEFAULT_HOST,  help="Go2 IP address")
    parser.add_argument("--port",    default=DEFAULT_PORT,  type=int, help="Rosbridge port")
    parser.add_argument("--topic",   default=DEFAULT_TOPIC, help="LiDAR ROS topic")
    parser.add_argument("--voxel",   default=VOXEL_SIZE,   type=float, help="Voxel size (m)")
    parser.add_argument("--maxrange",default=MAX_RANGE,    type=float, help="Max range (m)")
    args = parser.parse_args()

    bridge = RosbridgeLidarBridge(
        host=args.host,
        port=args.port,
        lidar_topic=args.topic,
        voxel_size=args.voxel,
        max_range=args.maxrange
    )
    bridge.run()


if __name__ == "__main__":
    main()

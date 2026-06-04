#!/usr/bin/env python3
"""
ASCAR-E LiDAR → MQTT Bridge
================================
Project : ASCAR-E  —  Real-time 3D SLAM → Blender MCP procedural geometry
Robot   : Unitree Go2 (production) | TurtleBot4/OAK-D (simulation proving ground)

Pipeline:
  Robot LiDAR  →  ROS 2 PointCloud2  →  this node
  →  outlier filter  →  voxel-downsample (Open3D)
  →  MQTT JSON  →  batch_recorder.py  →  .json batches on disk
  →  [Phase 3] Blender MCP  →  RANSAC / piecewise  →  procedural walls + rooms

All tuning parameters are exposed as ROS 2 parameters so the SAME binary
works for both simulation and the real Go2 without recompiling.

SIMULATION  (TurtleBot4 / OAK-D depth camera):
  ros2 run ascar_ros_bridge bridge

REAL ROBOT  (Unitree Go2 / Hesai XT16 LiDAR):
  ros2 run ascar_ros_bridge bridge --ros-args \\
      -p lidar_topic:=rt/utlidar/cloud_deskewed \\
      -p max_range:=30.0 \\
      -p voxel_size:=0.05
"""

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import PointCloud2
import sensor_msgs_py.point_cloud2 as pc2

import paho.mqtt.client as mqtt
from paho.mqtt.client import CallbackAPIVersion
import open3d as o3d
import numpy as np
import json


class AscarelidarBridge(Node):
    def __init__(self):
        super().__init__('ascar_lidar_bridge')

        # ── ROS 2 Parameters ──────────────────────────────────────────────
        # Declare with simulation defaults.  Override at launch for Go2.
        self.declare_parameter(
            'lidar_topic',
            '/oakd/rgb/preview/depth/points'    # sim default (TurtleBot4 OAK-D)
            # Go2 real robot: 'rt/utlidar/cloud_deskewed'
        )
        self.declare_parameter(
            'max_range',
            10.0        # metres — 10 m for sim depth cam; 30.0 for Go2 XT16
        )
        self.declare_parameter(
            'voxel_size',
            0.05        # metres — 5 cm voxels (good balance for both)
        )
        self.declare_parameter(
            'mqtt_host',
            '127.0.0.1'
        )
        self.declare_parameter(
            'mqtt_port',
            1883
        )
        self.declare_parameter(
            'mqtt_topic',
            'ascar/lidar'
        )
        self.declare_parameter(
            'log_every_n_frames',
            5           # throttle log output so terminal stays readable
        )

        # Read parameters
        lidar_topic  = self.get_parameter('lidar_topic').value
        self.max_range   = self.get_parameter('max_range').value
        self.voxel_size  = self.get_parameter('voxel_size').value
        mqtt_host    = self.get_parameter('mqtt_host').value
        mqtt_port    = self.get_parameter('mqtt_port').value
        self.mqtt_topic  = self.get_parameter('mqtt_topic').value
        self._log_every  = self.get_parameter('log_every_n_frames').value
        self._frame_count = 0

        # ── Print startup summary ─────────────────────────────────────────
        self.get_logger().info("=" * 55)
        self.get_logger().info("  ASCAR-E LiDAR Bridge — starting up")
        self.get_logger().info("=" * 55)
        self.get_logger().info(f"  LiDAR topic : {lidar_topic}")
        self.get_logger().info(f"  Max range   : {self.max_range} m")
        self.get_logger().info(f"  Voxel size  : {self.voxel_size} m ({int(self.voxel_size*100)} cm cubes)")
        self.get_logger().info(f"  MQTT broker : {mqtt_host}:{mqtt_port}  →  '{self.mqtt_topic}'")
        self.get_logger().info("=" * 55)

        # ── ROS 2 Subscriber ──────────────────────────────────────────────
        self.subscription = self.create_subscription(
            PointCloud2,
            lidar_topic,
            self.lidar_callback,
            10
        )

        # ── MQTT Client ───────────────────────────────────────────────────
        self.mqtt_client = mqtt.Client(CallbackAPIVersion.VERSION1)
        try:
            self.mqtt_client.connect(mqtt_host, mqtt_port, keepalive=60)
            # CRITICAL: start background network thread.
            # Without loop_start(), publish() queues the packet but it is never
            # flushed to the socket while rclpy.spin() owns the main thread.
            self.mqtt_client.loop_start()
            self.get_logger().info("Connected to MQTT broker ✓")
        except Exception as e:
            self.get_logger().error(
                f"MQTT connection failed: {e}\n"
                f"  → Is Mosquitto running?  sudo systemctl start mosquitto"
            )

    # ─────────────────────────────────────────────────────────────────────
    def lidar_callback(self, msg: PointCloud2):
        """
        Fires every time the robot publishes a new LiDAR / depth frame.

        Full pipeline:
          ROS PointCloud2
            → numpy structured array (pc2.read_points)
            → plain (N,3) float64 (unpack numpy.void fields)
            → outlier filter  (finite-value + range gate)
            → voxel downsample (Open3D)
            → JSON  →  MQTT publish
        """
        self._frame_count += 1

        # ── STEP 1: Deserialise ───────────────────────────────────────────
        # skip_nans drops pixels the sensor could not range (sky, max-range)
        raw_gen    = pc2.read_points(msg, field_names=("x", "y", "z"), skip_nans=True)
        structured = np.array(list(raw_gen))

        if len(structured) == 0:
            return  # completely empty frame

        # ── STEP 2: Unpack structured array → plain (N,3) float64 ─────────
        # pc2.read_points returns numpy.void records (C-struct-like).
        # Open3D requires a plain 2-D float array, so we extract each field.
        pts = np.empty((structured.shape[0], 3), dtype=np.float64)
        pts[:, 0] = structured['x']
        pts[:, 1] = structured['y']
        pts[:, 2] = structured['z']

        # ── STEP 3: Outlier / range filter ────────────────────────────────
        # Problem: some depth sensors emit "ghost" points for failed pixels
        # as huge-but-finite floats (1e10 …) rather than NaN.  A single such
        # point expands the cloud's bounding box to 1e10 m, making Open3D's
        # voxel grid integer-overflow → RuntimeError "voxel_size is too small".
        #
        # Fix A) finite mask  — drop any Inf that survived skip_nans
        # Fix B) range gate   — drop points beyond MAX_RANGE (physically impossible)
        finite_mask = np.all(np.isfinite(pts), axis=1)
        range_mask  = np.linalg.norm(pts, axis=1) < self.max_range
        pts         = pts[finite_mask & range_mask]

        if len(pts) == 0:
            if self._frame_count % self._log_every == 0:
                self.get_logger().warn("Frame had only outlier / OOR points — skipped.")
            return

        # ── STEP 4: Voxel downsampling (compression) ──────────────────────
        # Overlays a 3-D grid; all points inside each voxel cell collapse into
        # one representative point.  This is the core compression step that
        # makes the data transmittable over university Wi-Fi at real-time rates.
        #
        # Sim  (OAK-D, ~15 k pts/frame, 6 Hz):  30 k pts → ~600 pts at 5 cm
        # Go2  (XT16,  ~30 k pts/frame, 10 Hz): 30 k pts → ~2000 pts at 5 cm
        o3d_cloud = o3d.geometry.PointCloud()
        o3d_cloud.points = o3d.utility.Vector3dVector(pts)

        try:
            downsampled = o3d_cloud.voxel_down_sample(voxel_size=self.voxel_size)
        except RuntimeError as e:
            self.get_logger().warn(f"Voxel downsample skipped (degenerate frame): {e}")
            return

        compressed = np.asarray(downsampled.points).tolist()

        # ── STEP 5: Serialise → MQTT ──────────────────────────────────────
        # Include the ROS stamp so batch_recorder can align frames by real time
        # even if Wi-Fi reorders MQTT messages.
        payload = json.dumps({
            "stamp_sec":  msg.header.stamp.sec,
            "stamp_nsec": msg.header.stamp.nanosec,
            "frame_id":   msg.header.frame_id,
            "n_raw":      len(pts),
            "points":     compressed          # [[x,y,z], [x,y,z], ...]
        })

        self.mqtt_client.publish(self.mqtt_topic, payload, qos=0)
        # qos=0 = "fire and forget" — fine because the next frame arrives in
        # 50–100 ms anyway.  Higher QoS would add latency with no benefit.

        # ── Throttled log ─────────────────────────────────────────────────
        if self._frame_count % self._log_every == 0:
            ratio = 100.0 * len(compressed) / len(pts) if len(pts) else 0
            self.get_logger().info(
                f"Frame {self._frame_count:5d} | "
                f"{len(pts):6d} raw pts → {len(compressed):4d} compressed "
                f"({ratio:.1f}%) | MQTT ✓"
            )


# ─────────────────────────────────────────────────────────────────────────────
def main(args=None):
    rclpy.init(args=args)
    node = AscarelidarBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.mqtt_client.loop_stop()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
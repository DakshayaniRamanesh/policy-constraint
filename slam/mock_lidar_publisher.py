#!/usr/bin/env python3
"""
ASCAR-E Mock LiDAR Publisher
==============================
Replaces the heavy Ignition Gazebo simulation entirely.

Publishes synthetic room/corridor geometry as a proper ROS 2 PointCloud2
message on '/oakd/rgb/preview/depth/points' at 6 Hz — exactly what the
real OAK-D depth camera produces in the TurtleBot4 simulation.

This lets us validate the COMPLETE pipeline:
  This script → /oakd/rgb/preview/depth/points
  → ascar_ros_bridge (outlier filter + voxel downsample)
  → MQTT ascar/lidar
  → batch_recorder.py
  → pointcloud_batches/*.json
  → [Phase 3] Blender MCP

No Gazebo. No GPU. No overheating. Full-speed validation.

Scenes (cycles automatically every 5 seconds):
  0 - Flat wall (simple plane — tests degenerate-frame handling)
  1 - Corner room (two walls meeting)
  2 - Corridor (two parallel walls)
  3 - Open room with furniture obstacles
  4 - Mixed environment (walls + scattered objects)

Usage:
    source install/setup.bash
    python3 mock_lidar_publisher.py
"""

import math
import time
import random
import struct
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import PointCloud2, PointField
from std_msgs.msg import Header
import numpy as np

# How often to switch scenes (seconds)
SCENE_DURATION_SEC = 5

# Publish rate — matches OAK-D depth camera
PUBLISH_HZ = 6.0

# Approximate number of points per frame (OAK-D 300x300 depth, ~15k valid pts)
POINTS_PER_FRAME = 15_000


def make_pointcloud2_msg(points: np.ndarray, frame_id: str, stamp) -> PointCloud2:
    """
    Pack a (N, 3) float32 numpy array into a sensor_msgs/PointCloud2 message.
    This is the same format the real OAK-D camera produces.
    """
    pts = points.astype(np.float32)
    n   = len(pts)

    msg = PointCloud2()
    msg.header        = Header()
    msg.header.stamp  = stamp
    msg.header.frame_id = frame_id

    msg.height   = 1
    msg.width    = n
    msg.is_dense = False  # may contain NaN — mirrors real sensor behaviour
    msg.is_bigendian = False

    # Field layout: x(4) y(4) z(4) = 12 bytes per point
    msg.fields = [
        PointField(name='x', offset=0,  datatype=PointField.FLOAT32, count=1),
        PointField(name='y', offset=4,  datatype=PointField.FLOAT32, count=1),
        PointField(name='z', offset=8,  datatype=PointField.FLOAT32, count=1),
    ]
    msg.point_step = 12
    msg.row_step   = msg.point_step * n
    msg.data       = pts.tobytes()
    return msg


# ─── Scene generators ────────────────────────────────────────────────────────

def scene_flat_wall(n: int) -> np.ndarray:
    """A wall 2 m in front of the robot — tests degenerate plane handling."""
    x = np.full(n, 2.0) + np.random.normal(0, 0.005, n)
    y = np.random.uniform(-1.5, 1.5, n)
    z = np.random.uniform(0.0,  2.0, n)
    return np.column_stack([x, y, z])


def scene_corner_room(n: int) -> np.ndarray:
    """Two walls meeting at a corner — basic room shape."""
    half = n // 2
    # Wall A: in front at x=3m
    xA = np.full(half, 3.0) + np.random.normal(0, 0.008, half)
    yA = np.random.uniform(-2.0, 2.0, half)
    zA = np.random.uniform(0.0,  2.5, half)
    wallA = np.column_stack([xA, yA, zA])
    # Wall B: to the right at y=2m
    xB = np.random.uniform(0.1, 3.0, n - half)
    yB = np.full(n - half, 2.0) + np.random.normal(0, 0.008, n - half)
    zB = np.random.uniform(0.0, 2.5, n - half)
    wallB = np.column_stack([xB, yB, zB])
    return np.vstack([wallA, wallB])


def scene_corridor(n: int) -> np.ndarray:
    """Narrow corridor — two parallel walls with floor."""
    third = n // 3
    # Left wall  y = -1.0
    pts_L = np.column_stack([
        np.random.uniform(0.3, 6.0, third),
        np.full(third, -1.0) + np.random.normal(0, 0.01, third),
        np.random.uniform(0.0, 2.2, third),
    ])
    # Right wall  y = +1.0
    pts_R = np.column_stack([
        np.random.uniform(0.3, 6.0, third),
        np.full(third, +1.0) + np.random.normal(0, 0.01, third),
        np.random.uniform(0.0, 2.2, third),
    ])
    # Floor z = 0
    pts_F = np.column_stack([
        np.random.uniform(0.3, 6.0, n - 2 * third),
        np.random.uniform(-1.0, 1.0, n - 2 * third),
        np.full(n - 2 * third, 0.0) + np.random.normal(0, 0.01, n - 2 * third),
    ])
    return np.vstack([pts_L, pts_R, pts_F])


def scene_room_with_furniture(n: int) -> np.ndarray:
    """Open room with walls + box-shaped obstacle (sofa/table)."""
    quarter = n // 4
    # Four walls
    wallF = np.column_stack([np.full(quarter, 4.0) + np.random.normal(0, 0.01, quarter),
                              np.random.uniform(-2.5, 2.5, quarter),
                              np.random.uniform(0, 2.4, quarter)])
    wallB = np.column_stack([np.full(quarter, -0.2) + np.random.normal(0, 0.01, quarter),
                              np.random.uniform(-2.5, 2.5, quarter),
                              np.random.uniform(0, 2.4, quarter)])
    wallL = np.column_stack([np.random.uniform(0, 4.0, quarter),
                              np.full(quarter, -2.5) + np.random.normal(0, 0.01, quarter),
                              np.random.uniform(0, 2.4, quarter)])
    # Box obstacle (sofa) at x=2, y=1, height=0.5m, 40x60x50cm
    n_box = n - 3 * quarter
    ox = np.random.uniform(1.8, 2.2, n_box)
    oy = np.random.uniform(0.7, 1.3, n_box)
    oz = np.random.uniform(0.0, 0.5, n_box)
    box = np.column_stack([ox, oy, oz])
    return np.vstack([wallF, wallB, wallL, box])


def scene_mixed(n: int) -> np.ndarray:
    """Realistic mixed scene: room + scattered sparse obstacles."""
    base = scene_room_with_furniture(n - n // 5)
    # Scattered low-density obstacles (simulating chairs, posts)
    n_sparse = n // 5
    sparse = np.column_stack([
        np.random.uniform(0.5, 3.5, n_sparse),
        np.random.uniform(-2.0, 2.0, n_sparse),
        np.random.uniform(0.0, 1.5, n_sparse),
    ])
    return np.vstack([base, sparse])


SCENES = [
    ("Flat wall",            scene_flat_wall),
    ("Corner room",          scene_corner_room),
    ("Corridor",             scene_corridor),
    ("Room + furniture",     scene_room_with_furniture),
    ("Mixed environment",    scene_mixed),
]


# ─── ROS 2 Node ──────────────────────────────────────────────────────────────

class MockLidarPublisher(Node):
    def __init__(self):
        super().__init__('mock_lidar_publisher')

        self.publisher_ = self.create_publisher(
            PointCloud2,
            '/oakd/rgb/preview/depth/points',
            10
        )

        self._scene_idx   = 0
        self._frame_count = 0
        self._scene_start = time.time()

        period = 1.0 / PUBLISH_HZ
        self.timer = self.create_timer(period, self.publish_frame)

        self.get_logger().info("=" * 55)
        self.get_logger().info("  ASCAR-E Mock LiDAR Publisher — running")
        self.get_logger().info("=" * 55)
        self.get_logger().info(f"  Topic   : /oakd/rgb/preview/depth/points")
        self.get_logger().info(f"  Rate    : {PUBLISH_HZ} Hz  (~{POINTS_PER_FRAME:,} pts/frame)")
        self.get_logger().info(f"  Scenes  : cycle every {SCENE_DURATION_SEC} s")
        self.get_logger().info("=" * 55)

    def publish_frame(self):
        # Switch scene every SCENE_DURATION_SEC seconds
        elapsed = time.time() - self._scene_start
        if elapsed >= SCENE_DURATION_SEC:
            self._scene_idx  = (self._scene_idx + 1) % len(SCENES)
            self._scene_start = time.time()
            name, _ = SCENES[self._scene_idx]
            self.get_logger().info(f"  Scene → [{self._scene_idx + 1}/{len(SCENES)}] {name}")

        name, generator = SCENES[self._scene_idx]

        # Generate point cloud with realistic sensor noise
        pts = generator(POINTS_PER_FRAME)

        # Inject ~2% of points as "ghost" outliers (tests our outlier filter)
        n_outliers = POINTS_PER_FRAME // 50
        outlier_mask = np.random.choice(len(pts), n_outliers, replace=False)
        pts[outlier_mask] = np.random.uniform(50, 200, (n_outliers, 3))  # huge values

        # Inject ~1% NaN points (tests skip_nans=True)
        n_nans = POINTS_PER_FRAME // 100
        nan_mask = np.random.choice(len(pts), n_nans, replace=False)
        pts[nan_mask] = np.nan

        stamp = self.get_clock().now().to_msg()
        msg   = make_pointcloud2_msg(pts, 'oakd_rgb_camera_optical_frame', stamp)
        self.publisher_.publish(msg)

        self._frame_count += 1
        if self._frame_count % 18 == 0:  # log every 3 seconds
            self.get_logger().info(
                f"  Frame {self._frame_count:5d} | Scene: {name} | "
                f"{POINTS_PER_FRAME:,} pts published"
            )


# ─────────────────────────────────────────────────────────────────────────────
def main(args=None):
    rclpy.init(args=args)
    node = MockLidarPublisher()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
ASCAR-E Keyboard Teleop
=======================
Drives the TurtleBot4 simulation (or Unitree Go2) from the keyboard.

WHY THIS EXISTS:
  The standard 'teleop_twist_keyboard' publishes with RELIABLE QoS.
  TurtleBot4's motion_control node subscribes with BEST_EFFORT QoS.
  In ROS 2, RELIABLE → BEST_EFFORT is incompatible — messages are
  silently dropped and the robot never moves.  This script publishes
  with BEST_EFFORT so the QoS profiles match.

CONTROLS:
  w / x  →  forward / backward
  a / d  →  turn left / right
  s      →  stop (zero velocity)
  q      →  quit

Usage:
  python3 teleop.py
"""

import sys
import tty
import termios
import threading
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from geometry_msgs.msg import Twist

# Speed settings
LINEAR_SPEED  = 0.3   # m/s forward/backward
ANGULAR_SPEED = 0.8   # rad/s turning

KEY_BINDINGS = {
    'w': ( 1,  0),   # forward
    'x': (-1,  0),   # backward
    'a': ( 0,  1),   # turn left
    'd': ( 0, -1),   # turn right
    's': ( 0,  0),   # stop
}


def get_key(settings):
    """Read a single keypress without blocking."""
    tty.setraw(sys.stdin.fileno())
    key = sys.stdin.read(1)
    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, settings)
    return key


class KeyboardTeleop(Node):
    def __init__(self):
        super().__init__('ascar_keyboard_teleop')

        # CRITICAL: publish with BEST_EFFORT to match motion_control subscriber
        qos = QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE
        )

        self.publisher = self.create_publisher(Twist, '/cmd_vel', qos)
        self.get_logger().info("ASCAR-E Keyboard Teleop ready (BEST_EFFORT QoS)")

    def publish_velocity(self, linear: float, angular: float):
        msg = Twist()
        msg.linear.x  = linear
        msg.angular.z = angular
        self.publisher.publish(msg)


def main():
    rclpy.init()
    node = KeyboardTeleop()

    # Use an Event so we can signal the spin thread to stop cleanly
    stop_event = threading.Event()

    def spin_until_stopped():
        while not stop_event.is_set():
            rclpy.spin_once(node, timeout_sec=0.1)

    spin_thread = threading.Thread(target=spin_until_stopped, daemon=True)
    spin_thread.start()

    settings = termios.tcgetattr(sys.stdin)

    print("\n" + "=" * 45)
    print("  ASCAR-E Keyboard Teleop")
    print("=" * 45)
    print(f"  w / x  →  forward / backward  ({LINEAR_SPEED} m/s)")
    print(f"  a / d  →  turn left / right   ({ANGULAR_SPEED} rad/s)")
    print(f"  s      →  STOP")
    print(f"  q      →  quit")
    print("=" * 45 + "\n")

    current_linear  = 0.0
    current_angular = 0.0

    try:
        while True:
            key = get_key(settings)

            if key == 'q':
                print("\nStopping robot and exiting...")
                node.publish_velocity(0.0, 0.0)
                break

            if key in KEY_BINDINGS:
                lin_dir, ang_dir = KEY_BINDINGS[key]
                current_linear  = lin_dir  * LINEAR_SPEED
                current_angular = ang_dir  * ANGULAR_SPEED
                action = {
                    'w': 'FORWARD', 'x': 'BACKWARD',
                    'a': 'LEFT',    'd': 'RIGHT', 's': 'STOP'
                }.get(key, '')
                print(f"  {action:8s}  linear={current_linear:+.1f}  angular={current_angular:+.1f}")
            else:
                # Unknown key — keep current velocity (don't reset)
                continue

            node.publish_velocity(current_linear, current_angular)

    except KeyboardInterrupt:
        pass
    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, settings)
        node.publish_velocity(0.0, 0.0)   # safety stop
        stop_event.set()                  # signal spin thread to exit
        spin_thread.join(timeout=2.0)     # wait for it to finish cleanly
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()

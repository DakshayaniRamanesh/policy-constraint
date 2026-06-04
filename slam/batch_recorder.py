"""
ASCAR-E Batch Recorder
Project : ASCAR-E  —  Real-time 3D SLAM → Blender MCP procedural geometry

Listens on MQTT topic 'ascar/lidar' for compressed point-cloud frames
produced by the ASCAR bridge, and saves them to disk in fixed-size
batches as JSON files for offline SLAM / Blender MCP consumption.

Batch sizing guide:
  SIMULATION  (OAK-D depth cam, ~6 Hz):
    BATCH_SIZE = 30  →  ~5 seconds of robot movement  ← current default
  REAL Go2    (Hesai XT16,     ~10 Hz):
    BATCH_SIZE = 100 →  ~10 seconds of robot movement
"""

import paho.mqtt.client as mqtt
from paho.mqtt.client import CallbackAPIVersion  # Required for paho-mqtt v2+
import json
import time
import os

# ── Configuration ─────────────────────────────────────────────────────────────
MQTT_BROKER  = "127.0.0.1"
MQTT_PORT    = 1883
MQTT_TOPIC   = "ascar/lidar"
SAVE_DIR     = "pointcloud_batches"

# SIMULATION: OAK-D depth cam runs at ~6 Hz → 30 frames ≈ 5 seconds of data.
# REAL Go2:   Hesai XT16 runs at ~10 Hz → set to 100 for ~10-second chunks.
BATCH_SIZE   = 30


class BatchRecorder:
    def __init__(self):
        self.current_batch  = []
        self.batch_number   = 1
        self.total_frames   = 0

        os.makedirs(SAVE_DIR, exist_ok=True)

        # paho-mqtt v2 requires an explicit CallbackAPIVersion
        self.client = mqtt.Client(CallbackAPIVersion.VERSION1)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

    # ── MQTT callbacks ────────────────────────────────────────────────────────
    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        """Called once the broker acknowledges our connection."""
        if reason_code == 0:
            print(f"✅  Connected to MQTT broker — listening on '{MQTT_TOPIC}'")
            print(f"    Batch size : {BATCH_SIZE} frames  "
                  f"(~{BATCH_SIZE/10:.0f} s at 10 Hz)")
            print(f"    Saving to  : {os.path.abspath(SAVE_DIR)}/")
            self.client.subscribe(MQTT_TOPIC)
        else:
            print(f"❌  Connection failed — reason code: {reason_code}")
            print("    Is the ASCAR bridge running?  "
                  "Is mosquitto started? (sudo systemctl start mosquitto)")

    def on_message(self, client, userdata, msg):
        """Called every time a new compressed LiDAR frame arrives from the Go2."""
        try:
            frame = json.loads(msg.payload.decode("utf-8"))
            self.current_batch.append(frame)
            self.total_frames += 1

            # Progress indicator every 10 frames so you can see data is flowing
            if self.total_frames % 10 == 0:
                n_pts = len(frame.get("points", []))
                ts    = frame.get("stamp_sec", "?")
                print(f"  ⬇  Frame {self.total_frames:5d}  |  "
                      f"{n_pts:4d} pts  |  stamp={ts}  |  "
                      f"batch {self.batch_number} ({len(self.current_batch)}/{BATCH_SIZE})")

            if len(self.current_batch) >= BATCH_SIZE:
                self.save_batch()

        except Exception as e:
            print(f"⚠  Error processing frame: {e}")

    # ── Batch persistence ─────────────────────────────────────────────────────
    def save_batch(self):
        """Flush the current batch to disk and reset for the next one."""
        # Filename encodes batch number + wall-clock time for easy sorting
        filename = os.path.join(
            SAVE_DIR,
            f"ascar_batch_{self.batch_number:04d}_{int(time.time())}.json"
        )

        # Include metadata so offline tools know what produced this batch
        output = {
            "metadata": {
                "robot":      "unitree_go2",
                "lidar":      "hesai_xt16",
                "topic":      "rt/utlidar/cloud_deskewed",
                "batch_num":  self.batch_number,
                "n_frames":   len(self.current_batch),
                "saved_at":   time.time(),
            },
            "frames": self.current_batch
        }

        with open(filename, "w") as f:
            json.dump(output, f)

        print(f"\n💾  Saved {filename}")
        print(f"    {len(self.current_batch)} frames  |  "
              f"total collected: {self.total_frames}\n")

        self.current_batch = []
        self.batch_number  += 1

    # Entry point 
    def start(self):
        self.client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        self.client.loop_forever()


if __name__ == "__main__":
    print("=" * 60)
    print("  ASCAR-E Batch Recorder  —  Unitree Go2 / Hesai XT16")
    print("=" * 60)
    recorder = BatchRecorder()
    try:
        recorder.start()
    except KeyboardInterrupt:
        # Save whatever partial batch exists so data isn't lost on Ctrl+C
        if recorder.current_batch:
            print(f"\n⚡  Partial batch ({len(recorder.current_batch)} frames) — saving...")
            recorder.save_batch()
        print("Recording stopped safely.")

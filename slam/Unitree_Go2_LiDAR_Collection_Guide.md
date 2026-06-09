# ASCAR-E: Detailed Guide on LiDAR Data Collection & Blender 3D Pipeline

This document provides a comprehensive, step-by-step walkthrough on exactly **where** and **how** you collect the Hesai XT16 LiDAR data from your Unitree Go2 robot, and how to feed it through the ASCAR-E pipeline into Blender.

---

## 1. Where Does the LiDAR Data Come From?

The Unitree Go2 is equipped with a Hesai XT16 3D LiDAR. 
The robot's internal compute board runs ROS 2 (usually using CycloneDDS as its middleware) and continuously publishes the 3D point cloud data to a specific ROS 2 topic.

* **Sensor:** Hesai XT16
* **Publish Rate:** ~10 Hz (10 frames per second)
* **ROS 2 Topic Name:** `rt/utlidar/cloud_deskewed` or `/utlidar/cloud_deskewed`
* **Data Type:** `sensor_msgs/msg/PointCloud2`

You do **not** need to manually connect to the Hesai sensor's IP address. Instead, you simply connect your PC to the robot's network, and your PC's ROS 2 environment will automatically "see" the LiDAR topic being broadcasted by the Go2.

---

## 2. Phase 1: Establish Network Connection

Before you can collect the data, your PC needs to talk to the robot.

1. **Power On:** Turn on the Unitree Go2. Wait about 1-2 minutes for it to fully boot.
2. **Connect Wi-Fi:** On your PC, connect to the robot's hotspot. It is typically named `Unitree_Go2_XXXX`.
3. **Verify Connection:** Open a terminal on your PC and try to ping the robot's default IP address:
   ```bash
   ping 192.168.12.1
   ```
4. **SSH into the Robot (Optional, for verification):**
   ```bash
   ssh unitree@192.168.12.1
   ```
   *(The default password is `123`).* You can run `ros2 topic list` inside the SSH session to confirm that `rt/utlidar/cloud_deskewed` is active. Exit the SSH session when done.

---

## 3. Phase 2: Setup the PC Receiver Environment

Your PC needs to be on the same ROS 2 network domain as the Go2 to receive the LiDAR packets.

1. **Open a fresh terminal** on your PC.
2. **Set the ROS Domain:** Unitree often uses a specific domain ID (default is usually 0). Ensure your environment matches:
   ```bash
   export ROS_DOMAIN_ID=0
   ```
3. **Verify the PC can see the LiDAR:**
   Run the following command on your PC. If your network is configured correctly, you should see the 10Hz data streaming in:
   ```bash
   ros2 topic hz rt/utlidar/cloud_deskewed
   ```

---

## 4. Phase 3: Start the Collection Pipeline

Because raw `PointCloud2` messages are massive (~15,000+ points per frame) and can bottleneck your Wi-Fi, we use the ASCAR-E bridge to compress them and send them over MQTT.

**Terminal 1: Start the local MQTT Radio Tower**
The MQTT broker acts as the central hub for the compressed data.
```bash
sudo systemctl start mosquitto
```

**Terminal 2: Run the ASCAR-E Compressor Bridge**
This node subscribes to the heavy ROS 2 topic from the Go2, crushes it down using Open3D Voxel filtering, and broadcasts the lightweight JSON arrays to MQTT.
```bash
cd /home/rashad/policy-constraint/slam
source install/setup.bash
export ROS_DOMAIN_ID=0

# Run the bridge, remapping it to listen to the Go2's physical LiDAR topic
ros2 run ascar_ros_bridge bridge_node --ros-args -p pointcloud_topic:="rt/utlidar/cloud_deskewed"
```

**Terminal 3: Record the Data to the Hard Drive**
This is how you permanently **collect** and save the data. The Batch Recorder listens to MQTT and continuously chunks the frames into `.json` files. This means if the Go2 disconnects, your data is safe on the disk!
```bash
cd /home/rashad/policy-constraint/slam
python3 batch_recorder.py
```
*You will see terminal output indicating frames are being saved into the `pointcloud_batches/` folder every 10 seconds (approx. 100 frames per batch).*

---

## 5. Phase 4: Real-time Blender Visualization

You can generate the 3D model in real-time as the robot walks, or use it later to play back the recorded batches. Here is how to run the live view:

1. **Ensure Python Dependencies:**
   Blender has its own isolated Python environment. You must install `paho-mqtt` inside it.
   ```bash
   /path/to/blender/python/bin/python3 -m pip install paho-mqtt numpy
   ```
2. **Open Blender:** Launch your Blender application.
3. **Load the MCP:**
   - Go to the **Scripting** tab at the top.
   - Click **Open** and select `/home/rashad/policy-constraint/slam/blender_mcp.py`.
4. **Execute:**
   - Press the **Play / Run Script** icon.
   - Look at your 3D Viewport. As the Go2 scans the room, Blender will automatically procedurally generate solid walls (using our custom RANSAC algorithm) and place cubes for scattered obstacles in real-time.
5. **Stop:**
   If you need to stop the generation loop, go to the interactive Python console inside Blender's Scripting view and type:
   ```python
   stop_mcp()
   ```

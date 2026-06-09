import bpy
import bmesh
import mathutils
import numpy as np
import json
import threading
import queue
import time

try:
    import paho.mqtt.client as mqtt
    from paho.mqtt.client import CallbackAPIVersion
    MQTT_AVAILABLE = True
except Exception:
    MQTT_AVAILABLE = False
    print("WARNING: paho-mqtt is not installed in Blender's Python environment.")

# Configuration
MQTT_BROKER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "ascar/lidar"
CELL_SIZE = 0.2  # Grid cell size for density filtering (meters)
DENSITY_THRESHOLD = 2  # Points per cell to be considered a 'wall' (lowered for compressed clouds ~1k pts)
WALL_HEIGHT = 2.5
WALL_THICKNESS = 0.1

message_queue = queue.Queue()
mqtt_thread = None
mqtt_client = None

# Custom RANSAC implementation for 2D line fitting
def fit_line_ransac(points, iterations=100, threshold=0.1):
    best_line = None
    best_inliers = []
    best_inlier_count = 0
    n_points = len(points)
    
    if n_points < 2:
        return None, []
        
    for _ in range(iterations):
        idx = np.random.choice(n_points, 2, replace=False)
        p1 = points[idx[0]]
        p2 = points[idx[1]]
        
        # Line eq: ax + by + c = 0
        a = p1[1] - p2[1]
        b = p2[0] - p1[0]
        c = p1[0]*p2[1] - p2[0]*p1[1]
        
        norm = np.hypot(a, b)
        if norm == 0:
            continue
            
        a, b, c = a/norm, b/norm, c/norm
        distances = np.abs(a * points[:, 0] + b * points[:, 1] + c)
        inliers = np.where(distances < threshold)[0]
        
        if len(inliers) > best_inlier_count:
            best_inlier_count = len(inliers)
            best_inliers = inliers
            best_line = (a, b, c)
            
    return best_line, best_inliers

def extract_segments(points, dist_threshold=0.15, min_inliers=5, iterations=100):
    segments = []
    remaining_points = points.copy()
    
    while len(remaining_points) > min_inliers:
        line, inliers_idx = fit_line_ransac(remaining_points, iterations, dist_threshold)
        if line is None or len(inliers_idx) < min_inliers:
            break
            
        inliers = remaining_points[inliers_idx]
        a, b, c = line
        v = np.array([-b, a])
        
        projections = inliers.dot(v)
        min_idx = np.argmin(projections)
        max_idx = np.argmax(projections)
        
        p_start = inliers[min_idx]
        p_end = inliers[max_idx]
        
        def project_point(p, l):
            la, lb, lc = l
            d = la*p[0] + lb*p[1] + lc
            return np.array([p[0] - la*d, p[1] - lb*d])
            
        segments.append((project_point(p_start, line), project_point(p_end, line)))
        remaining_points = np.delete(remaining_points, inliers_idx, axis=0)
        
    return segments

def clear_geometry():
    # Remove old ASCAR objects using the data API — bpy.ops.object.delete()
    # crashes silently when called from a timer callback (no viewport context).
    objs = [o for o in bpy.data.objects if o.name.startswith("ASCAR_")]
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)

    # Cleanup orphaned meshes
    for m in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(m)

def create_walls(segments):
    if not segments: return
    mesh = bpy.data.meshes.new("ASCAR_Walls_Mesh")
    obj = bpy.data.objects.new("ASCAR_Walls", mesh)
    # bpy.context.collection is None in timer context — use scene.collection instead
    bpy.context.scene.collection.objects.link(obj)
    
    bm = bmesh.new()
    for start, end in segments:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = np.hypot(dx, dy)
        if length == 0: continue
            
        nx = -dy / length * (WALL_THICKNESS / 2.0)
        ny = dx / length * (WALL_THICKNESS / 2.0)
        
        v1 = bm.verts.new((start[0] + nx, start[1] + ny, 0.0))
        v2 = bm.verts.new((start[0] - nx, start[1] - ny, 0.0))
        v3 = bm.verts.new((end[0] - nx, end[1] - ny, 0.0))
        v4 = bm.verts.new((end[0] + nx, end[1] + ny, 0.0))
        
        face = bm.faces.new((v1, v2, v3, v4))
        
        # Extrude
        geom = bmesh.ops.extrude_discrete_faces(bm, faces=[face])
        faces = geom['faces']
        bmesh.ops.translate(bm, vec=(0, 0, WALL_HEIGHT), verts=faces[0].verts)

    bm.to_mesh(mesh)
    bm.free()

def create_obstacles(coords):
    if not len(coords): return
    mesh = bpy.data.meshes.new("ASCAR_Obstacles_Mesh")
    obj = bpy.data.objects.new("ASCAR_Obstacles", mesh)
    # bpy.context.collection is None in timer context — use scene.collection instead
    bpy.context.scene.collection.objects.link(obj)
    
    bm = bmesh.new()
    for x, y in coords:
        mat = mathutils.Matrix.Translation((x, y, 0.25))
        bmesh.ops.create_cube(bm, size=0.5, matrix=mat)
        
    bm.to_mesh(mesh)
    bm.free()

def process_frame(points_list):
    points = np.array(points_list)
    if len(points) == 0: return

    # Density filter mapping (ignoring Z)
    grid_coords = np.floor(points[:, :2] / CELL_SIZE).astype(int)
    unique_coords, counts = np.unique(grid_coords, axis=0, return_counts=True)
    
    wall_mask = counts >= DENSITY_THRESHOLD
    obstacle_mask = (counts > 0) & (counts < DENSITY_THRESHOLD)
    
    wall_cells = unique_coords[wall_mask] * CELL_SIZE + (CELL_SIZE / 2.0)
    obstacle_cells = unique_coords[obstacle_mask] * CELL_SIZE + (CELL_SIZE / 2.0)
    
    segments = []
    if len(wall_cells) > 0:
        segments = extract_segments(wall_cells, dist_threshold=0.3, min_inliers=5, iterations=200)
    
    clear_geometry()
    create_walls(segments)
    create_obstacles(obstacle_cells)
    
    print(f"ASCAR-E: Processed frame with {len(segments)} walls and {len(obstacle_cells)} soft obstacles.")

def mqtt_on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        print(f"Blender MCP connected to MQTT. Subscribing to {MQTT_TOPIC}")
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"MQTT Connect failed: {reason_code}")

def mqtt_on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode("utf-8"))
        if "points" in data:
            message_queue.put(data["points"])
    except Exception as e:
        print(f"Error parsing MQTT message: {e}")

def mqtt_worker():
    global mqtt_client
    # paho-mqtt v2 requires CallbackAPIVersion
    mqtt_client = mqtt.Client(CallbackAPIVersion.VERSION1)
    mqtt_client.on_connect = mqtt_on_connect
    mqtt_client.on_message = mqtt_on_message
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_forever()
    except Exception as e:
        print(f"MQTT Worker Error: {e}")

def blender_timer_callback():
    # Process up to 1 message per tick
    try:
        points = None
        # Drain queue, we only want the absolute latest frame to avoid lag building up
        while not message_queue.empty():
            points = message_queue.get_nowait()
            
        if points is not None:
            process_frame(points)
    except Exception as e:
        print(f"Error in timer callback: {e}")
        
    return 0.1  # 10Hz tick

def start_mcp():
    global mqtt_thread
    if not MQTT_AVAILABLE:
        print("Cannot start MCP: paho-mqtt not available in Blender Python.")
        return
        
    if mqtt_thread is None or not mqtt_thread.is_alive():
        print("Starting ASCAR-E MQTT background thread...")
        mqtt_thread = threading.Thread(target=mqtt_worker, daemon=True)
        mqtt_thread.start()
        
    if not bpy.app.timers.is_registered(blender_timer_callback):
        bpy.app.timers.register(blender_timer_callback)
        print("Registered Blender timer callback.")

def stop_mcp():
    global mqtt_client, mqtt_thread
    if mqtt_client is not None:
        mqtt_client.disconnect()
        mqtt_client = None
    if bpy.app.timers.is_registered(blender_timer_callback):
        bpy.app.timers.unregister(blender_timer_callback)
    print("ASCAR-E MCP Stopped.")

if __name__ == "__main__":
    start_mcp()

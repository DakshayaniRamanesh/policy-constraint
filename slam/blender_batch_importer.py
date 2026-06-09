"""
blender_batch_importer.py
─────────────────────────────────────────────────────────────────────────────
ASCAR-E  —  Offline Batch → Blender 3D Model Builder

Reads the JSON batch files recorded by batch_recorder.py from disk and
reconstructs a full 3D model inside Blender:

  • ASCAR_PointCloud  – raw point cloud mesh (one vertex per LiDAR return)
  • ASCAR_Walls       – extruded wall geometry from RANSAC line fitting
  • ASCAR_Floor       – inferred floor plane
  • ASCAR_Obstacles   – cluster cubes for isolated / low-density features

Usage (inside Blender ▸ Scripting tab):
    1. Paste or load this file into the text editor.
    2. Set BATCH_DIR to the folder containing your ascar_batch_*.json files.
    3. Adjust MAX_BATCHES / voxel / RANSAC parameters as needed.
    4. Click ▶ Run Script.

The script is idempotent: running it again clears the previous ASCAR objects
before rebuilding.

─────────────────────────────────────────────────────────────────────────────
"""

import bpy
import bmesh
import mathutils
import json
import os
import glob
import time

import numpy as np

# ── USER CONFIGURATION ────────────────────────────────────────────────────────

# Absolute path to the folder containing ascar_batch_*.json files.
# NOTE: Blender's scripting environment does NOT set __file__ reliably, so we
# use an explicit hardcoded path.  Update this if you move the batch folder.
BATCH_DIR = "/home/rashad/policy-constraint/slam/pointcloud_batches/jsondata_1970-01-01_14-10-30"

# ── Blender-safe fallback (auto-detect from .blend file location) ─────────────
# If the hardcoded path doesn't exist, try the folder next to the .blend file.
if not os.path.isdir(BATCH_DIR):
    _blend_dir = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ""
    _candidate = os.path.join(_blend_dir, "pointcloud_batches")
    if os.path.isdir(_candidate):
        BATCH_DIR = _candidate
    else:
        # Last resort: walk up from any known script path
        _script_paths = [t.filepath for t in bpy.data.texts if t.filepath]
        for _sp in _script_paths:
            _candidate = os.path.join(os.path.dirname(_sp), "pointcloud_batches")
            if os.path.isdir(_candidate):
                BATCH_DIR = _candidate
                break

# How many batch files to load (None = all).  Start small (e.g. 10) to test.
MAX_BATCHES = None          # e.g. 20

# Voxel size (metres) for downsampling the aggregated point cloud.
# Smaller = denser model but slower Blender.  0.05 m is a good starting point.
VOXEL_SIZE = 0.05

# Height range filter: keep only points whose Z is within [Z_MIN, Z_MAX].
# Real data shows Z ∈ [-0.25, +2.7] m in odom frame (robot base ≈ Z=0).
Z_MIN = -0.30    # metres  (below base-plate → floor noise, discard)
Z_MAX =  3.00    # metres  (above this → ceiling returns, discard)

# Wall / floor split: points below FLOOR_Z_THRESHOLD treated as floor;
# everything above goes into wall / obstacle RANSAC analysis.
FLOOR_Z_THRESHOLD = 0.10   # metres

# ── RANSAC WALL FITTING ───────────────────────────────────────────────────────
RANSAC_ITERATIONS  = 300
RANSAC_THRESHOLD   = 0.12   # inlier distance (m)
MIN_WALL_INLIERS   = 15     # fewer inliers → not a wall segment
WALL_HEIGHT        = 2.6    # metres — extruded height for wall geometry
WALL_THICKNESS     = 0.12   # metres

# ── OBSTACLE CLUSTERING ───────────────────────────────────────────────────────
CELL_SIZE           = 0.20   # grid cell size for density map
DENSITY_THRESHOLD   = 3      # cells with fewer points → obstacle, more → wall candidate

# ── POINT CLOUD DISPLAY ───────────────────────────────────────────────────────
# Maximum raw points to keep in the Blender point-cloud mesh.
# Blender slows dramatically above ~500k verts; we sub-sample if needed.
MAX_DISPLAY_POINTS = 300_000

# ── MATERIAL COLOURS (RGBA) ───────────────────────────────────────────────────
COL_WALL     = (0.18, 0.45, 0.72, 1.0)   # steel blue
COL_FLOOR    = (0.25, 0.25, 0.25, 1.0)   # dark grey
COL_OBSTACLE = (0.85, 0.45, 0.10, 1.0)   # amber
COL_CLOUD    = (0.10, 0.90, 0.55, 1.0)   # teal-green

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 1 — Load + aggregate all batches
# ─────────────────────────────────────────────────────────────────────────────

def load_batches(batch_dir: str, max_batches=None) -> np.ndarray:
    """Read every ascar_batch_*.json in batch_dir and return an (N,3) float32 array."""
    pattern = os.path.join(batch_dir, "ascar_batch_*.json")
    files   = sorted(glob.glob(pattern))
    if not files:
        raise FileNotFoundError(
            f"No ascar_batch_*.json files found in:\n  {batch_dir}\n"
            "Check that BATCH_DIR points to the correct folder."
        )

    if max_batches:
        files = files[:max_batches]

    print(f"[ASCAR] Loading {len(files)} batch file(s) from:\n  {batch_dir}")

    all_points = []
    total_frames = 0
    t0 = time.time()

    for i, fpath in enumerate(files):
        with open(fpath, "r") as f:
            batch = json.load(f)

        frames = batch.get("frames", [])
        for frame in frames:
            pts = frame.get("points", [])
            if pts:
                all_points.append(np.array(pts, dtype=np.float32))
        total_frames += len(frames)

        if (i + 1) % 10 == 0 or i == len(files) - 1:
            print(f"  Loaded {i + 1}/{len(files)} files — {total_frames} frames so far …")

    if not all_points:
        raise ValueError("Batch files loaded but contain no point data.")

    cloud = np.vstack(all_points)
    print(f"[ASCAR] Loaded {len(cloud):,} raw points from {total_frames} frames "
          f"in {time.time() - t0:.1f}s")
    return cloud


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 2 — Filter + downsample
# ─────────────────────────────────────────────────────────────────────────────

def filter_and_downsample(cloud: np.ndarray,
                           z_min=Z_MIN, z_max=Z_MAX,
                           voxel=VOXEL_SIZE) -> np.ndarray:
    """Height-clip then voxel-downsample."""
    mask = (cloud[:, 2] >= z_min) & (cloud[:, 2] <= z_max)
    cloud = cloud[mask]
    print(f"[ASCAR] After Z-filter [{z_min}, {z_max}] m: {len(cloud):,} points")

    # Voxel grid: keep one representative point per voxel cell
    if voxel > 0:
        idx = np.floor(cloud / voxel).astype(np.int32)
        # Use a dict for uniqueness (numpy unique on 3-col array is slow for huge clouds)
        keys = idx[:, 0].astype(np.int64) * (2**21) + \
               idx[:, 1].astype(np.int64) * (2**11) + \
               idx[:, 2].astype(np.int64)
        _, ui = np.unique(keys, return_index=True)
        cloud = cloud[ui]
        print(f"[ASCAR] After voxel downsample (voxel={voxel} m): {len(cloud):,} points")

    return cloud


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 3 — RANSAC line extraction (2-D, XZ plane)
# ─────────────────────────────────────────────────────────────────────────────

def fit_line_ransac_2d(points_2d: np.ndarray,
                        iterations=RANSAC_ITERATIONS,
                        threshold=RANSAC_THRESHOLD):
    """Fit a 2-D line to points_2d using RANSAC. Returns (a,b,c) or None."""
    n = len(points_2d)
    if n < 2:
        return None, []

    best_line     = None
    best_inliers  = []

    for _ in range(iterations):
        i1, i2 = np.random.choice(n, 2, replace=False)
        p1, p2  = points_2d[i1], points_2d[i2]

        a = p1[1] - p2[1]
        b = p2[0] - p1[0]
        c = p1[0] * p2[1] - p2[0] * p1[1]
        norm = np.hypot(a, b)
        if norm < 1e-9:
            continue
        a, b, c = a / norm, b / norm, c / norm

        dist    = np.abs(a * points_2d[:, 0] + b * points_2d[:, 1] + c)
        inliers = np.where(dist < threshold)[0]

        if len(inliers) > len(best_inliers):
            best_inliers = inliers
            best_line    = (a, b, c)

    return best_line, best_inliers


def extract_wall_segments(points_2d: np.ndarray,
                           min_inliers=MIN_WALL_INLIERS) -> list:
    """Iteratively extract line segments using RANSAC."""
    segments  = []
    remaining = points_2d.copy()

    while len(remaining) >= min_inliers:
        line, inlier_idx = fit_line_ransac_2d(remaining)
        if line is None or len(inlier_idx) < min_inliers:
            break

        inliers = remaining[inlier_idx]
        a, b, _ = line
        v       = np.array([-b, a])            # direction vector
        proj    = inliers.dot(v)
        p_start = inliers[np.argmin(proj)]
        p_end   = inliers[np.argmax(proj)]

        def project_onto_line(p, ln):
            la, lb, lc = ln
            d = la * p[0] + lb * p[1] + lc
            return np.array([p[0] - la * d, p[1] - lb * d])

        seg_len = np.linalg.norm(p_end - p_start)
        if seg_len > 0.3:                      # discard tiny spurious segments
            segments.append((
                project_onto_line(p_start, line),
                project_onto_line(p_end,   line),
            ))

        remaining = np.delete(remaining, inlier_idx, axis=0)

    return segments


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 4 — Blender geometry creation
# ─────────────────────────────────────────────────────────────────────────────

def _make_material(name: str, rgba):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value  = 0.75
        bsdf.inputs["Metallic"].default_value   = 0.05
    return mat


def clear_ascar_objects():
    """Remove all objects whose name starts with ASCAR_."""
    objs = [o for o in bpy.data.objects if o.name.startswith("ASCAR_")]
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for m in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(m)
    for m in [m for m in bpy.data.materials if m.users == 0]:
        bpy.data.materials.remove(m)
    print(f"[ASCAR] Cleared {len(objs)} old ASCAR objects.")


def build_point_cloud_mesh(cloud: np.ndarray):
    """Create a single mesh with one vertex per point (sub-sampled if too large)."""
    pts = cloud
    if len(pts) > MAX_DISPLAY_POINTS:
        idx = np.random.choice(len(pts), MAX_DISPLAY_POINTS, replace=False)
        pts = pts[idx]
        print(f"[ASCAR] Sub-sampled point cloud to {MAX_DISPLAY_POINTS:,} verts for display.")

    mesh = bpy.data.meshes.new("ASCAR_Cloud_Mesh")
    obj  = bpy.data.objects.new("ASCAR_PointCloud", mesh)
    bpy.context.scene.collection.objects.link(obj)

    # Build from vertices only — no edges / faces
    mesh.from_pydata(pts.tolist(), [], [])
    mesh.update()

    mat = _make_material("ASCAR_Mat_Cloud", COL_CLOUD)
    obj.data.materials.append(mat)
    print(f"[ASCAR] Point cloud mesh: {len(pts):,} vertices")
    return obj


def build_wall_geometry(segments: list):
    """Extrude each wall segment into a 3-D box."""
    if not segments:
        print("[ASCAR] No wall segments to build.")
        return

    mesh = bpy.data.meshes.new("ASCAR_Walls_Mesh")
    obj  = bpy.data.objects.new("ASCAR_Walls", mesh)
    bpy.context.scene.collection.objects.link(obj)

    bm = bmesh.new()
    for start_2d, end_2d in segments:
        dx  = end_2d[0] - start_2d[0]
        dy  = end_2d[1] - start_2d[1]
        length = np.hypot(dx, dy)
        if length < 1e-6:
            continue
        # Normal offset for wall thickness (half each side)
        nx  = -dy / length * (WALL_THICKNESS / 2.0)
        ny  =  dx / length * (WALL_THICKNESS / 2.0)

        # Note: our XZ LiDAR convention maps to Blender X, Y
        v1 = bm.verts.new((float(start_2d[0] + nx), float(start_2d[1] + ny), 0.0))
        v2 = bm.verts.new((float(start_2d[0] - nx), float(start_2d[1] - ny), 0.0))
        v3 = bm.verts.new((float(end_2d[0]   - nx), float(end_2d[1]   - ny), 0.0))
        v4 = bm.verts.new((float(end_2d[0]   + nx), float(end_2d[1]   + ny), 0.0))

        face = bm.faces.new((v1, v2, v3, v4))
        geom = bmesh.ops.extrude_discrete_faces(bm, faces=[face])
        bmesh.ops.translate(bm, vec=(0, 0, WALL_HEIGHT), verts=geom["faces"][0].verts)

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    mat = _make_material("ASCAR_Mat_Walls", COL_WALL)
    obj.data.materials.append(mat)
    print(f"[ASCAR] Wall mesh: {len(segments)} segments")
    return obj


def build_floor_plane(cloud: np.ndarray):
    """Create a flat floor quad that covers the XZ footprint of the scan."""
    floor_pts = cloud[cloud[:, 2] <= FLOOR_Z_THRESHOLD]
    if len(floor_pts) == 0:
        floor_pts = cloud
    xmin, xmax = float(floor_pts[:, 0].min()), float(floor_pts[:, 0].max())
    ymin, ymax = float(floor_pts[:, 1].min()), float(floor_pts[:, 1].max())

    # Add a small margin
    margin = 0.5
    mesh = bpy.data.meshes.new("ASCAR_Floor_Mesh")
    obj  = bpy.data.objects.new("ASCAR_Floor", mesh)
    bpy.context.scene.collection.objects.link(obj)

    bm = bmesh.new()
    bm.verts.new((xmin - margin, ymin - margin, 0.0))
    bm.verts.new((xmax + margin, ymin - margin, 0.0))
    bm.verts.new((xmax + margin, ymax + margin, 0.0))
    bm.verts.new((xmin - margin, ymax + margin, 0.0))
    bm.faces.new(bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    mat = _make_material("ASCAR_Mat_Floor", COL_FLOOR)
    obj.data.materials.append(mat)
    print(f"[ASCAR] Floor plane: X=[{xmin:.1f}, {xmax:.1f}] Y=[{ymin:.1f}, {ymax:.1f}]")
    return obj


def build_obstacles(obstacle_cells: np.ndarray):
    """Place small cubes at each obstacle grid cell centre."""
    if obstacle_cells is None or len(obstacle_cells) == 0:
        return

    mesh = bpy.data.meshes.new("ASCAR_Obstacles_Mesh")
    obj  = bpy.data.objects.new("ASCAR_Obstacles", mesh)
    bpy.context.scene.collection.objects.link(obj)

    bm = bmesh.new()
    for cx, cy in obstacle_cells:
        mat_t = mathutils.Matrix.Translation((float(cx), float(cy), 0.25))
        bmesh.ops.create_cube(bm, size=float(CELL_SIZE * 0.9), matrix=mat_t)

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    mat = _make_material("ASCAR_Mat_Obstacles", COL_OBSTACLE)
    obj.data.materials.append(mat)
    print(f"[ASCAR] Obstacle mesh: {len(obstacle_cells)} cells")
    return obj


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 5 — Density map → wall candidates vs obstacles
# ─────────────────────────────────────────────────────────────────────────────

def compute_density_map(cloud_2d: np.ndarray):
    """
    Project points onto XY and count hits per grid cell.
    Returns:
        wall_cells_2d     – centres of cells with count >= DENSITY_THRESHOLD
        obstacle_cells_2d – centres of cells with 0 < count < DENSITY_THRESHOLD
    """
    grid  = np.floor(cloud_2d / CELL_SIZE).astype(int)
    unique_cells, counts = np.unique(grid, axis=0, return_counts=True)

    wall_mask     = counts >= DENSITY_THRESHOLD
    obstacle_mask = (counts > 0) & (~wall_mask)

    wall_centres     = (unique_cells[wall_mask]     * CELL_SIZE + CELL_SIZE / 2.0)
    obstacle_centres = (unique_cells[obstacle_mask] * CELL_SIZE + CELL_SIZE / 2.0)

    return wall_centres.astype(np.float32), obstacle_centres.astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def build_scene():
    t_start = time.time()
    print("\n" + "=" * 68)
    print("  ASCAR-E  Offline Batch → Blender 3D Builder")
    print("=" * 68)

    # 1. Load all batch files
    raw_cloud = load_batches(BATCH_DIR, max_batches=MAX_BATCHES)

    # 2. Filter + downsample
    cloud = filter_and_downsample(raw_cloud)

    # 3. Clear previous ASCAR scene objects
    clear_ascar_objects()

    # 4. Point cloud display mesh
    build_point_cloud_mesh(cloud)

    # 5. Floor
    build_floor_plane(cloud)

    # 6. Separate floor from wall-level points for 2-D analysis
    wall_pts = cloud[cloud[:, 2] > FLOOR_Z_THRESHOLD]
    if len(wall_pts) == 0:
        wall_pts = cloud
    cloud_2d = wall_pts[:, :2]   # use X, Y for 2-D map (LiDAR XY plane)

    # 7. Density map → wall candidates & obstacles
    print(f"[ASCAR] Building density map ({len(wall_pts):,} wall-level points) …")
    wall_cells, obstacle_cells = compute_density_map(cloud_2d)
    print(f"[ASCAR] Density map: {len(wall_cells):,} wall cells, "
          f"{len(obstacle_cells):,} obstacle cells")

    # 8. RANSAC wall fitting on wall-candidate cell centres
    print(f"[ASCAR] Running RANSAC line extraction on {len(wall_cells):,} wall cell centres …")
    segments = extract_wall_segments(wall_cells, min_inliers=MIN_WALL_INLIERS)
    print(f"[ASCAR] Extracted {len(segments)} wall segments")

    # 9. Build Blender geometry
    build_wall_geometry(segments)
    build_obstacles(obstacle_cells)

    # 10. Final camera / view setup — frame all new objects
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            with bpy.context.temp_override(area=area, region=area.regions[-1]):
                bpy.ops.view3d.view_all(center=False)
            break

    elapsed = time.time() - t_start
    print(f"\n[ASCAR] ✅  Scene built in {elapsed:.1f}s")
    print(f"[ASCAR] Objects in scene: "
          f"ASCAR_PointCloud, ASCAR_Walls, ASCAR_Floor, ASCAR_Obstacles")
    print("=" * 68 + "\n")


# Run immediately when executed from Blender's script editor
build_scene()

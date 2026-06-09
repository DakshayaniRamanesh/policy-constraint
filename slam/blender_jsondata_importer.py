"""
blender_jsondata_importer.py
─────────────────────────────────────────────────────────────────────────────
ASCAR-E  —  jsondata_* Folder → Blender 3D Model Builder
(v2 — fixed maze / over-segmentation)

Reads the per-frame JSON files recorded by the Unitree Go2 LiDAR system
from a  jsondata_<timestamp>  folder and reconstructs a clean 3D model
inside Blender.

Each frame file (cloud_<timestamp>.json) is a flat JSON array of
point dicts:
    [ {"x": 0.123, "y": 4.567, "z": 0.089}, ... ]

The script builds:
  • ASCAR_PointCloud  – raw point cloud mesh (one vertex per LiDAR return)
  • ASCAR_Walls       – extruded wall geometry from RANSAC line fitting
  • ASCAR_Floor       – inferred floor plane
  • ASCAR_Obstacles   – cluster cubes for isolated / low-density features

WHY THE MAZE HAPPENED (v1 bug):
  With 700+ frames the same wall is scanned from many positions.
  Low MIN_WALL_INLIERS (15) and tight RANSAC_THRESHOLD (0.12 m) meant
  every slight angular variation in the point cloud produced a separate
  phantom wall slice → hundreds of thin parallel walls.

FIXES IN v2:
  1. Coarser voxel downsampling (0.15 m) collapses overlapping cloud copies.
  2. Higher MIN_WALL_INLIERS (80) — only dominant planes kept.
  3. Wider RANSAC_THRESHOLD (0.20 m) — tolerates scan-to-scan noise.
  4. Minimum segment length 1.0 m — no tiny wall slivers.
  5. Wall deduplication: parallel walls within MERGE_DIST of each other
     are collapsed into a single wall (longest kept).
  6. MAX_WALLS cap (30) prevents runaway RANSAC loops.
  7. Wall fitting uses a mid-height Z slice (0.5–1.5 m) instead of all
     wall-level points, reducing floor/ceiling bleed.
  8. DENSITY_THRESHOLD raised (10) so only genuinely dense cells feed RANSAC.

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

# Absolute path to the  jsondata_*  folder containing cloud_*.json files.
# This is the INNER folder, e.g.:
#   /home/rashad/Downloads/jsondata_1970-01-01_14-10-30-.../jsondata_1970-01-01_14-10-30
BATCH_FOLDER = "/home/rashad/policy-constraint/slam/pointcloud_batches/jsondata_1970-01-01_14-11-31-20260608T164153Z-3-001/jsondata_1970-01-01_14-11-31"

# ── Blender-safe auto-detect fallback ─────────────────────────────────────────
if not os.path.isdir(BATCH_FOLDER):
    def _try_find_jsondata(base_dir):
        if not base_dir:
            return None
        for entry in os.scandir(base_dir):
            if entry.is_dir() and entry.name.startswith("jsondata_"):
                return entry.path
        return None
    _blend_dir = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ""
    _found = _try_find_jsondata(_blend_dir)
    if not _found:
        for _t in bpy.data.texts:
            if _t.filepath:
                _found = _try_find_jsondata(os.path.dirname(_t.filepath))
                if _found:
                    break
    if _found:
        BATCH_FOLDER = _found
        print(f"[ASCAR] Auto-detected BATCH_FOLDER: {BATCH_FOLDER}")

# How many frame files to load (None = all).
MAX_FRAMES = None

# ── DOWNSAMPLING ──────────────────────────────────────────────────────────────
# Coarser voxel collapses the same wall seen from 700 frames into one layer.
# 0.15 m is the sweet spot: eliminates duplicates without losing wall shape.
VOXEL_SIZE = 0.15          # metres  (was 0.05 → caused point explosion)

# ── HEIGHT FILTERS ────────────────────────────────────────────────────────────
Z_MIN = -0.10    # discard floor returns below robot base
Z_MAX =  2.50    # discard ceiling / overhead structure

# Points used for wall fitting: a mid-height slice avoids floor and ceiling
# bleed-through which added spurious near-horizontal line candidates.
WALL_Z_MIN = 0.50   # metres  — bottom of wall-fitting slice
WALL_Z_MAX = 1.50   # metres  — top of wall-fitting slice

# Floor: everything below this Z treated as floor plane
FLOOR_Z_THRESHOLD = 0.15   # metres

# ── RANSAC WALL FITTING ───────────────────────────────────────────────────────
RANSAC_ITERATIONS = 500    # more iterations → more reliable dominant line
RANSAC_THRESHOLD  = 0.20   # inlier band (m)  — wider tolerates scan noise
MIN_WALL_INLIERS  = 80     # minimum cell votes to accept a wall  (was 15!)
MAX_WALLS         = 30     # hard cap on walls extracted (prevents runaway)
MIN_WALL_LENGTH   = 1.0    # metres — discard tiny slivers  (was 0.3 m)
WALL_HEIGHT       = 2.60   # metres — extruded height of wall geometry
WALL_THICKNESS    = 0.15   # metres

# ── WALL DEDUPLICATION ────────────────────────────────────────────────────────
# Two parallel walls whose perpendicular offset is less than MERGE_DIST are
# considered the same physical wall.  Only the longer one is kept.
MERGE_DIST        = 0.40   # metres
MERGE_ANGLE_TOL   = 0.15   # radians (~8.6°) — max angle diff to call "parallel"

# ── OBSTACLE CLUSTERING ───────────────────────────────────────────────────────
CELL_SIZE          = 0.25   # grid cell size for density map
DENSITY_THRESHOLD  = 10     # cells with fewer points → obstacle  (was 3!)

# ── POINT CLOUD DISPLAY ───────────────────────────────────────────────────────
MAX_DISPLAY_POINTS = 300_000

# ── MATERIAL COLOURS (RGBA) ───────────────────────────────────────────────────
COL_WALL     = (0.18, 0.45, 0.72, 1.0)   # steel blue
COL_FLOOR    = (0.25, 0.25, 0.25, 1.0)   # dark grey
COL_OBSTACLE = (0.85, 0.45, 0.10, 1.0)   # amber
COL_CLOUD    = (0.10, 0.90, 0.55, 1.0)   # teal-green

# ── BATCH LABEL ───────────────────────────────────────────────────────────────
_BATCH_LABEL = os.path.basename(BATCH_FOLDER.rstrip("/\\")).replace(" ", "_")[:40]


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 1 — Load all cloud_*.json frame files
# ─────────────────────────────────────────────────────────────────────────────

def load_jsondata_folder(folder: str, max_frames=None) -> np.ndarray:
    """
    Read every cloud_*.json in folder.
    Each file is a flat list of {"x":..., "y":..., "z":...} dicts.
    Returns an (N, 3) float32 numpy array of all concatenated points.
    """
    pattern = os.path.join(folder, "cloud_*.json")
    files   = sorted(glob.glob(pattern))

    if not files:
        raise FileNotFoundError(
            f"No cloud_*.json files found in:\n  {folder}\n"
            "Check that BATCH_FOLDER points to the correct jsondata_* folder."
        )

    if max_frames:
        files = files[:max_frames]

    print(f"[ASCAR] Loading {len(files)} frame file(s) from:\n  {folder}")

    all_points = []
    skipped    = []
    t0 = time.time()

    for i, fpath in enumerate(files):
        # ── Gracefully skip truncated / corrupt JSON files ────────────────
        try:
            with open(fpath, "r") as f:
                frame = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
            skipped.append(os.path.basename(fpath))
            if len(skipped) <= 5:   # only print first 5 to avoid log spam
                print(f"  ⚠ Skipping corrupt file: {os.path.basename(fpath)} ({e})")
            continue

        if isinstance(frame, list) and frame:
            pts = np.array(
                [[p["x"], p["y"], p["z"]] for p in frame],
                dtype=np.float32
            )
            all_points.append(pts)
        elif isinstance(frame, dict):
            pts_raw = frame.get("points", [])
            if pts_raw:
                arr = np.array(pts_raw, dtype=np.float32)
                if arr.ndim == 2 and arr.shape[1] >= 3:
                    all_points.append(arr[:, :3])
                else:
                    pts = np.array(
                        [[p["x"], p["y"], p["z"]] for p in pts_raw],
                        dtype=np.float32
                    )
                    all_points.append(pts)

        if (i + 1) % 100 == 0 or i == len(files) - 1:
            loaded = sum(len(a) for a in all_points)
            print(f"  Loaded {i + 1}/{len(files)} frames — {loaded:,} points …")

    if not all_points:
        raise ValueError("Frame files contain no point data.")

    cloud = np.vstack(all_points)
    good  = len(files) - len(skipped)
    skip_msg = f"  ({len(skipped)} corrupt file(s) skipped)" if skipped else ""
    print(f"[ASCAR] Loaded {len(cloud):,} raw points from {good} frames "
          f"in {time.time() - t0:.1f}s{skip_msg}")
    return cloud


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 2 — Filter + voxel downsample
# ─────────────────────────────────────────────────────────────────────────────

def filter_and_downsample(cloud: np.ndarray,
                           z_min=Z_MIN, z_max=Z_MAX,
                           voxel=VOXEL_SIZE) -> np.ndarray:
    """Height-clip then voxel-downsample to collapse multi-frame duplicates."""
    mask  = (cloud[:, 2] >= z_min) & (cloud[:, 2] <= z_max)
    cloud = cloud[mask]
    print(f"[ASCAR] After Z-filter [{z_min}, {z_max}] m: {len(cloud):,} points")

    if voxel > 0:
        idx  = np.floor(cloud / voxel).astype(np.int32)
        keys = (idx[:, 0].astype(np.int64) * (2**21) +
                idx[:, 1].astype(np.int64) * (2**11) +
                idx[:, 2].astype(np.int64))
        _, ui = np.unique(keys, return_index=True)
        cloud = cloud[ui]
        print(f"[ASCAR] After voxel downsample ({voxel} m): {len(cloud):,} points")

    return cloud


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 3 — Density map → wall candidates vs obstacles
# ─────────────────────────────────────────────────────────────────────────────

def compute_density_map(cloud_2d: np.ndarray):
    """
    Project points onto XY plane and count hits per grid cell.
    Only cells with >= DENSITY_THRESHOLD hits are wall candidates.
    """
    grid  = np.floor(cloud_2d / CELL_SIZE).astype(int)
    unique_cells, counts = np.unique(grid, axis=0, return_counts=True)

    wall_mask     = counts >= DENSITY_THRESHOLD
    obstacle_mask = (counts > 0) & (~wall_mask)

    wall_centres     = (unique_cells[wall_mask]     * CELL_SIZE + CELL_SIZE / 2.0)
    obstacle_centres = (unique_cells[obstacle_mask] * CELL_SIZE + CELL_SIZE / 2.0)

    return wall_centres.astype(np.float32), obstacle_centres.astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 4 — RANSAC 2-D line extraction
# ─────────────────────────────────────────────────────────────────────────────

def fit_line_ransac_2d(points_2d: np.ndarray,
                        iterations=RANSAC_ITERATIONS,
                        threshold=RANSAC_THRESHOLD):
    """Fit the best 2-D line to points_2d using RANSAC.
    Returns (a, b, c) normalised line coefficients and inlier indices."""
    n = len(points_2d)
    if n < 2:
        return None, []

    best_line    = None
    best_inliers = []

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


def _project_onto_line(p, ln):
    la, lb, lc = ln
    d = la * p[0] + lb * p[1] + lc
    return np.array([p[0] - la * d, p[1] - lb * d])


def extract_wall_segments(points_2d: np.ndarray,
                           min_inliers=MIN_WALL_INLIERS,
                           max_walls=MAX_WALLS,
                           min_length=MIN_WALL_LENGTH) -> list:
    """
    Iteratively extract dominant line segments using RANSAC.
    Each iteration finds the best line, removes its inliers, then repeats.
    Segments shorter than min_length or with too few inliers are discarded.
    """
    segments  = []
    remaining = points_2d.copy()

    while len(remaining) >= min_inliers and len(segments) < max_walls:
        line, inlier_idx = fit_line_ransac_2d(remaining)
        if line is None or len(inlier_idx) < min_inliers:
            break

        inliers = remaining[inlier_idx]
        a, b, _ = line
        v       = np.array([-b, a])           # direction vector along the line
        proj    = inliers.dot(v)
        p_start = inliers[np.argmin(proj)]
        p_end   = inliers[np.argmax(proj)]

        seg_start = _project_onto_line(p_start, line)
        seg_end   = _project_onto_line(p_end,   line)
        seg_len   = np.linalg.norm(seg_end - seg_start)

        if seg_len >= min_length:
            segments.append((seg_start, seg_end, line))   # store line too for dedup

        remaining = np.delete(remaining, inlier_idx, axis=0)

    return segments


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 5 — Wall deduplication
#  Merge parallel walls that are offset by < MERGE_DIST (same physical wall
#  seen from different robot positions).
# ─────────────────────────────────────────────────────────────────────────────

def _segment_angle(seg):
    """Return angle of segment direction in [0, π) — direction-agnostic."""
    s, e, _ = seg
    dx, dy = e[0] - s[0], e[1] - s[1]
    angle = np.arctan2(dy, dx) % np.pi
    return angle


def _segment_length(seg):
    s, e, _ = seg
    return np.linalg.norm(np.array(e) - np.array(s))


def _perpendicular_distance(seg_a, seg_b):
    """Perpendicular distance between two parallel line segments."""
    _, _, (a, b, c) = seg_a
    # Distance from midpoint of seg_b to the line of seg_a
    s2, e2, _ = seg_b
    mid = (np.array(s2) + np.array(e2)) / 2.0
    return abs(a * mid[0] + b * mid[1] + c)


def deduplicate_walls(segments: list,
                       merge_dist=MERGE_DIST,
                       angle_tol=MERGE_ANGLE_TOL) -> list:
    """
    Remove duplicate wall segments:
      - Group segments with similar angle (< angle_tol radians apart).
      - Within each group, merge segments whose perpendicular offset is
        < merge_dist (same physical wall from different viewpoints).
      - Keep only the longest segment from each merged group.
    """
    if not segments:
        return []

    used   = [False] * len(segments)
    kept   = []

    for i in range(len(segments)):
        if used[i]:
            continue
        group = [i]
        ai    = _segment_angle(segments[i])

        for j in range(i + 1, len(segments)):
            if used[j]:
                continue
            aj = _segment_angle(segments[j])
            # Angles are direction-agnostic in [0, π)
            diff = abs(ai - aj)
            diff = min(diff, np.pi - diff)
            if diff > angle_tol:
                continue
            # Check perpendicular offset
            try:
                perp = _perpendicular_distance(segments[i], segments[j])
            except Exception:
                continue
            if perp < merge_dist:
                group.append(j)

        # Keep the longest segment in this group
        best = max(group, key=lambda k: _segment_length(segments[k]))
        kept.append(segments[best])
        for k in group:
            used[k] = True

    print(f"[ASCAR] Deduplication: {len(segments)} → {len(kept)} wall segments")
    return kept


# ─────────────────────────────────────────────────────────────────────────────
#  STEP 6 — Blender geometry builders
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


def clear_ascar_objects(label: str = ""):
    """Remove all ASCAR_ objects (optionally only those matching label)."""
    prefix = f"ASCAR_{label}" if label else "ASCAR_"
    objs = [o for o in bpy.data.objects if o.name.startswith(prefix)]
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for m in [m for m in bpy.data.meshes   if m.users == 0]:
        bpy.data.meshes.remove(m)
    for m in [m for m in bpy.data.materials if m.users == 0]:
        bpy.data.materials.remove(m)
    print(f"[ASCAR] Cleared {len(objs)} old objects.")


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)


def build_point_cloud_mesh(cloud: np.ndarray, label: str = ""):
    pts = cloud
    if len(pts) > MAX_DISPLAY_POINTS:
        idx = np.random.choice(len(pts), MAX_DISPLAY_POINTS, replace=False)
        pts = pts[idx]
        print(f"[ASCAR] Sub-sampled display cloud to {MAX_DISPLAY_POINTS:,} verts.")

    name = f"ASCAR_{label}_PointCloud" if label else "ASCAR_PointCloud"
    mesh = bpy.data.meshes.new(name + "_Mesh")
    obj  = bpy.data.objects.new(name, mesh)
    _link(obj)
    mesh.from_pydata(pts.tolist(), [], [])
    mesh.update()
    obj.data.materials.append(_make_material(f"ASCAR_Mat_Cloud_{label}", COL_CLOUD))
    print(f"[ASCAR] Point cloud: {len(pts):,} vertices")
    return obj


def build_wall_geometry(segments: list, label: str = ""):
    """Extrude each deduplicated wall segment into a 3-D box."""
    if not segments:
        print("[ASCAR] No wall segments to build.")
        return

    name = f"ASCAR_{label}_Walls" if label else "ASCAR_Walls"
    mesh = bpy.data.meshes.new(name + "_Mesh")
    obj  = bpy.data.objects.new(name, mesh)
    _link(obj)

    bm = bmesh.new()
    for seg in segments:
        start_2d, end_2d = seg[0], seg[1]
        dx  = end_2d[0] - start_2d[0]
        dy  = end_2d[1] - start_2d[1]
        length = np.hypot(dx, dy)
        if length < 1e-6:
            continue
        nx = -dy / length * (WALL_THICKNESS / 2.0)
        ny =  dx / length * (WALL_THICKNESS / 2.0)

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
    obj.data.materials.append(_make_material(f"ASCAR_Mat_Walls_{label}", COL_WALL))
    print(f"[ASCAR] Wall geometry: {len(segments)} segments")
    return obj


def build_floor_plane(cloud: np.ndarray, label: str = ""):
    floor_pts = cloud[cloud[:, 2] <= FLOOR_Z_THRESHOLD]
    if len(floor_pts) == 0:
        floor_pts = cloud
    xmin = float(floor_pts[:, 0].min());  xmax = float(floor_pts[:, 0].max())
    ymin = float(floor_pts[:, 1].min());  ymax = float(floor_pts[:, 1].max())
    margin = 0.5

    name = f"ASCAR_{label}_Floor" if label else "ASCAR_Floor"
    mesh = bpy.data.meshes.new(name + "_Mesh")
    obj  = bpy.data.objects.new(name, mesh)
    _link(obj)

    bm = bmesh.new()
    bm.verts.new((xmin - margin, ymin - margin, 0.0))
    bm.verts.new((xmax + margin, ymin - margin, 0.0))
    bm.verts.new((xmax + margin, ymax + margin, 0.0))
    bm.verts.new((xmin - margin, ymax + margin, 0.0))
    bm.faces.new(bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj.data.materials.append(_make_material(f"ASCAR_Mat_Floor_{label}", COL_FLOOR))
    print(f"[ASCAR] Floor: X=[{xmin:.1f},{xmax:.1f}]  Y=[{ymin:.1f},{ymax:.1f}]")
    return obj


def build_obstacles(obstacle_cells: np.ndarray, label: str = ""):
    if obstacle_cells is None or len(obstacle_cells) == 0:
        return

    name = f"ASCAR_{label}_Obstacles" if label else "ASCAR_Obstacles"
    mesh = bpy.data.meshes.new(name + "_Mesh")
    obj  = bpy.data.objects.new(name, mesh)
    _link(obj)

    bm = bmesh.new()
    for cx, cy in obstacle_cells:
        mat_t = mathutils.Matrix.Translation((float(cx), float(cy), 0.25))
        bmesh.ops.create_cube(bm, size=float(CELL_SIZE * 0.85), matrix=mat_t)

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj.data.materials.append(_make_material(f"ASCAR_Mat_Obstacles_{label}", COL_OBSTACLE))
    print(f"[ASCAR] Obstacles: {len(obstacle_cells)} cells")
    return obj


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def build_scene():
    t_start = time.time()
    label   = _BATCH_LABEL

    print("\n" + "=" * 68)
    print("  ASCAR-E  jsondata_* → Blender 3D Builder  (v2 — no maze)")
    print(f"  Batch : {label}")
    print(f"  Folder: {BATCH_FOLDER}")
    print("=" * 68)

    if not os.path.isdir(BATCH_FOLDER):
        raise FileNotFoundError(
            f"BATCH_FOLDER does not exist:\n  {BATCH_FOLDER}"
        )

    # 1. Load frames
    raw_cloud = load_jsondata_folder(BATCH_FOLDER, max_frames=MAX_FRAMES)

    # 2. Filter + downsample (coarser voxel collapses multi-frame duplicates)
    cloud = filter_and_downsample(raw_cloud)

    # 3. Clear old objects
    clear_ascar_objects(label=label)

    # 4. Point cloud display
    build_point_cloud_mesh(cloud, label=label)

    # 5. Floor plane
    build_floor_plane(cloud, label=label)

    # 6. Wall-fitting uses a mid-height Z slice (avoids floor / ceiling bleed)
    wall_pts = cloud[(cloud[:, 2] >= WALL_Z_MIN) & (cloud[:, 2] <= WALL_Z_MAX)]
    if len(wall_pts) < 10:
        print("[ASCAR] ⚠ Very few wall-slice points — falling back to all heights")
        wall_pts = cloud[cloud[:, 2] > FLOOR_Z_THRESHOLD]
    cloud_2d = wall_pts[:, :2]
    print(f"[ASCAR] Wall-slice points (Z {WALL_Z_MIN}–{WALL_Z_MAX} m): {len(wall_pts):,}")

    # 7. Density map — high threshold filters out isolated noise
    wall_cells, obstacle_cells = compute_density_map(cloud_2d)
    print(f"[ASCAR] Density map: {len(wall_cells):,} wall cells, "
          f"{len(obstacle_cells):,} obstacle cells")

    # 8. RANSAC wall fitting on dense cell centres
    print(f"[ASCAR] RANSAC on {len(wall_cells):,} cells "
          f"(min_inliers={MIN_WALL_INLIERS}, threshold={RANSAC_THRESHOLD} m, "
          f"min_length={MIN_WALL_LENGTH} m, max_walls={MAX_WALLS}) …")
    raw_segments = extract_wall_segments(wall_cells)
    print(f"[ASCAR] Raw segments: {len(raw_segments)}")

    # 9. Deduplicate — collapse phantom parallel duplicates from multi-frame data
    segments = deduplicate_walls(raw_segments)

    # 10. Build Blender geometry
    build_wall_geometry(segments, label=label)
    build_obstacles(obstacle_cells, label=label)

    # 11. Fit viewport to scene
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            with bpy.context.temp_override(area=area, region=area.regions[-1]):
                bpy.ops.view3d.view_all(center=False)
            break

    elapsed = time.time() - t_start
    print(f"\n[ASCAR] ✅  Scene built in {elapsed:.1f}s — {len(segments)} clean walls")
    print(f"[ASCAR] Objects: ASCAR_{label}_PointCloud / _Walls / _Floor / _Obstacles")
    print("=" * 68 + "\n")


# Run immediately when executed from Blender's script editor
build_scene()

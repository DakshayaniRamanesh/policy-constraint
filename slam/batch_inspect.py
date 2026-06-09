"""
batch_inspect.py
────────────────────────────────────────────────────────────────────
Quick terminal inspector for ASCAR point-cloud batch files.

Run from the slam/ directory:
    python batch_inspect.py [--dir pointcloud_batches] [--n 5]

Shows per-batch stats and overall bounding box so you can verify the
data is correct before sending it to blender_batch_importer.py.
"""

import json, glob, os, argparse, time
import numpy as np


def inspect(batch_dir: str, n_batches=None, verbose: bool = False):
    pattern = os.path.join(batch_dir, "ascar_batch_*.json")
    files   = sorted(glob.glob(pattern))

    if not files:
        print(f"ERROR: No ascar_batch_*.json files found in {batch_dir!r}")
        return

    if n_batches:
        files = files[:n_batches]

    print(f"\n{'='*65}")
    print(f"  ASCAR Batch Inspector  ({len(files)} files)")
    print(f"  Directory: {batch_dir}")
    print(f"{'='*65}\n")

    all_pts = []
    t0 = time.time()

    for i, fp in enumerate(files):
        with open(fp) as f:
            batch = json.load(f)

        meta   = batch.get("metadata", {})
        frames = batch.get("frames", [])
        pts_in_batch = sum(len(fr.get("points", [])) for fr in frames)

        if verbose or i < 3 or i == len(files) - 1:
            print(f"  [{i+1:04d}] {os.path.basename(fp)}")
            print(f"         batch_num={meta.get('batch_num')}  "
                  f"n_frames={meta.get('n_frames')}  "
                  f"pts={pts_in_batch:,}")

        for fr in frames:
            pts = fr.get("points", [])
            if pts:
                all_pts.append(np.array(pts, dtype=np.float32))

    if not all_pts:
        print("No points found in any batch file!")
        return

    cloud = np.vstack(all_pts)
    elapsed = time.time() - t0

    print(f"\n{'─'*65}")
    print(f"  Total raw points : {len(cloud):>12,}")
    print(f"  Load time        : {elapsed:.2f}s")
    print(f"\n  Bounding box (X,Y,Z):")
    for axis, label in [(0,"X"), (1,"Y"), (2,"Z")]:
        mn, mx = cloud[:, axis].min(), cloud[:, axis].max()
        print(f"    {label}: [{mn:+.3f}  →  {mx:+.3f}]  span={mx-mn:.2f} m")

    # Height histogram
    z = cloud[:, 2]
    print(f"\n  Z distribution (height):")
    bins = [-0.5, 0.0, 0.1, 0.3, 0.7, 1.2, 2.0, 3.0, 4.0]
    counts, edges = np.histogram(z, bins=bins)
    for lo, hi, cnt in zip(edges[:-1], edges[1:], counts):
        bar = "█" * min(40, int(cnt / max(counts) * 40))
        pct = cnt / len(z) * 100
        print(f"    {lo:+.1f} … {hi:+.1f} m  {bar:<40} {cnt:>8,}  ({pct:.1f}%)")

    print(f"\n{'='*65}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ASCAR batch file inspector")
    parser.add_argument("--dir", default="pointcloud_batches",
                        help="Path to folder containing ascar_batch_*.json files")
    parser.add_argument("--n",   type=int, default=None,
                        help="Number of batch files to inspect (default: all)")
    parser.add_argument("--verbose", action="store_true",
                        help="Print info for every file (not just first/last 3)")
    args = parser.parse_args()

    batch_dir = args.dir
    if not os.path.isabs(batch_dir):
        batch_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), batch_dir)

    inspect(batch_dir, n_batches=args.n, verbose=args.verbose)

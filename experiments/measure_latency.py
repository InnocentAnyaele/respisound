"""Single-clip latency and dependency footprint for C2, C5 and C6.

Implements ANALYSIS_PLAN.md section 4. Times are measured on CPU, one clip at a
time, never batched. Models are fitted on grouped-protocol fold 0 of repeat 0
(the same frozen fold the paper uses); only inference is timed.

Usage:
    python measure_latency.py [--audio-root /path/to/ADDv2] [--n-clips 200]
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from importlib.util import find_spec
from pathlib import Path

import numpy as np
import pandas as pd

import config as C
from common import audio_paths, folds, labels, load_cache, load_manifest, write_env
from extract_features import f30, load16k, logmel
from run_classical import build, features, resolve
from run_crnn import RespiSoundCRNN


def machine_spec() -> dict:
    spec = {
        "utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_count_logical": os.cpu_count(),
        "python": sys.version.split()[0],
        "cuda": None,
    }
    try:
        import torch
        spec["cuda"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        spec["torch"] = torch.__version__
    except Exception:
        pass
    if sys.platform == "win32":
        try:
            spec["cpu_name"] = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-CimInstance Win32_Processor).Name"],
                text=True, timeout=15).strip()
        except Exception:
            spec["cpu_name"] = spec["processor"]
        try:
            bytes_ram = int(subprocess.check_output(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
                text=True, timeout=15).strip())
            spec["ram_gb"] = round(bytes_ram / 1e9, 1)
        except Exception:
            spec["ram_gb"] = None
    else:
        spec["cpu_name"] = spec["processor"]
        try:
            pages = os.sysconf("SC_PHYS_PAGES")
            page = os.sysconf("SC_PAGE_SIZE")
            spec["ram_gb"] = round(pages * page / 1e9, 1)
        except Exception:
            spec["ram_gb"] = None
    return spec


def _dir_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def package_bytes(modname: str) -> int:
    spec = find_spec(modname)
    if spec is None or not spec.origin:
        return 0
    origin = Path(spec.origin)
    root = origin.parent if origin.name == "__init__.py" else origin
    # torch ships a large lib/ next to the package; include the whole distribution tree
    if modname == "torch":
        return _dir_bytes(root)
    return _dir_bytes(root)


def footprint() -> dict:
    sklearn_stack = ("numpy", "scipy", "sklearn", "joblib", "librosa", "soundfile", "soxr")
    sizes = {name: package_bytes(name) for name in (*sklearn_stack, "torch")}
    sklearn_only = sum(sizes[n] for n in sklearn_stack)
    return {
        "bytes": sizes,
        "sklearn_only_mb": round(sklearn_only / 1e6, 1),
        "torch_mb": round(sizes["torch"] / 1e6, 1),
        "sklearn_plus_torch_mb": round((sklearn_only + sizes["torch"]) / 1e6, 1),
        "note": ("Sizes are the on-disk package directories of the named modules in this "
                 "environment, not a freshly pip-installed wheel set. sklearn-only is the "
                 "classical serving stack; sklearn_plus_torch is that stack plus PyTorch."),
    }


def fit_classical(cid: str, m, y, tr: np.ndarray):
    spec = resolve(cid)
    X = features(spec, m)
    pipe = build(spec, seed=0)
    # Single-clip serving: do not parallelise the forest across cores.
    if cid == "C5":
        pipe.set_params(clf__n_jobs=1)
    pipe.fit(X[tr], y[tr])
    return pipe


def fit_crnn_untrained():
    """Weights are unused for timing; instantiate the deployed architecture on CPU."""
    import torch
    model = RespiSoundCRNN(len(C.CLASSES), C.CRNN["dropout"])
    model.eval()
    return model


def time_one(fn) -> float:
    t0 = time.perf_counter()
    fn()
    return time.perf_counter() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio-root", type=Path, default=None)
    ap.add_argument("--n-clips", type=int, default=C.N_LATENCY_CLIPS)
    ap.add_argument("--warmup", type=int, default=C.N_LATENCY_WARMUP)
    args = ap.parse_args()

    write_env("latency")
    spec = machine_spec()
    fp = footprint()
    (C.RESULTS / "machine.json").write_text(json.dumps({**spec, "footprint": fp}, indent=2))
    print("Machine:", spec.get("cpu_name") or spec["processor"],
          f"| {spec.get('ram_gb')} GB RAM | cuda={spec['cuda']}")
    print(f"Footprint: sklearn-only {fp['sklearn_only_mb']} MB | "
          f"+torch {fp['sklearn_plus_torch_mb']} MB (torch itself {fp['torch_mb']} MB)")

    m = load_manifest()
    y = labels(m)
    paths = audio_paths(m, args.audio_root)
    _, tr, te = next(folds(m, "grouped", 0))
    rng = np.random.default_rng(0)
    take = min(args.n_clips + args.warmup, len(te))
    sample = rng.choice(te, size=take, replace=False)

    print(f"Fitting C2 and C5 on grouped r0 fold 0 training set (n={len(tr)})…")
    pipes = {cid: fit_classical(cid, m, y, tr) for cid in ("C2", "C5")}
    crnn = fit_crnn_untrained()

    import torch

    rows = []
    for i, idx in enumerate(sample):
        path = paths[idx]
        t0 = time.perf_counter()
        wav = load16k(path)
        load_s = time.perf_counter() - t0

        t0 = time.perf_counter()
        vec = f30(wav)
        f30_s = time.perf_counter() - t0

        t0 = time.perf_counter()
        mel = logmel(wav, C.SHORT_WIN_S)
        mel_s = time.perf_counter() - t0

        x = vec.reshape(1, -1)
        c2_s = time_one(lambda: pipes["C2"].predict_proba(x))
        c5_s = time_one(lambda: pipes["C5"].predict_proba(x))

        xt = torch.from_numpy(mel).unsqueeze(0).unsqueeze(0)
        def _crnn_call(t=xt):
            with torch.no_grad():
                torch.softmax(crnn(t), 1)
        c6_s = time_one(_crnn_call)

        rec = {
            "file_id": m.file_id.iloc[idx],
            "warmup": i < args.warmup,
            "load_s": load_s,
            "feat_f30_s": f30_s,
            "feat_mel_s": mel_s,
            "predict_C2_s": c2_s,
            "predict_C5_s": c5_s,
            "predict_C6_s": c6_s,
            "e2e_C2_s": load_s + f30_s + c2_s,
            "e2e_C5_s": load_s + f30_s + c5_s,
            "e2e_C6_s": load_s + mel_s + c6_s,
        }
        rows.append(rec)
        if (i + 1) % 50 == 0 or i + 1 == take:
            print(f"  timed {i + 1}/{take}")

    raw = pd.DataFrame(rows)
    timed = raw[~raw.warmup]
    if len(timed) < args.n_clips:
        print(f"WARNING: only {len(timed)} timed clips (asked for {args.n_clips})")

    stages = [
        ("C2", "load_s", "feat_f30_s", "predict_C2_s", "e2e_C2_s"),
        ("C5", "load_s", "feat_f30_s", "predict_C5_s", "e2e_C5_s"),
        ("C6", "load_s", "feat_mel_s", "predict_C6_s", "e2e_C6_s"),
    ]
    summary_rows = []
    for cid, load_c, feat_c, pred_c, e2e_c in stages:
        for stage, col in (("load_resample", load_c), ("feature", feat_c),
                           ("model", pred_c), ("end_to_end", e2e_c)):
            v = timed[col].to_numpy()
            summary_rows.append({
                "config": cid, "stage": stage, "n": len(v),
                "median_ms": round(float(np.median(v) * 1000), 2),
                "p95_ms": round(float(np.percentile(v, 95) * 1000), 2),
            })
    summary = pd.DataFrame(summary_rows)
    C.RESULTS.mkdir(parents=True, exist_ok=True)
    raw.to_csv(C.RESULTS / "latency_clips.csv", index=False)
    summary.to_csv(C.RESULTS / "latency_summary.csv", index=False)

    print("\nLatency (median / p95, milliseconds), single-clip, CPU:")
    for cid, g in summary.groupby("config", sort=False):
        parts = [f"{r.stage} {r.median_ms:.1f}/{r.p95_ms:.1f}" for r in g.itertuples()]
        print(f"  {cid}:  " + "  |  ".join(parts))
    print(f"\nWrote {C.RESULTS / 'latency_summary.csv'} and machine.json")


if __name__ == "__main__":
    main()

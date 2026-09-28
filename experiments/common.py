"""Shared helpers: seeding, manifest and cache loading, folds, metrics, result I/O."""
from __future__ import annotations

import json
import platform
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import config as C


# ---------------------------------------------------------------- seeding
def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
    except ImportError:
        pass


# ---------------------------------------------------------------- data
def load_manifest() -> pd.DataFrame:
    """Rows that loaded successfully, in the fixed order every cache file follows."""
    m = pd.read_csv(C.MANIFEST)
    return m[m.status == "ok"].reset_index(drop=True)


def audio_paths(m: pd.DataFrame, audio_root=None) -> list:
    """Absolute paths from the manifest, or rel_path re-rooted under audio_root when the
    manifest was built on another machine. Never rebuild the manifest just to fix paths:
    it holds the frozen folds.

    rel_path is stored with the separator of the machine that built the manifest, so a
    Windows-built manifest carries backslashes. On Linux those are ordinary filename
    characters, not separators, hence the normalisation."""
    if audio_root is None:
        return list(m.path)
    return [str(Path(audio_root) / r.replace("\\", "/")) for r in m.rel_path]


def labels(m: pd.DataFrame) -> np.ndarray:
    return np.array(m.label.map({c: i for i, c in enumerate(C.CLASSES)}), dtype=np.int64)  # writable copy


def load_cache(name: str, m: pd.DataFrame, mmap: bool = False) -> np.ndarray:
    """Load a cached array and check it is aligned with the manifest row order."""
    index = pd.read_csv(C.CACHE / "index.csv")
    if not index.file_id.equals(m.file_id):
        raise RuntimeError("Feature cache is out of sync with the manifest. "
                           "Re-run extract_features.py after rebuilding the manifest.")
    return np.load(C.CACHE / f"{name}.npy", mmap_mode="r" if mmap else None)


def folds(m: pd.DataFrame, protocol: str, repeat: int):
    """Yield (fold, train_idx, test_idx) from the fold column frozen in the manifest."""
    f = m[f"fold_{protocol}_r{repeat}"].to_numpy()
    for k in range(C.N_FOLDS):
        yield k, np.flatnonzero(f != k), np.flatnonzero(f == k)


# ---------------------------------------------------------------- metrics
def score(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """Macro recall over classes present in the test fold, plus per-class recall."""
    from sklearn.metrics import accuracy_score, f1_score

    rec = {}
    for i, c in enumerate(C.CLASSES):
        mask = y_true == i
        rec[c] = float((y_pred[mask] == i).mean()) if mask.any() else np.nan
    present = np.unique(y_true)
    return {
        "macro_recall": float(np.nanmean(list(rec.values()))),
        "macro_f1": float(f1_score(y_true, y_pred, labels=present, average="macro", zero_division=0)),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "n_classes_in_test": int(len(present)),
        **{f"recall_{c}": v for c, v in rec.items()},
    }


def fold_info(m: pd.DataFrame, te: np.ndarray) -> dict:
    t = m.iloc[te]
    b = t[t.label == "bronchial"]
    return {"n_test_bronchial_clips": len(b), "n_test_bronchial_groups": b.patient_group.nunique()}


# ---------------------------------------------------------------- results I/O
def _path(kind: str, config: str, protocol: str, repeat: int) -> Path:
    return C.RESULTS / kind / f"{config}__{protocol}__r{repeat}.csv"


def repeat_done(config: str, protocol: str, repeat: int) -> bool:
    p = _path("runs", config, protocol, repeat)
    return p.exists() and len(pd.read_csv(p)) == C.N_FOLDS


def save_repeat(config: str, protocol: str, repeat: int, rows: list, preds: list) -> None:
    for kind, data in (("runs", pd.DataFrame(rows)), ("preds", pd.concat(preds, ignore_index=True))):
        p = _path(kind, config, protocol, repeat)
        p.parent.mkdir(parents=True, exist_ok=True)
        data.to_csv(p, index=False)


def pred_frame(m, te, repeat, fold, y_true, y_pred, proba) -> pd.DataFrame:
    df = pd.DataFrame({"file_id": m.file_id.iloc[te].to_numpy(), "repeat": repeat, "fold": fold,
                       "y_true": y_true, "y_pred": y_pred})
    for i, c in enumerate(C.CLASSES):
        df[f"p_{c}"] = proba[:, i]
    return df


def write_env(tag: str) -> None:
    """Record library versions, hardware and git commit next to the results."""
    info = {"tag": tag, "utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "python": sys.version.split()[0], "platform": platform.platform()}
    for mod in ("numpy", "pandas", "scipy", "sklearn", "imblearn", "librosa", "soxr", "soundfile", "torch"):
        try:
            info[mod] = __import__(mod).__version__
        except Exception:
            info[mod] = None
    try:
        import torch
        info["cuda_device"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    except Exception:
        pass
    try:
        info["git_commit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=C.ROOT,
                                                     stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        info["git_commit"] = None
    C.RESULTS.mkdir(parents=True, exist_ok=True)
    (C.RESULTS / f"env_{tag}.json").write_text(json.dumps(info, indent=2))

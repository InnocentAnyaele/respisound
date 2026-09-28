"""Build data/manifest.csv and data/manifest_report.txt from the ORIGINAL ADD v2 files.

One row per audio file, with:
  label and patient group, native sample rate, channels, duration, md5,
  and the frozen fold assignment for every repeat and both protocols.

Use the original Kaggle download, not the respimerge-5 copy, which may already be
resampled and so hide native sample rates.

Usage:
    python build_manifest.py --audio-root data/raw [--handover-csv metadata_handover.csv]
                             [--group-mode per_class|global]
"""
from __future__ import annotations

import argparse
import hashlib
import re
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

import config as C

PID_RE = re.compile(r"^(P\d+)")


def class_of(path: Path, root: Path):
    """Nearest ancestor folder that names a class, plus that folder's original spelling."""
    for part in reversed(path.relative_to(root).parts[:-1]):
        key = part.strip().lower()
        if key in C.FOLDER_TO_CLASS:
            return C.FOLDER_TO_CLASS[key], part
    return None, None


def audio_info(path: Path) -> dict:
    try:
        import soundfile as sf
        i = sf.info(str(path))
        return dict(native_sr=i.samplerate, n_channels=i.channels,
                    duration_s=i.frames / i.samplerate, subtype=i.subtype, status="ok")
    except Exception as e:
        try:  # fallback for formats libsndfile cannot parse
            import librosa
            y, sr = librosa.load(str(path), sr=None, mono=False)
            ch = 1 if y.ndim == 1 else y.shape[0]
            return dict(native_sr=sr, n_channels=ch, duration_s=y.shape[-1] / sr,
                        subtype="librosa-fallback", status="ok")
        except Exception as e2:
            return dict(native_sr=np.nan, n_channels=np.nan, duration_s=np.nan, subtype=None,
                        status=f"load_failed: {type(e).__name__}/{type(e2).__name__}")


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio-root", required=True, type=Path)
    ap.add_argument("--handover-csv", type=Path, default=None,
                    help="metadata_handover.csv from respimerge-5, to cross-check the file list")
    ap.add_argument("--group-mode", choices=["per_class", "global"], default="per_class",
                    help="per_class: group = label + P-number (P-numbers restart per class). "
                         "global: group = P-number alone.")
    args = ap.parse_args()
    root = args.audio_root.resolve()
    out = StringIO()

    def say(*a):
        print(*a)
        print(*a, file=out)

    # ------------------------------------------------------------ scan
    files = sorted(p for p in root.rglob("*") if p.suffix.lower() == ".wav")
    say(f"Scanned {root}: {len(files)} .wav files")
    rows, unmapped = [], []
    for p in files:
        cls, folder = class_of(p, root)
        if cls is None:
            unmapped.append(str(p.relative_to(root)))
            continue
        pid = PID_RE.match(p.stem)
        rows.append(dict(file_id=f"asthma_v2_{folder}_{p.name}", original_filename=p.name,
                         source_folder=folder, rel_path=str(p.relative_to(root)), path=str(p),
                         label=cls, pid=pid.group(1) if pid else None, md5=md5(p), **audio_info(p)))
    if unmapped:
        say(f"WARNING: {len(unmapped)} files are not under a class folder and were skipped, e.g. {unmapped[:3]}")
    m = pd.DataFrame(rows).sort_values("file_id").reset_index(drop=True)

    # ------------------------------------------------------------ groups
    no_pid = m.pid.isna()
    m["patient_group"] = (m.label + "_" + m.pid) if args.group_mode == "per_class" else m.pid
    m.loc[no_pid, "patient_group"] = m.label[no_pid] + "_nopid_" + m.original_filename[no_pid]
    m["group_note"] = np.where(no_pid, "no P-number: own group", "")

    # Exact duplicate audio files must never straddle train and test. If twins sit in
    # different patient groups, merge those WHOLE groups (union-find). Moving only the
    # duplicate file would split its own patient across groups.
    m["dup_of"] = ""
    parent = {g: g for g in m.patient_group.unique()}

    def find(g):
        while parent[g] != g:
            parent[g] = parent[parent[g]]
            g = parent[g]
        return g

    for _, d in m.groupby("md5"):
        if len(d) > 1:
            m.loc[d.index[1:], "dup_of"] = m.at[d.index[0], "file_id"]
            roots = sorted({find(g) for g in d.patient_group}, key=lambda g: ("_nopid_" in g, g))
            for r in roots[1:]:
                parent[r] = roots[0]  # prefer a real P-number group as the representative
    merged = m.patient_group.map(find)
    changed = merged != m.patient_group
    m.loc[changed, "group_note"] = (m.loc[changed, "group_note"] + " merged via exact duplicate").str.strip()
    m["patient_group"] = merged

    # ------------------------------------------------------------ folds (frozen here)
    ok = m.status == "ok"
    y = m.loc[ok, "label"].to_numpy()
    g = m.loc[ok, "patient_group"].to_numpy()
    idx = np.flatnonzero(ok)
    for r in C.REPEATS:
        for proto, splitter, groups in (
            ("grouped", StratifiedGroupKFold(C.N_FOLDS, shuffle=True, random_state=r), g),
            ("clip", StratifiedKFold(C.N_FOLDS, shuffle=True, random_state=r), None),
        ):
            col = np.full(len(m), -1)
            for k, (_, te) in enumerate(splitter.split(idx, y, groups)):
                col[idx[te]] = k
            m[f"fold_{proto}_r{r}"] = col

    C.DATA.mkdir(parents=True, exist_ok=True)
    m.to_csv(C.MANIFEST, index=False)

    # ------------------------------------------------------------ report
    mo = m[ok]
    say(f"\nLoaded OK: {ok.sum()} / {len(m)}")
    if (~ok).any():
        say(m.loc[~ok, ["file_id", "status"]].to_string(index=False))

    say("\n== Class counts (source folder -> label)")
    say(m.groupby(["source_folder", "label"]).size().to_string())

    say("\n== Native sample rate x label  (reviewer 3d5K bandwidth concern)")
    say(pd.crosstab(mo.native_sr, mo.label, margins=True).to_string())
    say("\n== Channels x label")
    say(pd.crosstab(mo.n_channels, mo.label).to_string())
    say("\n== Duration (s) by label")
    say(mo.groupby("label").duration_s.describe().round(3).to_string())
    say(f"Clips of exactly {C.FULL_WIN_S:.1f} s: {(mo.duration_s.round(3) == C.FULL_WIN_S).mean():.1%} "
        "(a high share suggests fixed-length segments cut from longer recordings)")

    say(f"\n== Patient groups (group mode: {args.group_mode})")
    gs = mo.groupby("label").agg(groups=("patient_group", "nunique"), clips=("file_id", "size"))
    gs["clips_per_group"] = (gs.clips / gs.groups).round(2)
    say(gs.to_string())
    say(f"Total groups: {mo.patient_group.nunique()}  (the submitted paper claims 112 subjects)")
    say(f"Files without a P-number: {int(no_pid.sum())}")

    say("\n== Do P-numbers restart per class? (helps settle the grouping key)")
    pid_classes = mo.dropna(subset=["pid"]).groupby("pid").label.nunique()
    say(f"P-numbers found in >1 class: {(pid_classes > 1).sum()} of {len(pid_classes)}")
    say("If most P-numbers appear in several classes, the numbering almost certainly restarts per "
        "class, so use --group-mode per_class. Confirm against the dataset documentation.")

    say("\n== Filename suffix codes after '<P#><Class>' (recording site? device? segment?)")
    suf = (mo.original_filename
           .str.extract(r"^P\d+(?:Asthma|Bronchial|COPD|Healthy|Pneumonia)([^_.]*)", flags=re.I)[0]
           .str.replace(r"\d+", "", regex=True).fillna("?"))
    say(pd.crosstab(suf.replace("", "(none)"), mo.label).to_string())

    dups = m[m.dup_of != ""]
    say(f"\n== Exact duplicate files: {len(dups)}")
    if len(dups):
        lab = m.set_index("file_id").label
        conflict = dups[dups.label.to_numpy() != lab.loc[dups.dup_of].to_numpy()]
        say(dups[["file_id", "dup_of", "label"]].head(20).to_string(index=False))
        say(f"Duplicates with a DIFFERENT label from their twin: {len(conflict)}")

    if args.handover_csv:
        h = pd.read_csv(args.handover_csv)
        a, b = set(m.file_id), set(h.file_id)
        say(f"\n== Cross-check with {args.handover_csv.name}")
        say(f"handover rows: {len(h)}  | in both: {len(a & b)}  | only in original download: {len(a - b)}"
            f"  | only in handover: {len(b - a)}")
        if "source" in h.columns:
            say("handover 'source' values:\n" + h.source.value_counts().to_string())
        if b - a:
            say(f"e.g. only in handover: {sorted(b - a)[:5]}")

    say("\n== Fold diagnostics")
    for proto in ("grouped", "clip"):
        for r in C.REPEATS:
            col = mo[f"fold_{proto}_r{r}"]
            per = pd.crosstab(col, mo.label)
            bg = mo[mo.label == "bronchial"].groupby(col).patient_group.nunique()
            leak = (mo.groupby("patient_group")[f"fold_{proto}_r{r}"].nunique() > 1).sum()
            say(f"{proto} r{r}: test clips/fold {per.sum(axis=1).min()}-{per.sum(axis=1).max()} | "
                f"min clips of any class in a fold {per.values.min()} | "
                f"bronchial groups/fold {bg.min()}-{bg.max()} | groups split across folds: {leak}")
    say("(For 'grouped', 'groups split across folds' must be 0. For 'clip' it is expected to be large;"
        " that is the leakage being measured.)")

    (C.DATA / "manifest_report.txt").write_text(out.getvalue())
    print(f"\nWrote {C.MANIFEST} and {C.DATA / 'manifest_report.txt'}")


if __name__ == "__main__":
    main()

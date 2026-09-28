"""Classical configurations from ANALYSIS_PLAN.md section 4.

Everything that learns from data (scaler, SMOTE, augmentation) sits inside the
training fold. Test folds are never augmented.

Usage:
    python run_classical.py --configs all --protocols grouped clip
    python run_classical.py --configs C1 C2 --protocols grouped --repeats 0
"""
from __future__ import annotations

import argparse
import time

import numpy as np
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC

import config as C
from common import (fold_info, folds, labels, load_cache, load_manifest, pred_frame,
                    repeat_done, save_repeat, score, write_env)

CONFIGS = {
    # main
    "C1": dict(model="svm", feats="F30_full", dims=30, scale=False),
    "C2": dict(model="svm", feats="F30_full", dims=30, scale=True),
    "C3": dict(model="svm", feats="F30_full", dims=26, scale=True),
    "C4": dict(model="rf", feats="F30_full", dims=30, balanced=False),
    "C5": dict(model="rf", feats="F30_full", dims=30, balanced=True),
    "C8": dict(model="svm", feats="F30_short", dims=30, scale=True),
    # augmentation (training folds only)
    "A1": dict(base="C2", smote=True),
    "A2": dict(base="C5", smote=True),
    "A3": dict(base="C2", aug=True),
    "A4": dict(base="C5", aug=True),
    "A5": dict(base="C2", smote=True, aug=True),
    "A6": dict(base="C5", smote=True, aug=True),
    # bandwidth / sampling-rate control
    "B0": dict(model="logreg", feats="native_sr"),
    "B1": dict(model="logreg", feats="hf_frac"),
    "B2_C2": dict(base="C2", feats="F30_full_lp"),
    "B2_C5": dict(base="C5", feats="F30_full_lp"),
}


def resolve(cid: str) -> dict:
    spec = dict(CONFIGS[cid])
    base = spec.pop("base", None)
    return {**resolve(base), **spec} if base else spec


def build(spec: dict, seed: int) -> Pipeline:
    steps = []
    if spec.get("smote"):
        # As in the original notebook: SMOTE on unscaled features, minority class only.
        steps.append(("smote", SMOTE(sampling_strategy="minority", random_state=seed)))
    if spec["model"] == "svm":
        if spec.get("scale"):
            steps.append(("scale", StandardScaler()))
        steps.append(("clf", SVC(**C.SVM, random_state=seed)))
    elif spec["model"] == "rf":
        steps.append(("clf", RandomForestClassifier(
            n_estimators=C.RF_TREES, class_weight="balanced" if spec.get("balanced") else None,
            random_state=seed, n_jobs=-1)))
    elif spec["model"] == "logreg":
        enc = OneHotEncoder(handle_unknown="ignore") if spec["feats"] == "native_sr" else StandardScaler()
        steps += [("enc", enc), ("clf", LogisticRegression(class_weight="balanced", max_iter=5000))]
    return Pipeline(steps)


def features(spec: dict, m) -> np.ndarray:
    if spec["feats"] == "native_sr":
        return m.native_sr.to_numpy().reshape(-1, 1)
    X = load_cache(spec["feats"], m)
    X = X.reshape(-1, 1) if X.ndim == 1 else X
    return X[:, : spec["dims"]] if "dims" in spec else X


def run(cid: str, protocol: str, repeat: int, m, y, only_folds=None) -> None:
    spec = resolve(cid)
    X = features(spec, m)
    X_aug = load_cache(f"F30_full_aug_r{repeat}", m)[:, : spec["dims"]] if spec.get("aug") else None
    if spec.get("aug"):
        assert spec["feats"] == "F30_full", "augmented copies exist only for F30_full"
    rows, preds = [], []
    for k, tr, te in folds(m, protocol, repeat):
        if only_folds is not None and k not in only_folds:
            continue
        seed = repeat * 10 + k
        X_tr, y_tr = X[tr], y[tr]
        if X_aug is not None:  # add one augmented copy of each TRAINING clip; test untouched
            X_tr, y_tr = np.vstack([X_tr, X_aug[tr]]), np.concatenate([y_tr, y[tr]])
        pipe = build(spec, seed)
        t0 = time.perf_counter()
        pipe.fit(X_tr, y_tr)
        fit_s = time.perf_counter() - t0
        y_pred = pipe.predict(X[te])
        proba = np.zeros((len(te), len(C.CLASSES)))
        proba[:, pipe.classes_] = pipe.predict_proba(X[te])
        rows.append({"config": cid, "protocol": protocol, "repeat": repeat, "fold": k, "seed": seed,
                     "n_train": len(tr), "n_train_fit": len(y_tr), "n_test": len(te),
                     **score(y[te], y_pred), **fold_info(m, te), "fit_s": round(fit_s, 3)})
        preds.append(pred_frame(m, te, repeat, k, y[te], y_pred, proba))
    if only_folds is None:
        save_repeat(cid, protocol, repeat, rows, preds)
    mr = np.mean([r["macro_recall"] for r in rows])
    print(f"{cid:6s} {protocol:7s} r{repeat}  macro recall {mr:.3f}  ({len(rows)} folds)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--configs", nargs="+", default=["all"])
    ap.add_argument("--protocols", nargs="+", default=["grouped", "clip"], choices=["grouped", "clip"])
    ap.add_argument("--repeats", nargs="+", type=int, default=C.REPEATS)
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()
    cids = list(CONFIGS) if args.configs == ["all"] else args.configs

    write_env("classical")
    m = load_manifest()
    y = labels(m)
    for cid in cids:
        for protocol in args.protocols:
            for r in args.repeats:
                if repeat_done(cid, protocol, r) and not args.overwrite:
                    print(f"{cid:6s} {protocol:7s} r{r}  already done, skipping")
                    continue
                run(cid, protocol, r, m, y)


if __name__ == "__main__":
    main()

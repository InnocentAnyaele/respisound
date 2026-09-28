"""CRNN configurations from ANALYSIS_PLAN.md section 4.

Architecture is identical to backend/model_definition.py. Per outer fold:
  * inner validation = 1 of 7 stratified folds of the training data, split by patient
    group under the grouped protocol and by clip under the clip protocol
  * class weights computed from the inner-training labels only
  * Adam 1e-3, batch 32, max 50 epochs, early stopping on validation loss
    (patience 10), best checkpoint restored before testing
  * seed = repeat * 10 + fold, cuDNN deterministic

Results are written per (config, protocol, repeat), so an interrupted Kaggle session
resumes where it stopped.

Usage:
    python run_crnn.py --configs C6 C7 A7 B2_C6 --protocol grouped
    python run_crnn.py --configs C6 --protocol clip        # leakage-gap reference (R3)
"""
from __future__ import annotations

import argparse
import copy
import os
import time

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
from sklearn.utils.class_weight import compute_class_weight

import config as C
from common import (fold_info, folds, labels, load_cache, load_manifest, pred_frame,
                    repeat_done, save_repeat, score, seed_everything, write_env)

CONFIGS = {
    "C6": dict(mel="mel_short", specaug=False),
    "C7": dict(mel="mel_full", specaug=False),
    "A7": dict(mel="mel_short", specaug=True),
    "B2_C6": dict(mel="mel_short_lp", specaug=False),
}


class RespiSoundCRNN(nn.Module):
    """Copy of backend/model_definition.py. Works for 47 or 188 time frames because the
    LSTM input size depends only on the frequency axis (128 / 4 = 32 bins x 64 channels)."""

    def __init__(self, num_classes: int = 5, dropout: float = 0.3):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
        )
        self.dropout = nn.Dropout(dropout)
        self.rnn = nn.LSTM(input_size=64 * 32, hidden_size=128, num_layers=1, batch_first=True)
        self.fc = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.cnn(x)
        b, c, f, t = x.size()
        x = x.permute(0, 3, 1, 2).contiguous().view(b, t, c * f)
        x = self.dropout(x)
        x, _ = self.rnn(x)
        return self.fc(x[:, -1, :])


def spec_augment_(x: torch.Tensor, g: torch.Generator) -> None:
    """In place. One frequency mask (width ~ U[0,10)) and one time mask (width ~ U[0,15))
    per example, zero-filled, as in respisound-crnn_spec_augmentation.ipynb. No time warping."""
    _, _, F, T = x.shape
    for b in range(x.shape[0]):
        w = int(torch.randint(0, C.SPEC_AUG["freq_max"], (1,), generator=g))
        if w > 0:
            s = int(torch.randint(0, F - w, (1,), generator=g))
            x[b, :, s:s + w, :] = 0
        w = int(torch.randint(0, C.SPEC_AUG["time_max"], (1,), generator=g))
        if w > 0:
            s = int(torch.randint(0, T - w, (1,), generator=g))
            x[b, :, :, s:s + w] = 0


def batches(X, idx, bs):
    for s in range(0, len(idx), bs):
        bi = idx[s:s + bs]
        yield bi, torch.from_numpy(np.ascontiguousarray(X[bi])).unsqueeze(1)


@torch.no_grad()
def predict(model, X, idx, device, bs=256):
    model.eval()
    out = [torch.softmax(model(xb.to(device)), 1).cpu() for _, xb in batches(X, idx, bs)]
    return torch.cat(out).numpy()


def train_eval(X, y, groups, tr, te, spec, seed, protocol, device, max_epochs):
    seed_everything(seed)
    if protocol == "grouped":
        inner = StratifiedGroupKFold(C.INNER_VAL_SPLITS, shuffle=True, random_state=seed)
        i_tr, i_va = next(inner.split(tr, y[tr], groups[tr]))
    else:
        inner = StratifiedKFold(C.INNER_VAL_SPLITS, shuffle=True, random_state=seed)
        i_tr, i_va = next(inner.split(tr, y[tr]))
    fit_idx, val_idx = tr[i_tr], tr[i_va]

    w = compute_class_weight("balanced", classes=np.arange(len(C.CLASSES)), y=y[fit_idx])
    crit = nn.CrossEntropyLoss(weight=torch.tensor(w, dtype=torch.float32, device=device))
    crit_sum = nn.CrossEntropyLoss(weight=crit.weight, reduction="sum")
    model = RespiSoundCRNN(len(C.CLASSES), C.CRNN["dropout"]).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=C.CRNN["lr"])
    rng = np.random.default_rng(seed)
    g = torch.Generator().manual_seed(seed)
    y_t = torch.from_numpy(y).long()

    best_loss, best_state, best_epoch, bad, epoch = np.inf, None, -1, 0, -1
    t0 = time.perf_counter()
    for epoch in range(max_epochs):
        model.train()
        for bi, xb in batches(X, rng.permutation(fit_idx), C.CRNN["batch_size"]):
            if spec["specaug"]:
                spec_augment_(xb, g)
            opt.zero_grad()
            loss = crit(model(xb.to(device)), y_t[bi].to(device))
            loss.backward()
            opt.step()
        # validation loss = class-weighted mean over the whole validation set
        model.eval()
        tot, wsum = 0.0, 0.0
        with torch.no_grad():
            for bi, xb in batches(X, val_idx, 256):
                yb = y_t[bi].to(device)
                tot += crit_sum(model(xb.to(device)), yb).item()
                wsum += crit.weight[yb].sum().item()
        val_loss = tot / wsum
        if val_loss < best_loss:
            best_loss, best_state, best_epoch, bad = val_loss, copy.deepcopy(model.state_dict()), epoch, 0
        else:
            bad += 1
            if bad >= C.CRNN["patience"]:
                break
    fit_s = time.perf_counter() - t0
    model.load_state_dict(best_state)
    proba = predict(model, X, te, device)
    return proba, dict(epochs_run=epoch + 1, best_epoch=best_epoch + 1, best_val_loss=round(best_loss, 4),
                       n_fit=len(fit_idx), n_val=len(val_idx), fit_s=round(fit_s, 1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--configs", nargs="+", default=["C6", "C7", "A7", "B2_C6"])
    ap.add_argument("--protocol", default="grouped", choices=["grouped", "clip"])
    ap.add_argument("--repeats", nargs="+", type=int, default=C.REPEATS)
    ap.add_argument("--max-epochs", type=int, default=C.CRNN["max_epochs"],
                    help="smoke tests only; results with a non-default value are not saved")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()
    smoke = args.max_epochs != C.CRNN["max_epochs"]
    if smoke:
        print(f"SMOKE TEST: max_epochs={args.max_epochs}; results go to results/smoke/")
        C.RESULTS = C.RESULTS / "smoke"
    torch.use_deterministic_algorithms(True, warn_only=True)

    write_env("crnn")
    m = load_manifest()
    y = labels(m)
    groups = m.patient_group.to_numpy()
    for cid in args.configs:
        spec = CONFIGS[cid]
        X = load_cache(spec["mel"], m, mmap=True)
        for r in args.repeats:
            if repeat_done(cid, args.protocol, r) and not args.overwrite:
                print(f"{cid} {args.protocol} r{r}: already done, skipping")
                continue
            rows, preds = [], []
            for k, tr, te in folds(m, args.protocol, r):
                seed = r * 10 + k
                proba, info = train_eval(X, y, groups, tr, te, spec, seed, args.protocol,
                                         args.device, args.max_epochs)
                y_pred = proba.argmax(1)
                rows.append({"config": cid, "protocol": args.protocol, "repeat": r, "fold": k, "seed": seed,
                             "n_train": len(tr), "n_test": len(te), **score(y[te], y_pred),
                             **fold_info(m, te), **info})
                preds.append(pred_frame(m, te, r, k, y[te], y_pred, proba))
                print(f"{cid} {args.protocol} r{r} f{k}: macro recall {rows[-1]['macro_recall']:.3f} "
                      f"(epochs {info['epochs_run']}, best {info['best_epoch']}, {info['fit_s']}s)")
            save_repeat(cid, args.protocol, r, rows, preds)


if __name__ == "__main__":
    main()

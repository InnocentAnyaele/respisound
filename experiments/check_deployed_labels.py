"""Does the shipped checkpoint's output order match the app's hard-coded CLASSES?

backend/main.py assumes index order [Asthma, Bronchitis, COPD, Healthy, Pneumonia].
That holds only if the training run lowercased labels before LabelEncoder. The 0.86 run
(respisound-raw-crnn.ipynb) did not, so in that run index 0 = Bronchial and 1 = asthma.
If the shipped model came from that run, the app swaps Asthma and Bronchitis.

This script runs the shipped model exactly as the app does (same preprocessing as
extract_features() in backend/main.py) on known-label files, and scores both orders.

Usage:
    python check_deployed_labels.py --backend ../backend [--n-per-class 40]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch

import config as C
from common import audio_paths, load_manifest
from extract_features import load16k, logmel

APP_ORDER = ["asthma", "bronchial", "copd", "healthy", "pneumonia"]   # CLASSES in backend/main.py
UNNORMALISED_ORDER = ["bronchial", "asthma", "copd", "healthy", "pneumonia"]  # LabelEncoder on raw labels


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", type=Path, required=True, help="path to the repo's backend/ folder")
    ap.add_argument("--n-per-class", type=int, default=40)
    ap.add_argument("--audio-root", type=Path, default=None)
    args = ap.parse_args()

    sys.path.insert(0, str(args.backend.resolve()))
    from model_definition import RespiSoundCRNN  # the app's own class

    raw = torch.load(args.backend / "model" / "respisound_model.pt", map_location="cpu", weights_only=True)
    state = raw["model_state_dict"] if isinstance(raw, dict) and "model_state_dict" in raw else raw
    model = RespiSoundCRNN(num_classes=5)
    model.load_state_dict(state, strict=True)
    model.eval()

    m = load_manifest()
    sample = m.sample(frac=1, random_state=0).groupby("label").head(args.n_per_class)
    with torch.no_grad():
        x = torch.stack([torch.from_numpy(logmel(load16k(p), C.SHORT_WIN_S)) for p in audio_paths(sample, args.audio_root)]).unsqueeze(1)
        idx = model(x).argmax(1).numpy()

    true = sample.label.to_numpy()
    for name, order in (("APP ORDER (as shipped)", APP_ORDER), ("UNNORMALISED ORDER", UNNORMALISED_ORDER)):
        pred = np.array(order)[idx]
        acc = (pred == true).mean()
        print(f"\n== {name}: accuracy {acc:.3f}")
        print(pd.crosstab(pd.Series(true, name="true"), pd.Series(pred, name="pred")).to_string())

    # A swap only affects asthma and bronchial, so decide on those clips alone.
    ab = np.isin(true, ["asthma", "bronchial"])
    app_acc = (np.array(APP_ORDER)[idx][ab] == true[ab]).mean()
    alt_acc = (np.array(UNNORMALISED_ORDER)[idx][ab] == true[ab]).mean()
    print(f"\nOn asthma + bronchial clips only ({ab.sum()}): app order {app_acc:.3f} | unnormalised order {alt_acc:.3f}")
    best, other = max(app_acc, alt_acc), min(app_acc, alt_acc)
    if best < 0.6 or best - other < 0.2:
        print("INCONCLUSIVE: neither order fits well. Increase --n-per-class, and check that the audio "
              "path and preprocessing match the app.")
    elif alt_acc > app_acc:
        print("!! LABEL SWAP DETECTED: the shipped model uses the unnormalised order. The app currently "
              "shows Asthma for Bronchial and vice versa. Fix CLASSES in backend/main.py or re-export the model.")
    else:
        print("OK: the shipped model matches the app's CLASSES order.")
    print("(These files were probably in the model's training set, so accuracy is inflated. That's fine here: "
          "the test only asks which label order fits.)")


if __name__ == "__main__":
    main()

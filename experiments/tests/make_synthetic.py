"""Generate a small fake dataset laid out like the ADD v2 download, to smoke-test the harness.

Deliberate properties, so each part of the pipeline has something to find:
  * folder/file naming as in ADD v2: <root>/<class folder>/P<n><Class><code>_<k>.wav
  * mixed native rates (44.1 kHz and 4 kHz), correlated with class -> B0/B1 should fire
  * a strong per-patient signature plus a weaker class signal -> clip-level CV should
    beat grouped CV (a measurable leakage gap, as in R3)
  * one exact duplicate file under another patient, and one file without a P-number
  * a metadata_handover.csv with one file missing and one extra, for the cross-check

Usage: python tests/make_synthetic.py --out data/raw_synth
"""
import argparse
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import soundfile as sf

CLASSES = {  # folder: (name in filename, patients, class tone Hz, P(4 kHz native rate))
    "asthma": ("Asthma", 8, 600, 0.2),
    "Bronchial": ("Bronchial", 6, 350, 0.9),
    "copd": ("COPD", 10, 200, 0.2),
    "healthy": ("Healthy", 6, None, 0.3),
    "pneumonia": ("Pneumonia", 8, "crackle", 0.8),
}
CODES = ["Tc", "Sc", "IE", "IU"]


def clip(rng, sr, dur, class_sig, pat_freq, pat_gain):
    t = np.arange(int(sr * dur)) / sr
    y = 0.05 * rng.standard_normal(len(t))                              # broadband noise
    y += pat_gain * 0.25 * np.sin(2 * np.pi * pat_freq * t)             # patient signature
    if isinstance(class_sig, (int, float)):
        y += 0.08 * np.sin(2 * np.pi * class_sig * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t))
    elif class_sig == "crackle":
        for c in rng.uniform(0, dur, 25):
            i = int(c * sr)
            y[i:i + int(0.004 * sr)] += 0.3 * rng.standard_normal(len(y[i:i + int(0.004 * sr)]))
    return (np.clip(y, -1, 1) * 32767).astype(np.int16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    rng = np.random.default_rng(7)
    root = args.out / "Asthma Detection Dataset Version 2"
    if args.out.exists():
        shutil.rmtree(args.out)
    written = []
    k = 0
    for folder, (name, n_pat, sig, p4k) in CLASSES.items():
        (root / folder).mkdir(parents=True)
        for p in range(1, n_pat + 1):
            pat_freq, pat_gain = rng.uniform(120, 1800), rng.uniform(0.5, 1.5)
            sr = 4000 if rng.random() < p4k else 44100
            for c in range(4):
                k += 1
                dur = 6.0 if rng.random() < 0.85 else float(rng.uniform(1.0, 6.0))
                fn = f"P{p}{name}{CODES[c]}_{k}.wav"
                sf.write(root / folder / fn, clip(rng, sr, dur, sig, pat_freq, pat_gain), sr, subtype="PCM_16")
                written.append(f"asthma_v2_{folder}_{fn}")
    # exact duplicate filed under a different patient, and a file with no P-number
    src = root / "copd" / sorted((root / "copd").iterdir())[0].name
    shutil.copy(src, root / "copd" / f"P10COPDTc_{k + 1}.wav"); written.append(f"asthma_v2_copd_P10COPDTc_{k + 1}.wav")
    shutil.copy(root / "healthy" / sorted((root / "healthy").iterdir())[1].name, root / "healthy" / "HealthyExtra_999.wav")
    written.append("asthma_v2_healthy_HealthyExtra_999.wav")
    # handover csv: drop one, add one fake
    h = pd.DataFrame({"file_id": written[1:] + ["asthma_v2_lung_extra_1.wav"], "source": "Asthma_V2_Smartphone"})
    h.to_csv(args.out / "metadata_handover.csv", index=False)
    print(f"Wrote {len(written)} files under {root}")


if __name__ == "__main__":
    main()

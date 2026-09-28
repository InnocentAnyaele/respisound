"""Compute every input the experiments need, once, and cache it under cache/.

Each feature function reproduces the submitted notebooks and backend/main.py exactly,
so changes in results come from the evaluation protocol, not from the features.

Cached arrays (row order = manifest rows with status == "ok"):
  F30_full        MFCC(13) mean+SD, RMS mean+SD, ZCR mean+SD over the full clip   C1-C5, A*
  F30_full_lp     same, after an 1.8 kHz low-pass                                  B2 (classical)
  F30_short       same, on the first 1.5 s (zero-padded)                           C8
  F30_full_aug_rR one augmented copy per clip for repeat R (train folds only)      A3-A6
  hf_frac         fraction of spectral energy above 2 kHz                          B1
  mel_short       log-Mel 128x47 (first 1.5 s)                                     C6, A7
  mel_full        log-Mel 128x188 (6.0 s, padded/truncated)                        C7
  mel_short_lp    log-Mel 128x47 after the low-pass                                B2 (CRNN)

Usage: python extract_features.py [--n-jobs 4] [--audio-root /path/to/ADDv2]
"""
from __future__ import annotations

import argparse
import json
import time

import librosa
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy.signal import butter, sosfiltfilt

import config as C
from pathlib import Path

from common import audio_paths, load_manifest

SOS = butter(C.LOWPASS_ORDER, C.LOWPASS_HZ, btype="low", fs=C.TARGET_SR, output="sos")


def load16k(path: str) -> np.ndarray:
    # Same call as every notebook: librosa default resampler (soxr_hq), mono by channel mean.
    y, _ = librosa.load(path, sr=C.TARGET_SR, mono=True)
    return y.astype(np.float32)


def lowpass(y: np.ndarray) -> np.ndarray:
    return sosfiltfilt(SOS, y).astype(np.float32)


def fix_len(y: np.ndarray, seconds: float) -> np.ndarray:
    n = int(round(C.TARGET_SR * seconds))
    return np.pad(y, (0, max(0, n - len(y))))[:n]


def f30(y: np.ndarray) -> np.ndarray:
    """preprocess_audio() from the notebooks. librosa defaults: n_fft=2048, hop=512."""
    mfcc = librosa.feature.mfcc(y=y, sr=C.TARGET_SR, n_mfcc=C.N_MFCC)
    rms = librosa.feature.rms(y=y)
    zcr = librosa.feature.zero_crossing_rate(y)
    return np.concatenate([mfcc.mean(1), mfcc.std(1),
                           [rms.mean(), rms.std(), zcr.mean(), zcr.std()]]).astype(np.float32)


def logmel(y: np.ndarray, seconds: float) -> np.ndarray:
    """process_audio() from the CRNN notebooks, and extract_features() in backend/main.py."""
    y = fix_len(y, seconds)
    mel = librosa.feature.melspectrogram(y=y, sr=C.TARGET_SR, n_fft=C.N_FFT,
                                         hop_length=C.HOP, n_mels=C.N_MELS)
    lm = librosa.power_to_db(mel, ref=np.max)
    return ((lm - lm.mean()) / (lm.std() + 1e-6)).astype(np.float32)


def hf_frac(y: np.ndarray) -> float:
    S = np.abs(librosa.stft(y, n_fft=C.N_FFT, hop_length=C.HOP)) ** 2
    f = librosa.fft_frequencies(sr=C.TARGET_SR, n_fft=C.N_FFT)
    total = S.sum()
    return float(S[f > C.HF_SPLIT_HZ].sum() / total) if total > 0 else 0.0


def augment(y: np.ndarray, seed: int) -> np.ndarray:
    """preprocess_audio_augmented() from baselines-smote-augmentation.ipynb, with its own RNG
    so every clip's augmented copy is reproducible regardless of processing order."""
    rs = np.random.RandomState(seed)
    a = C.AUG
    if rs.random_sample() > 1 - a["noise_p"]:
        y = y + rs.normal(0, 1, len(y)) * a["noise_factor"]
    if rs.random_sample() > 1 - a["pitch_p"]:
        n_steps = rs.randint(-1, 1)  # yields -1 or 0: the original's randint(-1, 1) excludes the upper bound
        y = librosa.effects.pitch_shift(np.asarray(y, dtype=np.float32), sr=C.TARGET_SR, n_steps=n_steps)
    if rs.random_sample() > 1 - a["stretch_p"]:
        y = librosa.effects.time_stretch(np.asarray(y, dtype=np.float32), rate=rs.uniform(*a["stretch"]))
    return np.asarray(y, dtype=np.float32)


def process(i: int, path: str) -> dict:
    y = load16k(path)
    y_lp = lowpass(y)
    out = {
        "F30_full": f30(y),
        "F30_full_lp": f30(y_lp),
        "F30_short": f30(fix_len(y, C.SHORT_WIN_S)),
        "hf_frac": hf_frac(y),
        "mel_short": logmel(y, C.SHORT_WIN_S),
        "mel_full": logmel(y, C.FULL_WIN_S),
        "mel_short_lp": logmel(y_lp, C.SHORT_WIN_S),
        "dur_16k": len(y) / C.TARGET_SR,
    }
    for r in C.REPEATS:
        out[f"F30_full_aug_r{r}"] = f30(augment(y, seed=r * 100_000 + i))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-jobs", type=int, default=1)
    ap.add_argument("--audio-root", type=Path, default=None,
                    help="where the ADD v2 files live on THIS machine, if different from where the manifest was built")
    args = ap.parse_args()

    m = load_manifest()
    t0 = time.time()
    res = Parallel(n_jobs=args.n_jobs, verbose=5)(
        delayed(process)(i, p) for i, p in enumerate(audio_paths(m, args.audio_root)))

    C.CACHE.mkdir(parents=True, exist_ok=True)
    for key in res[0]:
        np.save(C.CACHE / f"{key}.npy", np.stack([np.asarray(r[key]) for r in res]))
    m[["file_id"]].to_csv(C.CACHE / "index.csv", index=False)
    (C.CACHE / "meta.json").write_text(json.dumps({
        "librosa": librosa.__version__, "n_files": len(m), "seconds": round(time.time() - t0, 1),
        "lowpass_hz": C.LOWPASS_HZ, "short_win_s": C.SHORT_WIN_S, "full_win_s": C.FULL_WIN_S}, indent=2))

    mel = np.load(C.CACHE / "mel_short.npy", mmap_mode="r")
    melf = np.load(C.CACHE / "mel_full.npy", mmap_mode="r")
    print(f"Done in {time.time() - t0:.0f}s: {len(m)} files | mel_short {mel.shape[1:]} | mel_full {melf.shape[1:]}")


if __name__ == "__main__":
    main()

# experiments/: reproducible harness for the camera-ready

Every number in the revised paper comes from these scripts. They implement `ANALYSIS_PLAN.md` exactly, and `config.py` holds every constant the plan names.

| Script | What it does |
|---|---|
| `build_manifest.py` | Scans the original ADD v2 files. Records label, patient group, native sample rate, duration and md5; merges groups joined by exact duplicates; freezes the folds; writes `data/manifest_report.txt`. |
| `extract_features.py` | Computes every model input once (MFCC/RMS/ZCR vectors, log-Mels, low-pass variants, augmented copies) into `cache/`. |
| `run_classical.py` | C1–C5, C8, A1–A6, B0, B1, B2_C2, B2_C5. Scaler, SMOTE and augmentation are fitted inside the training fold. |
| `run_crnn.py` | C6, C7, A7, B2_C6. Grouped inner validation, train-only class weights, best checkpoint restored. |
| `compare.py` | Applies the plan's decision rules and writes `results/REPORT.md` with the wording each result is allowed. |
| `measure_latency.py` | Single-clip CPU timings (median and p95 over 200 clips) and dependency footprint for C2, C5 and C6. |
| `check_deployed_labels.py` | Checks whether the shipped app's model has Asthma and Bronchial swapped. |
| `tests/smoke_test.sh` | Runs the full pipeline on synthetic data. |

## Order of operations (do not reorder)

1. **Build the manifest and read the report.** This computes no outcomes, so it is allowed before the freeze.
   ```bash
   python build_manifest.py --audio-root /path/to/ADDv2 --handover-csv /path/to/metadata_handover.csv
   ```
   Use `data/manifest_report.txt` to settle the grouping key (`--group-mode per_class|global`) and to check the paper's facts: the number of subjects, the native rates, and whether the corpus is ADD v2 only.
2. **Freeze.** Fill in the `[settle before freezing]` items in `ANALYSIS_PLAN.md`, then commit the plan **and** `data/manifest.csv` together. Never rebuild the manifest after this commit: it holds the folds. If paths differ on another machine, pass `--audio-root` instead of rebuilding.
3. **Extract features:** `python extract_features.py --n-jobs 4 [--audio-root ...]`
4. **Run the classical models (CPU):** `python run_classical.py --configs all --protocols grouped clip`
5. **Run the CRNN (GPU)**, in priority order, so the primary comparison lands first:
   ```bash
   python run_crnn.py --configs C6 C7 --protocol grouped
   python run_crnn.py --configs B2_C6 A7 --protocol grouped
   python run_crnn.py --configs C6 --protocol clip
   ```
6. **Compare:** `python compare.py`, then read `results/REPORT.md`.
7. **Latency (CPU-only machine):** `python measure_latency.py [--audio-root ...]`, then re-run `compare.py` so the report includes the table.
8. **Commit** `results/runs/`, `results/preds/`, `results/env_*.json`, `results/latency_*.csv`, `results/machine.json` and `results/REPORT.md`. Don't commit `cache/`.

## Running on Kaggle

- Create a notebook with a GPU T4 accelerator and Internet enabled. Add the dataset `mohammedtawfikmusaed/asthma-detection-dataset-version-2` as an input, and use the path shown in the Input panel as `--audio-root`.
- `/kaggle/input` is read-only, so clone the repo into `/kaggle/working`:
  ```bash
  git clone https://github.com/InnocentAnyaele/respisound && cd respisound/experiments
  pip install -r requirements.txt   # torch is preinstalled on Kaggle
  ```
- Results are written per (config, protocol, repeat), and finished repeats are skipped. If a session times out, run the same command again in a new session. Download `results/` at the end of each session, or push it to git.
- Use one environment for every run in the paper, and don't mix librosa versions. librosa 1.0 changed `pitch_shift`, so augmented audio differs from librosa 0.11. `results/env_*.json` records what was used.

## Expected runtime (1,211 clips)

| Step | Estimate |
|---|---|
| Manifest | about 1 min |
| Features | about 5–10 min on one core, less with `--n-jobs 4` |
| All classical runs (16 configs × 2 protocols × 25 runs) | about 15 min on CPU |
| CRNN C6, A7, B2_C6 (grouped) | about 3–5 min per run on a T4 (from your notebooks' 212–292 s), × 25 runs each |
| CRNN C7 (full clip, 4× the time frames) | roughly 3× slower per run |
| **CRNN total** | **about 10–12 GPU-hours** |

Time one C6 run first (`--repeats 0`) and rescale these estimates from it. Early stopping usually shortens runs.

## Notes

- **Determinism.** Reruns are bit-identical on CPU. On GPU, cuDNN's LSTM kernels can still vary slightly despite the deterministic flags, so judge variability across seeds, not across reruns.
- **Smoke tests.** `--max-epochs` below 50 writes to `results/smoke/` so a test can never be mistaken for a real result. Run `bash tests/smoke_test.sh` to test the whole pipeline on synthetic data (about 3 min on one core).
- **Features.** They copy the submitted notebooks and `backend/main.py` exactly, so any change in results comes from the evaluation protocol, not from the features.
- **Known replications of original quirks.** Kept on purpose so the comparisons are like-for-like:
  - The pitch-shift step draws `randint(-1, 1)`, i.e. −1 or 0 semitones.
  - SMOTE runs on unscaled features and only oversamples the single smallest class.

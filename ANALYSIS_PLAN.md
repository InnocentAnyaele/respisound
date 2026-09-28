# Pre-registered analysis plan: camera-ready revision

**Paper:** Feature Scaling Beats Architecture Choice in Offline Respiratory Screening for Low-Resource Clinics (GlobalSouthAI @ NeurIPS 2026, submission 207)
**Status:** FROZEN. Approved by all four authors and committed on `2026-09-28`, freeze commit `69ab10fea7b95dbad42923dc19f9530b4fc3bef5`. That commit, not this line, is the timestamped evidence; this line was added immediately afterwards because a file cannot contain its own commit hash.

**Rule:** This file is committed before any Phase 1 code produces a result. The commit timestamp is our evidence that the plan came first. Any later change goes in the Deviations log (Section 7), dated and with a reason. A change made after seeing results is labelled *post hoc* in the paper.

Items marked **[settle before freezing]** must be resolved before the freeze commit. Building the manifest and reading `data/manifest_report.txt` is allowed before freezing, because it computes no outcome. Running any model is not.

**Implementation:** `experiments/` in the repo. `config.py` holds every constant named here.

---

## 1. Data

- **Source:** Asthma Detection Dataset v2 (Kaggle, Musaed), using the original files. Do not use the `respimerge-5` unified copy, which may already be resampled.
- **Expected N:** 1,211.
- **Labels:** as in the source folders: asthma, Bronchial, copd, healthy, pneumonia. The paper uses the source label "Bronchial", not "bronchitis".
- **Exclusions:** none planned. Any file that fails to load is listed in the manifest with the reason, and the final N is reported.
- **Exact duplicates:** files with identical bytes (md5) are never split between train and test. If twins sit in different patient groups, those whole groups are merged. Duplicates whose twins carry different labels are reported, not removed.
- **Manifest:** committed as `data/manifest.csv` (metadata only, no audio), with these columns:
  - `file_id`, `original_filename`, `label`
  - `patient_group`
  - `native_sr`, `n_channels`, `duration_s`
  - fold assignment for every repeat
- **Grouping key:** `label + "_" + P-number` (`--group-mode per_class`), where the P-number is parsed from the original filename with the regex `^(P\d+)`, as implemented in `build_manifest.py`. It matches all 1,211 files.
  - Settled: 51 of the 58 P-numbers appear under more than one label, so the numbering restarts per class and the label must be part of the key.
  - Groups: 201 in total after the exact-duplicate merges — asthma 58, copd 51, pneumonia 46, healthy 25, bronchial 21. The submitted paper's claim of 112 subjects matches neither the 58 raw P-numbers nor the 201 per-class groups, and is corrected in the camera-ready.
  - Bronchial has 104 clips across only 21 groups, i.e. 2–6 patients per test fold. Its recall is reported with that count, per Section 3.
- **Recording codes:** settled as **undocumented**. Neither the dataset's `Des.txt` nor the Kaggle description says what the suffixes mean, so no interpretation is claimed. What is recorded is that the code alphabet is almost perfectly nested within class: copd uses Pr (201) and Mc (200); bronchial uses Tc (52) and Sc (52); asthma uses IE (13), IU (13), RL (12) and RS (12), with the remaining 238 asthma files carrying `Wheezing` in place of the class token (e.g. `P52WheezingRL_259.wav`) so the report's regex leaves them unmatched; healthy uses a single S (133); pneumonia uses single letters A–Z, roughly 7–17 files each. Two-letter codes therefore look like site or device labels and single letters like segment indices, but this is not asserted. Because no code is shared across classes, the codes are a second recording-provenance cue alongside the sample rate in Section 7.
- **Loading:** load at the native rate, convert to mono, and resample to 16 kHz with librosa's default resampler. librosa is pinned to **0.11.0**, the version used by the submitted notebooks, so the augmented copies in A3–A6 reproduce the original `pitch_shift`. Kaggle ships a different version by default and must be pinned explicitly at install time. `results/env_*.json` records the librosa and soxr versions actually used.

## 2. Evaluation protocol

**Primary protocol: subject-grouped cross-validation**
- `StratifiedGroupKFold`, k = 5, `shuffle=True`, repeated with seeds {0, 1, 2, 3, 4}. This gives 25 train/test runs per configuration.
- Every configuration uses identical folds, read from the manifest. The manifest is committed with this plan, and it is never rebuilt after the freeze.
- Model seed for each run = repeat × 10 + fold (all models).
- The scaler, SMOTE, audio augmentation and class weights are fitted on the training fold only. Test folds are never transformed by anything fitted on them or augmented.

**CRNN training within each fold**
- Inner validation set: one of 7 `StratifiedGroupKFold` folds of the training data (about 14% of training groups), using the run seed. Stratification guarantees Bronchial appears in the validation set.
- Class weights are computed from the inner-training labels only.
- Validation loss is the class-weighted mean over the whole validation set.
- Adam at 1e-3, batch size 32, maximum 50 epochs.
- Early stopping on validation loss with patience 10; the best checkpoint is restored before testing.
- Torch seed equals the repeat seed, with cuDNN set to deterministic.

**Secondary protocol: clip-level cross-validation**
- Stratified 5-fold with the same seeds, ignoring groups.
- Run for every classical configuration, and for C6 among the CRNNs (to keep GPU time manageable).
- Reported only to quantify the leakage gap (rule R3).

## 3. Metrics

- **Primary:** macro recall per run, reported as mean ± SD over the 25 runs.
- **Secondary:** per-class recall, macro F1, accuracy, and the pooled out-of-fold confusion matrix (per repeat, then averaged).
- **Minority class:** report Bronchial recall together with the number of Bronchial *patients* in each test fold.
- **By sampling rate:** macro recall computed separately on 4 kHz-origin and 44.1 kHz-origin test clips (pooled out-of-fold, grouped protocol).

## 4. Configurations

This list is fixed, and every configuration is reported whatever the outcome.

**Feature sets**
- **F26:** mean and SD of 13 MFCCs.
- **F30:** F26 plus the mean and SD of RMS and ZCR.
- Features are computed over the full clip unless stated otherwise.

**Hyperparameters** are fixed at the values actually used in the submitted notebooks, with no tuning on test folds.
- SVC: RBF kernel, C = 1, `gamma='scale'`, `class_weight='balanced'`, `probability=True`.
- Random Forest: 100 trees (the value in the code, not the 200 stated in the paper).
- CRNN: architecture as in `backend/model_definition.py`.

### Main configurations

| ID | Model | Input | Scaling | Class balance | Purpose |
|----|-------|-------|---------|---------------|---------|
| C1 | SVM-RBF | F30 | none | balanced | Scaling ablation (off) |
| C2 | SVM-RBF | F30 | StandardScaler | balanced | Main classical model |
| C3 | SVM-RBF | F26 | StandardScaler | balanced | Feature-set ablation |
| C4 | RF-100 | F30 | none | none | RF without class weights |
| C5 | RF-100 | F30 | none | balanced | RF with class weights |
| C6 | CRNN | log-Mel, first 1.5 s (128×47) | per-clip z-score | inverse-frequency weights | Submitted setting |
| C7 | CRNN | log-Mel, full clip (≈128×188) | per-clip z-score | inverse-frequency weights | Matched input window |
| C8 | SVM-RBF | F30 from first 1.5 s only | StandardScaler | balanced | Matched input window |

### Augmentation

Augmentation is applied to training folds only, and test folds are untouched.

- **SMOTE:** `sampling_strategy='minority'`, as in the original notebook. This isolates the effect of fixing the test-set contamination.
- **Audio augmentation:** one augmented copy is *added* per training clip. Transforms and probabilities are as in the original notebook (noise p=0.7, pitch shift p=0.5, time stretch p=0.5).

| ID | Base | Added |
|----|------|-------|
| A1 | C2 | SMOTE |
| A2 | C5 | SMOTE |
| A3 | C2 | Audio augmentation |
| A4 | C5 | Audio augmentation |
| A5 | C2 | SMOTE + audio augmentation |
| A6 | C5 | SMOTE + audio augmentation |
| A7 | C6 | SpecAugment: one frequency mask U[0,10) bins and one time mask U[0,15) frames, no time warping. The paper states the omission of time warping explicitly. |

### Bandwidth and sampling-rate control

- Report the crosstab of `native_sr` × label, and Cramér's V for their association.
- The low-pass filter is a 10th-order zero-phase Butterworth at **1.8 kHz**, applied to every file after resampling. The cutoff sits below 2 kHz so the resampler's roll-off near the 4 kHz files' Nyquist frequency cannot leave a residual cue.

| ID | Test |
|----|------|
| B0 | Shortcut probe: logistic regression on `native_sr` alone (one-hot), same folds. Descriptive only: with two rates it can predict at most two classes, so its macro recall is capped at 0.40. |
| B1 | Shortcut probe: logistic regression on the fraction of spectral energy above 2 kHz, computed on the 16 kHz signal. |
| B2 | C2, C5 and C6 rerun with every file low-pass filtered (1.8 kHz) before feature extraction. |

### Latency and footprint (C2, C5, C6)

- Measure on one CPU-only machine and record its full spec.
- Use single-clip calls, not batch-amortized timings: median and p95 over 200 clips.
- Time each stage separately:
  - load + resample
  - feature extraction
  - model call: `predict_proba` for the classical models, since the UI shows probabilities; the forward pass plus softmax for the CRNN
  - end-to-end total
- Also report the installed size of each pipeline's runtime dependencies (an sklearn-only build vs one that includes PyTorch).

## 5. Comparisons and decision rules

- All differences are computed per run on identical folds, so every comparison is paired.
- 95% confidence intervals use the corrected resampled t-test for repeated k-fold CV (Nadeau & Bengio, 2003).
- **Equivalence margin δ = 0.03 macro recall.** Settled at the value already in `config.py`.

**R1 Scaling.** Report C2 − C1, and separately C3 vs C2. Describe the scaling effect as the effect of a preprocessing step missing from a baseline, not as a finding about architectures, whatever its size.

**R2 Classical vs deep.**
- The primary comparison is C2 vs C7, because both see the full clip.
- Secondary comparisons are C2 vs C6 and C5 vs C7.
- Wording rules:
  - Say "outperforms" only if the CI of the difference excludes 0.
  - Say "comparable" only if the whole CI lies within ±δ.
  - Otherwise, say "inconclusive".

**R3 Leakage gap.** Always report clip-level minus grouped macro recall for C2, C5 and C6, in the main text.

**R4 Bandwidth shortcut.** R4 is triggered if either:
- Cramér's V between native sample rate and label is 0.30 or more, or
- for any of C2, C5 or C6, the low-pass version (B2) has a CI for its difference lying entirely below −δ.

If triggered:
- the abstract must state that recording-source cues predict class, and
- B2 results appear in the main text next to the primary results.

Otherwise, B2 goes to the appendix, with one sentence about it in the main text. A drop under low-pass is described as mixing shortcut use with genuine high-frequency information; it is not described as proof of a shortcut.

**R5 Augmentation.** A technique "helps" or "hurts" only under the R2 wording rules. Otherwise, it is reported as having "no measurable effect". No mechanism is claimed without a direct test.

**R6 Title and headline.** These are chosen after the results, and must not claim anything that R1–R5 do not support.

## 6. Commitments

- Every configuration in Section 4 is reported, including those that look bad.
- There is no hyperparameter tuning on test folds. Any tuning added later uses nested CV only and is labelled as such.
- Numbers from the submitted version (single clip-level split) may appear only in an appendix table labelled "superseded".
- Every number in the paper is generated from `results/*.csv` by a script. No numbers are copied by hand.
- The deployed checkpoint's label order is verified before the app is shown to anyone. (This is not an analysis item, but it is safety-relevant.)

## 7. Pre-freeze revisions

These edits were made after building the harness and running it on **synthetic data only**, before any real ADD v2 audio was processed:
1. Inner validation changed from a `GroupShuffleSplit` to a stratified group fold, so Bronchial is always present.
2. Model seeds are now per run (repeat × 10 + fold), not per repeat.
3. The low-pass cutoff is set to 1.8 kHz (resampler roll-off).
4. Exact duplicate files now force their groups to merge.
5. Clip-level CRNN runs are limited to C6 (GPU budget).
6. The R4 trigger changed from the B0 probe, which is capped at 0.40 with two rates, to Cramér's V plus the B2 rule.
7. A recall-by-sampling-rate breakdown was added.

**Observed before the freeze, from the manifest scan only (Section 1 permits this; no model was run):**

8. Native sample rate is strongly associated with label. The corpus holds two rates, 4 kHz and 44.1 kHz:

   | native_sr | asthma | bronchial | copd | healthy | pneumonia |
   |---|---|---|---|---|---|
   | 4000 | 262 | 15 | 188 | 0 | 39 |
   | 44100 | 26 | 89 | 213 | 133 | 246 |

   **Cramér's V = 0.65**, above the `CRAMERS_V_THRESHOLD = 0.30` already committed in `config.py`, so **R4 is triggered by a property of the data alone**. The threshold was fixed in code before this value was computed. Consequences, per Section 5: the abstract must state that recording-source cues predict class, and B0, B1 and the B2 runs appear in the main text next to the primary results rather than in the appendix.

   This is consistent with the dataset's own documentation, which describes ADD v2 as a merge of the Respiratory Sound Database (~170 clips), ICBHI (212 clips) and recordings from individual patients — three acquisition setups spread unevenly across five classes.
9. The grouping key, the recording codes and δ were settled as recorded in Sections 1 and 5. `FULL_WIN_S = 6.0` was confirmed: the longest clip is exactly 6.0 s and 91.3% of clips are exactly 6.0 s, so C7 never truncates.
10. Manifest scan results: 1,211 of 1,211 files loaded, none excluded, all mono. 12 exact-duplicate pairs, none with conflicting labels; the merges they forced reduced the group count from 205 to 201 (healthy 27→25, pneumonia 48→46). Grouped folds leak no group across folds for any of the five repeats; clip-level folds split about 200 groups per repeat, which is the leakage R3 measures. The handover cross-check matched all 1,211 file IDs with none on either side alone, confirming the corpus is ADD v2 only.

## 8. Deviations log (after freezing)

| Date | Change | Reason | Made before or after seeing results? |
|------|--------|--------|--------------------------------------|
| | | | |

---

**Approved by:** ☑ Victor Olufemi ☑ Abubakar Chilala ☑ Innocent Anyaele ☑ Cleophas Kadima

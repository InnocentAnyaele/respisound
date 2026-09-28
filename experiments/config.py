"""Single source of truth for every constant used by the harness.

Mirrors ANALYSIS_PLAN.md. If you change a value here after the plan is frozen,
log it in the plan's Deviations log.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CACHE = ROOT / "cache"
RESULTS = ROOT / "results"
MANIFEST = DATA / "manifest.csv"

# Fixed label order. Matches the deployed app's CLASSES list (Asthma, Bronchitis,
# COPD, Healthy, Pneumonia), so a model trained here can be dropped into the app.
CLASSES = ["asthma", "bronchial", "copd", "healthy", "pneumonia"]
DISPLAY = {"asthma": "Asthma", "bronchial": "Bronchial", "copd": "COPD",
           "healthy": "Healthy", "pneumonia": "Pneumonia"}
# Source folder name (lower-cased) -> class. "bronchitis" is accepted only as an alias.
FOLDER_TO_CLASS = {"asthma": "asthma", "bronchial": "bronchial", "bronchitis": "bronchial",
                   "copd": "copd", "healthy": "healthy", "pneumonia": "pneumonia"}

# Audio and features (identical to the submitted notebooks and backend/main.py)
TARGET_SR = 16_000
SHORT_WIN_S = 1.5          # CRNN window in the submitted paper
FULL_WIN_S = 6.0           # longest ADD v2 clip; full-clip CRNN input is padded/truncated to this
N_MFCC = 13
N_FFT = 2048
HOP = 512
N_MELS = 128
HF_SPLIT_HZ = 2000         # B1 probe: fraction of energy above this frequency
LOWPASS_HZ = 1800          # B2 control; below 2 kHz so resampler roll-off cannot leave a residual cue
LOWPASS_ORDER = 10

# Evaluation protocol
N_FOLDS = 5
REPEATS = [0, 1, 2, 3, 4]
INNER_VAL_SPLITS = 7       # CRNN early-stopping set = 1 of 7 stratified group folds (~14%)
DELTA = 0.03               # equivalence margin, macro recall
CRAMERS_V_THRESHOLD = 0.30 # R4: native sample rate vs label association that triggers main-text reporting
                           # (B0 cannot serve as the trigger: with 2 rates it predicts at most 2 of 5
                           #  classes, so its macro recall is capped at 0.40)

# Models (hyperparameters as actually used in the submitted notebooks)
SVM = dict(kernel="rbf", C=1.0, gamma="scale", class_weight="balanced", probability=True)
RF_TREES = 100
CRNN = dict(lr=1e-3, batch_size=32, max_epochs=50, patience=10, dropout=0.3)
SPEC_AUG = dict(freq_max=10, time_max=15)   # widths ~ U[0, max), one mask each, no time warp

# Audio augmentation, replicating baselines-smote-augmentation.ipynb
AUG = dict(noise_p=0.7, noise_factor=0.003, pitch_p=0.5, stretch_p=0.5, stretch=(0.95, 1.05))

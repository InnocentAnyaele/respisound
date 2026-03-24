import os
import sys
import io
import uuid
import json
import base64
import shutil
import logging
import sqlite3
import datetime
import numpy as np
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from typing import Optional, List


# When bundled as a windowed executable (console=False), stdout/stderr are None.
# Redirect them to devnull so uvicorn's logging formatter doesn't crash on isatty().
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    # Executable directory (read-only in packaged .deb / AppImage)
    BASE_DIR = Path(sys.executable).parent
    # PyInstaller 6.x places bundled data files inside _internal/ and exposes
    # the path via sys._MEIPASS. Fall back to BASE_DIR for older builds.
    _MEIPASS = Path(getattr(sys, "_MEIPASS", BASE_DIR / "_internal"))
    # Writable user-data directory for database and uploads.
    # On Windows use %LOCALAPPDATA%; on Unix follow XDG_DATA_HOME.
    if sys.platform == "win32":
        _app_data = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        _app_data = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    DATA_DIR = _app_data / "respisound"
else:
    BASE_DIR = Path(__file__).parent
    _MEIPASS = BASE_DIR
    DATA_DIR = BASE_DIR

DB_PATH = DATA_DIR / "respisound.db"
UPLOADS_DIR = DATA_DIR / "uploads"
MODEL_PATH = _MEIPASS / "model" / "respisound_model.pt"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Must match training LabelEncoder order: asthma, bronchitis, copd, healthy, pneumonia
CLASSES = ["Asthma", "Bronchitis", "COPD", "Healthy", "Pneumonia"]

TARGET_SAMPLE_RATE = 16_000
TARGET_DURATION_S = 1.5
TARGET_NUM_SAMPLES = int(TARGET_SAMPLE_RATE * TARGET_DURATION_S)

model = None
feature_extractor = None


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,
            created_at TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS screenings (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            audio_filename TEXT NOT NULL,
            predicted_class TEXT NOT NULL,
            confidence REAL NOT NULL,
            probabilities TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    """)
    conn.commit()
    conn.close()


def load_model():
    global model, feature_extractor
    try:
        import torch

        if not MODEL_PATH.exists():
            logger.warning("Model file not found at %s — running in demo mode", MODEL_PATH)
            return False

        from model_definition import RespiSoundCRNN

        raw = torch.load(str(MODEL_PATH), map_location="cpu")
        state = (
            raw["model_state_dict"]
            if isinstance(raw, dict) and "model_state_dict" in raw
            else raw
        )
        model = RespiSoundCRNN(num_classes=len(CLASSES))
        model.load_state_dict(state, strict=True)
        model.eval()
        logger.info("Model loaded successfully")
        return True
    except Exception as e:
        logger.warning("Could not load model: %s — running in demo mode", str(e))
        return False


def extract_features(audio_path: str):
    """
    Matches training notebook: librosa 16 kHz, 1.5 s pad/trim, mel (n_fft=2048, hop=512,
    n_mels=128), power_to_db(ref=max), per-spectrogram z-score (eps 1e-6).
    """
    try:
        import librosa
        import torch

        y, _ = librosa.load(audio_path, sr=TARGET_SAMPLE_RATE, mono=True)
        y = np.asarray(y, dtype=np.float32)

        if y.size == 0:
            raise ValueError("Empty audio after load")

        if y.shape[0] < TARGET_NUM_SAMPLES:
            y = np.pad(y, (0, TARGET_NUM_SAMPLES - y.shape[0]))
        else:
            y = y[:TARGET_NUM_SAMPLES]

        mel = librosa.feature.melspectrogram(
            y=y,
            sr=TARGET_SAMPLE_RATE,
            n_fft=2048,
            hop_length=512,
            n_mels=128,
        )
        log_mel = librosa.power_to_db(mel, ref=np.max)
        log_mel = (log_mel - np.mean(log_mel)) / (np.std(log_mel) + 1e-6)

        tensor = torch.from_numpy(log_mel.astype(np.float32)).unsqueeze(0).unsqueeze(0)
        return tensor

    except Exception as e:
        logger.error("Feature extraction failed: %s", str(e))
        raise


def run_inference(audio_path: str):
    if model is None:
        rng = np.random.default_rng(abs(hash(audio_path)) % (2**32))
        raw_probs = rng.dirichlet(np.ones(len(CLASSES)) * 0.5)
        predicted_idx = int(np.argmax(raw_probs))
        return {
            "predicted_class": CLASSES[predicted_idx],
            "confidence": float(raw_probs[predicted_idx]),
            "probabilities": {cls: float(p) for cls, p in zip(CLASSES, raw_probs)},
            "demo_mode": True
        }

    import torch
    features = extract_features(audio_path)
    with torch.no_grad():
        outputs = model(features)
        probabilities = torch.softmax(outputs, dim=1).squeeze().numpy()

    predicted_idx = int(np.argmax(probabilities))
    return {
        "predicted_class": CLASSES[predicted_idx],
        "confidence": float(probabilities[predicted_idx]),
        "probabilities": {cls: float(p) for cls, p in zip(CLASSES, probabilities)},
        "demo_mode": False
    }


def generate_mel_png(audio_path: str) -> str:
    """Return the log-mel spectrogram as a base64 PNG (magma colormap)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    features = extract_features(audio_path)      # (1, 1, 128, T)
    mel_np = features.squeeze().numpy()           # (128, T)

    fig, ax = plt.subplots(figsize=(4, 2.5), dpi=100)
    ax.imshow(mel_np, aspect="auto", origin="lower", cmap="magma")
    ax.axis("off")
    fig.tight_layout(pad=0)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def compute_acoustic_features(audio_path: str) -> dict:
    """Extract rich acoustic features for clinical explainability."""
    import librosa

    y, sr = librosa.load(audio_path, sr=TARGET_SAMPLE_RATE, mono=True)
    y = np.asarray(y, dtype=np.float32)
    if y.shape[0] < TARGET_NUM_SAMPLES:
        y = np.pad(y, (0, TARGET_NUM_SAMPLES - y.shape[0]))
    else:
        y = y[:TARGET_NUM_SAMPLES]

    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512, n_mels=128)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mel_power = librosa.db_to_power(mel_db)
    mel_freqs = librosa.mel_frequencies(n_mels=128, fmin=0.0, fmax=float(sr) / 2.0)

    total_energy = float(mel_power.sum()) + 1e-8
    band_defs = {
        "Sub-bass (0–250 Hz)": (0.0, 250.0),
        "Bass/Mid (250–2k Hz)": (250.0, 2000.0),
        "Upper-mid (2k–6k Hz)": (2000.0, 6000.0),
        "High-freq (6k–8k Hz)": (6000.0, float(sr) / 2.0),
    }
    freq_band_energy: dict = {}
    for name, (lo, hi) in band_defs.items():
        mask = (mel_freqs >= lo) & (mel_freqs < hi)
        freq_band_energy[name] = (
            round(float(mel_power[mask].sum() / total_energy * 100), 1) if mask.any() else 0.0
        )

    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, n_fft=2048, hop_length=512)
    mfcc_means = [round(float(v), 2) for v in mfccs.mean(axis=1)]

    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    idxs = np.linspace(0, len(rms) - 1, 24, dtype=int)
    rms_envelope = [round(float(rms[i]), 4) for i in idxs]

    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=2048, hop_length=512)[0]
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr, n_fft=2048, hop_length=512)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y, frame_length=2048, hop_length=512)[0]

    return {
        "freq_band_energy": freq_band_energy,
        "mfcc_means": mfcc_means,
        "rms_envelope": rms_envelope,
        "spectral_centroid_mean": round(float(centroid.mean()), 1),
        "spectral_bandwidth_mean": round(float(bandwidth.mean()), 1),
        "zero_crossing_rate_mean": round(float(zcr.mean()), 4),
        "duration_s": round(float(len(y) / sr), 3),
        "sample_rate": int(sr),
    }


def compute_uncertainty(probabilities: dict) -> dict:
    """Shannon entropy-based model uncertainty and confidence tier."""
    probs = np.array(list(probabilities.values()), dtype=np.float64)
    n = len(probs)
    entropy = float(-np.sum(probs * np.log(probs + 1e-8)) / np.log(n))
    sorted_p = sorted(probs, reverse=True)
    margin = round(float(sorted_p[0] - sorted_p[1]), 3)
    top_conf = sorted_p[0]
    tier = "High" if top_conf >= 0.80 else ("Moderate" if top_conf >= 0.55 else "Low")
    return {"entropy": round(entropy, 3), "margin": margin, "confidence_tier": tier}


def get_processing_pipeline(audio_path: str, mel_shape: tuple) -> list:
    """Ordered list of processing steps applied to the audio sample."""
    ext = Path(audio_path).suffix.upper().lstrip(".") or "WAV"
    try:
        size_kb = round(os.path.getsize(audio_path) / 1024, 1)
    except OSError:
        size_kb = 0.0
    return [
        {"step": "Load",            "detail": f"Decode {ext} file to raw PCM waveform",              "value": f"{size_kb} KB"},
        {"step": "Resample",        "detail": "Convert to 16 kHz single-channel mono",               "value": "16,000 Hz"},
        {"step": "Pad / Trim",      "detail": "Fixed-length 1.5 s analysis window",                  "value": "24,000 samples"},
        {"step": "Mel Filter",      "detail": "128-band mel filter bank (n_fft=2048, hop=512)",       "value": f"{mel_shape[0]}×{mel_shape[1]}"},
        {"step": "Power → dB",      "detail": "Log-amplitude scaling referenced to spectral peak",    "value": "dB scale"},
        {"step": "Z-Score Norm",    "detail": "Per-spectrogram standardisation (ε=1e-6)",             "value": "μ=0, σ=1"},
        {"step": "CRNN Inference",  "detail": "2×Conv + BatchNorm → LSTM(128) → FC → Softmax",       "value": "5 classes"},
    ]


def compute_gradcam(audio_path: str) -> str:
    """
    GradCAM on model.cnn[4] (the second Conv2d, 32→64 channels).
    Returns a base64 PNG: greyscale spectrogram + jet heatmap overlay.
    Returns empty string if model is None.
    """
    if model is None:
        return ""

    import torch
    import torch.nn.functional as F
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    features = extract_features(audio_path)    # (1, 1, 128, T)

    activation: dict = {}
    gradient: dict = {}

    def fwd_hook(module, inp, out):
        activation["A"] = out

    def bwd_hook(module, grad_in, grad_out):
        gradient["dA"] = grad_out[0]

    target_layer = model.cnn[4]
    fh = target_layer.register_forward_hook(fwd_hook)
    bh = target_layer.register_full_backward_hook(bwd_hook)

    try:
        model.eval()
        inp = features.detach().requires_grad_(True)
        logits = model(inp)                        # (1, num_classes)
        pred_idx = int(logits.argmax(dim=1).item())
        model.zero_grad()
        logits[0, pred_idx].backward()
    finally:
        fh.remove()
        bh.remove()

    A = activation["A"].detach()                   # (1, 64, H, W)
    dA = gradient["dA"].detach()                   # (1, 64, H, W)

    alpha = dA.mean(dim=(2, 3), keepdim=True)      # (1, 64, 1, 1)
    cam = F.relu((alpha * A).sum(dim=1, keepdim=True))  # (1, 1, H, W)

    cam_up = F.interpolate(
        cam, size=(features.shape[2], features.shape[3]),
        mode="bilinear", align_corners=False,
    ).squeeze().numpy()                            # (128, T)

    cam_max = cam_up.max()
    if cam_max > 1e-8:
        cam_up = cam_up / cam_max

    mel_np = features.detach().squeeze().numpy()   # (128, T)
    mel_min, mel_max = mel_np.min(), mel_np.max()
    mel_norm = (mel_np - mel_min) / (mel_max - mel_min + 1e-8)

    fig, ax = plt.subplots(figsize=(4, 2.5), dpi=100)
    ax.imshow(mel_norm, aspect="auto", origin="lower", cmap="Greys_r")
    ax.imshow(cam_up,   aspect="auto", origin="lower", cmap="jet", alpha=0.5)
    ax.axis("off")
    fig.tight_layout(pad=0)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    load_model()
    yield


app = FastAPI(title="RespiSound API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:1420", "tauri://localhost", "https://tauri.localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PatientCreate(BaseModel):
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None


class PatientResponse(BaseModel):
    id: str
    name: str
    age: Optional[int]
    gender: Optional[str]
    created_at: str


class ScreeningResponse(BaseModel):
    id: str
    patient_id: Optional[str]
    audio_filename: str
    predicted_class: str
    confidence: float
    probabilities: dict
    notes: Optional[str]
    created_at: str
    demo_mode: Optional[bool] = False


class ExplainResponse(BaseModel):
    screening_id: str
    mel_spectrogram_b64: str
    gradcam_b64: str
    demo_mode: bool
    acoustic_features: dict
    processing_pipeline: List[dict]
    model_uncertainty: dict


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "db_path": str(DB_PATH),
        "timestamp": datetime.datetime.utcnow().isoformat()
    }


@app.post("/patients", response_model=PatientResponse)
def create_patient(patient: PatientCreate):
    conn = get_db()
    try:
        patient_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO patients (id, name, age, gender, created_at) VALUES (?, ?, ?, ?, ?)",
            (patient_id, patient.name, patient.age, patient.gender, now)
        )
        conn.commit()
        return PatientResponse(
            id=patient_id,
            name=patient.name,
            age=patient.age,
            gender=patient.gender,
            created_at=now
        )
    finally:
        conn.close()


@app.get("/patients", response_model=List[PatientResponse])
def list_patients():
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM patients ORDER BY created_at DESC").fetchall()
        return [PatientResponse(**dict(row)) for row in rows]
    finally:
        conn.close()


@app.get("/patients/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: str):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Patient not found")
        return PatientResponse(**dict(row))
    finally:
        conn.close()


@app.post("/screen", response_model=ScreeningResponse)
async def screen_audio(
    audio: UploadFile = File(...),
    patient_id: Optional[str] = Form(None),
    notes: Optional[str] = Form(None)
):
    # Browsers and WebKit (Tauri on Linux/macOS) use varying MIME types for the same
    # container format — e.g. audio/wave, audio/vnd.wave, audio/x-wav all mean WAV.
    # Fall back to file extension when the content-type is ambiguous or generic.
    _ALLOWED_TYPES = {
        "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/x-pn-wav",
        "audio/mpeg", "audio/mp3", "audio/x-mp3", "audio/x-mpeg",
        "audio/ogg", "audio/vorbis", "video/ogg", "application/ogg",
        "audio/flac", "audio/x-flac",
        "audio/mp4", "audio/x-m4a", "audio/aac",
        "application/octet-stream",  # generic binary — extension check covers this
    }
    _ALLOWED_EXT = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
    ct = (audio.content_type or "").lower().split(";")[0].strip()
    ext = Path(audio.filename or "").suffix.lower()
    if ct and ct not in _ALLOWED_TYPES and ext not in _ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Unsupported audio format. Use WAV, MP3, OGG, or FLAC.")

    file_ext = Path(audio.filename).suffix if audio.filename else ".wav"
    stored_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = UPLOADS_DIR / stored_filename

    try:
        with open(file_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save audio file: {str(e)}")

    try:
        result = run_inference(str(file_path))
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(e)}")

    conn = get_db()
    try:
        screening_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat()
        conn.execute(
            """INSERT INTO screenings 
               (id, patient_id, audio_filename, predicted_class, confidence, probabilities, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                screening_id,
                patient_id,
                stored_filename,
                result["predicted_class"],
                result["confidence"],
                json.dumps(result["probabilities"]),
                notes,
                now
            )
        )
        conn.commit()
    finally:
        conn.close()

    return ScreeningResponse(
        id=screening_id,
        patient_id=patient_id,
        audio_filename=stored_filename,
        predicted_class=result["predicted_class"],
        confidence=result["confidence"],
        probabilities=result["probabilities"],
        notes=notes,
        created_at=now,
        demo_mode=result.get("demo_mode", False)
    )


@app.get("/screenings", response_model=List[ScreeningResponse])
def list_screenings(patient_id: Optional[str] = None, limit: int = 50):
    conn = get_db()
    try:
        if patient_id:
            rows = conn.execute(
                "SELECT * FROM screenings WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?",
                (patient_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM screenings ORDER BY created_at DESC LIMIT ?",
                (limit,)
            ).fetchall()

        results = []
        for row in rows:
            d = dict(row)
            d["probabilities"] = json.loads(d["probabilities"])
            results.append(ScreeningResponse(**d))
        return results
    finally:
        conn.close()


@app.get("/screenings/{screening_id}", response_model=ScreeningResponse)
def get_screening(screening_id: str):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM screenings WHERE id = ?", (screening_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Screening not found")
        d = dict(row)
        d["probabilities"] = json.loads(d["probabilities"])
        return ScreeningResponse(**d)
    finally:
        conn.close()


@app.get("/explain/{screening_id}", response_model=ExplainResponse)
def explain_screening(screening_id: str):
    """
    Called fire-and-forget from the frontend after prediction returns.
    Returns mel spectrogram, GradCAM, acoustic features, processing pipeline,
    and model uncertainty. Runs synchronously so PyTorch backward() stays off
    the async event loop.
    """
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT audio_filename, probabilities FROM screenings WHERE id = ?",
            (screening_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Screening not found")
        audio_filename = row["audio_filename"]
        probabilities = json.loads(row["probabilities"])
    finally:
        conn.close()

    audio_path = str(UPLOADS_DIR / audio_filename)
    if not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found on server")

    is_demo = model is None

    try:
        mel_b64 = generate_mel_png(audio_path)
    except Exception as e:
        logger.error("mel PNG generation failed: %s", str(e))
        mel_b64 = ""

    try:
        gradcam_b64 = compute_gradcam(audio_path) if not is_demo else ""
    except Exception as e:
        logger.error("GradCAM failed: %s", str(e))
        gradcam_b64 = ""

    try:
        acoustic = compute_acoustic_features(audio_path)
    except Exception as e:
        logger.error("Acoustic features failed: %s", str(e))
        acoustic = {
            "freq_band_energy": {}, "mfcc_means": [], "rms_envelope": [],
            "spectral_centroid_mean": 0.0, "spectral_bandwidth_mean": 0.0,
            "zero_crossing_rate_mean": 0.0, "duration_s": 1.5, "sample_rate": 16000,
        }

    try:
        feats = extract_features(audio_path)
        mel_shape = (feats.shape[2], feats.shape[3])
    except Exception:
        mel_shape = (128, 47)
    pipeline = get_processing_pipeline(audio_path, mel_shape)

    uncertainty = compute_uncertainty(probabilities)

    return ExplainResponse(
        screening_id=screening_id,
        mel_spectrogram_b64=mel_b64,
        gradcam_b64=gradcam_b64,
        demo_mode=is_demo,
        acoustic_features=acoustic,
        processing_pipeline=pipeline,
        model_uncertainty=uncertainty,
    )


@app.get("/explain/{screening_id}/mel.png", response_class=Response)
def explain_mel_png(screening_id: str):
    """Serve the mel spectrogram as a PNG image (avoids data-URI CSP issues in packaged app)."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT audio_filename FROM screenings WHERE id = ?", (screening_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Screening not found")
        audio_filename = row["audio_filename"]
    finally:
        conn.close()

    audio_path = str(UPLOADS_DIR / audio_filename)
    if not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        png_b64 = generate_mel_png(audio_path)
        png_bytes = base64.b64decode(png_b64)
    except Exception as e:
        logger.error("mel PNG failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Could not generate spectrogram")

    return Response(content=png_bytes, media_type="image/png")


@app.get("/explain/{screening_id}/gradcam.png", response_class=Response)
def explain_gradcam_png(screening_id: str):
    """Serve the GradCAM heatmap as a PNG image (avoids data-URI CSP issues in packaged app)."""
    if model is None:
        raise HTTPException(status_code=503, detail="GradCAM requires a loaded model")

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT audio_filename FROM screenings WHERE id = ?", (screening_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Screening not found")
        audio_filename = row["audio_filename"]
    finally:
        conn.close()

    audio_path = str(UPLOADS_DIR / audio_filename)
    if not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        png_b64 = compute_gradcam(audio_path)
        if not png_b64:
            raise HTTPException(status_code=500, detail="GradCAM computation returned empty result")
        png_bytes = base64.b64decode(png_b64)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("GradCAM PNG failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Could not generate GradCAM")

    return Response(content=png_bytes, media_type="image/png")


@app.get("/stats")
def get_stats():
    conn = get_db()
    try:
        total_screenings = conn.execute("SELECT COUNT(*) FROM screenings").fetchone()[0]
        total_patients = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
        class_dist = conn.execute(
            "SELECT predicted_class, COUNT(*) as count FROM screenings GROUP BY predicted_class"
        ).fetchall()
        recent = conn.execute(
            "SELECT * FROM screenings ORDER BY created_at DESC LIMIT 5"
        ).fetchall()
        return {
            "total_screenings": total_screenings,
            "total_patients": total_patients,
            "class_distribution": {row["predicted_class"]: row["count"] for row in class_dist},
            "recent_screenings": len(recent)
        }
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("RESPISOUND_PORT", 8000))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", log_config=None)

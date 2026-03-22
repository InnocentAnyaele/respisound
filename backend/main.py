import os
import sys
import uuid
import json
import shutil
import logging
import sqlite3
import datetime
import numpy as np
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent

DB_PATH = BASE_DIR / "respisound.db"
UPLOADS_DIR = BASE_DIR / "uploads"
MODEL_PATH = BASE_DIR / "model" / "respisound_model.pt"

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
    allowed_types = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/flac"]
    if audio.content_type and audio.content_type not in allowed_types:
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
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

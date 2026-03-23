export function getBase(): string {
  if (typeof window !== "undefined") {
    const stored = window.sessionStorage.getItem("__RESPISOUND_API_URL__");
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: {
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export interface Patient {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  created_at: string;
}

export interface Screening {
  id: string;
  patient_id: string | null;
  audio_filename: string;
  predicted_class: string;
  confidence: number;
  probabilities: Record<string, number>;
  notes: string | null;
  created_at: string;
  demo_mode?: boolean;
}

export interface Stats {
  total_screenings: number;
  total_patients: number;
  class_distribution: Record<string, number>;
  recent_screenings: number;
}

export interface AcousticFeatures {
  freq_band_energy: Record<string, number>;
  mfcc_means: number[];
  rms_envelope: number[];
  spectral_centroid_mean: number;
  spectral_bandwidth_mean: number;
  zero_crossing_rate_mean: number;
  duration_s: number;
  sample_rate: number;
}

export interface ProcessingStep {
  step: string;
  detail: string;
  value: string;
}

export interface ModelUncertainty {
  entropy: number;
  margin: number;
  confidence_tier: string;
}

export interface ExplainResponse {
  screening_id: string;
  mel_spectrogram_b64: string;
  gradcam_b64: string;
  demo_mode: boolean;
  acoustic_features: AcousticFeatures;
  processing_pipeline: ProcessingStep[];
  model_uncertainty: ModelUncertainty;
}

export const api = {
  health: () => request<{ status: string; model_loaded: boolean }>("/health"),

  getStats: () => request<Stats>("/stats"),

  createPatient: (data: { name: string; age?: number; gender?: string }) =>
    request<Patient>("/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  listPatients: () => request<Patient[]>("/patients"),

  getPatient: (id: string) => request<Patient>(`/patients/${id}`),

  screenAudio: (formData: FormData) =>
    request<Screening>("/screen", {
      method: "POST",
      body: formData,
    }),

  listScreenings: (patientId?: string) =>
    request<Screening[]>(patientId ? `/screenings?patient_id=${patientId}` : "/screenings"),

  getScreening: (id: string) => request<Screening>(`/screenings/${id}`),

  explainScreening: (screeningId: string) =>
    request<ExplainResponse>(`/explain/${screeningId}`),
};

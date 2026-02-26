const BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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
};

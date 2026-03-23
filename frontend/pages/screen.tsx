import React, { useState, useRef, useCallback, useEffect } from "react";
import Layout from "../components/Layout";
import { api, Screening, Patient, ExplainResponse } from "../lib/api";

const CLASS_COLORS: Record<string, string> = {
  COPD: "#ff3b30",
  Asthma: "#ff9500",
  Pneumonia: "#af52de",
  Bronchitis: "#0071e3",
  Healthy: "#34c759",
};

const CLASS_BG: Record<string, string> = {
  COPD: "#fff0ef",
  Asthma: "#fff5e6",
  Pneumonia: "#f5eefa",
  Bronchitis: "#e8f1fd",
  Healthy: "#eafaf0",
};

const DISEASE_INFO: Record<string, { short: string; action: string }> = {
  COPD: {
    short: "Chronic Obstructive Pulmonary Disease — progressive airflow limitation.",
    action: "Refer to pulmonologist for spirometry confirmation.",
  },
  Asthma: {
    short: "Chronic inflammatory airway disease with reversible obstruction.",
    action: "Assess trigger factors; consider bronchodilator therapy.",
  },
  Pneumonia: {
    short: "Lung infection inflaming the air sacs, possibly filling with fluid.",
    action: "Chest X-ray and full blood count recommended urgently.",
  },
  Bronchitis: {
    short: "Bronchial tube inflammation, often viral in acute cases.",
    action: "Monitor symptoms; antibiotic therapy if bacterial origin suspected.",
  },
  Healthy: {
    short: "No significant respiratory pathology detected in the audio sample.",
    action: "Continue routine monitoring.",
  },
};

function WaveformVisualiser({ playing }: { playing: boolean }) {
  const bars = Array.from({ length: 32 });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        height: 40,
      }}
    >
      {bars.map((_, i) => {
        const delay = `${(i * 0.04).toFixed(2)}s`;
        const baseH = 8 + Math.sin(i * 0.6) * 10 + Math.cos(i * 0.3) * 6;
        return (
          <div
            key={i}
            className={playing ? "wave-bar" : ""}
            style={{
              width: 3,
              height: playing ? `${baseH + 8}px` : `${baseH}px`,
              background: playing ? "var(--blue)" : "#dde1e7",
              borderRadius: 2,
              animationDelay: delay,
              transition: "height 0.2s, background 0.3s",
            }}
          />
        );
      })}
    </div>
  );
}

function CircularProgress({ value, color, size = 110 }: { value: number; color: string; size?: number }) {
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - value * circumference;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg)"
        strokeWidth={8}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }}
      />
    </svg>
  );
}

export default function ScreenPage() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [notes, setNotes] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Screening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setAudioUrl(URL.createObjectURL(f)); setResult(null); setError(null); }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setAudioUrl(URL.createObjectURL(f)); setResult(null); setError(null); }
  };

  const togglePlay = () => {
    if (!audioUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let patientId: string | undefined;
      if (patientName.trim()) {
        const p: Patient = await api.createPatient({
          name: patientName.trim(),
          age: patientAge ? parseInt(patientAge) : undefined,
          gender: patientGender || undefined,
        });
        patientId = p.id;
      }
      const fd = new FormData();
      fd.append("audio", file);
      if (patientId) fd.append("patient_id", patientId);
      if (notes.trim()) fd.append("notes", notes.trim());
      const s = await api.screenAudio(fd);
      setResult(s);
      // Fire-and-forget — does not block showing the prediction
      setExplainLoading(true);
      setExplain(null);
      setExplainError(null);
      api.explainScreening(s.id)
        .then((exp) => setExplain(exp))
        .catch((err: any) => setExplainError(err.message || "Could not load explainability data."))
        .finally(() => setExplainLoading(false));
    } catch (err: any) {
      setError(err.message || "Screening failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null); setAudioUrl(null); setResult(null); setError(null);
    setPatientName(""); setPatientAge(""); setPatientGender(""); setNotes("");
    setExplain(null); setExplainLoading(false); setExplainError(null);
    setIsPlaying(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (fileRef.current) fileRef.current.value = "";
  };

  const sortedProbs = result
    ? Object.entries(result.probabilities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <Layout>
      <div style={{ padding: "28px 32px", maxWidth: 1040 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 3 }}>
            New Screening
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Upload a cough audio sample for respiratory disease classification
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: result ? "420px 1fr" : "420px 1fr", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14, letterSpacing: "-0.01em" }}>
                Patient Details
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <div>
                  <div className="label" style={{ marginBottom: 5 }}>Full Name</div>
                  <input className="input-field" placeholder="Optional" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div className="label" style={{ marginBottom: 5 }}>Age</div>
                    <input className="input-field" type="number" placeholder="Years" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} />
                  </div>
                  <div>
                    <div className="label" style={{ marginBottom: 5 }}>Gender</div>
                    <select className="input-field" value={patientGender} onChange={(e) => setPatientGender(e.target.value)} style={{ background: "var(--bg)" }}>
                      <option value="">Select</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 5 }}>Clinical Notes</div>
                  <textarea
                    className="input-field"
                    placeholder="Symptoms, duration, relevant history..."
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ resize: "vertical", fontFamily: "Inter, sans-serif" }}
                  />
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14, letterSpacing: "-0.01em" }}>
                Audio Sample
              </div>

              <div
                style={{
                  border: `2px dashed ${isDragging ? "var(--blue)" : "var(--border)"}`,
                  borderRadius: 10,
                  padding: "24px 16px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: isDragging ? "var(--blue-light)" : "var(--bg)",
                  transition: "all 0.15s",
                  marginBottom: 12,
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept="audio/*" style={{ display: "none" }} onChange={handleFileChange} />
                {file ? (
                  <div>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "var(--blue-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 10px",
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>
                      {file.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      {(file.size / 1024).toFixed(1)} KB — click to replace
                    </div>
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: "#f0f2f5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 10px",
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 3 }}>
                      Drop audio file or <span style={{ color: "var(--blue)", fontWeight: 500 }}>browse</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      WAV, MP3, OGG, FLAC supported
                    </div>
                  </div>
                )}
              </div>

              {file && audioUrl && (
                <div
                  style={{
                    background: "var(--bg)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    marginBottom: 12,
                    border: "1px solid var(--border)",
                  }}
                >
                  <WaveformVisualiser playing={isPlaying} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                    <button
                      onClick={togglePlay}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "var(--blue)",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 2px 8px rgba(0,113,227,0.3)",
                        transition: "transform 0.1s",
                        flexShrink: 0,
                      }}
                    >
                      {isPlaying ? (
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="#fff">
                          <rect x="0" y="0" width="3" height="12" rx="1" />
                          <rect x="7" y="0" width="3" height="12" rx="1" />
                        </svg>
                      ) : (
                        <svg width="11" height="12" viewBox="0 0 11 12" fill="#fff" style={{ marginLeft: 1 }}>
                          <path d="M0 0L11 6L0 12V0Z" />
                        </svg>
                      )}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{file.name}</span>
                  </div>
                </div>
              )}

              {error && (
                <div
                  style={{
                    padding: "10px 13px",
                    borderRadius: 8,
                    background: "var(--red-light)",
                    border: "1px solid rgba(255,59,48,0.2)",
                    color: "#c0372b",
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={!file || loading}
                  style={{ flex: 1 }}
                >
                  {loading ? (
                    <><div className="spinner" /> Analysing...</>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      Run Screening
                    </>
                  )}
                </button>
                {(file || result) && (
                  <button className="btn-ghost" onClick={reset}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {result ? (
              <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  className="card"
                  style={{
                    padding: 22,
                    borderColor: `${CLASS_COLORS[result.predicted_class]}30`,
                    borderWidth: 1.5,
                  }}
                >
                  {result.demo_mode && (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: 7,
                        background: "#f8fafc",
                        border: "1px solid var(--border)",
                        color: "var(--text-tertiary)",
                        fontSize: 12,
                        marginBottom: 14,
                      }}
                    >
                      Demo mode — model not loaded. Probabilities are randomised.
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <CircularProgress
                        value={result.confidence}
                        color={CLASS_COLORS[result.predicted_class] || "var(--blue)"}
                        size={100}
                      />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.04em" }}>
                          {(result.confidence * 100).toFixed(0)}%
                        </span>
                        <span style={{ fontSize: 9, color: "var(--text-tertiary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          conf.
                        </span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                        Predicted Condition
                      </div>
                      <div
                        style={{
                          fontSize: 26,
                          fontWeight: 700,
                          color: CLASS_COLORS[result.predicted_class] || "var(--text-primary)",
                          letterSpacing: "-0.04em",
                          lineHeight: 1.1,
                          marginBottom: 6,
                        }}
                      >
                        {result.predicted_class}
                      </div>
                      <span
                        className={`badge badge-${result.predicted_class.toLowerCase()}`}
                        style={{ fontSize: 11 }}
                      >
                        Screening Result
                      </span>
                    </div>
                  </div>

                  {DISEASE_INFO[result.predicted_class] && (
                    <div
                      style={{
                        background: CLASS_BG[result.predicted_class] || "var(--bg)",
                        borderRadius: 10,
                        padding: "13px 15px",
                        marginBottom: 18,
                      }}
                    >
                      <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.55, marginBottom: 6 }}>
                        {DISEASE_INFO[result.predicted_class].short}
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={CLASS_COLORS[result.predicted_class] || "var(--blue)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                          <polyline points="9 11 12 14 22 4" />
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </svg>
                        <span style={{ fontSize: 12, color: CLASS_COLORS[result.predicted_class] || "var(--blue)", fontWeight: 500 }}>
                          {DISEASE_INFO[result.predicted_class].action}
                        </span>
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
                    All Class Probabilities
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {sortedProbs.map(([cls, prob]) => {
                      const isTop = cls === result.predicted_class;
                      return (
                        <div key={cls}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <div
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: CLASS_COLORS[cls] || "var(--blue)",
                                  opacity: isTop ? 1 : 0.4,
                                  flexShrink: 0,
                                }}
                              />
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: isTop ? 600 : 400,
                                  color: isTop ? "var(--text-primary)" : "var(--text-secondary)",
                                }}
                              >
                                {cls}
                              </span>
                              {isTop && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: CLASS_COLORS[cls],
                                    background: CLASS_BG[cls],
                                    padding: "1px 6px",
                                    borderRadius: 10,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                  }}
                                >
                                  Top
                                </span>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: isTop ? 600 : 400,
                                color: isTop ? "var(--text-primary)" : "var(--text-tertiary)",
                              }}
                            >
                              {(prob * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div style={{ height: isTop ? 7 : 5, background: "var(--bg)", borderRadius: 10, overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${prob * 100}%`,
                                height: "100%",
                                background: CLASS_COLORS[cls] || "var(--blue)",
                                borderRadius: 10,
                                opacity: isTop ? 1 : 0.35,
                                transition: "width 0.9s cubic-bezier(0.4,0,0.2,1)",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    padding: "11px 14px",
                    borderRadius: 9,
                    background: "#fffbeb",
                    border: "1px solid rgba(245,158,11,0.25)",
                    fontSize: 12,
                    color: "#92600a",
                    lineHeight: 1.55,
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  This tool is for clinical decision support only. Results must be confirmed with physical examination and established diagnostic procedures.
                </div>

                {/* Explainability Panel */}
                <div className="card" style={{ padding: 20 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                    marginBottom: 14, letterSpacing: "-0.01em",
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    Model Explainability
                  </div>

                  {explainLoading && (
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", gap: 10, padding: "28px 0",
                    }}>
                      <div className="spinner-blue" style={{ width: 24, height: 24, borderWidth: 3 }} />
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        Computing spectrogram and GradCAM heatmap...
                      </div>
                    </div>
                  )}

                  {explainError && !explainLoading && (
                    <div style={{
                      padding: "10px 13px", borderRadius: 8,
                      background: "var(--red-light)",
                      border: "1px solid rgba(255,59,48,0.2)",
                      color: "#c0372b", fontSize: 12,
                    }}>
                      {explainError}
                    </div>
                  )}

                  {explain && !explainLoading && (
                    <div>
                      {explain.demo_mode && (
                        <div style={{
                          fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10,
                          padding: "6px 10px", background: "#f8fafc",
                          borderRadius: 6, border: "1px solid var(--border)",
                        }}>
                          Demo mode — synthetic visualisation shown.
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={{
                            fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)",
                            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
                          }}>
                            Mel Spectrogram
                          </div>
                          {explain.mel_spectrogram_b64 && (
                            <img
                              src={`data:image/png;base64,${explain.mel_spectrogram_b64}`}
                              alt="Mel spectrogram"
                              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
                            />
                          )}
                        </div>
                        <div>
                          <div style={{
                            fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)",
                            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
                          }}>
                            GradCAM Attention{" "}
                            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                              — red = high influence
                            </span>
                          </div>
                          {explain.gradcam_b64 && (
                            <img
                              src={`data:image/png;base64,${explain.gradcam_b64}`}
                              alt="GradCAM heatmap"
                              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
                            />
                          )}
                          {!explain.gradcam_b64 && (
                            <div style={{
                              padding: "20px 0", textAlign: "center",
                              fontSize: 12, color: "var(--text-tertiary)",
                              border: "1px solid var(--border)", borderRadius: 8,
                            }}>
                              GradCAM unavailable (demo mode)
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="card"
                style={{
                  padding: 32,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 320,
                  textAlign: "center",
                }}
              >
                {loading ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                    <div className="spinner-blue" style={{ width: 32, height: 32, borderWidth: 3 }} />
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>Analysing audio...</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Extracting mel-spectrogram features and running inference</div>
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: "50%",
                        background: "var(--bg)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 14px",
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>
                      Results will appear here
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                      Upload a cough audio sample and click Run Screening
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

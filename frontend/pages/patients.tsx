import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import { api, Patient, Screening } from "../lib/api";

const CLASS_COLORS: Record<string, string> = {
  COPD: "#ff3b30",
  Asthma: "#ff9500",
  Pneumonia: "#af52de",
  Bronchitis: "#0071e3",
  Healthy: "#34c759",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function Avatar({ name }: { name: string }) {
  const colors = ["#0071e3", "#34c759", "#ff9500", "#af52de", "#ff3b30"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        background: `${color}18`,
        border: `1.5px solid ${color}30`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        fontWeight: 600,
        color,
        flexShrink: 0,
      }}
    >
      {name[0].toUpperCase()}
    </div>
  );
}

export default function PatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listPatients().then(setPatients).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSelect = async (p: Patient) => {
    setSelected(p);
    const s = await api.listScreenings(p.id).catch(() => []);
    setScreenings(s);
  };

  const filtered = patients.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Layout>
      <div style={{ padding: "28px 32px", maxWidth: 1080 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 3 }}>
            Patients
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {patients.length} registered patient{patients.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: selected ? "300px 1fr" : "300px 1fr", gap: 16 }}>
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ position: "relative" }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-tertiary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  className="input-field"
                  placeholder="Search patients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: 32 }}
                />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 58, borderRadius: 10 }} />
                ))
              ) : filtered.length === 0 ? (
                <div
                  className="card"
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    color: "var(--text-tertiary)",
                    fontSize: 13,
                  }}
                >
                  {search ? "No patients match your search." : "No patients yet."}
                </div>
              ) : (
                filtered.map((p) => {
                  const active = selected?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "11px 13px",
                        borderRadius: 10,
                        border: `1px solid ${active ? "var(--blue)" : "var(--border)"}`,
                        background: active ? "var(--blue-light)" : "#fff",
                        cursor: "pointer",
                        transition: "all 0.12s",
                        boxShadow: active ? "0 0 0 3px rgba(0,113,227,0.08)" : "var(--shadow-sm)",
                      }}
                      onClick={() => handleSelect(p)}
                    >
                      <Avatar name={p.name} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                          {[p.age ? `${p.age}y` : null, p.gender].filter(Boolean).join(" · ") || "No demographics"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            {selected ? (
              <div className="animate-fade-up">
                <div className="card" style={{ padding: "20px 22px", marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "50%",
                          background: "var(--blue-light)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 20,
                          fontWeight: 700,
                          color: "var(--blue)",
                        }}
                      >
                        {selected.name[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.025em", marginBottom: 2 }}>
                          {selected.name}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {[selected.age ? `${selected.age} years` : null, selected.gender].filter(Boolean).join(" · ") || "Demographics not recorded"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                          Registered {formatDate(selected.created_at)}
                        </div>
                      </div>
                    </div>
                    <button className="btn-ghost" onClick={() => { setSelected(null); setScreenings([]); }} style={{ fontSize: 12 }}>
                      Close
                    </button>
                  </div>
                </div>

                <div className="card" style={{ padding: "20px 22px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14, letterSpacing: "-0.01em" }}>
                    Screening History
                    <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-tertiary)", marginLeft: 6 }}>
                      {screenings.length} record{screenings.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {screenings.length === 0 ? (
                    <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
                      No screenings recorded for this patient.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {screenings.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            padding: "12px 14px",
                            background: "var(--bg)",
                            borderRadius: 9,
                            border: "1px solid var(--border)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: CLASS_COLORS[s.predicted_class] || "var(--blue)",
                                  flexShrink: 0,
                                }}
                              />
                              <span className={`badge badge-${s.predicted_class.toLowerCase()}`} style={{ fontSize: 12 }}>
                                {s.predicted_class}
                              </span>
                              <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
                                {(s.confidence * 100).toFixed(0)}% confidence
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                              {formatDate(s.created_at)}
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                            {Object.entries(s.probabilities)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 3)
                              .map(([cls, prob]) => (
                                <div key={cls} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 11, color: cls === s.predicted_class ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: cls === s.predicted_class ? 600 : 400, width: 72, flexShrink: 0 }}>{cls}</span>
                                  <div style={{ flex: 1, height: 4, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{ width: `${prob * 100}%`, height: "100%", background: CLASS_COLORS[cls] || "var(--blue)", borderRadius: 3, opacity: cls === s.predicted_class ? 1 : 0.35 }} />
                                  </div>
                                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", width: 36, textAlign: "right", flexShrink: 0 }}>{(prob * 100).toFixed(0)}%</span>
                                </div>
                              ))}
                          </div>
                          {s.notes && (
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", background: "#fff", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 9px", marginBottom: 8 }}>
                              {s.notes}
                            </div>
                          )}
                          <button
                            onClick={() => router.push(`/screen?id=${s.id}`)}
                            style={{ width: "100%", padding: "6px 0", borderRadius: 7, border: "1px solid var(--blue)", background: "var(--blue-light)", color: "var(--blue)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                            </svg>
                            View Full Analysis
                          </button>
                        </div>
                      ))}
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
                  minHeight: 280,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "var(--bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 12px",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>Select a patient</div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3 }}>to view their screening history</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

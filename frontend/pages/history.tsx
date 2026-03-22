import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api, Screening } from "../lib/api";

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const CLASSES = ["All", "Asthma", "Bronchitis", "COPD", "Healthy", "Pneumonia"];

export default function HistoryPage() {
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.listScreenings().then(setScreenings).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "All" ? screenings : screenings.filter((s) => s.predicted_class === filter);

  return (
    <Layout>
      <div style={{ padding: "28px 32px", maxWidth: 900 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 3 }}>
            Screening History
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {screenings.length} total screening{screenings.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          {CLASSES.map((c) => {
            const active = filter === c;
            const count = c === "All" ? screenings.length : screenings.filter((s) => s.predicted_class === c).length;
            return (
              <button
                key={c}
                onClick={() => setFilter(c)}
                style={{
                  padding: "6px 13px",
                  borderRadius: 20,
                  border: `1px solid ${active ? (CLASS_COLORS[c] || "var(--blue)") : "var(--border)"}`,
                  background: active ? (CLASS_BG[c] || "var(--blue-light)") : "#fff",
                  color: active ? (CLASS_COLORS[c] || "var(--blue)") : "var(--text-secondary)",
                  fontFamily: "Inter, sans-serif",
                  fontWeight: active ? 600 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.12s",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  boxShadow: active ? `0 0 0 3px ${CLASS_COLORS[c] || "var(--blue)"}18` : "var(--shadow-sm)",
                }}
              >
                {c !== "All" && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: active ? CLASS_COLORS[c] : "#c5cad4",
                    }}
                  />
                )}
                {c}
                <span
                  style={{
                    fontSize: 11,
                    color: active ? CLASS_COLORS[c] || "var(--blue)" : "var(--text-tertiary)",
                    fontWeight: 500,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 54, borderRadius: 10 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="card"
            style={{ padding: "36px 24px", textAlign: "center" }}
          >
            <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
              {filter === "All" ? "No screenings yet." : `No ${filter} screenings found.`}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map((s) => (
              <div
                key={s.id}
                className="card"
                style={{
                  overflow: "hidden",
                  transition: "box-shadow 0.15s",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: expanded === s.id ? "var(--bg)" : "#fff",
                    transition: "background 0.12s",
                  }}
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: CLASS_BG[s.predicted_class] || "var(--blue-light)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: CLASS_COLORS[s.predicted_class] || "var(--blue)",
                      }}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={`badge badge-${s.predicted_class.toLowerCase()}`} style={{ flexShrink: 0 }}>
                      {s.predicted_class}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 52, height: 4, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${s.confidence * 100}%`,
                            height: "100%",
                            background: CLASS_COLORS[s.predicted_class] || "var(--blue)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>
                        {(s.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    {s.notes && (
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--text-tertiary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 200,
                        }}
                      >
                        {s.notes}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      {formatDate(s.created_at)}
                    </span>
                    {s.demo_mode && (
                      <span className="badge badge-demo" style={{ fontSize: 10 }}>Demo</span>
                    )}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--text-tertiary)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transition: "transform 0.2s",
                        transform: expanded === s.id ? "rotate(90deg)" : "none",
                      }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>

                {expanded === s.id && (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderTop: "1px solid var(--border)",
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                          Class Probabilities
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          {Object.entries(s.probabilities)
                            .sort((a, b) => b[1] - a[1])
                            .map(([cls, prob]) => {
                              const isTop = cls === s.predicted_class;
                              return (
                                <div key={cls}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <div
                                        style={{
                                          width: 6,
                                          height: 6,
                                          borderRadius: "50%",
                                          background: CLASS_COLORS[cls] || "var(--blue)",
                                          opacity: isTop ? 1 : 0.4,
                                        }}
                                      />
                                      <span style={{ fontSize: 12, color: isTop ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isTop ? 600 : 400 }}>
                                        {cls}
                                      </span>
                                    </div>
                                    <span style={{ fontSize: 11, color: isTop ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: isTop ? 600 : 400 }}>
                                      {(prob * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                  <div style={{ height: 4, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                                    <div
                                      style={{
                                        width: `${prob * 100}%`,
                                        height: "100%",
                                        background: CLASS_COLORS[cls] || "var(--blue)",
                                        opacity: isTop ? 0.9 : 0.3,
                                        borderRadius: 4,
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>

                      <div>
                        {s.notes && (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>
                              Clinical Notes
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                color: "var(--text-secondary)",
                                lineHeight: 1.6,
                                background: "var(--bg)",
                                borderRadius: 8,
                                padding: "9px 12px",
                                border: "1px solid var(--border)",
                              }}
                            >
                              {s.notes}
                            </div>
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>
                            Record ID
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-tertiary)", wordBreak: "break-all", fontFamily: "monospace" }}>
                            {s.id}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

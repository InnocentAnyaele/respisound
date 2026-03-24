import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api, Stats, Screening } from "../lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: ok ? "var(--green)" : "#ff3b30",
        boxShadow: ok ? "0 0 0 3px rgba(52,199,89,0.2)" : "0 0 0 3px rgba(255,59,48,0.15)",
      }}
    />
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Screening[]>([]);
  const [apiOk, setApiOk] = useState(false);
  const [apiStarting, setApiStarting] = useState(true);
  const [modelLoaded, setModelLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const MAX_ATTEMPTS = 80; // 80 × 3 s = 4 minutes

    const loadData = () => {
      api.getStats().then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
      api.listScreenings().then((s) => { if (!cancelled) setRecent(s.slice(0, 8)); }).catch(() => {});
    };

    const checkHealth = () => {
      attempts++;
      api.health()
        .then((h) => {
          if (cancelled) return;
          setApiOk(true);
          setApiStarting(false);
          setModelLoaded(h.model_loaded);
          loadData();
        })
        .catch(() => {
          if (cancelled) return;
          if (attempts >= MAX_ATTEMPTS) {
            setApiStarting(false); // give up → show "API Offline"
            return;
          }
          timer = setTimeout(checkHealth, 3000);
        });
    };

    checkHealth();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const chartData = stats
    ? Object.entries(stats.class_distribution).map(([name, count]) => ({ name, count }))
    : [];

  const total = stats ? Object.values(stats.class_distribution).reduce((a, b) => a + b, 0) : 0;

  return (
    <Layout>
      <div style={{ padding: "28px 32px", maxWidth: 1080 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 3 }}>
              Dashboard
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Respiratory disease screening overview
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text-secondary)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <StatusDot ok={apiOk} />
              {apiOk ? "API Online" : apiStarting ? "API Starting…" : "API Offline"}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text-secondary)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <StatusDot ok={modelLoaded} />
              {modelLoaded ? "Model Active" : "Demo Mode"}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
          {[
            {
              label: "Total Screenings",
              value: stats?.total_screenings ?? "—",
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071e3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
                </svg>
              ),
              iconBg: "var(--blue-light)",
              color: "var(--blue)",
            },
            {
              label: "Patients Registered",
              value: stats?.total_patients ?? "—",
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#af52de" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              ),
              iconBg: "var(--purple-light)",
              color: "var(--purple)",
            },
            {
              label: "Disease Classes",
              value: stats ? Object.keys(stats.class_distribution).length : "—",
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              ),
              iconBg: "var(--green-light)",
              color: "var(--green)",
            },
          ].map((item) => (
            <div key={item.label} className="card" style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                  {item.label}
                </span>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: item.iconBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.icon}
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.04em" }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 20 }}>
          <div className="card" style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16, letterSpacing: "-0.01em" }}>
              Screening Distribution
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={chartData} barSize={32} barCategoryGap="30%">
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12, fontFamily: "Inter" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--text-tertiary)", fontSize: 11, fontFamily: "Inter" }}
                    axisLine={false}
                    tickLine={false}
                    width={26}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#fff",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      boxShadow: "var(--shadow-md)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      fontFamily: "Inter",
                    }}
                    cursor={{ fill: "rgba(0,0,0,0.03)", radius: 6 }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={CLASS_COLORS[entry.name] || "var(--blue)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div
                style={{
                  height: 170,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  color: "var(--text-tertiary)",
                  fontSize: 13,
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                No screenings yet
              </div>
            )}
          </div>

          <div className="card" style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16, letterSpacing: "-0.01em" }}>
              Class Breakdown
            </div>
            {stats && Object.keys(stats.class_distribution).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {Object.entries(stats.class_distribution)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cls, count]) => {
                    const pct = total > 0 ? (count / total) * 100 : 0;
                    return (
                      <div key={cls}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: CLASS_COLORS[cls] || "var(--blue)",
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
                              {cls}
                            </span>
                          </div>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
                            {count} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>({pct.toFixed(0)}%)</span>
                          </span>
                        </div>
                        <div style={{ height: 5, background: "var(--bg)", borderRadius: 10, overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: CLASS_COLORS[cls] || "var(--blue)",
                              borderRadius: 10,
                              transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
                              opacity: 0.85,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No data yet</div>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16, letterSpacing: "-0.01em" }}>
            Recent Screenings
          </div>
          {recent.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date & Time", "Result", "Confidence", "Notes", "Status"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "0 0 10px",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        color: "var(--text-tertiary)",
                        textTransform: "uppercase",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((s, i) => (
                  <tr key={s.id} style={{ borderBottom: i < recent.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "11px 0", fontSize: 12, color: "var(--text-secondary)" }}>
                      {formatDate(s.created_at)}
                    </td>
                    <td style={{ padding: "11px 0" }}>
                      <span className={`badge badge-${s.predicted_class.toLowerCase()}`}>
                        {s.predicted_class}
                      </span>
                    </td>
                    <td style={{ padding: "11px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 48, height: 4, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${s.confidence * 100}%`,
                              height: "100%",
                              background: CLASS_COLORS[s.predicted_class] || "var(--blue)",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500 }}>
                          {(s.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "11px 0", fontSize: 12, color: "var(--text-secondary)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.notes || <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                    </td>
                    <td style={{ padding: "11px 0" }}>
                      {s.demo_mode ? (
                        <span className="badge badge-demo" style={{ fontSize: 11 }}>Demo</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>Live</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
              No screenings yet. Upload a cough sample to get started.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

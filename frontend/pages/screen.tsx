import React, { useState, useRef, useCallback, useEffect } from "react";
import Layout from "../components/Layout";
import {
  api,
  getBase,
  Screening,
  Patient,
  ExplainResponse,
  AcousticFeatures,
  ModelUncertainty,
  ProcessingStep,
} from "../lib/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ─── Constants ────────────────────────────────────────────────────────────────

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

const CLINICAL_MARKERS: Record<
  string,
  {
    markers: string[];
    urgency: string;
    urgencyColor: string;
    differentials: string[];
    follow_up: string[];
  }
> = {
  COPD: {
    markers: [
      "Reduced high-frequency energy consistent with airflow obstruction",
      "Prolonged expiratory phase pattern in temporal analysis",
      "Low spectral centroid indicating predominant low-frequency pathology",
    ],
    urgency: "Urgent Referral",
    urgencyColor: "#ff3b30",
    differentials: ["Asthma (reversible component)", "Cardiac dyspnoea", "Bronchiectasis"],
    follow_up: [
      "Spirometry with bronchodilator reversibility testing (GOLD criteria)",
      "Chest X-ray to assess hyperinflation and exclude malignancy",
      "ABG if SpO₂ < 92% or significant breathlessness",
      "Refer to pulmonologist for GOLD staging and inhaler initiation",
    ],
  },
  Asthma: {
    markers: [
      "Mid-frequency resonance patterns consistent with bronchospasm",
      "Variable airflow limitation signatures detected",
      "Elevated spectral bandwidth suggesting turbulent airflow",
    ],
    urgency: "Priority Assessment",
    urgencyColor: "#ff9500",
    differentials: ["COPD (fixed obstruction)", "Vocal cord dysfunction", "Cardiac wheeze"],
    follow_up: [
      "Peak flow measurement before and after bronchodilator",
      "FeNO test if allergic asthma suspected",
      "Review trigger factors (allergens, occupational, NSAID/β-blocker use)",
      "Consider step-up therapy per BTS/SIGN guidelines",
    ],
  },
  Pneumonia: {
    markers: [
      "Attenuated high-frequency content consistent with consolidation",
      "Low-frequency crackling signatures in temporal segments",
      "Asymmetric spectral energy distribution across time windows",
    ],
    urgency: "Urgent",
    urgencyColor: "#ff3b30",
    differentials: ["COPD exacerbation", "Pulmonary oedema", "Lung abscess"],
    follow_up: [
      "CURB-65 score for severity assessment and admission decision",
      "Chest X-ray (PA and lateral) urgently",
      "FBC, CRP, blood cultures if febrile",
      "Sputum culture before antibiotic initiation",
    ],
  },
  Bronchitis: {
    markers: [
      "Productive cough signatures with mid-band turbulence",
      "Elevated low-frequency energy consistent with mucus secretion",
      "Moderate spectral centroid indicating mid-airway involvement",
    ],
    urgency: "Non-urgent",
    urgencyColor: "#0071e3",
    differentials: ["Early COPD", "Whooping cough (Pertussis)", "Post-nasal drip"],
    follow_up: [
      "Reassess in 3–4 weeks if symptoms do not resolve",
      "Antibiotics only if bacterial origin suspected (purulent sputum, fever)",
      "Smoking cessation counselling if applicable",
      "Spirometry if symptoms persist >3 months in 2 consecutive years",
    ],
  },
  Healthy: {
    markers: [
      "Normal spectral distribution across all frequency bands",
      "Low zero-crossing rate consistent with clear, unobstructed airways",
      "Balanced energy profile — no pathological frequency signatures detected",
    ],
    urgency: "Routine",
    urgencyColor: "#34c759",
    differentials: ["Sub-clinical early disease (single-sample screening limitation)"],
    follow_up: [
      "Routine follow-up per scheduled health screening intervals",
      "Counsel patient that screening supplements but does not replace clinical exam",
      "Repeat screening if new respiratory symptoms develop",
    ],
  },
};

// ─── Small shared helpers ─────────────────────────────────────────────────────

function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

// ─── WaveformVisualiser ───────────────────────────────────────────────────────

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

// ─── CircularProgress ─────────────────────────────────────────────────────────

function CircularProgress({
  value,
  color,
  size = 110,
}: {
  value: number;
  color: string;
  size?: number;
}) {
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - value * circumference;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg)" strokeWidth={8} />
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

// ─── PipelineStepper ──────────────────────────────────────────────────────────

function PipelineStepper({ steps }: { steps: ProcessingStep[] }) {
  return (
    <div className="card" style={{ padding: "18px 22px" }}>
      <SLabel>Audio Processing Pipeline</SLabel>
      <div style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 4 }}>
        {steps.map((s, i) => (
          <React.Fragment key={s.step}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: "1 0 auto",
                minWidth: 96,
                maxWidth: 130,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background:
                    i === steps.length - 1
                      ? "var(--blue)"
                      : i === 0
                      ? "#f0f2f5"
                      : `hsl(${210 + i * 8}, 60%, 94%)`,
                  border:
                    i === steps.length - 1
                      ? "none"
                      : "1.5px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color:
                    i === steps.length - 1 ? "#fff" : "var(--text-secondary)",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ marginTop: 9, textAlign: "center", padding: "0 4px" }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.step}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    lineHeight: 1.45,
                    marginBottom: 6,
                  }}
                >
                  {s.detail}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--blue)",
                    background: "var(--blue-light)",
                    padding: "2px 8px",
                    borderRadius: 10,
                    display: "inline-block",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.value}
                </span>
              </div>
            </div>

            {i < steps.length - 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginTop: 15,
                  flex: "0 0 18px",
                  paddingBottom: 2,
                }}
              >
                <svg width="18" height="8" viewBox="0 0 18 8" fill="none">
                  <path
                    d="M0 4H14M14 4L11 1.5M14 4L11 6.5"
                    stroke="var(--border)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── FrequencyBandChart ───────────────────────────────────────────────────────

function FrequencyBandChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const colors = ["#0071e3", "#34c759", "#ff9500", "#af52de"];

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <SLabel>Frequency Band Energy</SLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {entries.map(([band, pct], i) => (
          <div key={band}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 5,
              }}
            >
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{band}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: colors[i % colors.length],
                }}
              >
                {pct.toFixed(1)}%
              </span>
            </div>
            <div
              style={{
                height: 7,
                background: "var(--bg)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${(pct / maxVal) * 100}%`,
                  height: "100%",
                  background: colors[i % colors.length],
                  borderRadius: 4,
                  transition: "width 0.9s cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 14,
          padding: "8px 10px",
          background: "var(--bg)",
          borderRadius: 7,
          fontSize: 10,
          color: "var(--text-tertiary)",
          lineHeight: 1.5,
        }}
      >
        Energy distribution across the four mel-filtered frequency bands. Dominant
        bands reflect the primary spectral signature of the respiratory event.
      </div>
    </div>
  );
}

// ─── MFCCChart ────────────────────────────────────────────────────────────────

function MFCCChart({
  values,
  classColor,
}: {
  values: number[];
  classColor: string;
}) {
  if (!values.length) return null;
  const maxAbs = Math.max(...values.map(Math.abs), 0.1);

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <SLabel>MFCC Profile — 13 Coefficients</SLabel>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 76,
          justifyContent: "space-between",
        }}
      >
        {values.map((v, i) => {
          const pct = (Math.abs(v) / maxAbs) * 100;
          return (
            <div
              key={i}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}
            >
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  height: 64,
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: `${Math.max(pct, 3)}%`,
                    background: v >= 0 ? classColor : "#ff3b30",
                    borderRadius: "2px 2px 0 0",
                    opacity: 0.75,
                    transition: "height 0.9s cubic-bezier(0.4,0,0.2,1)",
                  }}
                />
              </div>
              <div style={{ fontSize: 8, color: "var(--text-tertiary)", marginTop: 3 }}>
                {i + 1}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        {[
          { color: classColor, label: "Positive" },
          { color: "#ff3b30", label: "Negative" },
        ].map(({ color, label }) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-tertiary)" }}
          >
            <div style={{ width: 8, height: 8, background: color, borderRadius: 2, opacity: 0.75 }} />
            {label}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          padding: "8px 10px",
          background: "var(--bg)",
          borderRadius: 7,
          fontSize: 10,
          color: "var(--text-tertiary)",
          lineHeight: 1.5,
        }}
      >
        Mel-Frequency Cepstral Coefficients encode the timbral shape of the cough.
        MFCC 1–3 capture coarse spectral envelope; higher coefficients capture fine
        texture and vocal tract resonances.
      </div>
    </div>
  );
}

// ─── SpectralMetricsCard ──────────────────────────────────────────────────────

function SpectralMetricsCard({
  features,
  uncertainty,
}: {
  features: AcousticFeatures;
  uncertainty: ModelUncertainty;
}) {
  const tierColor =
    uncertainty.confidence_tier === "High"
      ? "#34c759"
      : uncertainty.confidence_tier === "Moderate"
      ? "#ff9500"
      : "#ff3b30";

  const metrics = [
    {
      label: "Prediction Entropy",
      value: `${(uncertainty.entropy * 100).toFixed(1)}%`,
      sub: "0 % = certain · 100 % = uniform",
    },
    {
      label: "Decision Margin",
      value: `${(uncertainty.margin * 100).toFixed(1)}%`,
      sub: "Top-1 minus Top-2 probability",
    },
    {
      label: "Spectral Centroid",
      value: `${(features.spectral_centroid_mean / 1000).toFixed(2)} kHz`,
      sub: "Centre of mass of spectral energy",
    },
    {
      label: "Spectral Bandwidth",
      value: `${(features.spectral_bandwidth_mean / 1000).toFixed(2)} kHz`,
      sub: "Spread of spectral distribution",
    },
    {
      label: "Zero-Crossing Rate",
      value: features.zero_crossing_rate_mean.toFixed(4),
      sub: "Proxy for high-frequency content",
    },
  ];

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <SLabel>Model Uncertainty & Spectral Metrics</SLabel>

      {/* Confidence tier badge */}
      <div
        style={{
          background: `${tierColor}12`,
          border: `1px solid ${tierColor}30`,
          borderRadius: 9,
          padding: "10px 13px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: tierColor,
            boxShadow: `0 0 0 3px ${tierColor}25`,
            flexShrink: 0,
          }}
        />
        <div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 1 }}>
            CONFIDENCE TIER
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: tierColor, letterSpacing: "-0.02em" }}>
            {uncertainty.confidence_tier}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {metrics.map(({ label, value, sub }) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              paddingBottom: 9,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)" }}>
                {label}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{sub}</div>
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-primary)",
                flexShrink: 0,
                marginLeft: 10,
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── VisualAnalysisPanel ──────────────────────────────────────────────────────

function VisualAnalysisPanel({
  screeningId,
  demoMode,
}: {
  screeningId: string;
  demoMode: boolean;
}) {
  const base = getBase();
  const melSrc = `${base}/explain/${screeningId}/mel.png`;
  const gradcamSrc = `${base}/explain/${screeningId}/gradcam.png`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {/* Mel Spectrogram */}
      <div className="card" style={{ padding: "18px 20px" }}>
        <SLabel>Mel-Frequency Spectrogram</SLabel>
        <p
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
            marginBottom: 12,
          }}
        >
          Log-power energy across 128 mel-scaled frequency bands over 1.5 s. Brighter
          (magma) regions indicate higher energy concentration.
        </p>
        <img
          src={melSrc}
          alt="Mel spectrogram"
          style={{
            width: "100%",
            borderRadius: 8,
            border: "1px solid var(--border)",
            display: "block",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 9,
            color: "var(--text-tertiary)",
          }}
        >
          <span>0 ms</span>
          <span>← Time →</span>
          <span>1500 ms</span>
        </div>
      </div>

      {/* GradCAM */}
      <div className="card" style={{ padding: "18px 20px" }}>
        <SLabel>GradCAM Attention Heatmap</SLabel>
        <p
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
            marginBottom: 12,
          }}
        >
          Gradient-weighted class activation map overlaid on the spectrogram. Red/warm
          regions were most influential in driving the model's classification decision.
        </p>
        {demoMode ? (
          <div
            style={{
              height: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-tertiary)",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            GradCAM requires a loaded model
          </div>
        ) : (
          <img
            src={gradcamSrc}
            alt="GradCAM heatmap"
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
        )}
        {!demoMode && (
          <div style={{ display: "flex", gap: 10, marginTop: 6, justifyContent: "flex-end" }}>
            {[
              { color: "#00f", label: "Low influence" },
              { color: "#0f0", label: "Mid" },
              { color: "#ff0", label: "High" },
              { color: "#f00", label: "Peak" },
            ].map(({ color, label }) => (
              <div
                key={label}
                style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "var(--text-tertiary)" }}
              >
                <div
                  style={{ width: 7, height: 7, borderRadius: "50%", background: color, opacity: 0.8 }}
                />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RMSEnvelopeChart ─────────────────────────────────────────────────────────

function RMSEnvelopeChart({ envelope }: { envelope: number[] }) {
  if (!envelope.length) return null;

  const data = envelope.map((val, i) => ({
    t: `${Math.round((i / (envelope.length - 1)) * 1500)} ms`,
    rms: parseFloat((val * 1000).toFixed(2)),
  }));

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <SLabel>RMS Energy Envelope</SLabel>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            background: "var(--bg)",
            padding: "2px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          24 time-frames · 1500 ms window
        </span>
      </div>
      <div style={{ height: 90 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="rmsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.28} />
                <stop offset="95%" stopColor="var(--blue)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
              formatter={(val: unknown) => [`${val}`, "RMS ×10⁻³"]}
            />
            <Area
              type="monotone"
              dataKey="rms"
              stroke="var(--blue)"
              strokeWidth={1.5}
              fill="url(#rmsGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: "var(--text-tertiary)",
          lineHeight: 1.5,
        }}
      >
        Root-Mean-Square energy over time reflects breath-phase intensity transitions.
        Sharp peaks may indicate expiratory effort; sustained high energy is consistent
        with productive cough patterns.
      </div>
    </div>
  );
}

// ─── ClinicalInterpretation ───────────────────────────────────────────────────

function ClinicalInterpretation({
  result,
  uncertainty,
}: {
  result: Screening;
  uncertainty: ModelUncertainty;
}) {
  const info = CLINICAL_MARKERS[result.predicted_class];
  if (!info) return null;
  const color = CLASS_COLORS[result.predicted_class] || "var(--blue)";

  return (
    <div className="card" style={{ padding: "18px 22px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <SLabel>Clinical Interpretation</SLabel>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: info.urgencyColor,
            background: `${info.urgencyColor}15`,
            padding: "3px 11px",
            borderRadius: 20,
            border: `1px solid ${info.urgencyColor}30`,
          }}
        >
          {info.urgency}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 20,
        }}
      >
        {/* Key Acoustic Markers */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            Key Acoustic Markers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {info.markers.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: color,
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}
                >
                  {m}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 14,
              padding: "8px 10px",
              background: "var(--bg)",
              borderRadius: 7,
              fontSize: 10,
              color: "var(--text-tertiary)",
              lineHeight: 1.5,
            }}
          >
            Derived from spectral analysis of the 1.5 s cough window. These patterns
            support but do not confirm the predicted diagnosis.
          </div>
        </div>

        {/* Differential Diagnoses */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            Differential Diagnoses
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {info.differentials.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-tertiary)",
                    marginTop: 1,
                    flexShrink: 0,
                    minWidth: 14,
                  }}
                >
                  {i + 1}.
                </div>
                <span
                  style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}
                >
                  {d}
                </span>
              </div>
            ))}
          </div>

          {/* Probability comparison mini-bar for top differentials */}
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-tertiary)",
                marginBottom: 7,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 600,
              }}
            >
              All class probabilities
            </div>
            {Object.entries(result.probabilities)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([cls, p]) => (
                <div key={cls} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color:
                        cls === result.predicted_class
                          ? "var(--text-primary)"
                          : "var(--text-tertiary)",
                      fontWeight: cls === result.predicted_class ? 600 : 400,
                      marginBottom: 2,
                    }}
                  >
                    <span>{cls}</span>
                    <span>{(p * 100).toFixed(1)}%</span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: "var(--bg)",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${p * 100}%`,
                        height: "100%",
                        background: CLASS_COLORS[cls] || "var(--blue)",
                        borderRadius: 3,
                        opacity: cls === result.predicted_class ? 1 : 0.4,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Recommended Actions */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            Recommended Clinical Actions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {info.follow_up.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0, marginTop: 2 }}
                >
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span
                  style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

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
  const [apiReady, setApiReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restoredRef = useRef(false);
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const MAX_ATTEMPTS = 80;

    const checkHealth = () => {
      attempts++;
      api.health()
        .then(() => {
          if (!cancelled) {
            setApiReady(true);
            if (restoredRef.current) return;
            restoredRef.current = true;
            const urlParams = new URLSearchParams(window.location.search);
            const urlId = urlParams.get("id");
            let targetId: string | null = urlId;
            if (!targetId) {
              try {
                const saved = localStorage.getItem("respisound_last_screening");
                if (saved) targetId = JSON.parse(saved).screeningId ?? null;
              } catch { /* ignore */ }
            }
            if (!targetId) return;
            if (!urlId) {
              try {
                const saved = JSON.parse(localStorage.getItem("respisound_last_screening") || "{}");
                if (saved.patientName) setPatientName(saved.patientName);
                if (saved.patientAge) setPatientAge(saved.patientAge);
                if (saved.patientGender) setPatientGender(saved.patientGender);
                if (saved.notes) setNotes(saved.notes);
              } catch { /* ignore */ }
            }
            api.getScreening(targetId)
              .then((s) => {
                if (cancelled) return;
                setResult(s);
                setIsRestored(true);
                setExplainLoading(true);
                api.explainScreening(targetId!)
                  .then((exp) => { if (!cancelled) setExplain(exp); })
                  .catch((err: unknown) => {
                    if (!cancelled) setExplainError(err instanceof Error ? err.message : "Could not load analysis.");
                  })
                  .finally(() => { if (!cancelled) setExplainLoading(false); });
              })
              .catch(() => {
                localStorage.removeItem("respisound_last_screening");
              });
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempts < MAX_ATTEMPTS) timer = setTimeout(checkHealth, 3000);
        });
    };
    checkHealth();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      setFile(f);
      setAudioUrl(URL.createObjectURL(f));
      setResult(null);
      setError(null);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setAudioUrl(URL.createObjectURL(f));
      setResult(null);
      setError(null);
    }
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
    setExplain(null);
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
      try {
        localStorage.setItem("respisound_last_screening", JSON.stringify({
          screeningId: s.id,
          patientName: patientName.trim(),
          patientAge,
          patientGender,
          notes: notes.trim(),
        }));
      } catch { /* ignore */ }
      setExplainLoading(true);
      setExplainError(null);
      api
        .explainScreening(s.id)
        .then((exp) => setExplain(exp))
        .catch((err: unknown) =>
          setExplainError(
            err instanceof Error ? err.message : "Could not load analysis data."
          )
        )
        .finally(() => setExplainLoading(false));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Screening failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setAudioUrl(null);
    setResult(null);
    setError(null);
    setPatientName("");
    setPatientAge("");
    setPatientGender("");
    setNotes("");
    setExplain(null);
    setExplainLoading(false);
    setExplainError(null);
    setIsPlaying(false);
    setIsRestored(false);
    localStorage.removeItem("respisound_last_screening");
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const sortedProbs = result
    ? Object.entries(result.probabilities).sort((a, b) => b[1] - a[1])
    : [];

  const exportReport = async () => {
    if (!result) return;
    const info = CLINICAL_MARKERS[result.predicted_class];
    const cls = result.predicted_class;
    const color = CLASS_COLORS[cls] || "#0071e3";
    const screeningDate = new Date(result.created_at).toLocaleString("en-GB", {
      day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const generatedAt = new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    const probRows = Object.entries(result.probabilities)
      .sort((a, b) => b[1] - a[1])
      .map(([c, p]) => `
        <tr style="background:${c === cls ? "#f8fafc" : "transparent"}">
          <td style="padding:7px 12px;font-weight:${c === cls ? 700 : 400};color:${CLASS_COLORS[c] || "#374151"}">${c}${c === cls ? " ★" : ""}</td>
          <td style="padding:7px 12px;font-weight:${c === cls ? 700 : 400}">${(p * 100).toFixed(1)}%</td>
          <td style="padding:7px 12px">
            <div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;width:180px">
              <div style="height:100%;width:${(p * 100).toFixed(1)}%;background:${CLASS_COLORS[c] || "#0071e3"};border-radius:4px"></div>
            </div>
          </td>
        </tr>
      `).join("");

    const markersList = info?.markers.map((m) => `<li style="margin-bottom:6px;color:#374151">${m}</li>`).join("") || "";
    const differentialsList = info?.differentials.map((d) => `<li style="margin-bottom:6px;color:#374151">${d}</li>`).join("") || "";
    const actionsList = info?.follow_up.map((a) => `<li style="margin-bottom:6px;color:#374151">${a}</li>`).join("") || "";

    const acousticSection = explain ? `
      <h2>Acoustic Features &amp; Model Uncertainty</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <tr><td style="padding:7px 12px;color:#6b7280;width:220px;background:#f9fafb">Spectral Centroid</td><td style="padding:7px 12px;font-weight:600">${(explain.acoustic_features.spectral_centroid_mean / 1000).toFixed(2)} kHz</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280">Spectral Bandwidth</td><td style="padding:7px 12px;font-weight:600">${(explain.acoustic_features.spectral_bandwidth_mean / 1000).toFixed(2)} kHz</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280;background:#f9fafb">Zero-Crossing Rate</td><td style="padding:7px 12px;font-weight:600">${explain.acoustic_features.zero_crossing_rate_mean.toFixed(4)}</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280">Duration</td><td style="padding:7px 12px;font-weight:600">${explain.acoustic_features.duration_s.toFixed(3)} s</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280;background:#f9fafb">Sample Rate</td><td style="padding:7px 12px;font-weight:600">${explain.acoustic_features.sample_rate.toLocaleString()} Hz</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280">Confidence Tier</td><td style="padding:7px 12px;font-weight:600">${explain.model_uncertainty.confidence_tier}</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280;background:#f9fafb">Prediction Entropy</td><td style="padding:7px 12px;font-weight:600">${(explain.model_uncertainty.entropy * 100).toFixed(1)}%</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280">Decision Margin (Top-1 vs Top-2)</td><td style="padding:7px 12px;font-weight:600">${(explain.model_uncertainty.margin * 100).toFixed(1)}%</td></tr>
      </table>
    ` : "";

    // Fetch images as base64 so they embed correctly in the downloaded HTML
    const fetchImageAsDataUrl = async (url: string): Promise<string | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    };

    const base = getBase();
    const [melDataUrl, gradcamDataUrl] = await Promise.all([
      fetchImageAsDataUrl(`${base}/explain/${result.id}/mel.png`),
      fetchImageAsDataUrl(`${base}/explain/${result.id}/gradcam.png`),
    ]);

    const visualSection = (melDataUrl || gradcamDataUrl) ? `
      <h2>Visual Analysis</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:8px">
        ${melDataUrl ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:8px">Mel-Frequency Spectrogram</div>
          <img src="${melDataUrl}" alt="Mel spectrogram" style="width:100%;border-radius:8px;border:1px solid #e5e7eb" />
          <div style="font-size:11px;color:#9ca3af;margin-top:5px">Log-power energy across 128 mel-scaled frequency bands</div>
        </div>` : ""}
        ${gradcamDataUrl ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:8px">GradCAM Attention Heatmap</div>
          <img src="${gradcamDataUrl}" alt="GradCAM heatmap" style="width:100%;border-radius:8px;border:1px solid #e5e7eb" />
          <div style="font-size:11px;color:#9ca3af;margin-top:5px">Gradient-weighted class activation map — highlights regions driving the prediction</div>
        </div>` : ""}
      </div>
    ` : "";

    const patientSection = (patientName || patientAge || patientGender || notes) ? `
      <h2>Patient Information</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        ${patientName ? `<tr><td style="padding:7px 12px;color:#6b7280;width:160px;background:#f9fafb">Patient Name</td><td style="padding:7px 12px;font-weight:600">${patientName}</td></tr>` : ""}
        ${patientAge ? `<tr><td style="padding:7px 12px;color:#6b7280">Age</td><td style="padding:7px 12px;font-weight:600">${patientAge} years</td></tr>` : ""}
        ${patientGender ? `<tr><td style="padding:7px 12px;color:#6b7280;background:#f9fafb">Gender</td><td style="padding:7px 12px;font-weight:600">${patientGender}</td></tr>` : ""}
        ${notes ? `<tr><td style="padding:7px 12px;color:#6b7280;vertical-align:top">Clinical Notes</td><td style="padding:7px 12px">${notes}</td></tr>` : ""}
      </table>
    ` : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RespiSound Report — ${cls} — ${screeningDate}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 48px; max-width: 860px; margin: 0 auto; font-size: 14px; line-height: 1.6; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-weight: 700; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin: 32px 0 16px; }
    table { border-collapse: collapse; width: 100%; }
    li { line-height: 1.7; }
    ul, ol { margin: 0; padding-left: 20px; }
    .header { border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .result-box { background: ${color}0f; border: 1.5px solid ${color}35; border-radius: 10px; padding: 22px 28px; margin: 20px 0 28px; display: flex; align-items: center; gap: 28px; }
    .urgency { display: inline-block; background: ${info?.urgencyColor || "#6b7280"}15; border: 1px solid ${info?.urgencyColor || "#6b7280"}40; color: ${info?.urgencyColor || "#6b7280"}; padding: 3px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-top: 8px; }
    .interp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-bottom: 20px; }
    .disclaimer { margin-top: 40px; padding: 14px 18px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; font-size: 12px; color: #92600a; line-height: 1.65; }
    .footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; }
    .print-btn { margin-top: 32px; text-align: center; }
    .print-btn button { background: #0071e3; color: #fff; border: none; padding: 11px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    @media print {
      body { padding: 20px; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">RespiSound — Clinical Screening Report</div>
      <div style="font-size:24px;font-weight:900;color:#111;letter-spacing:-0.03em;line-height:1.1">Respiratory Disease<br>Screening Report</div>
      <div style="font-size:13px;color:#6b7280;margin-top:8px">Screening date: <strong>${screeningDate}</strong></div>
    </div>
    <div style="text-align:right;font-size:12px;color:#6b7280;flex-shrink:0">
      <div>Generated: ${generatedAt}</div>
      <div style="margin-top:5px">Record ID:</div>
      <div style="font-family:monospace;font-size:11px;color:#374151">${result.id}</div>
      ${result.demo_mode ? '<div style="margin-top:8px;color:#f59e0b;font-weight:700;font-size:12px">⚠ DEMO MODE — No model loaded</div>' : '<div style="margin-top:8px;color:#34c759;font-weight:700;font-size:12px">✓ Live Inference</div>'}
    </div>
  </div>

  ${patientSection}

  <h2>Primary Finding</h2>
  <div class="result-box">
    <div style="text-align:center;min-width:100px;flex-shrink:0">
      <div style="font-size:52px;font-weight:900;color:${color};line-height:1">${(result.confidence * 100).toFixed(0)}%</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Confidence</div>
    </div>
    <div>
      <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Predicted Condition</div>
      <div style="font-size:36px;font-weight:900;color:${color};line-height:1;margin-bottom:8px">${cls}</div>
      <div style="font-size:13px;color:#374151;max-width:420px;line-height:1.6">${DISEASE_INFO[cls]?.short || ""}</div>
      <div class="urgency">${info?.urgency || "Assessment Required"}</div>
    </div>
  </div>

  <h2>Class Probabilities</h2>
  <table style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600">Condition</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600">Probability</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600">Distribution</th>
      </tr>
    </thead>
    <tbody>${probRows}</tbody>
  </table>

  ${info ? `
  <h2>Clinical Interpretation</h2>
  <div class="interp-grid">
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:10px">Key Acoustic Markers</div>
      <ul>${markersList}</ul>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:10px">Differential Diagnoses</div>
      <ol>${differentialsList}</ol>
    </div>
  </div>
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:10px">Recommended Clinical Actions</div>
  <ul>${actionsList}</ul>
  <div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-radius:7px;border:1px solid #e5e7eb;font-size:13px">
    <strong>Immediate action:</strong> ${DISEASE_INFO[cls]?.action || ""}
  </div>
  ` : ""}

  ${acousticSection}

  ${visualSection}

  <div class="disclaimer">
    <strong>Clinical Disclaimer:</strong> RespiSound is a decision support tool only. This report must be interpreted by qualified clinical personnel alongside physical examination, patient history, and established diagnostic procedures. It is not a replacement for spirometry, chest X-ray, or physician assessment. Acoustic analysis of a 1.5-second cough sample has inherent limitations and should be considered as supplementary evidence only.
  </div>

  <div class="footer">
    <span>RespiSound v1.0 — AI-assisted respiratory screening</span>
    <span>Record: ${result.id.slice(0, 8)}…</span>
  </div>

  <div class="print-btn">
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>
</body>
</html>`;

    const reportFilename = `RespiSound_${cls}_${result.id.slice(0, 8)}.html`;

    // In a packaged Tauri app the WebView does not honour <a download> clicks.
    // Detect the Tauri runtime and use a native save command instead.
    type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;

    if (tauriInternals) {
      try {
        const savedPath = await tauriInternals.invoke("save_report", {
          content: html,
          filename: reportFilename,
        }) as string;
        // Brief visual confirmation in the console; a toast can be wired here.
        console.info(`[RespiSound] Report saved to: ${savedPath}`);
      } catch (err) {
        // "cancelled" means the user dismissed the dialog – not a real error.
        if (err !== "cancelled") {
          console.error("[RespiSound] Failed to save report:", err);
        }
      }
    } else {
      // Fallback: standard browser blob-download (works in dev / web builds).
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Layout>
      <div style={{ padding: "24px 36px" }}>
        {/* ── Page header ── */}
        <div style={{ marginBottom: 24 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 650,
              color: "var(--text-primary)",
              letterSpacing: "-0.03em",
              marginBottom: 3,
            }}
          >
            New Screening
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Upload a cough audio sample for respiratory disease classification
          </p>
        </div>

        {/* ── Form + results grid ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px 1fr",
            gap: 20,
          }}
        >
          {/* Left — patient details + audio (sticky so form stays visible while scrolling analysis) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 24, alignSelf: "start" }}>
            {/* Patient details */}
            <div className="card" style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 14,
                  letterSpacing: "-0.01em",
                }}
              >
                Patient Details
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <div>
                  <div className="label" style={{ marginBottom: 5 }}>
                    Full Name
                  </div>
                  <input
                    className="input-field"
                    placeholder="Optional"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div className="label" style={{ marginBottom: 5 }}>
                      Age
                    </div>
                    <input
                      className="input-field"
                      type="number"
                      placeholder="Years"
                      value={patientAge}
                      onChange={(e) => setPatientAge(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="label" style={{ marginBottom: 5 }}>
                      Gender
                    </div>
                    <select
                      className="input-field"
                      value={patientGender}
                      onChange={(e) => setPatientGender(e.target.value)}
                      style={{ background: "var(--bg)" }}
                    >
                      <option value="">Select</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 5 }}>
                    Clinical Notes
                  </div>
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

            {/* Audio sample */}
            <div className="card" style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 14,
                  letterSpacing: "-0.01em",
                }}
              >
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
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
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
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--blue)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%",
                      }}
                    >
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
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-tertiary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        marginBottom: 3,
                      }}
                    >
                      Drop audio file or{" "}
                      <span style={{ color: "var(--blue)", fontWeight: 500 }}>browse</span>
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 8,
                      minWidth: 0,
                      gap: 8,
                    }}
                  >
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
                        flexShrink: 0,
                      }}
                    >
                      {isPlaying ? (
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="#fff">
                          <rect x="0" y="0" width="3" height="12" rx="1" />
                          <rect x="7" y="0" width="3" height="12" rx="1" />
                        </svg>
                      ) : (
                        <svg
                          width="11"
                          height="12"
                          viewBox="0 0 11 12"
                          fill="#fff"
                          style={{ marginLeft: 1 }}
                        >
                          <path d="M0 0L11 6L0 12V0Z" />
                        </svg>
                      )}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      {file.name}
                    </span>
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
                  disabled={!file || loading || !apiReady}
                  style={{ flex: 1 }}
                >
                  {loading ? (
                    <>
                      <div className="spinner" /> Analysing...
                    </>
                  ) : !apiReady ? (
                    <>
                      <div className="spinner" /> API Starting…
                    </>
                  ) : (
                    <>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
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

          {/* Right — classification result */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {result ? (
              <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* ── Toolbar ── */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {isRestored ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-tertiary)", background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                      Restored from last session
                      <button onClick={() => setIsRestored(false)} style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: 12, padding: 0 }}>✕</button>
                    </div>
                  ) : <div />}
                  <button
                    onClick={exportReport}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", fontFamily: "Inter, sans-serif", boxShadow: "var(--shadow-sm)", transition: "all 0.12s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--blue)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--blue)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export Report
                  </button>
                </div>
                {/* Classification card */}
                <div
                  className="card"
                  style={{
                    padding: "22px 26px",
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

                  {/* ── Horizontal result header ── */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: 20,
                      alignItems: "center",
                      marginBottom: 20,
                      paddingBottom: 20,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {/* Confidence gauge */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <CircularProgress
                        value={result.confidence}
                        color={CLASS_COLORS[result.predicted_class] || "var(--blue)"}
                        size={96}
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
                        <span
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: "var(--text-primary)",
                            letterSpacing: "-0.04em",
                          }}
                        >
                          {(result.confidence * 100).toFixed(0)}%
                        </span>
                        <span
                          style={{
                            fontSize: 8,
                            color: "var(--text-tertiary)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          conf.
                        </span>
                      </div>
                    </div>

                    {/* Class name + description */}
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--text-tertiary)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          marginBottom: 3,
                        }}
                      >
                        Predicted Condition
                      </div>
                      <div
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          color: CLASS_COLORS[result.predicted_class] || "var(--text-primary)",
                          letterSpacing: "-0.04em",
                          lineHeight: 1.05,
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

                    {/* Disease info + action (right side) */}
                    {DISEASE_INFO[result.predicted_class] && (
                      <div
                        style={{
                          background: CLASS_BG[result.predicted_class] || "var(--bg)",
                          borderRadius: 10,
                          padding: "14px 16px",
                          maxWidth: 340,
                          minWidth: 260,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text-primary)",
                            lineHeight: 1.6,
                            marginBottom: 8,
                          }}
                        >
                          {DISEASE_INFO[result.predicted_class].short}
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={CLASS_COLORS[result.predicted_class] || "var(--blue)"}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ flexShrink: 0, marginTop: 1 }}
                          >
                            <polyline points="9 11 12 14 22 4" />
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                          </svg>
                          <span
                            style={{
                              fontSize: 12,
                              color: CLASS_COLORS[result.predicted_class] || "var(--blue)",
                              fontWeight: 500,
                              lineHeight: 1.5,
                            }}
                          >
                            {DISEASE_INFO[result.predicted_class].action}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── All class probabilities (2-column grid) ── */}
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-tertiary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 12,
                    }}
                  >
                    All Class Probabilities
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px 28px",
                    }}
                  >
                    {sortedProbs.map(([cls, prob]) => {
                      const isTop = cls === result.predicted_class;
                      return (
                        <div key={cls}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 5,
                            }}
                          >
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
                          <div
                            style={{
                              height: isTop ? 7 : 5,
                              background: "var(--bg)",
                              borderRadius: 10,
                              overflow: "hidden",
                            }}
                          >
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

                {/* Disclaimer */}
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
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, marginTop: 1 }}
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  This tool is for clinical decision support only. Results must be
                  confirmed with physical examination and established diagnostic
                  procedures.
                </div>

                {/* Explainability loading indicator (brief, inside result column) */}
                {explainLoading && !explain && (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: 10,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 12,
                      color: "var(--text-tertiary)",
                    }}
                  >
                    <div
                      className="spinner-blue"
                      style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }}
                    />
                    Computing acoustic analysis and attention maps…
                  </div>
                )}
                {explainError && !explainLoading && (
                  <div
                    style={{
                      padding: "10px 13px",
                      borderRadius: 8,
                      background: "var(--red-light)",
                      border: "1px solid rgba(255,59,48,0.2)",
                      color: "#c0372b",
                      fontSize: 12,
                    }}
                  >
                    {explainError}
                  </div>
                )}

                {/* ── AI Analysis Dashboard — flows directly below disclaimer, no gap ── */}
                {explain && (
                  <div>
                    {/* Section divider */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--text-tertiary)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        AI Analysis Dashboard
                        {explain.demo_mode && (
                          <span style={{ fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", padding: "1px 7px", borderRadius: 8, color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0 }}>
                            demo mode
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <PipelineStepper steps={explain.processing_pipeline} />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                        <FrequencyBandChart data={explain.acoustic_features.freq_band_energy} />
                        <MFCCChart
                          values={explain.acoustic_features.mfcc_means}
                          classColor={CLASS_COLORS[result.predicted_class] || "var(--blue)"}
                        />
                        <SpectralMetricsCard
                          features={explain.acoustic_features}
                          uncertainty={explain.model_uncertainty}
                        />
                      </div>
                      <VisualAnalysisPanel
                        screeningId={explain.screening_id}
                        demoMode={explain.demo_mode}
                      />
                      <RMSEnvelopeChart envelope={explain.acoustic_features.rms_envelope} />
                      <ClinicalInterpretation
                        result={result}
                        uncertainty={explain.model_uncertainty}
                      />
                    </div>
                  </div>
                )}
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
                  minHeight: 440,
                  textAlign: "center",
                }}
              >
                {loading ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      className="spinner-blue"
                      style={{ width: 32, height: 32, borderWidth: 3 }}
                    />
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      Analysing audio...
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                      Extracting mel-spectrogram features and running inference
                    </div>
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
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-tertiary)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text-secondary)",
                        marginBottom: 5,
                      }}
                    >
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

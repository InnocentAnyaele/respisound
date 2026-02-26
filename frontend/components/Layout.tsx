import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";

const NAV = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/screen",
    label: "New Screening",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    ),
  },
  {
    href: "/patients",
    label: "Patients",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "History",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 15" />
      </svg>
    ),
  },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <aside
        style={{
          width: 228,
          minHeight: "100vh",
          background: "#fff",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
        }}
      >
        <div style={{ padding: "22px 16px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "var(--blue)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 2px 8px rgba(0,113,227,0.35)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 3C9.6 3 8 5.2 8 7.5C8 10.5 10 12.5 12 14C14 12.5 16 10.5 16 7.5C16 5.2 14.4 3 12 3Z" fill="rgba(255,255,255,0.9)" />
                <path d="M5 17.5C5 14.5 8 13 12 13C16 13 19 14.5 19 17.5V19H5V17.5Z" fill="rgba(255,255,255,0.7)" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.025em" }}>
                RespiSound
              </div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                v1.0 · Screening
              </div>
            </div>
          </div>

          <div className="label" style={{ marginBottom: 6, paddingLeft: 2 }}>
            Menu
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {NAV.map((item) => {
              const active = router.pathname === item.href;
              return (
                <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "9px 11px",
                      borderRadius: 9,
                      background: active ? "var(--blue-light)" : "transparent",
                      color: active ? "var(--blue)" : "var(--text-secondary)",
                      fontWeight: active ? 600 : 400,
                      fontSize: 14,
                      cursor: "pointer",
                      transition: "all 0.12s",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    <span style={{ opacity: active ? 1 : 0.6, flexShrink: 0, display: "flex" }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            margin: "0 12px 16px",
            padding: "11px 13px",
            background: "var(--bg)",
            borderRadius: 10,
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)", lineHeight: 1.6 }}>
            Clinical Decision Support Tool
          </div>
          <div style={{ fontSize: 11, color: "#b0b8c4", marginTop: 1 }}>
            Not a replacement for diagnosis
          </div>
        </div>
      </aside>

      <main style={{ marginLeft: 228, flex: 1 }}>
        {children}
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "600px",
          background: "radial-gradient(circle, rgba(46,196,182,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, textAlign: "center", maxWidth: "680px" }}>

        {/* Badge */}
        <div style={{ marginBottom: "32px" }}>
          <span className="badge badge-accent">Multi-Agent Spatial AI</span>
        </div>

        {/* Logo */}
        <h1 style={{ fontSize: "clamp(72px, 12vw, 120px)", lineHeight: 0.9, marginBottom: "8px" }}>
          <span className="font-logo" style={{ color: "var(--text)" }}>INEV</span>
          <span className="font-logo-italic" style={{ color: "var(--accent)" }}>itable</span>
        </h1>

        {/* Accent line */}
        <div style={{ width: "48px", height: "2px", background: "var(--accent)", borderRadius: "1px", margin: "24px auto" }} />

        {/* Tagline */}
        <p style={{ fontSize: "18px", fontWeight: 300, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: "4px" }}>
          Where Google Maps ends,
        </p>
        <p style={{ fontSize: "18px", fontWeight: 600, color: "var(--text)", lineHeight: 1.7, marginBottom: "48px" }}>
          Inevi begins.
        </p>

        {/* CTA */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/studio">
            <button className="btn-primary" style={{ padding: "12px 32px", fontSize: "14px" }}>
              Open Map Studio
            </button>
          </Link>
          <Link href="/traverse">
            <button className="btn-secondary" style={{ padding: "12px 32px", fontSize: "14px" }}>
              Start Traverse
            </button>
          </Link>
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginTop: "64px" }}>
          {["Live Camera Vision", "Multi-Agent AI", "AR Guidance", "Telugu / Hindi / English", "Aurora DSQL", "DynamoDB Sessions"].map((f) => (
            <span key={f} style={{ padding: "5px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "20px", fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>
              {f}
            </span>
          ))}
        </div>

        {/* Agents */}
        <div style={{ marginTop: "48px", display: "flex", gap: "24px", justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { name: "IRIS", desc: "Perception" },
            { name: "LOKI", desc: "Location" },
            { name: "SAGE", desc: "Knowledge" },
            { name: "NOVA", desc: "Navigation" },
            { name: "VEDA", desc: "Communication" },
          ].map((agent) => (
            <div key={agent.name} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "16px", color: "var(--accent)", letterSpacing: "0.1em" }}>
                {agent.name}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>
                {agent.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
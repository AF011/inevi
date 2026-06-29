"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/studio",   label: "Map Studio", icon: "🗺" },
  { href: "/traverse", label: "Traverse",   icon: "📍" },
];

export default function Navbar() {
  const pathname = usePathname();

  // On Traverse page during a call, hide navbar to maximise screen
  // (we still render it so the fixed offset works, just make it invisible)
  const onTraverse = pathname.startsWith("/traverse");

  return (
    <>
      {/* ── Top navbar ── */}
      <header style={{
        background:    "var(--surface)",
        borderBottom:  "1px solid var(--border)",
        height:        "56px",
        display:       "flex",
        alignItems:    "center",
        justifyContent: "space-between",
        paddingLeft:   "max(16px, env(safe-area-inset-left))",
        paddingRight:  "max(16px, env(safe-area-inset-right))",
        position:      "fixed",
        top:           0,
        left:          0,
        right:         0,
        zIndex:        100,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "baseline", gap: "0px" }}>
          <span className="font-logo" style={{ fontSize: "26px", color: "var(--text)", lineHeight: 1 }}>
            INEV
          </span>
          <span className="font-logo-italic" style={{ fontSize: "20px", color: "var(--accent)", lineHeight: 1 }}>
            itable
          </span>
        </Link>

        {/* Desktop nav links */}
        <nav style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} style={{
                textDecoration: "none",
                padding:    "6px 14px",
                borderRadius: "6px",
                fontSize:   "13px",
                fontWeight: isActive ? 600 : 400,
                color:      isActive ? "var(--accent)" : "var(--text-muted)",
                background: isActive ? "var(--accent-glow)" : "transparent",
                border:     isActive ? "1px solid rgba(46,196,182,0.2)" : "1px solid transparent",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}>
                {/* Show icon on mobile, text on desktop */}
                <span className="nav-icon">{link.icon}</span>
                <span className="nav-label">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ── Mobile bottom tab bar (only on non-traverse pages) ── */}
      {!onTraverse && (
        <nav style={{
          display:        "none", // shown via CSS media query below
          position:       "fixed",
          bottom:         0,
          left:           0,
          right:          0,
          zIndex:         100,
          background:     "var(--surface)",
          borderTop:      "1px solid var(--border)",
          height:         "calc(56px + env(safe-area-inset-bottom))",
          paddingBottom:  "env(safe-area-inset-bottom)",
          alignItems:     "center",
          justifyContent: "space-around",
        }} className="mobile-tab-bar">
          {[{ href: "/", label: "Home", icon: "🏠" }, ...navLinks].map((link) => {
            const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} style={{
                textDecoration: "none",
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                gap:            "3px",
                padding:        "8px 20px",
                color:          isActive ? "var(--accent)" : "var(--text-dim)",
                fontSize:       "10px",
                fontWeight:     isActive ? 600 : 400,
                transition:     "color 0.15s",
              }}>
                <span style={{ fontSize: "20px", lineHeight: 1 }}>{link.icon}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <style>{`
        /* Hide nav label on small screens, show icon only */
        @media (max-width: 480px) {
          .nav-icon  { display: inline; margin-right: 0; }
          .nav-label { display: none; }
        }
        @media (min-width: 481px) {
          .nav-icon  { display: none; }
          .nav-label { display: inline; }
        }

        /* Show bottom tab bar on mobile */
        @media (max-width: 640px) {
          .mobile-tab-bar { display: flex !important; }
          /* Push main content up above tab bar on non-traverse pages */
          main { padding-bottom: calc(56px + env(safe-area-inset-bottom)) !important; }
        }
      `}</style>
    </>
  );
}
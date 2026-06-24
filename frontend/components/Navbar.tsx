"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/studio", label: "Map Studio" },
  { href: "/traverse", label: "Traverse" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: "24px",
        paddingRight: "24px",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
      }}
    >
      <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "baseline" }}>
        <span className="font-logo" style={{ fontSize: "28px", color: "var(--text)", lineHeight: 1 }}>
          INEV
        </span>
        <span className="font-logo-italic" style={{ fontSize: "22px", color: "var(--accent)", lineHeight: 1 }}>
          itable
        </span>
      </Link>

      <nav style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {navLinks.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                textDecoration: "none",
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                background: isActive ? "var(--accent-glow)" : "transparent",
                border: isActive ? "1px solid rgba(46,196,182,0.2)" : "1px solid transparent",
                transition: "all 0.2s",
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
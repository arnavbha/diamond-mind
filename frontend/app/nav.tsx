"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string; shortLabel?: string };

// Pages used daily. Stay in the main row at every viewport.
const PRIMARY_LINKS: NavLink[] = [
  { href: "/", label: "Slate" },
  { href: "/picks", label: "Picks" },
  { href: "/tracker", label: "Tracker" },
  { href: "/chat", label: "ACE" },
  { href: "/report", label: "Report" },
  { href: "/track-record", label: "Track Record", shortLabel: "Record" },
];

// Low-frequency pages. Live in the main row on desktop, behind a "•••"
// popover on mobile (still accessible, just out of the way).
const SECONDARY_LINKS: NavLink[] = [
  { href: "/verify", label: "Verifier" },
  { href: "/tools", label: "Tools" },
  { href: "/admin", label: "Admin" },
];

function NavLinkPill({
  link,
  path,
  onClick,
}: {
  link: NavLink;
  path: string;
  onClick?: () => void;
}) {
  const active =
    link.href === "/" ? path === "/" : path.startsWith(link.href);
  return (
    <Link
      href={link.href}
      onClick={onClick}
      className="nav-link"
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: active ? 600 : 500,
        fontSize: "13px",
        color: active ? "var(--text)" : "var(--text-2)",
        borderBottom: active
          ? "2px solid var(--blue)"
          : "2px solid transparent",
        paddingBottom: "2px",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span className="nav-label-full">{link.label}</span>
      {link.shortLabel && (
        <span className="nav-label-short">{link.shortLabel}</span>
      )}
    </Link>
  );
}

// Popover for the SECONDARY links on mobile. Hidden on desktop via CSS — the
// desktop renders SECONDARY links inline instead.
function NavOverflow({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside to close. Bound only while open to avoid steady-state cost.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Close on route change too — the click handler on each link sets open=false
  // proactively, but this catches navigations from elsewhere.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  const anyActive = SECONDARY_LINKS.some((l) =>
    l.href === "/" ? path === "/" : path.startsWith(l.href),
  );

  return (
    <div ref={wrapRef} className="nav-overflow" style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="More links"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "1px solid var(--border-2)",
          color: anyActive ? "var(--text)" : "var(--text-2)",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          padding: "3px 8px",
          borderRadius: "4px",
          cursor: "pointer",
          lineHeight: 1,
          minHeight: "26px",
        }}
      >
        •••
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border-2)",
            borderRadius: "6px",
            padding: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            minWidth: "140px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
            zIndex: 200,
          }}
        >
          {SECONDARY_LINKS.map((link) => {
            const active =
              link.href === "/" ? path === "/" : path.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "13px",
                  color: active ? "var(--text)" : "var(--text-2)",
                  fontWeight: active ? 600 : 500,
                  textDecoration: "none",
                  padding: "8px 10px",
                  borderRadius: "4px",
                  background: active ? "var(--surface-2)" : "transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {PRIMARY_LINKS.map((link) => (
        <NavLinkPill key={link.href} link={link} path={path} />
      ))}
      {/* Desktop: secondary links inline. Mobile: hidden via .nav-secondary-desktop. */}
      <span className="nav-secondary-desktop" style={{ display: "contents" }}>
        {SECONDARY_LINKS.map((link) => (
          <NavLinkPill key={link.href} link={link} path={path} />
        ))}
      </span>
      {/* Mobile: ••• overflow popover. Hidden via CSS on desktop. */}
      <NavOverflow path={path} />
    </>
  );
}

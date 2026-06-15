"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string; shortLabel?: string };

// Pages used daily. Stay in the main row at every viewport.
const PRIMARY_LINKS: NavLink[] = [
  { href: "/", label: "Slate" },
  { href: "/picks", label: "Picks" },
  { href: "/edge", label: "Edge" },
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
          ? "2px solid var(--clay)"
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
  // proactively, but this catches navigations from elsewhere. Adjusting state
  // during render (React's recommended pattern) instead of in an effect avoids
  // a wasted render and the setState-in-effect cascade.
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setOpen(false);
  }

  // Focus management: when the menu opens, move focus to the first item. When
  // it closes, restore focus to the trigger so keyboard users aren't stranded.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      const first = menuRef.current?.querySelector<HTMLElement>("[role='menuitem']");
      first?.focus();
    } else if (wasOpen.current) {
      btnRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  const anyActive = SECONDARY_LINKS.some((l) =>
    l.href === "/" ? path === "/" : path.startsWith(l.href),
  );

  // Roving keyboard nav within the menu: ↑/↓ move between items, Home/End jump,
  // Escape closes (and focus restores to the trigger via the effect above).
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <div ref={wrapRef} className="nav-overflow" style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        aria-label="More navigation links"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "1px solid var(--border-2)",
          color: anyActive ? "var(--text)" : "var(--text-2)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-meta)",
          // 44px min touch target (WCAG 2.5.5 / iOS HIG) — was 26px.
          minHeight: "44px",
          minWidth: "44px",
          padding: "0 var(--sp-2)",
          borderRadius: "var(--r-sm)",
          cursor: "pointer",
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        •••
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More navigation links"
          onKeyDown={onMenuKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border-2)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-1)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            minWidth: "160px",
            boxShadow: "var(--shadow-pop)",
            zIndex: "var(--z-popover)" as unknown as number,
          }}
        >
          {SECONDARY_LINKS.map((link) => {
            const active =
              link.href === "/" ? path === "/" : path.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body)",
                  color: active ? "var(--text)" : "var(--text-2)",
                  fontWeight: active ? 600 : 500,
                  textDecoration: "none",
                  // 44px min touch target on each row.
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 var(--sp-3)",
                  borderRadius: "var(--r-sm)",
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

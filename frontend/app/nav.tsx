"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; shortLabel?: string }[] = [
  { href: "/", label: "Slate" },
  { href: "/picks", label: "Picks" },
  { href: "/tracker", label: "Tracker" },
  { href: "/chat", label: "ACE" },
  { href: "/report", label: "Report" },
  { href: "/verify", label: "Verifier" },
  { href: "/track-record", label: "Track Record", shortLabel: "Record" },
  { href: "/admin", label: "Admin" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, shortLabel }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className="nav-link"
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: active ? 600 : 500,
              fontSize: "13px",
              color: active ? "var(--text)" : "var(--text-2)",
              borderBottom: active ? "2px solid var(--blue)" : "2px solid transparent",
              paddingBottom: "2px",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            <span className="nav-label-full">{label}</span>
            {shortLabel && <span className="nav-label-short">{shortLabel}</span>}
          </Link>
        );
      })}
    </>
  );
}

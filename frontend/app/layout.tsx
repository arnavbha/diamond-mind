import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import { IBM_Plex_Sans, IBM_Plex_Mono, IBM_Plex_Sans_Condensed, Syne } from "next/font/google";
import { NavLinks } from "./nav";
import { GlossaryButton } from "./glossary-button";
import { ScoreTicker } from "@/components/score-ticker";
import "./globals.css";

// ── Font loading ────────────────────────────────────────────────────────────
// Self-hosted via next/font, weight-subset to what the design system uses. Each
// family exposes a CSS variable wired into the existing token names on <body>
// below, so every `var(--font-*)` consumer keeps working.
//
// Type system (sportsbook / trading-terminal identity, all-Plex working text):
//   Syne (display)             → logo + page titles. KEPT — it's the brand.
//   IBM Plex Mono (mono/ui)    → odds, units, %, timestamps, nav, labels.
//   IBM Plex Sans (body)       → prose / descriptions / explanations.
//   IBM Plex Sans Condensed    → dense table text (numbers stay Plex Mono via .num).
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--dm-font-mono",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--dm-font-display",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--dm-font-body",
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--dm-font-condensed",
});

export const metadata: Metadata = {
  title: "Diamond Mind",
  description: "MLB Intelligence System",
};

// Without an explicit viewport meta, mobile Safari renders the page at 980px
// and zooms out to fit — which made every @media (max-width: 640px) rule a
// dead letter (the reported viewport was always desktop-sized). This is the
// one-line fix that lets the responsive CSS actually engage on phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexMono.variable} ${syne.variable} ${plexSans.variable} ${plexCondensed.variable}`}
    >
      <body
        style={{
          // Point the design-system font tokens at the self-hosted next/font
          // families. Inline on <body> so it wins over the literal strings in
          // globals.css :root without editing that (out-of-bucket) file.
          // The fallback mirrors the original token so a deploy never ships
          // un-styled if next/font's variable is somehow absent.
          ["--font-mono" as string]: "var(--dm-font-mono), 'IBM Plex Mono', monospace",
          ["--font-ui" as string]: "var(--dm-font-mono), 'IBM Plex Mono', monospace",
          ["--font-display" as string]: "var(--dm-font-display), 'Syne', system-ui, sans-serif",
          ["--font-scoreboard" as string]: "var(--dm-font-display), 'Syne', system-ui, sans-serif",
          ["--font-body" as string]: "var(--dm-font-body), 'IBM Plex Sans', system-ui, sans-serif",
          ["--font-condensed" as string]: "var(--dm-font-condensed), 'IBM Plex Sans Condensed', system-ui, sans-serif",
          // Shell-height tokens so Chat (and anything else) can stop hard-coding
          // the nav(52) + ticker(36) offsets in magic calc() expressions.
          ["--nav-h" as string]: "52px",
          ["--ticker-h" as string]: "36px",
          ["--shell-h" as string]: "calc(52px + 36px)",
        }}
      >
        <nav className="app-nav" style={{
          borderBottom: "1px solid var(--border)",
          padding: "0 24px",
          height: "var(--nav-h)",
          display: "flex",
          alignItems: "center",
          gap: "20px",
          // Frosted navigation chrome: content scrolls UNDER a translucent,
          // blurred nav rather than vanishing behind an opaque bar. This is
          // purposeful navigation chrome (a fixed instrument header), not
          // decorative glassmorphism on content surfaces.
          background: "rgba(5, 8, 11, 0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          position: "sticky",
          top: 0,
          zIndex: "var(--z-nav)" as unknown as number,
        }}>
          {/* Brand lockup — now a Link home. The clay ◆ is the single identity
              trim; the wordmark is Syne 800, uppercase, wide-tracked. */}
          <Link
            href="/"
            className="app-nav-brand"
            aria-label="Diamond Mind — home"
            style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "4px", flexShrink: 0, textDecoration: "none" }}
          >
            <Image src="/logo.ico" alt="" width={22} height={22} style={{ display: "block" }} />
            <span className="app-nav-brand-text" style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "14px",
              color: "var(--text)",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              <span aria-hidden="true" style={{ color: "var(--clay)", fontSize: "10px", lineHeight: 1 }}>◆</span>
              Diamond Mind
            </span>
          </Link>
          <div style={{ width: "1px", height: "16px", background: "var(--border-2)" }} />
          <NavLinks />
          <GlossaryButton />
        </nav>
        <ScoreTicker />
        <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "28px 24px", position: "relative", zIndex: "var(--z-content)" as unknown as number }}>
          {children}
        </main>
      </body>
    </html>
  );
}

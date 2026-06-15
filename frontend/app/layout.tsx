import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { Inter, JetBrains_Mono, Syne } from "next/font/google";
import { NavLinks } from "./nav";
import { GlossaryButton } from "./glossary-button";
import { ScoreTicker } from "@/components/score-ticker";
import "./globals.css";

// ── Font loading ────────────────────────────────────────────────────────────
// Self-hosted via next/font (replaces the render-blocking @import that used to
// sit at globals.css line 1 + the runtime <link> to fonts.googleapis.com). All
// three families load through one path, weight-subset to exactly what the design
// system uses. Each exposes a CSS variable; we wire those into the existing
// token names (--font-mono / --font-display / --font-body) on <body> below so
// every `var(--font-*)` consumer keeps working with no globals.css change.
const jetbrainsMono = JetBrains_Mono({
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

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--dm-font-body",
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
      className={`${jetbrainsMono.variable} ${syne.variable} ${inter.variable}`}
    >
      <body
        style={{
          // Point the design-system font tokens at the self-hosted next/font
          // families. Inline on <body> so it wins over the literal strings in
          // globals.css :root without editing that (out-of-bucket) file.
          // The fallback mirrors the original token so a deploy never ships
          // un-styled if next/font's variable is somehow absent.
          ["--font-mono" as string]: "var(--dm-font-mono), 'JetBrains Mono', monospace",
          ["--font-ui" as string]: "var(--dm-font-mono), 'JetBrains Mono', monospace",
          ["--font-display" as string]: "var(--dm-font-display), 'Syne', system-ui, sans-serif",
          ["--font-scoreboard" as string]: "var(--dm-font-display), 'Syne', system-ui, sans-serif",
          ["--font-body" as string]: "var(--dm-font-body), 'Inter', system-ui, sans-serif",
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
          gap: "24px",
          background: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: "var(--z-nav)" as unknown as number,
        }}>
          <div className="app-nav-brand" style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "8px", flexShrink: 0 }}>
            <Image src="/logo.ico" alt="Diamond Mind" width={22} height={22} style={{ display: "block" }} />
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
              {/* Clay diamond — the single identity trim, marking the wordmark like an instrument legend. */}
              <span aria-hidden="true" style={{ color: "var(--clay)", fontSize: "10px", lineHeight: 1 }}>◆</span>
              Diamond Mind
            </span>
          </div>
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

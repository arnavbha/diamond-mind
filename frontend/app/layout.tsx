import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { NavLinks } from "./nav";
import { GlossaryButton } from "./glossary-button";
import { ScoreTicker } from "@/components/score-ticker";
import DecryptedText from "@/components/decrypted-text";
import NoiseOverlay from "@/components/noise-overlay";
import DotGrid from "@/components/dot-grid";
import "./globals.css";

const FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@700;800&display=swap";

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={FONTS_URL} rel="stylesheet" />
      </head>
      <body>
        <DotGrid
          dotSize={2}
          gap={22}
          baseColor="#2D3748"
          activeColor="#58A6FF"
          proximity={120}
          shockStrength={10}
        />
        <nav className="app-nav" style={{
          borderBottom: "1px solid var(--border)",
          padding: "0 24px",
          height: "52px",
          display: "flex",
          alignItems: "center",
          gap: "24px",
          background: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}>
          <div className="app-nav-brand" style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "8px", flexShrink: 0 }}>
            <Image src="/logo.ico" alt="Diamond Mind" width={22} height={22} style={{ display: "block" }} />
            <span className="app-nav-brand-text" style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "14px",
              color: "var(--text)",
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              <DecryptedText
                text="Diamond Mind"
                animateOn="view"
                sequential
                revealDirection="start"
                speed={80}
                characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%"
              />
            </span>
          </div>
          <div style={{ width: "1px", height: "16px", background: "var(--border-2)" }} />
          <NavLinks />
          <GlossaryButton />
        </nav>
        <NoiseOverlay patternAlpha={12} patternRefreshInterval={3} />
        <ScoreTicker />
        <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "28px 24px", position: "relative", zIndex: 1 }}>
          {children}
        </main>
      </body>
    </html>
  );
}

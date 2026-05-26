"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { todayET } from "@/lib/api";
import { GameDetailPanel } from "@/components/game-detail-panel";

function GamePageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const asOf = searchParams.get("date") ?? todayET();

  return (
    <div>
      <Link
        href={`/?date=${asOf}`}
        style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)", textDecoration: "none", letterSpacing: "0.05em" }}
      >
        ← Slate · {asOf}
      </Link>
      <div style={{ marginTop: "16px" }}>
        <GameDetailPanel gameId={Number(id)} date={asOf} />
      </div>
    </div>
  );
}

export default function GameDetailPage() {
  return (
    <Suspense fallback={<div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>Loading…</div>}>
      <GamePageInner />
    </Suspense>
  );
}

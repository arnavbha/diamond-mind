"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { todayET } from "@/lib/api";
import { GameDetailPanel } from "@/components/game-detail-panel";
import { Loading, SkeletonCard } from "@/components/ui";

function GamePageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const asOf = searchParams.get("date") ?? todayET();

  return (
    <div>
      <Link
        href={`/?date=${asOf}`}
        className="num"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          minHeight: "44px",
          fontSize: "var(--fs-meta)",
          color: "var(--text-2)",
          textDecoration: "none",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
        }}
      >
        ← Slate · {asOf}
      </Link>
      <div style={{ marginTop: "var(--sp-4)" }}>
        <GameDetailPanel gameId={Number(id)} date={asOf} />
      </div>
    </div>
  );
}

export default function GameDetailPage() {
  return (
    <Suspense fallback={<Loading label="Loading game"><SkeletonCard lines={6} /></Loading>}>
      <GamePageInner />
    </Suspense>
  );
}

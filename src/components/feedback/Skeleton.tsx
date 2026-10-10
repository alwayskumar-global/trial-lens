import type { CSSProperties } from "react";

function L({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  const style: CSSProperties = { width: w, height: h, borderRadius: r };
  return <span className="tl-skel" style={style} />;
}

/** Loading placeholder shimmer for cards, strips, lines. Shimmer is disabled under reduced motion. */
export function Skeleton({ variant = "card" }: { variant?: "card" | "strip" | "line" }) {
  if (variant === "line") return <L />;
  if (variant === "strip") {
    return (
      <div className="tl-strip" aria-hidden="true" style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "160px 1fr 24px", gap: 16, alignItems: "center" }}>
        <L h={20} />
        <L w="70%" />
        <L w={20} h={20} r={10} />
      </div>
    );
  }
  return (
    <div className="tl-card" aria-busy="true" aria-label="Loading trial">
      <L w={140} h={24} r={12} />
      <L h={22} />
      <L w="60%" h={22} />
      <L w="45%" />
      <L />
      <L w="80%" />
      <L w="90%" />
      <L w={180} h={44} />
    </div>
  );
}

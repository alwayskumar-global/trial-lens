"use client";
import { useEffect, useRef, useState } from "react";
import { FIT_ZONES, fitLinePositions } from "@/lib/ui/fit-line";
import { TIER_LABELS, type Tier } from "../status/TierBadge";

export interface FitLineTrial {
  id: string;
  title: string;
  short?: string;
  tier: Tier;
  /** Pending/failed trials: drawn as a dashed dot; this text (e.g. "not analyzed this run") is added to the accessible label and tooltip. */
  dashedNote?: string;
}

export interface FitLineProps<T extends FitLineTrial = FitLineTrial> {
  trials: readonly T[];
  onSelect?: (trial: T) => void;
  /** Called with ids of dots that changed tier */
  onMoved?: (ids: string[]) => void;
}

const tiersOf = (trials: readonly FitLineTrial[]) => Object.fromEntries(trials.map((t) => [t.id, t.tier])) as Record<string, Tier>;

/** Signature desktop band: every trial as a dot in one of four zones; dots glide (600ms, 40ms stagger) when a tier changes. */
export function FitLine<T extends FitLineTrial>({ trials, onSelect, onMoved }: FitLineProps<T>) {
  // `prev` is the last COMMITTED tier map, so a tier change is visible during the render that animates it.
  const [prev, setPrev] = useState<Record<string, Tier>>(() => tiersOf(trials));
  const [ring, setRing] = useState<string[]>([]);
  const moved = trials.filter((t) => prev[t.id] && prev[t.id] !== t.tier).map((t) => t.id);
  const movedKey = moved.join(",");

  useEffect(() => {
    // Commits the new tier map after the animating render; intentional post-render sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrev(tiersOf(trials));
    if (!movedKey) return;
    const ids = movedKey.split(",");
    setRing(ids);
    onMoved?.(ids);
    const h = setTimeout(() => setRing([]), 4000);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the tier assignment changes
  }, [trials]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(1000);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackPx(el.clientWidth || 1000);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { pos, starts, height } = fitLinePositions(trials, trackPx);
  const count = (k: Tier) => trials.filter((t) => t.tier === k).length;
  return (
    <div className="tl-fitline" role="group" aria-label="Fit line: where each analyzed trial sits">
      <div className="tl-fitline__heads">
        {FIT_ZONES.map((z) => (
          <div key={z.k} className={"tl-fitline__head tl-fitline__head--" + z.k} style={{ width: z.w + "%" }}>
            <div className="tl-fitline__count">{count(z.k)}</div>
            <div className="tl-fitline__zname">{z.n}</div>
          </div>
        ))}
      </div>
      <div className="tl-fitline__track" ref={trackRef} style={{ height }}>
        {FIT_ZONES.map((z) => (
          <div key={z.k} className={"tl-fitline__zone tl-fitline__zone--" + z.k} style={{ left: starts[z.k] + 0.3 + "%", width: z.w - 0.6 + "%" }} />
        ))}
        <div className="tl-fitline__axis" />
        {trials.map((t) => {
          const mi = moved.indexOf(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={"tl-dot tl-dot--" + t.tier + (t.dashedNote ? " tl-dot--dashed" : "") + (ring.includes(t.id) ? " tl-dot--ring" : "")}
              style={{ left: pos[t.id]!.left, top: pos[t.id]!.top, "--dd": (mi >= 0 ? mi * 40 : 0) + "ms" } as React.CSSProperties}
              onClick={() => onSelect?.(t)}
              aria-label={t.title + ", " + TIER_LABELS[t.tier] + (t.dashedNote ? ", " + t.dashedNote : "")}
            >
              <span className="tl-dot__tip" role="tooltip">
                {t.short ?? t.title}
                <br />
                {TIER_LABELS[t.tier]}
                {t.dashedNote && (
                  <>
                    <br />
                    {t.dashedNote}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

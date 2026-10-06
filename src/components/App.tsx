"use client";
import { useCallback, useEffect, useState } from "react";
import { Confirm } from "./screens/Confirm";
import { Describe } from "./screens/Describe";
import { Detail } from "./screens/Detail";
import { Processing } from "./screens/Processing";
import { Results } from "./screens/Results";
import { MOVES, SAMPLE_TEXT, TRIALS } from "@/lib/sample/triallens-sample";
import type { Tier } from "./status/TierBadge";

type Screen = "describe" | "confirm" | "processing" | "results" | "detail";

/** Describe → Confirm → Processing → Results → Detail. Patient text lives only in this component's memory (never stored or sent). */
export function App() {
  const [screen, setScreen] = useState<Screen>("describe");
  const [text, setText] = useState(SAMPLE_TEXT);
  const [tiers, setTiers] = useState<Record<string, Tier>>({});
  const [answer, setAnswer] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState("t1");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
  // Toasts dismiss themselves after ~6s (design: feedback/Toast.prompt.md).
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(h);
  }, [toast]);
  useEffect(() => {
    if (updated.length === 0) return;
    const h = setTimeout(() => setUpdated([]), 4000);
    return () => clearTimeout(h);
  }, [updated]);

  const trials = TRIALS.map((t) => ({ ...t, tier: tiers[t.id] ?? t.tier }));
  const onAnswer = (a: string) => {
    setAnswer(a);
    const mv = MOVES[a];
    if (!mv) {
      setTiers({});
      setUpdated([]);
      setToast(a === "I don't know" ? "Noted. Results stay as they are. You can answer later." : "Good plan. Results stay as they are until you know.");
      return;
    }
    setTiers(mv);
    const ids = Object.keys(mv);
    setUpdated(ids);
    const strong = ids.filter((i) => mv[i] === "strong").length;
    setToast(ids.length + " trials moved." + (strong ? " " + strong + " is now a Strong potential match." : ""));
  };
  const toProcessing = useCallback(() => setScreen("processing"), []);
  const toResults = useCallback(() => setScreen("results"), []);

  let view;
  if (screen === "describe") view = <Describe text={text} setText={setText} onNext={() => setScreen("confirm")} />;
  else if (screen === "confirm") view = <Confirm text={text} onBack={() => setScreen("describe")} onNext={toProcessing} />;
  else if (screen === "processing") view = <Processing onDone={toResults} />;
  else if (screen === "detail") view = <Detail trial={trials.find((t) => t.id === open) ?? trials[0]!} onBack={() => setScreen("results")} />;
  else view = <Results trials={trials} answer={answer} onAnswer={onAnswer} updated={updated} onOpen={(id) => { setOpen(id); setScreen("detail"); }} toast={toast} setToast={setToast} />;
  return <div className="tl-frame">{view}</div>;
}

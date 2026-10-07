"use client";
import { useCallback, useEffect, useState } from "react";
import { LiveApp } from "./live/LiveApp";
import { Confirm } from "./screens/Confirm";
import { Describe } from "./screens/Describe";
import { Detail } from "./screens/Detail";
import { Processing } from "./screens/Processing";
import { Results } from "./screens/Results";
import { TRIALS } from "@/lib/sample/triallens-sample";

type Screen = "describe" | "confirm" | "processing" | "results" | "detail";

/** Describe → Confirm → Processing → Results → Detail. Demo only: fixed fictional profile and results; nothing the visitor types is read, stored or sent. */
function FixedDemo() {
  const [screen, setScreen] = useState<Screen>("describe");
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

  // Option B (2026-10-10): the fixed demo has no answer step and no tier updates; the sample trials are shown as they are.
  const trials = TRIALS;
  const toProcessing = useCallback(() => setScreen("processing"), []);
  const toResults = useCallback(() => setScreen("results"), []);

  let view;
  if (screen === "describe") view = <Describe onNext={() => setScreen("confirm")} />;
  else if (screen === "confirm") view = <Confirm onBack={() => setScreen("describe")} onNext={toProcessing} />;
  else if (screen === "processing") view = <Processing onDone={toResults} />;
  else if (screen === "detail") view = <Detail trial={trials.find((t) => t.id === open) ?? trials[0]!} onBack={() => setScreen("results")} />;
  else view = <Results trials={trials} onOpen={(id) => { setOpen(id); setScreen("detail"); }} toast={toast} setToast={setToast} />;
  return <div className="tl-frame">{view}</div>;
}

/**
 * UI mode, set at build time (non-secret): "fixed" (default) is the shipped fixed fictional demo; "live" runs the real
 * pipeline on the fictional profile and shows the live / replay / pending states. Never set to "live" without approval.
 */
export function App() {
  return process.env.NEXT_PUBLIC_UI_MODE === "live" ? <LiveApp /> : <FixedDemo />;
}

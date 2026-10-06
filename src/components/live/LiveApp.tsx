"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Confirm } from "../screens/Confirm";
import { Describe } from "../screens/Describe";
import { ErrorState } from "../feedback/ErrorState";
import { ANALYZE_LIVE, ERROR_BODY, ERROR_TITLE, REPLAY_LOADING, TAG_ENTRY } from "@/lib/live/copy";
import { streamRun } from "@/lib/live/client";
import { initialRun, reduceRun } from "@/lib/live/model";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { LiveDetail } from "./LiveDetail";
import { LiveProcessing } from "./LiveProcessing";
import { LiveResults } from "./LiveResults";
import { LiveShell } from "./LiveShell";

type Screen = "describe" | "confirm" | "run" | "detail";

/** Live flow: the same fictional profile is analyzed by the real pipeline (/api/run). No visitor text is read or stored. */
export function LiveApp() {
  const [screen, setScreen] = useState<Screen>("describe");
  const [run, dispatch] = useReducer(reduceRun, initialRun);
  const [open, setOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  const start = useCallback(() => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    dispatch({ type: "start" });
    setScreen("run");
    void streamRun({ text: SAMPLE_TEXT }, dispatch, { signal: ac.signal }).then((r) => {
      if (ac.signal.aborted) return;
      if (!r.ok) dispatch({ type: "http_error", code: r.code });
      else dispatch({ type: "closed" });
    });
  }, []);

  let view;
  if (screen === "describe") view = <Describe tag={TAG_ENTRY} onNext={() => setScreen("confirm")} />;
  else if (screen === "confirm") view = <Confirm tag={TAG_ENTRY} nextLabel={ANALYZE_LIVE} onBack={() => setScreen("describe")} onNext={start} />;
  else if (screen === "detail" && open) {
    const t = run.trials.find((x) => x.nct_id === open);
    view = t ? <LiveDetail run={run} trial={t} onBack={() => setScreen("run")} /> : null;
  } else if (run.status === "error") {
    view = (
      <LiveShell replay={false}>
        <main className="page stack g24">
          <ErrorState title={ERROR_TITLE}>{ERROR_BODY}</ErrorState>
        </main>
      </LiveShell>
    );
  } else if (run.status === "done") {
    view = (
      <LiveResults
        run={run}
        onOpen={(nct) => {
          setOpen(nct);
          setScreen("detail");
        }}
      />
    );
  } else if (run.mode === "replay") {
    // A replay never shows live-style progress: only a neutral line until the saved example has arrived.
    view = (
      <LiveShell replay reason={run.reason} label={run.replayLabel}>
        <main className="page stack g24">
          <p role="status" className="lead">
            {REPLAY_LOADING}
          </p>
        </main>
      </LiveShell>
    );
  } else view = <LiveProcessing run={run} />;
  return <div className="tl-frame">{view}</div>;
}

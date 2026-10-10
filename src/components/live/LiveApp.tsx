"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { focusScreenHeading } from "@/lib/ui/focus";
import { Button } from "../actions/Button";
import { Confirm } from "../screens/Confirm";
import { Describe } from "../screens/Describe";
import { ErrorState } from "../feedback/ErrorState";
import { VisitorConfirm } from "../visitor/VisitorConfirm";
import { VisitorDescribe } from "../visitor/VisitorDescribe";
import { ANALYZE_LIVE, ERROR_BODY, ERROR_TITLE, REPLAY_LOADING, TAG_ENTRY } from "@/lib/live/copy";
import { streamRun } from "@/lib/live/client";
import { initialRun, reduceRun } from "@/lib/live/model";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { fetchInputMode, canReuse, requestExtraction, type InputMode } from "@/lib/visitor/client";
import * as C from "@/lib/visitor/copy";
import { add, clone, FACT_LABEL, remove, setSure, setValue, toRunProfile, validate, type Drafts } from "@/lib/visitor/facts";
import type { FactKey } from "@/schema/vocabulary";
import { DEFAULT_COPY, LiveCopyContext, VISITOR_COPY } from "./LiveCopy";
import { LiveDetail } from "./LiveDetail";
import { LiveProcessing } from "./LiveProcessing";
import { LiveResults } from "./LiveResults";
import { LiveShell } from "./LiveShell";

type Screen = "describe" | "confirm" | "run" | "detail";
interface Extracted { text: string; at: number; token: string; original: Drafts }
const EXAMPLE_ID = "her2pos-stage3";
const MESSAGES = { needValue: C.C_NEED_VALUE, badNumber: C.C_BAD_NUMBER, outOfRange: C.C_OUT_OF_RANGE };

/**
 * Live flow. The server decides what is allowed (GET /api/input-mode):
 *  - open: Describe (typed text or a fictional example) → /api/extract → editable review → signed /api/run → Results.
 *  - samples with extraction available: the same flow, but typing is visibly switched off and the review is read-only.
 *  - samples without extraction (no signing secret) or an unreachable mode check: the original fixed flow (prepared profile, text run).
 * The text is held in memory only: no storage, no URL, no logging.
 */
export function LiveApp() {
  const [inputMode, setInputMode] = useState<InputMode | null>(null);
  const [screen, setScreen] = useState<Screen>("describe");
  const [run, dispatch] = useReducer(reduceRun, initialRun);
  const [open, setOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const extractAbort = useRef<AbortController | null>(null);
  const focusAfter = useRef<string | null>(null); // an added detail's control gets focus once it exists

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | undefined>();
  const [extractErr, setExtractErr] = useState<C.FlowError | undefined>();
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [runErr, setRunErr] = useState<C.FlowError | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void fetchInputMode({ signal: ac.signal }).then((m) => !ac.signal.aborted && setInputMode(m));
    return () => ac.abort();
  }, []);
  useEffect(() => () => { abort.current?.abort(); extractAbort.current?.abort(); }, []);

  const first = useRef(true);
  const errored = run.status === "error";
  const modeKnown = inputMode !== null;
  const done = run.status === "done"; // results replace the processing view: move focus to the results heading, not to <body>
  useEffect(() => {
    window.scrollTo(0, 0);
    if (first.current) first.current = false; // do not steal focus on the initial render
    else focusScreenHeading();
  }, [screen, errored, done, modeKnown]);

  const visitorFlow = inputMode !== null && !(inputMode.mode === "samples" && !inputMode.extractReady);
  const typing = inputMode?.mode === "open";
  const copy = typing ? VISITOR_COPY : DEFAULT_COPY;

  const begin = useCallback((body: Parameters<typeof streamRun>[0]) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunErr(null);
    dispatch({ type: "start" });
    setScreen("run");
    void streamRun(body, dispatch, { signal: ac.signal }).then((r) => {
      if (ac.signal.aborted) return;
      if (!r.ok) {
        setRunErr(C.runError(r.status, r.code));
        dispatch({ type: "http_error", code: r.code });
      } else dispatch({ type: "closed" });
    });
  }, []);

  // ---- original fixed flow ----
  const startLegacy = useCallback(() => begin({ text: SAMPLE_TEXT }), [begin]);

  // ---- visitor flow ----
  const submitDescribe = useCallback(async () => {
    setExtractErr(undefined);
    if (text.trim().length === 0) return setInvalid(C.D_EMPTY);
    setInvalid(undefined);
    if (canReuse(extracted, text, Date.now())) return setScreen("confirm"); // same text, token still fresh: keep the reviewed edits
    extractAbort.current?.abort();
    const ac = new AbortController();
    extractAbort.current = ac;
    setBusy(true);
    const r = await requestExtraction(text, { signal: ac.signal });
    if (ac.signal.aborted) return;
    setBusy(false);
    if (!r.ok) return setExtractErr(C.extractError(r.status, r.code));
    setExtracted({ text, at: Date.now(), token: r.token, original: r.drafts });
    setDrafts(clone(r.drafts));
    setShowErrors(false);
    setAnnounce("");
    setScreen("confirm");
  }, [text, extracted]);

  const submitConfirm = useCallback(() => {
    if (!drafts || !extracted) return;
    if (Object.keys(validate(drafts, MESSAGES)).length > 0) {
      setShowErrors(true);
      return;
    }
    begin({ profile: toRunProfile(drafts), extract_token: extracted.token });
  }, [drafts, extracted, begin]);
  useEffect(() => {
    if (focusAfter.current) document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [drafts]);
  useEffect(() => {
    if (showErrors && screen === "confirm") document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [showErrors, screen]);

  const showExample = useCallback(() => begin({ replay_id: EXAMPLE_ID }), [begin]);
  const restartDescribe = useCallback(() => { abort.current?.abort(); dispatch({ type: "start" }); setRunErr(null); setScreen("describe"); }, []);
  const mutate = (f: (d: Drafts) => Drafts, say?: string) => { setDrafts((d) => (d ? f(d) : d)); if (say !== undefined) setAnnounce(say); };

  let view;
  if (inputMode === null) {
    view = (
      <div className="app">
        <div className="wrap">
          <main className="page">
            <h1 className="tl-h1">TrialLens</h1>
            <p role="status" className="lead">{C.G_LOADING}</p>
          </main>
        </div>
      </div>
    );
  } else if (screen === "describe" || screen === "confirm") {
    if (!visitorFlow) {
      view = screen === "describe" ? <Describe tag={TAG_ENTRY} onNext={() => setScreen("confirm")} /> : <Confirm tag={TAG_ENTRY} nextLabel={ANALYZE_LIVE} onBack={() => setScreen("describe")} onNext={startLegacy} />;
    } else if (screen === "describe") {
      view = (
        <VisitorDescribe
          mode={typing ? "open" : "gated"}
          text={text}
          maxChars={inputMode.maxChars}
          busy={busy}
          invalid={invalid}
          error={extractErr}
          tag={typing ? C.D_TAG : TAG_ENTRY}
          footer={typing ? C.FOOTER_OPEN : C.FOOTER_CURRENT}
          onText={(t) => { setText(t); setInvalid(undefined); setExtractErr(undefined); }}
          onSample={(t) => { setText(t); setInvalid(undefined); setExtractErr(undefined); }}
          onSubmit={() => void submitDescribe()}
          onErrorAction={(a) => (a === "example" ? showExample() : void submitDescribe())}
        />
      );
    } else if (drafts) {
      view = (
        <VisitorConfirm
          drafts={drafts}
          errors={validate(drafts, MESSAGES)}
          text={extracted?.text ?? text}
          editable={typing}
          tag={typing ? C.D_TAG : TAG_ENTRY}
          announce={announce}
          showErrors={showErrors}
          onSure={(k: FactKey, sure) => mutate((d) => setSure(d, k, sure))}
          onValue={(k, raw) => mutate((d) => setValue(d, k, raw))}
          onRemove={(k) => mutate((d) => remove(d, k), C.C_REMOVED(FACT_LABEL[k]))}
          onAdd={(k) => { focusAfter.current = "tl-fact-" + k; mutate((d) => add(d, k), C.C_ADDED(FACT_LABEL[k])); }}
          onBack={() => setScreen("describe")}
          onNext={submitConfirm}
        />
      );
    } else view = null;
  } else if (screen === "detail" && open) {
    const t = run.trials.find((x) => x.nct_id === open);
    view = t ? <LiveDetail run={run} trial={t} onBack={() => setScreen("run")} /> : null;
  } else if (run.status === "error") {
    const e = visitorFlow ? runErr ?? C.runError(0, run.errorCode ?? "") : null;
    view = (
      <LiveShell replay={false}>
        <main className="page stack g24">
          {e ? (
            <ErrorState
              title={e.title}
              headingLevel={1}
              actions={
                <>
                  {e.action === "example" && <Button size="sm" variant="secondary" onClick={showExample}>{C.EXAMPLE_BUTTON}</Button>}
                  {e.action === "restart" && <Button size="sm" variant="secondary" onClick={() => { setExtracted(null); restartDescribe(); }}>Read my situation again</Button>}
                  {drafts && e.action !== "restart" && <Button size="sm" variant="quiet" onClick={() => { dispatch({ type: "start" }); setScreen("confirm"); }}>Back to review</Button>}
                </>
              }
            >
              {e.body}
            </ErrorState>
          ) : (
            <ErrorState title={ERROR_TITLE} headingLevel={1}>{ERROR_BODY}</ErrorState>
          )}
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
        actions={
          visitorFlow ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {drafts && run.mode !== "replay" && <Button size="sm" variant="secondary" onClick={() => { dispatch({ type: "start" }); setScreen("confirm"); }}>{C.V_EDIT}</Button>}
              <Button size="sm" variant="quiet" onClick={restartDescribe}>{C.V_RESTART}</Button>
            </div>
          ) : undefined
        }
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
  return (
    <LiveCopyContext.Provider value={copy}>
      <div className="tl-frame">{view}</div>
    </LiveCopyContext.Provider>
  );
}

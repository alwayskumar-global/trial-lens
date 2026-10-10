import type { ReactNode } from "react";
import { SafetyBanner } from "../feedback/SafetyBanner";
import { Header } from "../screens/Header";
import { REPLAY_BANNER, TAG_LIVE, TAG_REPLAY } from "@/lib/live/copy";
import { useLiveCopy } from "./LiveCopy";
import { ReplayNotice } from "./ReplayNotice";
import type { ReplayReason } from "@/lib/live/copy";

/** Frame for live and replay screens: persistent safety banner, mode tag in the header, and (replay) the persistent notice. */
export function LiveShell({ replay, reason, label, children }: { replay: boolean; reason?: ReplayReason | undefined; label?: string | undefined; children: ReactNode }) {
  const copy = useLiveCopy();
  return (
    <div className="app">
      <SafetyBanner>{replay ? REPLAY_BANNER : copy.banner}</SafetyBanner>
      <div className="wrap">
        <Header tag={replay ? TAG_REPLAY : TAG_LIVE} />
        {replay && <ReplayNotice reason={reason} label={label} />}
        {children}
      </div>
    </div>
  );
}

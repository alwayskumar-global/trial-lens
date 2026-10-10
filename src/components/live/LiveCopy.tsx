"use client";
import { createContext, useContext } from "react";
import { LIVE_BANNER, LIVE_SUBJECT, PROCESSING_LEAD, STAGE_LABELS, type FilterWho } from "@/lib/live/copy";
import { V_BANNER, V_EXTRACTION_STAGE, V_RESULTS_NOTE, V_PANEL_NOTE, V_PANEL_SUB, V_PROCESSING_LEAD, V_SUBJECT } from "@/lib/visitor/copy";
import { PANEL_NOTE, PANEL_SUB } from "../results/StudyTeamPanel";
import { R_NOTE_FIXED } from "@/lib/live/copy";

/** How live screens refer to the profile. Default = the approved prepared-fictional-profile copy; the visitor flow (typed input) supplies its proposed copy. */
export interface LiveCopyValue {
  subject: string;
  banner: string;
  processingLead: string;
  extractionStage: string;
  /** Who the profile belongs to, for the discovery-filter sentence. */
  who: FilterWho;
  resultsNote: string;
  panelSub: string;
  panelNote: string;
  plural: boolean;
}
export const DEFAULT_COPY: LiveCopyValue = {
  subject: LIVE_SUBJECT,
  banner: LIVE_BANNER,
  processingLead: PROCESSING_LEAD,
  extractionStage: STAGE_LABELS.extraction!,
  who: "fixed",
  resultsNote: R_NOTE_FIXED,
  panelSub: PANEL_SUB,
  panelNote: PANEL_NOTE,
  plural: false,
};
export const VISITOR_COPY: LiveCopyValue = {
  subject: V_SUBJECT,
  banner: V_BANNER,
  processingLead: V_PROCESSING_LEAD,
  extractionStage: V_EXTRACTION_STAGE,
  who: "visitor",
  resultsNote: V_RESULTS_NOTE,
  panelSub: V_PANEL_SUB,
  panelNote: V_PANEL_NOTE,
  plural: true,
};
export const LiveCopyContext = createContext<LiveCopyValue>(DEFAULT_COPY);
export const useLiveCopy = () => useContext(LiveCopyContext);

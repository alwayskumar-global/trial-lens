// Thin wrapper kept for the offline tools: the window fetch itself lives in src/lib/ctgov/selection.ts and is the SAME code the live route uses.
import { fetchSelectionWindow, INTERVENTIONAL_FILTER, type WindowStudy } from "../../src/lib/ctgov/selection";
export { INTERVENTIONAL_FILTER };
export type { WindowStudy };

export const fetchWindow = (base: string, sort: string | null, opts: { interventionalOnly?: boolean } = {}): Promise<WindowStudy[]> =>
  fetchSelectionWindow({ base, sort, interventionalOnly: opts.interventionalOnly === true });

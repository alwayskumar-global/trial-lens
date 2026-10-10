// Moves keyboard/screen-reader focus to the screen's main heading after a screen change, so focus is not left on <body> when the previous
// screen's button disappears. The heading is not interactive, so its focus outline is suppressed (no visual change).
export interface FocusableHeading { tabIndex: number; style: { outline: string }; focus(o?: { preventScroll?: boolean }): void }
export function focusScreenHeading(root: { querySelector(sel: string): FocusableHeading | null } = document): boolean {
  const h = root.querySelector("main h1");
  if (!h) return false;
  h.tabIndex = -1;
  h.style.outline = "none";
  h.focus({ preventScroll: true });
  return true;
}

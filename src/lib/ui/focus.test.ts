import { describe, expect, it, vi } from "vitest";
import { focusScreenHeading, type FocusableHeading } from "./focus";

describe("focusScreenHeading", () => {
  it("focuses the main h1 without scrolling and without a visible outline", () => {
    const h: FocusableHeading = { tabIndex: 0, style: { outline: "" }, focus: vi.fn() };
    expect(focusScreenHeading({ querySelector: (s) => (s === "main h1" ? h : null) })).toBe(true);
    expect(h.tabIndex).toBe(-1);
    expect(h.style.outline).toBe("none");
    expect(h.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
  it("does nothing when the screen has no h1", () => {
    expect(focusScreenHeading({ querySelector: () => null })).toBe(false);
  });
});

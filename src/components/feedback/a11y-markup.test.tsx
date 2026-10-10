import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./ErrorState";
import { SafetyBanner } from "./SafetyBanner";

describe("accessible structure of the shared notices", () => {
  it("the safety notice is a named landmark (so its text is not outside every landmark) and keeps its approved copy", () => {
    const h = renderToStaticMarkup(<SafetyBanner />);
    expect(h).toContain("<aside");
    expect(h).toContain('aria-label="Demo notice"');
    expect(h).toContain("It can&#x27;t confirm eligibility. Only a study team can.");
  });
  it("an error that is the whole screen can carry the page's h1; the default stays an h3; both keep role=alert", () => {
    const page = renderToStaticMarkup(<ErrorState title="T" headingLevel={1}>B</ErrorState>);
    const inline = renderToStaticMarkup(<ErrorState title="T">B</ErrorState>);
    expect(page).toContain("<h1>T</h1>");
    expect(inline).toContain("<h3>T</h3>");
    expect(page).toContain('role="alert"');
    expect(inline).toContain('role="alert"');
  });
});

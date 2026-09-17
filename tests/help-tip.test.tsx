import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpTip } from "@/components/help-tip";

describe("HelpTip", () => {
  it("renders a labeled question-mark control for help text", () => {
    const html = renderToStaticMarkup(<HelpTip label="Explain calories">Use a typical complete day.</HelpTip>);
    expect(html).toContain("type=\"button\"");
    expect(html).toContain("aria-label=\"Explain calories\"");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("?");
    // Closed by default: tip body is gated behind open state.
    expect(html).not.toContain("Use a typical complete day.");
    expect(html).not.toContain("role=\"tooltip\"");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpTip } from "@/components/help-tip";

describe("HelpTip", () => {
  it("renders keyboard-readable help with a visible question mark", () => {
    const html = renderToStaticMarkup(<HelpTip label="Explain calories">Use a typical complete day.</HelpTip>);
    expect(html).toContain("<details");
    expect(html).toContain("aria-label=\"Explain calories\"");
    expect(html).toContain("role=\"tooltip\"");
    expect(html).toContain("Use a typical complete day.");
  });
});

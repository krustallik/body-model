import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const localeMock = vi.hoisted(() => ({ value: "uk" as "uk" | "en" }));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: localeMock.value }),
}));

import { HelpTip } from "@/components/help-tip";

describe("HelpTip", () => {
  it("localizes its default accessible name", () => {
    localeMock.value = "uk";
    expect(renderToStaticMarkup(<HelpTip>Пояснення.</HelpTip>)).toContain("aria-label=\"Показати пояснення\"");

    localeMock.value = "en";
    expect(renderToStaticMarkup(<HelpTip>Explanation.</HelpTip>)).toContain("aria-label=\"Show explanation\"");
  });

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

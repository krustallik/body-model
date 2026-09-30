import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const localeMock = vi.hoisted(() => ({ value: "uk" as "uk" | "en" }));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: localeMock.value }),
}));

import { HelpTip } from "@/components/help-tip";

const helpTipCss = readFileSync(resolve(process.cwd(), "src/components/help-tip.module.css"), "utf8");

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

  it("keeps a 24px control and expands coarse-pointer target to 44px without enlarging the glyph", () => {
    const triggerRule = helpTipCss.match(/\.trigger\s*\{([^}]*)\}/)?.[1] ?? "";
    const coarsePointerRule = helpTipCss.match(/@media\s*\(pointer:\s*coarse\)\s*\{\s*\.trigger::before\s*\{([^}]*)\}\s*\}/)?.[1] ?? "";

    expect(triggerRule).toMatch(/width:\s*24px/);
    expect(triggerRule).toMatch(/height:\s*24px/);
    expect(triggerRule).toMatch(/font:\s*700\s*\.78rem\/1/);
    expect(coarsePointerRule).toMatch(/width:\s*44px/);
    expect(coarsePointerRule).toMatch(/height:\s*44px/);
    expect(coarsePointerRule).toMatch(/position:\s*absolute/);
    expect(coarsePointerRule).toMatch(/pointer-events:\s*auto/);
  });
});

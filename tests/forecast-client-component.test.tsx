import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

import { ForecastClient } from "@/app/forecast/forecast-client";
import { noActiveModelPresentation } from "@/modules/model-forecast/forecast-ui";

describe("ForecastClient", () => {
  it("renders the complete initial control surface and honest loading state", () => {
    const html = renderToStaticMarkup(<ForecastClient />);
    expect(html).toContain("See the range, not just a line.");
    expect(html).toContain("As lately");
    expect(html).toContain("Exact daily plan");
    expect(html).toContain("Plan with small drift");
    expect(html).toContain("Calculating possible weight paths");
    expect(html).toContain("href=\"/forecast\"");
    expect(html).toContain("do it here");
  });

  it("keeps start-model wording available for the missing-episode empty state", () => {
    const copy = noActiveModelPresentation("uk");
    expect(copy.primaryAction).toBe("Запустити модель");
    expect(copy.detail).toMatch(/Модель ще не рахувала/);
  });

  it("shows a visible recalculate control on the initial forecast surface", () => {
    const html = renderToStaticMarkup(<ForecastClient />);
    expect(html).toContain("Recalculate model");
    expect(html).toContain("Takes health-table rows, saves calculated days, and automatically estimates state after a data gap when needed.");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

import { ForecastClient } from "@/app/forecast/forecast-client";

describe("ForecastClient", () => {
  it("renders the complete initial control surface and honest loading state", () => {
    const html = renderToStaticMarkup(<ForecastClient />);
    expect(html).toContain("See the range, not just a line.");
    expect(html).toContain("Recent routine");
    expect(html).toContain("Exact daily plan");
    expect(html).toContain("Flexible plan");
    expect(html).toContain("Building a distribution of possible paths");
    expect(html).toContain("href=\"/forecast\"");
  });
});

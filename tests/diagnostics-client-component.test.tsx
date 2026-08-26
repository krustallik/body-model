import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

import { DiagnosticsClient } from "@/app/diagnostics/diagnostics-client";

describe("DiagnosticsClient", () => {
  it("renders an honest multi-dimensional loading surface and navigation", () => {
    const html = renderToStaticMarkup(<DiagnosticsClient />);
    expect(html).toContain("What the model knows—and what it does not.");
    expect(html).toContain("There is no universal score");
    expect(html).toContain("Loading model status");
    expect(html).toContain("href=\"/diagnostics\"");
  });
});


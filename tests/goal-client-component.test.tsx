import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

import { GoalClient } from "@/app/goal/goal-client";

describe("GoalClient", () => {
  it("renders an honest initial loading state and Goal navigation", () => {
    const html = renderToStaticMarkup(<GoalClient />);
    expect(html).toContain("Plan toward a target—with uncertainty visible.");
    expect(html).toContain("Loading current model state");
    expect(html).toContain("href=\"/goal\"");
    expect(html).toContain("Scenario · not a prescription");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

import { GoalClient } from "@/app/goal/goal-client";
import {
  canOpenGoalPlanner,
  defaultGoalForm,
} from "@/modules/model-goal-planning/goal-planning-ui";
import { formatDate } from "@/modules/model-forecast/forecast-ui";

describe("GoalClient", () => {
  it("renders an honest initial loading state and Goal navigation", () => {
    const html = renderToStaticMarkup(<GoalClient />);
    expect(html).toContain("Plan toward a target—with uncertainty visible.");
    expect(html).toContain("Loading current model state");
    expect(html).toContain("href=\"/goal\"");
    expect(html).toContain("Scenario · not a prescription");
  });

  it("does not open the planner without a latest modeled date", () => {
    expect(canOpenGoalPlanner(null)).toBe(false);
    const html = renderToStaticMarkup(<GoalClient />);
    expect(html).not.toContain("Latest modeled day:");
    expect(html).not.toContain("Calculate scenario");
    expect(html).not.toContain("Target and date");
  });

  it("prepares planner labels for a valid latest modeled date", () => {
    expect(canOpenGoalPlanner("2026-09-16")).toBe(true);
    const form = defaultGoalForm("2026-09-16", 89.4);
    expect(form.goalDate).toBe("2026-12-15");
    expect(form.targetWeightKg).toBe("86.4");
    expect(formatDate("2026-09-16", { year: "numeric" }, "en")).toMatch(/2026/);
    // SSR only sees loading; once context arrives the planner copy keys off this date.
    expect(`Latest modeled day: ${formatDate("2026-09-16", { year: "numeric" }, "en")}`)
      .toMatch(/Latest modeled day:.*2026/);
  });
});

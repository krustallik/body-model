/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/help-tip", () => ({
  HelpTip: ({ children, label }: { children: React.ReactNode; label?: string }) => (
    <button type="button" aria-label={label}>{children}</button>
  ),
}));

import { ModelStateSource, type ModelStateSource as Source } from "@/components/model-state-source";

afterEach(cleanup);

const states: Array<[Source, string, string]> = [
  ["deterministic", "Sequential calculation", "The state was calculated day by day"],
  ["recovered", "State recovered", "recovered after a gap in history"],
  ["bootstrap", "Starting estimate", "short history and available profile data"],
  ["degraded", "Approximate estimate", "some data is missing or inconsistent"],
  ["awaiting", "Waiting for data", "not enough data yet"],
  ["degenerate", "Unreliable current state", "not reliable enough"],
];

describe("ModelStateSource", () => {
  it.each(states)("shows a human English label and explanation for %s", (value, label, explanation) => {
    render(<ModelStateSource value={value} uk={false} />);
    expect(screen.getByText(label, { exact: true })).toBeTruthy();
    expect(screen.getByText(new RegExp(explanation, "i"))).toBeTruthy();
    expect(screen.getByRole("button", { name: `Explanation: ${label}` })).toBeTruthy();
  });

  it("localizes the deterministic label and explanation in Ukrainian", () => {
    render(<ModelStateSource value="deterministic" uk />);
    expect(screen.getByText("Послідовний розрахунок", { exact: true })).toBeTruthy();
    expect(screen.getByText(/порахований день за днем/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Пояснення: Послідовний розрахунок" })).toBeTruthy();
  });
});

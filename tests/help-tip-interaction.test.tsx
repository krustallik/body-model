/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpTip } from "@/components/help-tip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HelpTip interactions", () => {
  it("opens from keyboard activation on desktop and closes with Escape", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const user = userEvent.setup();
    render(<HelpTip label="Explain target">The solver searches within these bounds.</HelpTip>);
    const trigger = screen.getByRole("button", { name: "Explain target" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tooltip").textContent).toMatch(/solver searches/);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles on touch/mobile and closes when tapping outside", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    render(<><HelpTip label="Explain target">Mobile help text.</HelpTip><button type="button">Outside</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Explain target" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Mobile help text.");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

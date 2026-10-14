/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "en", intlLocale: "en-US" }) }));

import { WorkCategoryHelper } from "@/components/work-category-helper";

describe("WorkCategoryHelper", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    } });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.restoreAllMocks();
  });

  it("asks sequential work questions and returns only an existing category", async () => {
    const onRecommend = vi.fn();
    const user = userEvent.setup();
    render(<WorkCategoryHelper onRecommend={onRecommend} />);
    await user.click(screen.getByRole("button", { name: "Help me choose a level" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("How much do you move during most of a typical shift?")));

    const nextQuestions = [
      "Which work positions best describe most of the shift?",
      "How physically demanding are the repeated tasks?",
      "What do you usually carry, push, or pull?",
    ];
    for (const [index, answer] of [
      "Mostly in one place",
      "Mostly stable standing or light hand tasks",
      "Little effort beyond standing and light movement",
      "None or occasional light items",
    ].entries()) {
      await user.click(screen.getByRole("radio", { name: answer }));
      await user.click(screen.getByRole("button", { name: "Next" }));
      if (index < nextQuestions.length) {
        await waitFor(() => expect(document.activeElement).toBe(screen.getByText(nextQuestions[index])));
      }
    }

    expect(screen.getByRole("heading", { name: "Very light / mostly waiting" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Very light / mostly waiting" })));
    await user.click(screen.getByRole("button", { name: "Use recommendation" }));
    expect(onRecommend).toHaveBeenCalledExactlyOnceWith("standingLight");
    expect(onRecommend.mock.calls[0]).toHaveLength(1);
  });

  it("does not recommend a level for an uncertain shift", async () => {
    const onRecommend = vi.fn();
    const user = userEvent.setup();
    render(<WorkCategoryHelper onRecommend={onRecommend} />);
    await user.click(screen.getByRole("button", { name: "Help me choose a level" }));

    for (const answer of [
      "It varies or I am not sure",
      "Mostly stable standing or light hand tasks",
      "Little effort beyond standing and light movement",
      "None or occasional light items",
    ]) {
      await user.click(screen.getByRole("radio", { name: answer }));
      await user.click(screen.getByRole("button", { name: "Next" }));
    }

    expect(screen.getByRole("heading", { name: "No clear recommendation" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "No clear recommendation" })));
    expect(onRecommend).not.toHaveBeenCalled();
  });
});

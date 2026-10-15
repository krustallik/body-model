/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "en", intlLocale: "en-US" }) }));

import { WorkActivityDialog } from "@/app/history/work-activity-dialog";

function WorkDialogHarness() {
  const [open, setOpen] = useState(true);
  return open
    ? <WorkActivityDialog date="2026-10-14" onClose={() => setOpen(false)} />
    : <p>Parent closed</p>;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("WorkActivityDialog nested category helper", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    } });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/v1/work-intervals") && init?.method === "POST") return response({ interval: {} }, 201);
      if (url.startsWith("/api/v1/work-intervals")) return response({ intervals: [] });
      if (url.startsWith("/api/v1/work-activity")) return response({});
      return response({ error: "unexpected" }, 500);
    }));
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the parent draft open when a recommendation closes and applies only the category", async () => {
    const fetchMock = vi.mocked(fetch);
    const user = userEvent.setup();
    render(<WorkDialogHarness />);
    await waitFor(() => expect(screen.getByText("No work activity recorded for this day.")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Add work interval" }));
    await user.clear(screen.getByLabelText("Start"));
    await user.type(screen.getByLabelText("Start"), "09:15");
    await user.clear(screen.getByLabelText("End"));
    await user.type(screen.getByLabelText("End"), "18:00");
    const breakInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    await user.clear(breakInput);
    await user.type(breakInput, "45");

    await user.click(screen.getByRole("button", { name: "Help me choose a level" }));
    for (const answer of [
      "Mostly in one place",
      "Mostly stable standing or light hand tasks",
      "Little effort beyond standing and light movement",
      "None or occasional light items",
    ]) {
      await user.click(screen.getByRole("radio", { name: answer }));
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    await user.click(screen.getByRole("button", { name: "Use recommendation" }));

    expect(screen.queryByText("Parent closed")).toBeNull();
    const parentDialog = Array.from(document.querySelectorAll("dialog")).find((dialog) => dialog.className.includes("workDialog"));
    expect(parentDialog?.hasAttribute("open")).toBe(true);
    expect((screen.getByLabelText("Work between detected walking and break") as HTMLSelectElement).value).toBe("standingLight");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("09:15");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("18:00");
    expect(breakInput.value).toBe("45");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Save interval" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1];
    expect(JSON.parse(String(post?.body))).toMatchObject({
      date: "2026-10-14", startTime: "09:15", endTime: "18:00", breakMinutes: 45, category: "standingLight",
    });
  });

  it("lets the parent cancel the helper without applying its recommendation", async () => {
    const user = userEvent.setup();
    render(<WorkDialogHarness />);
    await waitFor(() => expect(screen.getByText("No work activity recorded for this day.")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Add work interval" }));
    await user.click(screen.getByRole("button", { name: "Help me choose a level" }));
    const childDialog = document.querySelector("dialog[aria-labelledby='work-category-helper-title']")!;
    await act(async () => { fireEvent(childDialog, new Event("cancel", { bubbles: false, cancelable: true })); });
    expect(screen.queryByText("Parent closed")).toBeNull();
    expect((screen.getByLabelText("Work between detected walking and break") as HTMLSelectElement).value).toBe("manualLight");
  });
});

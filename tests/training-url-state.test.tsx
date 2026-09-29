/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseTrainingPage, updateTrainingSearchParams, useTrainingSearchParam } from "@/app/training/training-url-state";

describe("Training URL state", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("reads direct page URLs, accepts page 1, and normalizes invalid page values", () => {
    window.history.replaceState(null, "", "/training?recentPage=3");
    expect(parseTrainingPage(new URLSearchParams(window.location.search).get("recentPage"))).toBe(3);
    expect(parseTrainingPage("1")).toBe(1);
    expect(parseTrainingPage("0")).toBe(1);
    expect(parseTrainingPage("2x")).toBe(1);
    expect(parseTrainingPage("9007199254740992")).toBe(1);
  });

  it("updates only subscribers whose URL parameter changed and preserves unrelated parameters", async () => {
    const renders = { page: 0, stepper: 0, filter: 0, shell: 0 };
    function Probe({ name, param }: { name: "page" | "stepper" | "filter"; param: string }) {
      renders[name] += 1;
      const { value } = useTrainingSearchParam(param);
      return <output aria-label={name}>{value ?? "unset"}</output>;
    }
    function Shell() {
      renders.shell += 1;
      return (
        <main>
          <Probe name="page" param="recentPage" />
          <Probe name="stepper" param="stepperPage" />
          <Probe name="filter" param="onlyMissingDiary" />
        </main>
      );
    }

    window.history.replaceState(null, "", "/training?stepperPage=2&onlyMissingDiary=true");
    render(<Shell />);
    await act(async () => {});
    renders.page = 0;
    renders.stepper = 0;
    renders.filter = 0;
    renders.shell = 0;
    expect(screen.getByLabelText("page").textContent).toBe("unset");
    expect(screen.getByLabelText("stepper").textContent).toBe("2");
    expect(renders).toEqual({ page: 0, stepper: 0, filter: 0, shell: 0 });

    act(() => updateTrainingSearchParams({ recentPage: "3" }));
    expect(window.location.search).toBe("?stepperPage=2&onlyMissingDiary=true&recentPage=3");
    expect(screen.getByLabelText("page").textContent).toBe("3");
    expect(renders).toEqual({ page: 1, stepper: 0, filter: 0, shell: 0 });

    act(() => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    act(() => updateTrainingSearchParams({ recentPage: null }, true));
    expect(window.location.search).toBe("?stepperPage=2&onlyMissingDiary=true");
    expect(screen.getByLabelText("page").textContent).toBe("unset");
    expect(screen.getByLabelText("stepper").textContent).toBe("2");
    expect(renders.shell).toBe(0);
  });
});

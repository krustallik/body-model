/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { ExercisePicker } from "@/app/training/exercise-picker";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import type { ExerciseCatalogDto } from "@/modules/training/training.types";

vi.mock("next/image", () => ({
  default: () => <span aria-hidden="true" />,
}));

const exercises: ExerciseCatalogDto[] = CANONICAL_EXERCISE_IDENTITIES.map((exercise, index) => ({
  id: index + 1,
  name: exercise.displayName,
  stableKey: exercise.stableKey,
  isActive: true,
  archivedAt: null,
  muscleMapping: null,
}));

function renderPicker(overrides: Partial<ComponentProps<typeof ExercisePicker>> = {}) {
  const onSelect = vi.fn();
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open picker</button>
        {open && (
          <ExercisePicker
            open
            exercises={exercises}
            uk
            selectedId={selectedId}
            onSelect={(exercise) => { onSelect(exercise); setSelectedId(exercise.id); }}
            onConfirm={onConfirm}
            onClose={() => { onClose(); setOpen(false); }}
            confirmLabel="Додати вправу"
            {...overrides}
          />
        )}
      </>
    );
  }
  render(<Harness />);
  return { onSelect, onConfirm, onClose, trigger: screen.getByRole("button", { name: "Open picker" }) };
}

describe("ExercisePicker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.style.overflow = "";
  });

  it("opens with muscle groups, drills into arms and triceps, then confirms a selection", async () => {
    const user = userEvent.setup();
    const { onSelect, onConfirm } = renderPicker();
    await user.click(screen.getByRole("button", { name: "Open picker" }));
    expect(screen.getByRole("dialog", { name: "Каталог вправ" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Руки/ }));
    await user.click(screen.getByRole("button", { name: /^Трицепс\s*12$/ }));
    const exerciseButton = screen.getByRole("button", { name: /Французький жим однією рукою з-за голови сидячи/ });
    await user.click(exerciseButton);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ stableKey: "overhead_single_arm_dumbbell_triceps_extension_seated_90" }));
    await user.click(screen.getByRole("button", { name: "Додати вправу" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("searches all categories by English alias and keeps explicit load hints visible", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "Open picker" }));
    await user.type(screen.getByRole("searchbox", { name: "Пошук усіх вправ" }), "romanian deadlift");
    expect(screen.getByRole("button", { name: /Румунська тяга/ })).toBeTruthy();

    const search = screen.getByPlaceholderText("Пошук вправ…");
    await user.clear(search);
    await user.type(search, "knee push up floor");
    expect(screen.getByText("Вага тіла · частка не задана")).toBeTruthy();
  });

  it("supports loading/error states, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    const { onClose, trigger } = renderPicker({ loading: true, error: "Could not load catalog." });
    await user.click(trigger);
    expect(screen.getByRole("status").textContent).toContain("Завантаження каталогу");
    expect(screen.getByRole("alert").textContent).toContain("Could not load catalog.");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });
});

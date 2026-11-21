/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { ExercisePicker } from "@/app/training/exercise-picker";
import { resolveExercisePickerMovement, useExercisePickerOpenFromUrl } from "@/app/training/exercise-picker-url-state";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import type { ExerciseCatalogDto } from "@/modules/training/training.types";

vi.mock("next/image", () => ({
  default: ({ unoptimized = false }: { unoptimized?: boolean }) => (
    <span aria-hidden="true" data-testid="exercise-picker-image" data-unoptimized={String(unoptimized)} />
  ),
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
    window.history.replaceState(window.history.state, "", "/");
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

  it("renders local exercise images without the broken Next image optimization route", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "Open picker" }));

    const categoryImages = screen.getAllByTestId("exercise-picker-image");
    expect(categoryImages).toHaveLength(7);
    expect(categoryImages.every((image) => image.getAttribute("data-unoptimized") === "true")).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Ноги/ }));
    const movementImages = screen.getAllByTestId("exercise-picker-image");
    expect(movementImages.length).toBeGreaterThan(0);
    expect(movementImages.every((image) => image.getAttribute("data-unoptimized") === "true")).toBe(true);
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
    await user.click(screen.getByRole("button", { name: "Закрити каталог" }));
    await user.click(screen.getByRole("button", { name: "Open picker" }));
    await user.click(screen.getByRole("button", { name: "Очистити пошук" }));
    await user.click(screen.getByRole("button", { name: /^Ноги/ }));
    await user.type(screen.getByPlaceholderText("Пошук вправ…"), "knee push up floor");
    expect(screen.getByRole("button", { name: "Вага тіла" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Штанга" })).toBeNull();
  });

  it("limits equipment choices to the selected muscle group and restores picker filters from the URL", async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: /^Ноги/ }));

    expect(screen.getByRole("button", { name: "Гантелі" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "EZ-гриф" })).toBeNull();
    expect(new URL(window.location.href).searchParams.get("exercisePickerCategory")).toBe("legs");

    await user.click(screen.getByRole("button", { name: "Блок" }));
    expect(screen.getByRole("button", { name: /Згинання ніг із нижнім блоком/ })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("exercisePickerEquipment")).toBe("cable");

    await user.click(screen.getByRole("button", { name: "Закрити каталог" }));
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Блок" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Згинання ніг із нижнім блоком/ })).toBeTruthy();
  });

  it("restores open state, filters, search, and selected movement after loading from a saved URL", () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/training/programs/new?exercisePicker=1&exercisePickerCategory=legs&exercisePickerSubcategory=all&exercisePickerEquipment=cable&exercisePickerSearch=leg%20curl&exercisePickerMovement=cable_leg_curl",
    );

    function UrlHarness() {
      const open = useExercisePickerOpenFromUrl();
      const movement = resolveExercisePickerMovement(
        exercises,
        new URL(window.location.href).searchParams.get("exercisePickerMovement"),
      );
      return (
        <ExercisePicker
          open={open}
          exercises={exercises}
          uk
          selectedId={movement?.id ?? null}
          onSelect={() => undefined}
          onConfirm={() => undefined}
          onClose={() => undefined}
          confirmLabel="Додати вправу"
        />
      );
    }

    render(<UrlHarness />);

    expect(screen.getByRole("dialog", { name: "Результати пошуку" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Пошук вправ…") as HTMLInputElement).value).toBe("leg curl");
    expect(screen.getByRole("button", { name: "Блок" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Згинання ніг із нижнім блоком/ }).getAttribute("aria-pressed")).toBe("true");
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

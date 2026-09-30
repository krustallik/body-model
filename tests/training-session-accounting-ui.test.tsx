/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionAccountingPanel } from "@/app/training/session-accounting-panel";
import { ExerciseLoadConfigEditor } from "@/app/training/exercise-load-config-editor";
import { RESISTANCE, SESSION_STATUS } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import type {
  ConfigProvenanceV1,
  LoadAccountingBreakdownContributionV1,
  LoadMetricV1,
} from "@/modules/training/load-accounting-v1";

type MetricUnit = "kg-repetitions" | "nominal-kg-repetitions-per-logged-side" | "nominal-kg-repetitions-per-side" | "sets" | "repetitions" | "bodyweight-reference-kg-repetitions";
function metric<Unit extends MetricUnit = "kg-repetitions">(
  value: number | null,
  unit: Unit = "kg-repetitions" as Unit,
): LoadMetricV1<Unit> {
  return {
    value,
    unit,
    availability: value === null ? "unavailable" as const : "available" as const,
    coverage: { eligibleRows: value === null ? 1 : 2, accountedRows: value === null ? 0 : 2, omittedRows: value === null ? 1 : 0, omittedReasons: {} },
    provenance: [],
  };
}

function session(overrides: Partial<StrengthSessionDto> = {}): StrengthSessionDto {
  return {
    id: 42,
    status: SESSION_STATUS.COMPLETED,
    entryMode: "RETROSPECTIVE",
    revision: 3,
    programId: 7,
    programName: "Pull",
    programVersionId: 9,
    programVersionNumber: 2,
    webStartedAt: null,
    webEndedAt: null,
    matchStatus: "UNMATCHED",
    matchMethod: null,
    matchedAt: null,
    matchedWorkoutId: null,
    matchedWorkout: null,
    exercises: [],
    ordinaryTonnageKg: 300,
    createdAt: "2026-09-10T16:00:00.000Z",
    updatedAt: "2026-09-10T16:00:00.000Z",
    materializationState: "current",
    loadAccountingV1: {
      methodVersion: "bodycast-load-accounting-v1",
      externalLoadVolume: metric(4667),
      bandNominalIndex: {
        perLoggedSide: metric(2770.2, "nominal-kg-repetitions-per-logged-side"),
        leftSide: metric(null, "nominal-kg-repetitions-per-side"),
        rightSide: metric(null, "nominal-kg-repetitions-per-side"),
      },
      bodyweight: {
        sets: metric(4, "sets"),
        repetitions: metric(87, "repetitions"),
        referenceVolume: metric(6960, "bodyweight-reference-kg-repetitions"),
        reference: { status: "observed", valueKg: 80, localDate: "2026-09-10", source: "apple-health-shortcut", sourceId: "internal-sample-id" },
      },
      additionalLoad: metric(180),
      assistanceLoad: metric(120),
      identityCoverage: { customExercises: 0, ambiguousExercises: 0, unverifiedExercises: 0 },
    },
    loadAccountingBreakdown: {
      status: "available",
      value: {
        schemaVersion: "bodycast-load-accounting-breakdown-v1",
        accountingMethodVersion: "bodycast-load-accounting-v1",
        rows: [{
          accountingMethodVersion: "bodycast-load-accounting-v1",
          sessionId: 42,
          sessionExerciseId: 2,
          exerciseOrder: 0,
          exerciseName: "Pull-up",
          stableKey: "pull_up",
          identityStatus: "canonical-snapshot",
          strengthSetId: 8,
          setNumber: 1,
          scalarReps: 12,
          effectiveReps: 22,
          asymmetricReps: { left: 12, right: 10 },
          enteredLoad: { externalKg: 10, bandNominalKg: null },
          config: {
            sourceSnapshot: null,
            resolved: null,
            effective: null,
            provenance: { kind: "session-snapshot", version: "private-v", stableKey: "pull_up" },
            resolution: "resolved",
            unavailableReason: null,
          },
          override: { snapshot: null, status: "absent" },
          mechanics: { inventoryCount: 2, loadedSides: 2, execution: "simultaneous", implementsPerMovement: null, effectiveMultiplier: 2 },
          contributions: [{
            category: "externalLoadVolume",
            basis: "per-implement-kg",
            unit: "kg-repetitions",
            value: 220,
            effectiveMultiplier: 1,
            availability: "available",
            unavailableReason: null,
            provenance: [{ kind: "session-snapshot", version: "private-v", stableKey: "pull_up" }],
          }],
        }, {
          accountingMethodVersion: "bodycast-load-accounting-v1",
          sessionId: 42,
          sessionExerciseId: 3,
          exerciseOrder: 1,
          exerciseName: "Bodyweight squat",
          stableKey: "bodyweight_squat",
          identityStatus: "canonical-snapshot",
          strengthSetId: 9,
          setNumber: 1,
          scalarReps: 12,
          effectiveReps: 12,
          asymmetricReps: null,
          enteredLoad: { externalKg: null, bandNominalKg: null },
          config: {
            sourceSnapshot: null,
            resolved: null,
            effective: null,
            provenance: { kind: "legacy-interpretation", version: "legacy-rule-private", stableKey: "bodyweight_squat" },
            resolution: "resolved",
            unavailableReason: null,
          },
          override: { snapshot: null, status: "absent" },
          mechanics: { inventoryCount: 1, loadedSides: 1, execution: "unilateral", implementsPerMovement: null, effectiveMultiplier: 1 },
          contributions: [{
            category: "bodyweightReferenceVolume",
            basis: "bodyweight-reference",
            unit: "bodyweight-reference-kg-repetitions",
            value: 960,
            effectiveMultiplier: 1,
            availability: "available",
            unavailableReason: null,
            provenance: [
              { kind: "legacy-interpretation", version: "legacy-rule-private", stableKey: "bodyweight_squat" },
              { kind: "bodyweight-observation", version: "apple-health-shortcut", sourceId: "private-weight-sample-id", localDate: "2026-09-10" },
            ],
          }],
        }],
      },
    },
    ...overrides,
  };
}

function sessionWithMassContribution(input: {
  provenance: ConfigProvenanceV1[];
  availability?: "available" | "unavailable";
  unavailableReason?: LoadAccountingBreakdownContributionV1["unavailableReason"];
  value?: number | null;
}): StrengthSessionDto {
  const base = session();
  const breakdown = base.loadAccountingBreakdown;
  if (!breakdown || breakdown.status !== "available") throw new Error("expected V2 test breakdown");
  const contribution: LoadAccountingBreakdownContributionV1 = {
    category: "bodyweightReferenceVolume",
    basis: "bodyweight-reference",
    unit: "bodyweight-reference-kg-repetitions",
    value: input.value === undefined ? 960 : input.value,
    effectiveMultiplier: 1,
    availability: input.availability ?? "available",
    unavailableReason: input.unavailableReason ?? null,
    provenance: input.provenance,
  };
  const rows = breakdown.value.rows.map((row) => row.strengthSetId === 9
    ? { ...row, contributions: [contribution] }
    : row);
  return {
    ...base,
    loadAccountingBreakdown: { status: "available", value: { ...breakdown.value, rows } },
  };
}

describe("persisted session accounting UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders only the three persisted load categories and hides side-specific UI", async () => {
    const user = userEvent.setup();
    render(<SessionAccountingPanel session={session()} uk onRefresh={() => undefined} />);
    expect(screen.getByText("4 667")).toBeTruthy();
    expect(screen.getByText(/2\s770,2/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Зовнішнє навантаження" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Резинки" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Власна вага" })).toBeTruthy();
    expect(screen.queryByText(/ліва сторона|права сторона|left side|right side|logged side/i)).toBeNull();
    expect(screen.queryByText(/Підходи з власною вагою|Повторення з власною вагою|Bodyweight sets|Bodyweight repetitions/i)).toBeNull();
    expect(screen.queryByText(/Додаткова вага|Допоміжне навантаження|Added load|Assistance load/i)).toBeNull();
    expect(screen.queryByText(/Загальний обсяг|Mixed total/i)).toBeNull();
    expect(screen.getByText(/Точне вимірювання 2026-09-10/)).toBeTruthy();
    await user.click(screen.getByText(/Деталі за вправами/));
    expect(screen.getByText("Pull-up")).toBeTruthy();
    expect(screen.getAllByText("12")).toHaveLength(2);
    expect(screen.queryByText(/ліворуч|праворуч|left|right/i)).toBeNull();
    expect(screen.getByText("220 kg × reps")).toBeTruthy();
    expect(screen.getByText(/Точне вимірювання маси · дата вимірювання 2026-09-10/)).toBeTruthy();
    expect(screen.queryByText(/No eligible historical measurement or estimate/)).toBeNull();
    expect(screen.queryByText("private-v")).toBeNull();
    expect(screen.queryByText("internal-sample-id")).toBeNull();
    expect(screen.queryByText("private-weight-sample-id")).toBeNull();
    expect(screen.queryByText("legacy-rule-private")).toBeNull();
  });
  it("shows bodyweight contribution provenance for exact, nearest, as-of, and unavailable values", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SessionAccountingPanel session={session()} uk={false} />);
    const ensureBreakdownOpen = async () => {
      const summary = screen.getByText(/Exercise and set details/);
      if (!summary.closest("details")?.open) await user.click(summary);
    };
    await ensureBreakdownOpen();
    expect(screen.getByText(/Exact bodyweight measurement · measured 2026-09-10/)).toBeTruthy();

    rerender(<SessionAccountingPanel uk={false} session={sessionWithMassContribution({
      provenance: [
        { kind: "legacy-interpretation", version: "private-config-v", stableKey: "bodyweight_squat" },
        { kind: "bodyweight-observation", version: "apple-health-shortcut-nearest-v2", sourceId: "private-sample-id", localDate: "2026-09-08" },
      ],
    })} />);
    await ensureBreakdownOpen();
    expect(screen.getByText(/Approximate bodyweight measurement · measured 2026-09-08/)).toBeTruthy();

    rerender(<SessionAccountingPanel uk={false} session={sessionWithMassContribution({
      provenance: [
        { kind: "legacy-interpretation", version: "private-config-v", stableKey: "bodyweight_squat" },
        { kind: "bodycast-as-of-model", version: "private-model-v", sourceId: "private-episode-id", localDate: "2026-09-10", uncertaintyStatus: "reported" },
      ],
    })} />);
    await ensureBreakdownOpen();
    expect(screen.getByText(/Model estimate as of 2026-09-10 · uncertainty reported/)).toBeTruthy();
    expect(screen.queryByText("private-model-v")).toBeNull();
    expect(screen.queryByText("private-episode-id")).toBeNull();

    rerender(<SessionAccountingPanel uk={false} session={sessionWithMassContribution({
      availability: "unavailable",
      unavailableReason: "missing-bodyweight-reference",
      value: null,
      provenance: [{ kind: "legacy-interpretation", version: "private-config-v", stableKey: "bodyweight_squat" }],
    })} />);
    await ensureBreakdownOpen();
    expect(screen.getByText(/No eligible historical measurement or estimate/)).toBeTruthy();
    expect(screen.getByText("Unavailable · bodyweight reference is unavailable")).toBeTruthy();
  });

  it("shows approximate observation date and never formats unavailable mass as zero", () => {
    const approximate = session({
      loadAccountingV1: {
        ...session().loadAccountingV1!,
        bodyweight: {
          ...session().loadAccountingV1!.bodyweight,
          reference: { status: "nearest-observed", valueKg: 79.5, localDate: "2026-09-10", observationLocalDate: "2026-09-08", dayOffset: -2, approximate: true, source: "apple-health-shortcut", sourceId: "id" },
        },
      },
    });
    const { rerender } = render(<SessionAccountingPanel session={approximate} uk />);
    expect(screen.getByText(/Приблизно, вимірювання 2026-09-08/)).toBeTruthy();
    rerender(<SessionAccountingPanel session={session({ loadAccountingV1: {
      ...session().loadAccountingV1!,
      bodyweight: { ...session().loadAccountingV1!.bodyweight, reference: { status: "model-estimated", valueKg: 80.2, localDate: "2026-09-10", source: "bodycast-as-of-model", sourceId: "private-model-id", modelVersion: "private-model-v", uncertainty: null } },
    } })} uk />);
    expect(screen.getByText(/Оцінка «на дату» 2026-09-10/)).toBeTruthy();
    expect(screen.queryByText("private-model-v")).toBeNull();
    rerender(<SessionAccountingPanel session={session({ loadAccountingV1: {
      ...session().loadAccountingV1!,
      bodyweight: { ...session().loadAccountingV1!.bodyweight, reference: { status: "unavailable", valueKg: null, localDate: "2026-09-10", source: null, sourceId: null }, referenceVolume: metric(null, "bodyweight-reference-kg-repetitions") },
    } })} uk />);
    expect(screen.getByText(/Історичний референс маси недоступний/)).toBeTruthy();
    expect(screen.getByText("Немає значення")).toBeTruthy();
    expect(screen.queryByText("0 кг")).toBeNull();
  });

  it("handles missing, pending, stale, and legacy snapshots without presenting stale values as current", async () => {
    const onMaterialize = vi.fn();
    const onRefresh = vi.fn();
    const { rerender } = render(<SessionAccountingPanel session={session({ materializationState: "missing", loadAccountingV1: undefined, loadAccountingBreakdown: undefined })} uk onMaterialize={onMaterialize} onRefresh={onRefresh} />);
    expect(screen.getAllByText("Знімок ще не створено")).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole("button", { name: "Створити знімок обліку" }));
    expect(onMaterialize).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();

    rerender(<SessionAccountingPanel session={session({ materializationState: "pending" })} uk onRefresh={onRefresh} />);
    expect(screen.getAllByText("Облік очікує завершення")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /облік|знімок/i })).toBeNull();

    rerender(<SessionAccountingPanel session={session({ materializationState: "stale" })} uk onRefresh={onRefresh} />);
    expect(screen.getAllByText("Знімок застарів після змін")).toHaveLength(2);
    expect(screen.queryByText("4 667")).toBeNull();
    expect(screen.getByRole("button", { name: "Оновити облік" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Оновити облік" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<SessionAccountingPanel session={session({ loadAccountingBreakdown: { status: "unavailable", reason: "legacy-snapshot-no-breakdown" } })} uk />);
    expect(screen.getByText(/Підсумки цього старого знімка/)).toBeTruthy();
    expect(screen.getByText("4 667")).toBeTruthy();
    expect(screen.queryByText(/Деталі за вправами/)).toBeNull();

    rerender(<SessionAccountingPanel session={session({ materializationState: "current", loadAccountingV1: undefined })} uk onRefresh={onRefresh} />);
    expect(screen.getAllByText("Не вдалося прочитати знімок обліку")).toHaveLength(2);
    expect(screen.queryByText(/Підходи з власною вагою/)).toBeNull();
  });

  it("offers plain-language catalog load configuration and calls the existing PATCH contract", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExerciseLoadConfigEditor catalogId={15} configuration={null} resistanceType={RESISTANCE.EXTERNAL_WEIGHT} uk onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Як враховувати навантаження" }));
    expect(screen.getByLabelText("Як введена вага відповідає руху")).toBeTruthy();
    expect(screen.getByText(/Збережені тренування зберігають власні історичні налаштування/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Зберегти правило" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/training/exercises/15/load-accounting", expect.objectContaining({ method: "PATCH" }));
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("PATCH request was not recorded");
    const init = firstCall[1];
    if (!init) throw new Error("PATCH request was missing options");
    expect(JSON.parse(String(init.body)).loadAccountingConfig).toMatchObject({
      accountingKind: "external-per-implement-per-side",
      resistanceType: "external",
      loadInput: "per-implement-kg",
      repsMeaning: "per-side",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Як враховувати навантаження" }));
    await user.selectOptions(screen.getByLabelText("Як введена вага відповідає руху"), "external-whole-setup");
    await user.click(screen.getByRole("button", { name: "Зберегти правило" }));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).loadAccountingConfig).toMatchObject({
      accountingKind: "external-complete-setup-per-movement",
      resistanceType: "external",
      loadInput: "complete-setup-kg",
      repsMeaning: "per-movement",
    });
  });

  it("offers band nominal and bodyweight reference setups with user-readable choices", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (...args) => {
      requests.push(String(args[1]?.body));
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<ExerciseLoadConfigEditor catalogId={16} configuration={null} resistanceType={RESISTANCE.RESISTANCE_BAND} uk onSaved={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Як враховувати навантаження" }));
    expect(screen.getByLabelText("Як введена вага відповідає руху")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Як введена вага відповідає руху"), "band-each-side");
    await user.click(screen.getByRole("button", { name: "Зберегти правило" }));
    await screen.findByRole("button", { name: "Як враховувати навантаження" });
    expect(JSON.parse(requests[0]!).loadAccountingConfig).toMatchObject({
      accountingKind: "band-nominal-per-side",
      resistanceType: "band-nominal",
      loadInput: "nominal-kg-per-logged-side",
      repsMeaning: "per-side",
    });

    unmount();
    const { unmount: unmountBodyweight } = render(<ExerciseLoadConfigEditor catalogId={17} configuration={null} resistanceType={RESISTANCE.BODYWEIGHT} uk onSaved={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Як враховувати навантаження" }));
    await user.selectOptions(screen.getByLabelText("Як введена вага відповідає руху"), "bodyweight-per-side");
    await user.clear(screen.getByLabelText("Частка маси для цього руху"));
    await user.type(screen.getByLabelText("Частка маси для цього руху"), "0.7");
    await user.click(screen.getByRole("button", { name: "Зберегти правило" }));
    expect(JSON.parse(requests[1]!).loadAccountingConfig).toMatchObject({
      accountingKind: "bodyweight-reference-per-side",
      resistanceType: "bodyweight",
      loadInput: "bodyweight-reference",
      repsMeaning: "per-side",
      bodyweightFraction: 0.7,
    });
    expect(screen.queryByText(/band-nominal|bodyweight-reference|per-side/)).toBeNull();

    unmountBodyweight();
    render(<ExerciseLoadConfigEditor catalogId={18} configuration={null} resistanceType={RESISTANCE.BODYWEIGHT} stableKey="pushup_handles" uk onSaved={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Як враховувати навантаження" }));
    expect(screen.getByLabelText("Частка маси для цього руху")).toHaveProperty("value", "0.7");
    expect(screen.getByText(/початкове правило приблизне: 70% маси тіла/)).toBeTruthy();
  });
});

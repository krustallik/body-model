import { describe, expect, it } from "vitest";
import { CreateSetSchema, UpdateSetSchema } from "@/modules/training/training.schema";

describe("Stage 02 set input compatibility", () => {
  it("keeps the legacy scalar reps value when asymmetric execution is explicitly supplied", () => {
    const parsed = CreateSetSchema.safeParse({
      reps: 12,
      weightKg: 10,
      loadAccountingOverride: {
        reps: { kind: "asymmetric-per-side", left: 12, right: 10 },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.reps).toBe(12);
    expect(parsed.data.loadAccountingOverride?.reps).toEqual({
      kind: "asymmetric-per-side", left: 12, right: 10,
    });
  });

  it("leaves ordinary legacy input untouched and accepts explicit override clearing", () => {
    const legacy = CreateSetSchema.safeParse({ reps: 12, weightKg: 10 });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.reps).toBe(12);
    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: null }).success).toBe(true);
    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: { reps: { kind: "asymmetric-per-side", left: -1, right: 2 } } }).success).toBe(false);
  });

  it("accepts finite non-negative BODYWEIGHT additional load only through the existing override", () => {
    const create = CreateSetSchema.safeParse({
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: null,
      loadAccountingOverride: { additionalLoadKg: 15 },
    });
    expect(create.success).toBe(true);
    if (create.success) {
      expect(create.data.weightKg).toBeNull();
      expect(create.data.bandNominalResistanceKg).toBeNull();
      expect(create.data.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
    }

    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: { additionalLoadKg: 15 } }).success).toBe(true);
    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: null }).success).toBe(true);
    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: { additionalLoadKg: 0 } }).success).toBe(true);
    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: { additionalLoadKg: -0.1 } }).success).toBe(false);
    expect(UpdateSetSchema.safeParse({ loadAccountingOverride: { additionalLoadKg: Number.POSITIVE_INFINITY } }).success).toBe(false);
    expect(UpdateSetSchema.safeParse({
      loadAccountingOverride: { additionalLoadKg: 15, assistanceLoadKg: 5 },
    }).success).toBe(false);
  });
});

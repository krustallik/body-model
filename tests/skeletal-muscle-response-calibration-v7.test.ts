import { describe, expect, it } from "vitest";
import {
  buildSkeletalMuscleResponseCalibrationV7,
  skeletalMuscleResponseCalibrationV7Fingerprint,
} from "@/model/physiology-v7/skeletal-muscle-response-calibration-v7";

describe("SkeletalMuscleResponseCalibrationV7", () => {
  it("allows qualitative constraints but explicitly withholds a quantitative skeletal-muscle transition", () => {
    const calibration = buildSkeletalMuscleResponseCalibrationV7();
    expect(calibration.highestSupportedResponseLevel).toBe("level-1-qualitative-constraints");
    expect(calibration.quantitativeTransition).toMatchObject({
      availability: "unavailable",
      reason: "no-approved-whole-body-calibration",
    });
    expect(calibration.quantitativeTransition.blockers).toContain("no-approved-dose-to-kg-calibration");
    expect(JSON.stringify(calibration)).not.toMatch(/skeletalMuscleDeltaKg|anabolicScore|kg\/week|kg\/month/i);
  });

  it("keeps protein and energy missingness and asymmetry explicit without a numeric modifier", () => {
    const constraints = buildSkeletalMuscleResponseCalibrationV7().qualitativeConstraints;
    expect(constraints).toContain("missing-protein-is-unknown-not-zero");
    expect(constraints).toContain("missing-energy-balance-is-unknown-not-neutral");
    expect(constraints).toContain("deficit-does-not-make-recomposition-impossible");
    expect(constraints).toContain("maintenance-or-no-surplus-does-not-force-zero-gain");
    expect(constraints).toContain("deficit-and-surplus-have-no-symmetric-muscle-multiplier");
    expect(constraints).toContain("no-universal-set-cutoff-forces-zero-or-negative-expected-adaptation");
  });

  it("is deterministic and rejects unsupported response inputs and conversions", () => {
    const first = buildSkeletalMuscleResponseCalibrationV7();
    const second = buildSkeletalMuscleResponseCalibrationV7();
    expect(skeletalMuscleResponseCalibrationV7Fingerprint(first))
      .toBe(skeletalMuscleResponseCalibrationV7Fingerprint(second));
    expect(first.rejectedConversions).toEqual(expect.arrayContaining([
      "acute-mps-to-chronic-skeletal-muscle-kg",
      "strength-performance-to-skeletal-muscle-kg",
      "hrv-to-hypertrophy-or-skeletal-muscle-kg",
      "kcal-surplus-to-muscle-kg",
      "hr-tonnage-frequency-or-rir-to-numeric-muscle-multiplier",
      "universal-set-cutoff-to-zero-or-negative-hypertrophy",
    ]));
  });
});

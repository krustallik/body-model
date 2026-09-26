import { createHash } from "node:crypto";
import { finiteNonNegative } from "@/model/activity/canonical-activity-policy-v1";

export type StrengthPublicationDecisionV1 = {
  publish: boolean;
  reason: "published" | "session-not-completed" | "stale-inputs" | "missing-mass" | "unavailable";
  kcal: number | null;
};

export function strengthInputFingerprintV1(input: {
  sessionId: number;
  sessionRevision: number;
  massKg: number | null;
  setFingerprint: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    massKg: input.massKg,
    setFingerprint: input.setFingerprint,
  })).digest("hex");
}

/**
 * Publishes a fresh completed BodyCast estimate into the staged shadow only.
 * A write from an older session revision cannot replace a newer fingerprint.
 * Legacy Garmin activeEnergyKcal is not a write target.
 */
export function strengthPublicationDecisionV1(input: {
  sessionStatus: string;
  estimateKcal: number | null;
  estimateFresh: boolean;
  massKg: number | null;
  inputFingerprint: string;
  previousFingerprint: string | null;
  previousSessionRevision: number | null;
  sessionRevision: number;
}): StrengthPublicationDecisionV1 {
  if (input.sessionStatus !== "COMPLETED") {
    return { publish: false, reason: "session-not-completed", kcal: null };
  }
  if (input.previousFingerprint !== null
    && input.previousSessionRevision !== null
    && input.previousSessionRevision > input.sessionRevision
    && input.previousFingerprint !== input.inputFingerprint) {
    return { publish: false, reason: "stale-inputs", kcal: null };
  }
  if (!input.estimateFresh) {
    return { publish: false, reason: "unavailable", kcal: null };
  }
  const mass = finiteNonNegative(input.massKg);
  if (mass === null || mass <= 0) {
    return { publish: false, reason: "missing-mass", kcal: null };
  }
  const kcal = finiteNonNegative(input.estimateKcal);
  if (kcal === null) return { publish: false, reason: "unavailable", kcal: null };
  return { publish: true, reason: "published", kcal };
}

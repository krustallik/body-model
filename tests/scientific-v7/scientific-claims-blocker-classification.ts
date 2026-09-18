/**
 * Stage 12 audit of BLOCKED scientific claims.
 * Classification is engineering triage only — it does not unblock claims.
 * Do not promote any claim to GREEN without a real measurement oracle where required.
 */

import {
  SCIENTIFIC_V7_CLAIMS,
  type ScientificClaimManifestRecord,
} from "./scientific-claims.manifest";

export type BlockedClaimCategory =
  | "implementation-only"
  | "validation-data"
  | "research-blocked";

export type BlockedClaimClassification = {
  claimId: string;
  category: BlockedClaimCategory;
  reason: string;
  closestToGreenRank: number | null;
};

/**
 * Explicit triage map. Claims omitted here fall back by infrastructureBlocker text.
 */
const CLASSIFICATIONS: Record<string, Omit<BlockedClaimClassification, "claimId">> = {
  "C-A01": {
    category: "implementation-only",
    reason: "Dose/adaptation output wiring missing; monotonicity claim itself is evidence-backed within range.",
    closestToGreenRank: 1,
  },
  "C-K06": {
    category: "research-blocked",
    reason: "Mechanical stepper energy estimator is deliberately withheld; inventing MET would fake precision.",
    closestToGreenRank: null,
  },
  "C-I03": {
    category: "validation-data",
    reason: "Needs a water-observation classifier distinguishing associated vs other transient water against measurements.",
    closestToGreenRank: 6,
  },
  "C-I05": {
    category: "research-blocked",
    reason: "Adult glycogen range must remain metadata; no individualized capacity oracle is approved.",
    closestToGreenRank: null,
  },
  "C-H02": {
    category: "research-blocked",
    reason: "Capacity-bounded repletion requires individualized glycogen capacity that is forbidden as a universal clamp.",
    closestToGreenRank: null,
  },
  "C-B05": {
    category: "research-blocked",
    reason: "Retraining identification still needs an unsupported cessation-duration threshold before labeling.",
    closestToGreenRank: null,
  },
  "C-F01": {
    category: "implementation-only",
    reason: "Connect workout dose to a nonpositive glycogen-demand transition with recruitment context.",
    closestToGreenRank: 7,
  },
  "C-F02": {
    category: "implementation-only",
    reason: "Same glycogen-demand seam as C-F01 plus store bounding.",
    closestToGreenRank: 8,
  },
  "C-MV05": {
    category: "validation-data",
    reason: "Needs longitudinal same-method vs mixed-method uncertainty series against real measurement protocols.",
    closestToGreenRank: 9,
  },
  "C-M01": {
    category: "research-blocked",
    reason: "Sleep→anabolic coupling lacks bounded v7 sleep-context physiology and chronic oracle.",
    closestToGreenRank: null,
  },
  "C-K03": {
    category: "validation-data",
    reason: "Needs modality-relevant personal calibration coverage and separately observable anabolic-dose outputs.",
    closestToGreenRank: null,
  },
};

function fallbackCategory(claim: ScientificClaimManifestRecord): BlockedClaimCategory {
  const blocker = claim.infrastructureBlocker ?? "";
  if (
    /skeletal-muscle|skeletalMuscleKg|muscle-memory|atrophy|capacity|measurement-role|DXA\/BIA|hypertrophy response output exists against which a universal|cessation-duration threshold|HRV|sleep-context|invented quantitative/i
      .test(blocker)
    || /no evidence-backed|universal clamp|not approved|forbidden|unsupported/i.test(blocker)
  ) {
    return "research-blocked";
  }
  if (/cohort|protocol|longitudinal|calibration inputs|sleep provenance|classifier|measurement/i.test(blocker)) {
    return "validation-data";
  }
  if (/no .+ exists|does not exist|not connected|not expose|missing|wiring/i.test(blocker)) {
    return "implementation-only";
  }
  return "research-blocked";
}

export function classifyBlockedScientificClaims(): BlockedClaimClassification[] {
  return SCIENTIFIC_V7_CLAIMS
    .filter((claim) => claim.status === "BLOCKED")
    .map((claim) => {
      const explicit = CLASSIFICATIONS[claim.claimId];
      if (explicit) {
        return { claimId: claim.claimId, ...explicit };
      }
      return {
        claimId: claim.claimId,
        category: fallbackCategory(claim),
        reason: claim.infrastructureBlocker ?? "No infrastructure blocker text recorded.",
        closestToGreenRank: null,
      };
    });
}

export function summarizeBlockedClaimClassification(
  rows: readonly BlockedClaimClassification[] = classifyBlockedScientificClaims(),
) {
  const counts = {
    "implementation-only": rows.filter((row) => row.category === "implementation-only").length,
    "validation-data": rows.filter((row) => row.category === "validation-data").length,
    "research-blocked": rows.filter((row) => row.category === "research-blocked").length,
  };
  const closestToGreen = [...rows]
    .filter((row) => row.closestToGreenRank !== null)
    .sort((a, b) => (a.closestToGreenRank ?? 99) - (b.closestToGreenRank ?? 99));
  return {
    totalBlocked: rows.length,
    counts,
    closestToGreen,
    note: "Closest-to-GREEN ranks are engineering triage only. Do not unblock without a real oracle where the claim requires measurement validation.",
  };
}

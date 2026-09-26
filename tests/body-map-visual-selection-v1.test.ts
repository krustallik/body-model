import { describe, expect, it } from "vitest";
import { resolveSelectedVisualRegionIdsV1 } from "../src/app/dev/body-map/visual-selection-v1";

const anatomyId = "pectoralis_major_clavicular_head";
const leftId = `bodycast.visual-region.v1.${anatomyId}.left.main`;
const rightId = `bodycast.visual-region.v1.${anatomyId}.right.main`;
const regions = [
  { visualRegionId: leftId, anatomyId },
  { visualRegionId: rightId, anatomyId },
  { visualRegionId: "bodycast.visual-region.v1.pectoralis_major_sternocostal_head.left.main", anatomyId: "pectoralis_major_sternocostal_head" },
];

describe("resolveSelectedVisualRegionIdsV1", () => {
  it("keeps taxonomy-driven subregion selection bilateral", () => {
    expect(resolveSelectedVisualRegionIdsV1(regions, new Set([anatomyId]), null)).toEqual([leftId, rightId]);
  });

  it("highlights both sides regardless of which physical side received the ray hit", () => {
    const fromLeft = resolveSelectedVisualRegionIdsV1(regions, new Set([anatomyId]), leftId);
    const fromRight = resolveSelectedVisualRegionIdsV1(regions, new Set([anatomyId]), rightId);
    expect(fromLeft).toEqual([leftId, rightId]);
    expect(fromRight).toEqual(fromLeft);
  });

  it("does not preserve a picked region after navigating to another anatomy", () => {
    const sternocostalId = "bodycast.visual-region.v1.pectoralis_major_sternocostal_head.left.main";
    expect(resolveSelectedVisualRegionIdsV1(regions, new Set(["pectoralis_major_sternocostal_head"]), leftId)).toEqual([sternocostalId]);
  });

  it("ignores stale visual IDs and falls back to known regions for the selected anatomy", () => {
    expect(resolveSelectedVisualRegionIdsV1(regions, new Set([anatomyId]), "missing-region")).toEqual([leftId, rightId]);
  });

  it("selects every actual mesh mapped to a composite taxonomy ID without duplicate mesh geometry", () => {
    const composite = [
      { visualRegionId: "pec.left.clavicular", anatomyId: "pectoralis_major_clavicular_head", anatomyIds: ["pectoralis_major", "pectoralis_major_clavicular_head"] },
      { visualRegionId: "pec.right.clavicular", anatomyId: "pectoralis_major_clavicular_head", anatomyIds: ["pectoralis_major", "pectoralis_major_clavicular_head"] },
      { visualRegionId: "pec.left.sternocostal", anatomyId: "pectoralis_major_sternocostal_head", anatomyIds: ["pectoralis_major", "pectoralis_major_sternocostal_head"] },
    ];
    expect(resolveSelectedVisualRegionIdsV1(composite, new Set(["pectoralis_major"]), null)).toEqual(composite.map(({ visualRegionId }) => visualRegionId));
  });

  it("does not invent a mirrored identity when the registry has no bilateral mesh", () => {
    const registeredUnpairedRegion = [{ visualRegionId: "registered.midline", anatomyId: "midline_anatomy" }];
    expect(resolveSelectedVisualRegionIdsV1(registeredUnpairedRegion, new Set(["midline_anatomy"]), null)).toEqual(["registered.midline"]);
  });
});

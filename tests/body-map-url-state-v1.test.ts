import { describe, expect, it } from "vitest";
import {
  BODY_MAP_URL_OVERVIEW_V1,
  defaultBodyMapGroupViewV1,
  defaultBodyMapSubregionViewV1,
  isBodyMapUrlStateEqualV1,
  parseBodyMapUrlStateV1,
  serializeBodyMapUrlStateV1,
} from "@/modules/training/body-map-url-state-v1";

describe("Body Map URL state v1", () => {
  it("restores group, subregion and camera orientation from a direct URL", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=quadriceps&region=rectus_femoris&side=left&view=back")).toEqual({
      groupId: "quadriceps", anatomyId: "rectus_femoris", view: "back", mode: "muscle", deep: false,
    });
  });

  it.each(["left", "right", "both"])("normalizes legacy side=%s links to bilateral selection", (side) => {
    const href = `http://localhost/dev/body-map?group=chest&region=pectoralis_major&side=${side}&view=front`;
    const state = parseBodyMapUrlStateV1(href);
    expect(state).toEqual({
      groupId: "chest", anatomyId: "pectoralis_major", view: "front", mode: "muscle", deep: false,
    });
    expect(serializeBodyMapUrlStateV1(href, state)).toBe("/dev/body-map?group=chest&region=pectoralis_major&view=front");
  });

  it("recovers a known region to its first valid group when group is absent or invalid", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?region=rectus_femoris&group=unknown")).toMatchObject({
      groupId: "quadriceps", anatomyId: "rectus_femoris", view: "default",
    });
  });

  it("drops a region that does not belong to the supplied valid group", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&region=rectus_femoris")).toMatchObject({
      groupId: "chest", anatomyId: null, view: "front",
    });
  });

  it("recovers an unknown group and region to overview", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=made_up&region=made_up")).toEqual(BODY_MAP_URL_OVERVIEW_V1);
  });

  it("normalizes invalid orientation and display mode", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&side=diagonal&view=up&mode=wireframe")).toMatchObject({
      groupId: "chest", view: "front", mode: "muscle",
    });
  });

  it("normalizes view=default to front in overview", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?view=default").view).toBe("front");
  });

  it("removes a legacy selection side while retaining a left camera view", () => {
    const href = "http://localhost/dev/body-map?side=left&view=left";
    const state = parseBodyMapUrlStateV1(href);
    expect(state).toMatchObject({ groupId: null, view: "left" });
    expect(serializeBodyMapUrlStateV1(href, state)).toBe("/dev/body-map?view=left");
  });

  it("retains left and right as independent camera orientations", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&view=left").view).toBe("left");
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&view=right").view).toBe("right");
  });

  it("compares legacy links by their bilateral semantic state", () => {
    expect(isBodyMapUrlStateEqualV1(
      parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&region=pectoralis_major&side=left"),
      parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&region=pectoralis_major&side=right"),
    )).toBe(true);
  });

  it("omits legacy side when serializing semantic selection", () => {
    expect(serializeBodyMapUrlStateV1(
      "http://localhost/dev/body-map?campaign=spring&side=right",
      { groupId: "quadriceps", anatomyId: "rectus_femoris", view: "front", mode: "skeleton", deep: true },
    )).toBe("/dev/body-map?campaign=spring&group=quadriceps&region=rectus_femoris&view=front&mode=skeleton&deep=1");
  });

  it("keeps the existing bilateral overview state shape", () => {
    expect(BODY_MAP_URL_OVERVIEW_V1).toEqual({
      groupId: null, anatomyId: null, view: "front", mode: "muscle", deep: false,
    });
  });

  it("preserves unrelated query parameters and hash while replacing Body Map state", () => {
    expect(serializeBodyMapUrlStateV1(
      "http://localhost/dev/body-map?campaign=spring&group=chest&region=pectoralis_major&x=1#map",
      { groupId: "quadriceps", anatomyId: "rectus_femoris", view: "front", mode: "skeleton", deep: true },
    )).toBe("/dev/body-map?campaign=spring&x=1&group=quadriceps&region=rectus_femoris&view=front&mode=skeleton&deep=1#map");
  });

  it("serializes the overview without adding default navigation parameters", () => {
    expect(serializeBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest", BODY_MAP_URL_OVERVIEW_V1)).toBe("/dev/body-map");
  });

  it("normalizes non-deep subregions when deep mode is incompatible", () => {
    const parsed = parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=quadriceps&region=rectus_femoris&deep=1", {
      deepAnatomyIds: new Set(["vastus_intermedius"]),
    });
    expect(parsed.deep).toBe(false);
  });

  it("retains compatible deep routes", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=quadriceps&region=vastus_intermedius&deep=1", {
      deepAnatomyIds: new Set(["vastus_intermedius"]),
    }).deep).toBe(true);
  });

  it("uses a visible front detail camera for hip adductors while preserving explicit orientation", () => {
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=hip_adductors").view).toBe("back");
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=hip_adductors&region=adductor_longus").view).toBe("front");
    expect(parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=hip_adductors&region=adductor_longus&view=back").view).toBe("back");
    expect(defaultBodyMapGroupViewV1("hip_adductors")).toBe("back");
    expect(defaultBodyMapGroupViewV1("chest")).toBe("front");
    expect(defaultBodyMapSubregionViewV1("hip_adductors")).toBe("front");
    expect(defaultBodyMapSubregionViewV1("chest")).toBe("front");
  });

  it("compares semantic state rather than query ordering", () => {
    const first = parseBodyMapUrlStateV1("http://localhost/dev/body-map?view=left&group=chest");
    const second = parseBodyMapUrlStateV1("http://localhost/dev/body-map?group=chest&view=left");
    expect(isBodyMapUrlStateEqualV1(first, second)).toBe(true);
  });
});

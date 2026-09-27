import { describe, expect, it } from "vitest";
import { BODY_MAP_GROUP_CATALOG_V2 } from "@/modules/training/body-map-catalog-v2";
import { normalizeStaticPublicBodyMapManifestV1, type StaticPublicBodyMapManifestV1 } from "@/modules/body-map/static-public-manifest-adapter-v1";

const validManifest = (): StaticPublicBodyMapManifestV1 => ({
  schemaVersion: "2.0.0",
  release: "bodyparts3d-v4.0-bodycast-v3",
  asset: { assetId: "bodyparts3d-v4.0-full-body-v3", url: "/body-map/bodyparts3d-v3/bodyparts3d-v4.0-full-body-v3.glb", mediaType: "model/gltf-binary", sha256: "a".repeat(64), byteLength: 100, triangleCount: 10, selectableMeshCount: 1, contextMeshCount: 1, compression: "EXT_meshopt_compression" },
  contracts: { catalog: { contract: "catalog", version: "2.0.0" }, taxonomyVersion: "taxonomy-v2", navigation: { contract: "navigation", version: "2.0.0" }, camera: { contract: "camera", version: "1.0.0" }, visualMappingVersion: "mapping-v3" },
  bodyMapGroups: BODY_MAP_GROUP_CATALOG_V2.map(({ id }) => ({ groupId: id, subregions: [] })),
  anatomyCoverage: [],
  visualIdentity: { supportedRegions: [{ meshId: "mesh-1", anatomyId: "pectoralis_major", anatomyIds: ["pectoralis_major"], primaryPickGroupId: "chest", assetId: "bodyparts3d-v4.0-full-body-v3" }], contextNodes: [{ meshId: "context-1" }] },
});

describe("static public Body Map delivery adapter v1", () => {
  it("keeps all production training exposure explicitly unavailable rather than zero", () => {
    const result = normalizeStaticPublicBodyMapManifestV1(validManifest());
    expect(result.runtimeAssets[0].path).toBe("/body-map/bodyparts3d-v3/bodyparts3d-v4.0-full-body-v3.glb");
    expect(result.dataNotice).toBe("TRAINING DATA NOT CONNECTED");
    expect(result.trainingExposure.groups).toHaveLength(20);
    expect(result.trainingExposure.groups.every((group) => group.status === "unavailable" && group.totalUniqueSetCount === null)).toBe(true);
  });

  it("rejects non-public or traversal asset paths", () => {
    const manifest = validManifest();
    manifest.asset.url = "../../local-assets/model.glb";
    expect(() => normalizeStaticPublicBodyMapManifestV1(manifest)).toThrow("versioned public GLB path");
  });

  it("rejects mismatched selectable and context mesh counts", () => {
    const manifest = validManifest();
    manifest.asset.contextMeshCount = 9;
    expect(() => normalizeStaticPublicBodyMapManifestV1(manifest)).toThrow("mesh counts");
  });
});

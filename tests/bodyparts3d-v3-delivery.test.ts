import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_MAP_GROUP_CATALOG_V2, BODY_MAP_TAXONOMY_V2 } from "@/modules/training/body-map-catalog-v2";

const deliveryRoot = resolve("public/body-map/bodyparts3d-v3");
const manifestPath = resolve(deliveryRoot, "manifest.json");
const glbPath = resolve(deliveryRoot, "bodyparts3d-v4.0-full-body-v3.glb");
const requiredAuthored: Record<string, { groupId: string; sideMeshIds: string[]; depth: string }> = {
  latissimus_dorsi: { groupId: "back", sideMeshIds: ["bodycast-authored-latissimus-dorsi-left", "bodycast-authored-latissimus-dorsi-right"], depth: "superficial" },
  rectus_abdominis: { groupId: "core", sideMeshIds: ["bodycast-authored-rectus-abdominis-left", "bodycast-authored-rectus-abdominis-right"], depth: "superficial" },
  internal_oblique: { groupId: "core", sideMeshIds: ["bodycast-authored-internal_oblique-left", "bodycast-authored-internal_oblique-right"], depth: "deep" },
  transversus_abdominis: { groupId: "core", sideMeshIds: ["bodycast-authored-transversus_abdominis-left", "bodycast-authored-transversus_abdominis-right"], depth: "deep" },
};

describe("BodyParts3D v3 static delivery", () => {
  it("keeps the shared 20-group catalog and versioned stable mesh identities", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const bytes = await readFile(glbPath);
    expect(manifest.release).toBe("bodyparts3d-v4.0-bodycast-v3");
    expect(manifest.bodyMapGroups.map((group: { groupId: string }) => group.groupId).sort())
      .toEqual(BODY_MAP_GROUP_CATALOG_V2.map((group) => group.id).sort());
    expect(manifest.bodyMapGroups).toHaveLength(20);
    expect(manifest.anatomyCoverage.map((entry: { anatomyId: string }) => entry.anatomyId).sort())
      .toEqual(BODY_MAP_TAXONOMY_V2.map((entry) => entry.id).sort());
    expect(manifest.visualIdentity.supportedRegions).toHaveLength(manifest.asset.selectableMeshCount);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.asset.sha256);
    expect(bytes.byteLength).toBe(manifest.asset.byteLength);

    const gltf = readGlbJson(bytes);
    const nodeById = new Map<string, TestNode>();
    for (const node of gltf.nodes ?? []) {
      const meshId = node.extras?.bodycastMeshId;
      if (typeof meshId === "string") nodeById.set(meshId, node);
    }
    expect(nodeById.size).toBe(manifest.asset.selectableMeshCount + manifest.asset.contextMeshCount);

    for (const [anatomyId, contract] of Object.entries(requiredAuthored)) {
      expect(BODY_MAP_TAXONOMY_V2.some((entry) => entry.id === anatomyId)).toBe(true);
      expect(manifest.anatomyCoverage.some((entry: { anatomyId: string; visualAvailability: string }) => entry.anatomyId === anatomyId && entry.visualAvailability === "represented")).toBe(true);
      expect(manifest.visualIdentity.supportedRegions.filter((region: { anatomyIds: string[]; bodyMapGroupIds: string[]; depthLayer: string }) => region.anatomyIds.includes(anatomyId) && region.bodyMapGroupIds.includes(contract.groupId) && region.depthLayer === contract.depth)).toHaveLength(2);
      for (const meshId of contract.sideMeshIds) {
        const node = nodeById.get(meshId) as { extras?: { bodycastSelectable?: boolean; bodycastGeometryOrigin?: string } } | undefined;
        expect(node?.extras?.bodycastSelectable).toBe(true);
        expect(node?.extras?.bodycastGeometryOrigin).toBe("BodyCast-authored-volumetric-anatomy-v2.0.0");
      }
    }
  });

  it("contains redistribution provenance and no demo exposure or local-file dependency", async () => {
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.provenance.license).toContain("CC BY 4.0");
    expect(manifest.provenance.attribution).toContain("BodyParts3D");
    expect(manifest.provenance.legacyObjHeaderNotice).toContain("2.1 Japan");
    expect(manifest.provenance.disclosedUncertainty).toBeTruthy();
    const attribution = await readFile(resolve(deliveryRoot, "ATTRIBUTION.md"), "utf8");
    expect(attribution).toContain("[official database license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)");
    expect(attribution).not.toContain("(undefined)");
    expect(manifest.asset.url).toBe("/body-map/bodyparts3d-v3/bodyparts3d-v4.0-full-body-v3.glb");
    expect(raw).not.toContain("3d-model/local-assets");
    expect(raw.toLowerCase()).not.toContain("z-anatomy");
    expect(manifest).not.toHaveProperty("trainingExposure");
    expect(manifest).not.toHaveProperty("demoData");
  });

  it("retains internal head context while excluding it from the default viewer presentation", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const mapping = JSON.parse(await readFile(resolve("3d-model/bodyparts3d-adapter-v2/visual-mapping-v3.json"), "utf8"));
    const gltf = readGlbJson(await readFile(glbPath));
    const hiddenMeshIds = manifest.visualIdentity.contextVisibility.defaultHiddenContextMeshIds as string[];
    const sourceIds = mapping.presentation.defaultHiddenSourceObjectIds as string[];
    const nodeBySourceId = new Map((gltf.nodes ?? []).map((node) => [node.extras?.bodyparts3dFileId, node] as const));
    const selectableIds = new Set(manifest.visualIdentity.supportedRegions.map((region: { meshId: string }) => region.meshId));

    expect(manifest.visualIdentity.contextVisibility).toMatchObject({ contract: mapping.presentation.contract, version: mapping.presentation.version });
    expect(sourceIds).toHaveLength(38);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(hiddenMeshIds).toHaveLength(sourceIds.length);
    expect(manifest.visualIdentity.contextNodes.map((node: { meshId: string }) => node.meshId)).toEqual(expect.arrayContaining(hiddenMeshIds));

    const headRepair = mapping.presentation.headSurfaceRepair;
    expect(headRepair).toMatchObject({
      contract: "bodycast-neutral-head-surface-repair",
      version: "1.1.0",
      skinEnvelopeSourceObjectId: "FJ2810",
      opaqueSurfaceMinSourceZ: 1.37,
      eyeBoundarySelection: { expectedLoopCount: 15 },
      neutralEyeClosures: { centersSourceX: [-0.032, 0.032] },
    });
    const skinNode = nodeBySourceId.get("FJ2810");
    expect(skinNode?.extras?.bodycastSelectable).toBe(false);
    expect(skinNode?.extras?.bodycastHeadSurfaceRepair).toBe("bodycast-neutral-head-surface-repair-v1.1.0");
    expect(skinNode?.extras?.bodycastHeadSurfaceRepairSelectedLoopCount).toBe(15);
    expect(skinNode?.extras?.bodycastHeadSurfaceRepairFilledFaceCount).toBeGreaterThan(0);
    expect(skinNode?.extras?.bodycastNeutralEyeCapCount).toBe(2);
    expect(gltf.materials?.find((material) => material.name === "BodyCast neutral head surface closure")?.extras)
      .toMatchObject({ bodycastOpaqueFaceClosure: true });

    for (const sourceId of sourceIds) {
      const node = nodeBySourceId.get(sourceId) as TestNode | undefined;
      expect(node?.extras?.bodycastSelectable).toBe(false);
      expect(hiddenMeshIds).toContain(node?.extras?.bodycastMeshId);
      expect(selectableIds.has(String(node?.extras?.bodycastMeshId))).toBe(false);
    }
  });
});

type TestNode = { name: string; extras?: { bodycastMeshId?: string; bodycastSelectable?: boolean; bodycastGeometryOrigin?: string; bodyparts3dFileId?: string; [key: string]: unknown } };

function readGlbJson(buffer: Buffer): { nodes?: TestNode[]; materials?: Array<{ name?: string; extras?: Record<string, unknown> }> } {
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
  expect(buffer.readUInt32LE(4)).toBe(2);
  expect(buffer.readUInt32LE(8)).toBe(buffer.byteLength);
  const jsonLength = buffer.readUInt32LE(12);
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

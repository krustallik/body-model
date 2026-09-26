import { describe, expect, it } from "vitest";
import { resolveVisualRegionV1, type VisualRegionBindingV1 } from "../src/app/dev/body-map/visual-region-resolver-v1";

const clavicular: VisualRegionBindingV1 = {
  visualRegionId: "chest.pectoralis-major.clavicular.left.v1",
  gltfNodeName: "mesh_chest_pec_clavicular_l",
};
const sternocostal: VisualRegionBindingV1 = {
  visualRegionId: "chest.pectoralis-major.sternocostal.left.v1",
  gltfNodeName: "mesh_chest_pec_sternocostal_l",
};
const byId = new Map([clavicular, sternocostal].map((region) => [region.visualRegionId, region]));
const byNodeName = new Map([clavicular, sternocostal].map((region) => [region.gltfNodeName, region]));

describe("versioned mesh-to-region identity", () => {
  it("resolves explicit GLB stable IDs against the manifest", () => {
    expect(resolveVisualRegionV1({ name: "mesh_other", userData: { bodycastRegionId: clavicular.visualRegionId } }, byId, byNodeName)).toEqual(clavicular);
  });

  it("resolves manifest mesh IDs carried in GLB node extras", () => {
    const zAnatomyMesh = { ...clavicular, meshId: "test.mesh.chest.left" };
    const byMeshId = new Map([[zAnatomyMesh.meshId, zAnatomyMesh]]);
    expect(resolveVisualRegionV1({ name: "test.mesh.chest.left", userData: { bodycastMeshId: zAnatomyMesh.meshId } }, byMeshId, new Map())).toEqual(zAnatomyMesh);
  });

  it("uses exact manifest node names when the GLB has no userData ID", () => {
    expect(resolveVisualRegionV1({ name: clavicular.gltfNodeName }, byId, byNodeName)).toEqual(clavicular);
  });

  it("resolves material-split mesh children through their named GLTF node", () => {
    expect(resolveVisualRegionV1({
      name: "mesh_primitive_0",
      parent: { name: clavicular.gltfNodeName },
    }, byId, byNodeName)).toEqual(clavicular);
  });

  it("resolves the visualRegionId extra carried by a GLTF node", () => {
    expect(resolveVisualRegionV1({
      name: "mesh_primitive_1",
      parent: { name: "bodycast_region_node", userData: { visualRegionId: clavicular.visualRegionId } },
    }, byId, byNodeName)).toEqual(clavicular);
  });

  it("does not fall back to a named parent when a child has an unknown explicit ID", () => {
    expect(resolveVisualRegionV1({
      name: "mesh_primitive_0",
      userData: { bodycastRegionId: "unknown-region" },
      parent: { name: clavicular.gltfNodeName },
    }, byId, byNodeName)).toBeNull();
  });

  it("does not reinterpret an unknown explicit ID as a name-based muscle pick", () => {
    expect(resolveVisualRegionV1({ name: clavicular.gltfNodeName, userData: { bodycastRegionId: "unknown-region" } }, byId, byNodeName)).toBeNull();
  });

  it("leaves generic or unmapped meshes unselected", () => {
    expect(resolveVisualRegionV1({ name: "bodycast_surface_unsegmented" }, byId, byNodeName)).toBeNull();
  });
});

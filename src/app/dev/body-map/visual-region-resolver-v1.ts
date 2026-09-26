export type VisualRegionBindingV1 = {
  visualRegionId: string;
  gltfNodeName: string;
  meshId?: string;
};

export type VisualMeshIdentityV1 = {
  name: string;
  userData?: Record<string, unknown>;
  parent?: VisualMeshIdentityV1 | null;
};

export function resolveVisualRegionV1<T extends VisualRegionBindingV1>(
  mesh: VisualMeshIdentityV1,
  regionById: ReadonlyMap<string, T>,
  regionByNodeName: ReadonlyMap<string, T>,
): T | null {
  let current: VisualMeshIdentityV1 | null | undefined = mesh;
  while (current) {
    const explicitId = [
      current.userData?.bodycastMeshId,
      current.userData?.bodycastRegionId,
      current.userData?.bodycastRegionId,
      current.userData?.bodycastVisualRegionId,
      current.userData?.visualRegionId,
      current.userData?.regionId,
    ].find((candidate): candidate is string => typeof candidate === "string");

    if (explicitId !== undefined) return regionById.get(explicitId) ?? null;

    const byName = regionByNodeName.get(current.name);
    if (byName) return byName;
    current = current.parent;
  }

  return null;
}

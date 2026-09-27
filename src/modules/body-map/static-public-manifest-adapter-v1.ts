import { BODY_MAP_GROUP_CATALOG_V2, type AnatomyIdV2, type BodyMapGroupIdV2 } from "@/modules/training/body-map-catalog-v2";

export type StaticPublicBodyMapManifestV1 = {
  schemaVersion: string;
  release: string;
  asset: {
    assetId: string;
    url: string;
    mediaType: string;
    sha256: string;
    byteLength: number;
    triangleCount: number;
    selectableMeshCount: number;
    contextMeshCount: number;
    compression: string;
  };
  contracts: {
    catalog: { contract: string; version: string };
    taxonomyVersion: string;
    navigation: { contract: string; version: string };
    camera: { contract: string; version: string };
    visualMappingVersion: string;
  };
  bodyMapGroups: Array<{
    groupId: BodyMapGroupIdV2;
    subregions: Array<{ anatomyId: AnatomyIdV2 }>;
    [key: string]: unknown;
  }>;
  anatomyCoverage: Array<Record<string, unknown> & { anatomyId: AnatomyIdV2 }>;
  visualIdentity: {
    supportedRegions: Array<{
      meshId: string;
      anatomyId: AnatomyIdV2;
      anatomyIds: AnatomyIdV2[];
      primaryPickGroupId: BodyMapGroupIdV2;
      assetId: string;
      [key: string]: unknown;
    }>;
    contextNodes: Array<Record<string, unknown> & { meshId: string }>;
    contextVisibility?: { contract: string; version: string; defaultHiddenContextMeshIds: string[] };
    [key: string]: unknown;
  };
};

export type UnavailableExposureV1 = {
  contract: "bodycast-training-exposure-v1";
  version: "1.0.0";
  source: "unavailable";
  groups: Array<{
    groupId: BodyMapGroupIdV2;
    source: "unavailable";
    status: "unavailable";
    directUniqueSetCount: null;
    indirectUniqueSetCount: null;
    totalUniqueSetCount: null;
    mappingCoverage: "unknown";
    note: string;
  }>;
};

const TRAINING_UNAVAILABLE_NOTE = "Training exposure is not connected on this route; no user or demo training data is shown.";

export function unavailableTrainingExposureV1(groupIds: readonly BodyMapGroupIdV2[]): UnavailableExposureV1 {
  return {
    contract: "bodycast-training-exposure-v1",
    version: "1.0.0",
    source: "unavailable",
    groups: groupIds.map((groupId) => ({
      groupId,
      source: "unavailable",
      status: "unavailable",
      directUniqueSetCount: null,
      indirectUniqueSetCount: null,
      totalUniqueSetCount: null,
      mappingCoverage: "unknown",
      note: TRAINING_UNAVAILABLE_NOTE,
    })),
  };
}

export function normalizeStaticPublicBodyMapManifestV1(source: StaticPublicBodyMapManifestV1) {
  const asset = source.asset;
  const expectedGroupIds = BODY_MAP_GROUP_CATALOG_V2.map(({ id }) => id).sort();
  const actualGroupIds = source.bodyMapGroups.map(({ groupId }) => groupId).sort();
  if (source.schemaVersion !== "2.0.0") throw new Error("Unsupported static Body Map manifest version.");
  if (asset.mediaType !== "model/gltf-binary" || !asset.url.startsWith("/body-map/bodyparts3d-v3/") || asset.url.includes("..")) {
    throw new Error("Body Map production delivery must use the versioned public GLB path.");
  }
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0) {
    throw new Error("Body Map public asset identity is invalid.");
  }
  if (JSON.stringify(actualGroupIds) !== JSON.stringify(expectedGroupIds)) throw new Error("Static Body Map manifest does not match the canonical 20-group catalog.");
  if (source.visualIdentity.supportedRegions.length !== asset.selectableMeshCount
    || source.visualIdentity.contextNodes.length !== asset.contextMeshCount) {
    throw new Error("Static Body Map manifest mesh counts do not match its asset contract.");
  }
  const meshIds = new Set<string>();
  for (const region of source.visualIdentity.supportedRegions) {
    if (meshIds.has(region.meshId) || region.assetId !== asset.assetId) throw new Error(`Invalid or duplicate Body Map mesh identity: ${region.meshId}`);
    meshIds.add(region.meshId);
  }

  const trainingExposure = unavailableTrainingExposureV1(actualGroupIds);
  const pairs = source.bodyMapGroups.flatMap(({ groupId, subregions }) => subregions.map(({ anatomyId }) => ({ anatomyId, groupId })));
  const primaryPickGroupByAnatomyId = Object.fromEntries(source.visualIdentity.supportedRegions.map(({ anatomyId, primaryPickGroupId }) => [anatomyId, primaryPickGroupId]));
  const runtimeAsset = {
    assetId: asset.assetId,
    path: asset.url,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    meshNodeCount: asset.selectableMeshCount + asset.contextMeshCount,
    selectableMeshCount: asset.selectableMeshCount,
    contextMeshCount: asset.contextMeshCount,
    faceCount: asset.triangleCount,
    triangleCount: asset.triangleCount,
    vertexCount: 0,
    materialSlots: 0,
    compression: asset.compression,
  };

  return {
    contract: "bodycast-body-map-public-viewer-adapter-v1",
    contractVersion: source.schemaVersion,
    catalog: source.contracts.catalog,
    taxonomyVersion: source.contracts.taxonomyVersion,
    exerciseMappingVersion: "not-connected",
    trainingExposure: { contract: trainingExposure.contract, version: trainingExposure.version, source: trainingExposure.source, groups: trainingExposure.groups },
    navigationMembership: {
      contract: source.contracts.navigation.contract,
      version: source.contracts.navigation.version,
      pairs,
      primaryPickGroupByAnatomyId,
    },
    bodyMapGroups: source.bodyMapGroups,
    anatomyCoverage: source.anatomyCoverage,
    asset: {
      assetVersion: asset.assetId,
      visualSelectionStatus: "verified-static-public-delivery",
      selectableRegionCount: asset.selectableMeshCount,
      totalRuntimeBytes: asset.byteLength,
      contextMeshCount: asset.contextMeshCount,
    },
    viewerAsset: {
      path: asset.url,
      sha256: asset.sha256,
      status: source.release,
      mayClaimMusclePicking: true,
      assetId: asset.assetId,
      selectableMeshCount: asset.selectableMeshCount,
      contextMeshCount: asset.contextMeshCount,
      triangleCount: asset.triangleCount,
      byteLength: asset.byteLength,
    },
    runtimeAssets: [runtimeAsset],
    visualIdentity: source.visualIdentity,
    dataNotice: "TRAINING DATA NOT CONNECTED",
    status: "static public anatomy delivery; no training analytics are connected",
  };
}

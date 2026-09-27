import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BODY_MAP_CATALOG_CONTRACT_V2,
  BODY_MAP_CATALOG_VERSION_V2,
  BODY_MAP_GROUP_CATALOG_V2,
  BODY_MAP_MEMBERSHIP_V2,
  BODY_MAP_PRIMARY_PICK_GROUP_BY_ANATOMY_ID_V2,
  BODY_MAP_TAXONOMY_V2,
  BODY_MAP_TAXONOMY_VERSION_V2,
  bodyMapAnatomySubtreeIdsV2,
  bodyMapGroupIdsForAnatomyV2,
  buildBodyMapGroupsV2,
  primaryBodyMapGroupForAnatomyV2,
} from "@/modules/training/body-map-catalog-v2";
import {
  ANATOMY_ANALYTICS_CROSSWALK_V1,
  EXERCISE_ANATOMY_MAPPING_V1_VERSION,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import {
  BODY_MAP_EXPOSURE_CONTRACT_V2,
  BODY_MAP_EXPOSURE_VERSION_V2,
  buildBodyMapDemoExposureFixtureV2,
} from "@/modules/training/body-map-training-exposure-v2";
import {
  BODY_MAP_NAVIGATION_CONTRACT_V2,
  BODY_MAP_NAVIGATION_MEMBERSHIP_V2,
  BODY_MAP_NAVIGATION_VERSION_V2,
} from "@/modules/training/body-map-navigation-contract-v2";
import {
  BODY_MAP_CAMERA_CONTRACT_V1,
  BODY_MAP_CAMERA_VERSION_V1,
  BODY_MAP_OVERVIEW_PADDING_FACTOR_V1,
} from "@/app/dev/body-map/camera-transition-v1";

import type { AnatomyIdV2, BodyMapGroupIdV2 } from "@/modules/training/body-map-catalog-v2";

type GltfNode = { name?: string; mesh?: number; extras?: Record<string, unknown> };
type GltfPrimitive = { mode?: number; indices?: number; attributes?: { POSITION?: number } };
type GltfMesh = { primitives?: GltfPrimitive[] };
type GltfDocument = {
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: Array<{ count: number }>;
  materials?: unknown[];
  extensionsUsed?: string[];
};
type GenerationReport = {
  selectableRegions: SourceMesh[];
  contextNodes: SourceMesh[];
  selectableMeshCount: number;
  contextMeshCount: number;
  glbSha256: string;
  glbBytes: number;
  triangleCount: number;
  faceCount: number;
  vertexCount: number;
  sourceArchiveHashes: Record<string, string>;
  coordinateTransform: string;
  geometryProcessing: string;
};
type VisualMapping = {
  version: string;
  mappings: Array<{ anatomyId: string; note?: string }>;
  presentation?: { contract: string; version: string; defaultHiddenSourceObjectIds: string[]; note?: string };
  independentGeometry?: Array<{ anatomyId: string; geometryId: string; construction: string; reference?: string; leftMeshId: string; rightMeshId: string }>;
  unavailable: Array<{ anatomyId: string; reason: string }>;
  licenseReview: Record<string, unknown>;
};

async function main() {
const root = process.cwd();
const revision = process.argv.includes("--v3") ? "v3" : process.argv.includes("--v2") ? "v2" : "v1";
const v2 = revision !== "v1";
const assetId = v2 ? `bodyparts3d-v4.0-full-body-${revision}` : "bodyparts3d-v4.0-full-body-local";
const revisionDir = revision === "v1" ? "" : `bodyparts3d-${revision}/`;
const revisionSuffix = revision === "v1" ? "" : `-${revision}`;
const assetName = v2 ? `3d-model/local-assets/${revisionDir}bodyparts3d-v4.0-full-body${revisionSuffix}.glb` : "3d-model/local-assets/bodyparts3d-v4.0-full-body.glb";
const reportName = v2 ? `3d-model/local-assets/${revisionDir}bodyparts3d-v4.0-generation-report${revisionSuffix}.json` : "3d-model/local-assets/bodyparts3d-v4.0-generation-report.json";
const mappingName = v2 ? `3d-model/bodyparts3d-adapter-v2/visual-mapping-${revision}.json` : "3d-model/bodyparts3d-adapter-v1/visual-mapping-v1.json";
const manifestName = v2 ? `3d-model/local-assets/${revisionDir}body-map-runtime-manifest-${revision}.json` : "3d-model/local-assets/body-map-runtime-manifest.json";

const [assetPath, reportPath, mappingPath] = await Promise.all([
  readFile(resolve(root, assetName)),
  readFile(resolve(root, reportName), "utf8"),
  readFile(resolve(root, mappingName), "utf8"),
]);
const report = JSON.parse(reportPath) as GenerationReport;
const mapping = JSON.parse(mappingPath) as VisualMapping;
const hash = createHash("sha256").update(assetPath).digest("hex");
const gltf = readGlbJson(assetPath);
const nodeRows = report.selectableRegions;
const contextRows = report.contextNodes;
const regionByMeshId = new Map<string, Region>();
const nodeByName = new Map<string, GltfNode>((gltf.nodes ?? []).filter((node): node is GltfNode & { name: string; mesh: number } => Number.isInteger(node.mesh) && typeof node.name === "string").map((node) => [node.name, node] as const));
const unavailableByAnatomy = new Map<string, string>(mapping.unavailable.map((row) => [row.anatomyId, row.reason] as const));
const mappingNoteByAnatomy = new Map<string, string>(mapping.mappings.filter((row) => row.note).map((row) => [row.anatomyId, row.note as string] as const));
for (const row of mapping.independentGeometry ?? []) mappingNoteByAnatomy.set(row.anatomyId, `BodyCast-authored educational approximation (${row.geometryId}): ${row.construction}`);
const analyticsGroupsByAnatomy = new Map<string, Set<string>>();
for (const entry of ANATOMY_ANALYTICS_CROSSWALK_V1) {
  const values = analyticsGroupsByAnatomy.get(entry.anatomyId) ?? new Set<string>();
  values.add(entry.analyticsGroupId);
  analyticsGroupsByAnatomy.set(entry.anatomyId, values);
}

for (const source of nodeRows) {
  const gltfNode = nodeByName.get(source.meshId);
  if (!gltfNode?.name || gltfNode.extras?.bodycastSelectable !== true || gltfNode.extras?.bodycastMeshId !== source.meshId) {
    throw new Error("GLB identity mismatch for selectable source mesh " + source.meshId);
  }
  const anatomyIds = source.anatomyIds;
  const bodyMapGroupIds = bodyMapGroupIdsForAnatomyV2(anatomyIds);
  const primaryPickGroupId = primaryBodyMapGroupForAnatomyV2(anatomyIds);
  if (!anatomyIds.length || !bodyMapGroupIds.length || !primaryPickGroupId) {
    throw new Error("Selectable source mesh has no BodyCast anatomy/group binding: " + source.meshId);
  }
  const visualRegionId = "bodyparts3d-v4-region-" + source.meshId;
  regionByMeshId.set(source.meshId, {
    visualRegionId,
    meshId: source.meshId,
    gltfNodeName: gltfNode.name,
    anatomyId: anatomyIds[0],
    anatomyIds,
    bodyMapGroupIds,
    analyticsGroupIds: unique(anatomyIds.flatMap((id) => [...(analyticsGroupsByAnatomy.get(id) ?? [])])),
    primaryPickGroupId,
    side: source.side,
    depthLayer: source.depthLayer,
    sourceObjectId: source.sourceObjectId,
    geometryOrigin: source.geometryOrigin,
    geometryMethod: source.geometryMethod,
    geometryProfileContract: source.geometryProfileContract,
    geometryMetrics: source.geometryMetrics,
    attachmentContract: source.attachmentContract,
    sourceObjectName: anatomyIds.map((id) => BODY_MAP_TAXONOMY_V2.find((node) => node.id === id)?.label).filter(Boolean).join(" / ") || "Mapped muscle region",
    assetId,
    selectable: true,
    bounds: source.bounds,
  });
}
const regions = [...regionByMeshId.values()];
const contextNodes = contextRows.map((source: SourceMesh) => {
  const gltfNode = nodeByName.get(source.meshId);
  if (!gltfNode?.name || gltfNode.extras?.bodycastSelectable !== false || gltfNode.extras?.bodycastMeshId !== source.meshId) {
    throw new Error("GLB identity mismatch for context source mesh " + source.meshId);
  }
  return {
    meshId: source.meshId,
    gltfNodeName: gltfNode.name,
    sourceObjectName: source.contextKind === "whole-body-skin-envelope" ? "Body silhouette context" : "Supplemental muscle anatomy",
    contextLayer: source.depthLayer,
    contextPresentation: source.contextPresentation,
    selectable: false as const,
    bounds: source.bounds,
    sourceObjectId: source.sourceObjectId,
  };
});
const hiddenContextSourceIds = new Set(mapping.presentation?.defaultHiddenSourceObjectIds ?? []);
const defaultHiddenContextMeshIds = contextRows
  .filter((source: SourceMesh) => hiddenContextSourceIds.has(source.sourceObjectId))
  .map((source: SourceMesh) => source.meshId)
  .sort();
if (defaultHiddenContextMeshIds.length !== hiddenContextSourceIds.size) {
  const resolved = new Set(contextRows.map((source: SourceMesh) => source.sourceObjectId));
  const missing = [...hiddenContextSourceIds].filter((sourceObjectId) => !resolved.has(sourceObjectId));
  throw new Error("Default-hidden context IDs must resolve to non-selectable source meshes: " + (missing.join(", ") || "duplicate source IDs"));
}
const glbIdentityCount = (gltf.nodes ?? []).filter((node) => Number.isInteger(node.mesh) && typeof node.extras?.bodycastMeshId === "string").length;
if (regions.length !== report.selectableMeshCount || contextNodes.length !== report.contextMeshCount || glbIdentityCount !== regions.length + contextNodes.length) {
  throw new Error("Generation report, GLB identities, and BodyCast adapter counts differ.");
}
if (hash !== report.glbSha256 || assetPath.byteLength !== report.glbBytes) throw new Error("GLB hash or size differs from Blender report.");

const unavailableIds = new Set<string>([...unavailableByAnatomy.keys()]);
const subtreeRows = (anatomyId: string, groupId?: string) => {
  const subtree = new Set<string>(bodyMapAnatomySubtreeIdsV2(anatomyId));
  return regions.filter((region) => (!groupId || region.bodyMapGroupIds.includes(groupId as BodyMapGroupIdV2))
    && region.anatomyIds.some((id) => subtree.has(id)));
};
const availabilityFor = (anatomyId: string, rows: Region[]) => {
  if (rows.length === 0) return "unavailable";
  const subtree = bodyMapAnatomySubtreeIdsV2(anatomyId);
  if (subtree.some((id) => unavailableIds.has(id))) return "partial";
  return "represented";
};
const limitationsFor = (anatomyId: string, rows: Region[]) => {
  const subtree = bodyMapAnatomySubtreeIdsV2(anatomyId);
  const messages = subtree.filter((id) => unavailableByAnatomy.has(id)).map((id) => {
    const label = BODY_MAP_TAXONOMY_V2.find((node) => node.id === id)?.label ?? id;
    return label + ": " + unavailableByAnatomy.get(id);
  });
  if (rows.length === 0 && messages.length === 0) messages.push("No separate selectable BodyParts3D mesh is mapped for this anatomy in the current source release.");
  const note = mappingNoteByAnatomy.get(anatomyId);
  if (note) messages.push(note);
  return unique(messages);
};

const anatomyCoverage = BODY_MAP_TAXONOMY_V2.map((node) => {
  const rows = subtreeRows(node.id);
  const meshIds = unique(rows.map((region) => region.meshId));
  return {
    anatomyId: node.id,
    parentId: node.parentId,
    label: node.label,
    bodyMapGroupIds: bodyMapGroupIdsForAnatomyV2([node.id]),
    analyticsGroupIds: [...(analyticsGroupsByAnatomy.get(node.id) ?? [])],
    visualRegionIds: rows.map((region) => region.visualRegionId),
    representedMeshIds: meshIds,
    descendantAnatomyIds: bodyMapAnatomySubtreeIdsV2(node.id),
    visualAvailability: availabilityFor(node.id, rows),
    limitations: limitationsFor(node.id, rows),
  };
});

const boundsFor = (rows: Array<{ bounds?: Bounds }>) => {
  const valid = rows.map((row) => row.bounds).filter((bounds): bounds is Bounds => Boolean(bounds?.min && bounds?.max));
  if (!valid.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    min: [0, 1, 2].map((index) => Math.min(...valid.map((bounds) => bounds.min[index]))),
    max: [0, 1, 2].map((index) => Math.max(...valid.map((bounds) => bounds.max[index]))),
  };
};

const bodyMapGroups = buildBodyMapGroupsV2().map((group) => {
  const groupRegions = regions.filter((region) => region.bodyMapGroupIds.includes(group.id));
  const missing = group.subregions.filter((node) => unavailableIds.has(node.id)).map((node) => node.label);
  const groupAvailability = missing.length ? "partial" : "represented";
  const subregions = group.subregions.map((node) => {
    const rows = subtreeRows(node.id, group.id);
    const exactRows = regions.filter((region) => region.bodyMapGroupIds.includes(group.id) && region.anatomyIds.includes(node.id));
    const sides = {
      left: rows.filter((region) => region.side === "left").map((region) => region.meshId),
      right: rows.filter((region) => region.side === "right").map((region) => region.meshId),
      midline: rows.filter((region) => region.side === "midline").map((region) => region.meshId),
      unspecified: rows.filter((region) => region.side === "unspecified").map((region) => region.meshId),
    };
    const sideValues = new Set(rows.map((region) => region.side));
    const sideMode = sideValues.has("left") && sideValues.has("right") ? "bilateral" : sideValues.has("midline") ? "midline" : rows.length ? "unilateral" : "unavailable";
    const visualAvailability = availabilityFor(node.id, rows);
    const descendantAnatomyIds = bodyMapAnatomySubtreeIdsV2(node.id);
    return {
      anatomyId: node.id,
      label: node.label,
      parentAnatomyId: node.parentId,
      kind: node.kind,
      intendedRepresentation: node.kind === "functional-region" ? "functional-region-supported-by-named-muscle-meshes" : "independent-source-muscle-meshes",
      visualAvailability,
      sideMode,
      sides,
      meshIds: unique(rows.map((region) => region.meshId)),
      representedMeshIds: unique(rows.map((region) => region.meshId)),
      descendantAnatomyIds,
      assetIds: rows.length ? [assetId] : [],
      representation: exactRows.some((region) => region.sourceObjectId === "BODYCAST-AUTHORED") ? "bodycast-authored-volumetric-meshes" : exactRows.length ? "source-meshes-bound-to-anatomy" : rows.length ? "represented-through-named-descendants" : "not-represented-in-source",
      limitations: limitationsFor(node.id, rows),
    };
  });
  const limitationText = missing.length ? "Coverage is partial; unavailable BodyCast areas: " + unique(missing).join(", ") + "." : "";
  return {
    groupId: group.id,
    kind: group.kind,
    label: group.label,
    note: limitationText ? group.note + " " + limitationText : group.note,
    fallbackAnchor: group.fallbackAnchor,
    legacyAnalyticsGroupId: group.legacyAnalyticsGroupId,
    bodyMapGroupIds: [group.id],
    analyticsGroupIds: unique(groupRegions.flatMap((region) => region.analyticsGroupIds)),
    assetIds: groupRegions.length ? [assetId] : [],
    subregions,
    cameraBounds: boundsFor(groupRegions),
    camera: {
      preferredDirection: group.preferredDirection,
      targetPolicy: "bounds-center-from-source-mapped-meshes",
      framingPolicy: "fit-real-mesh-bounds-with-responsive-padding",
      desktopTransitionMs: 620,
      mobileTransitionMs: 760,
      reducedMotionTransitionMs: 0,
      near: 0.01,
      far: 20,
      paddingFactor: BODY_MAP_OVERVIEW_PADDING_FACTOR_V1,
    },
    visualAvailability: groupAvailability,
  };
});

const demoExposure = [...buildBodyMapDemoExposureFixtureV2()];
const groupAssetIds = Object.fromEntries(BODY_MAP_GROUP_CATALOG_V2.map((group) => [
  group.id,
  unique(regions.filter((region) => region.bodyMapGroupIds.includes(group.id)).map((region) => region.meshId)),
]));
const output = {
  contract: v2 ? "bodycast-body-map-local-runtime-v2" : "bodycast-body-map-local-runtime-v1",
  contractVersion: v2 ? `bodycast-body-map-local-runtime-${revision}.0.0` : "bodycast-body-map-local-runtime-v1.0.0",
  catalog: { contract: BODY_MAP_CATALOG_CONTRACT_V2, version: BODY_MAP_CATALOG_VERSION_V2 },
  taxonomyVersion: BODY_MAP_TAXONOMY_VERSION_V2,
  exerciseMappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
  cameraContract: { contract: BODY_MAP_CAMERA_CONTRACT_V1, version: BODY_MAP_CAMERA_VERSION_V1 },
  navigationContract: { contract: BODY_MAP_NAVIGATION_CONTRACT_V2, version: BODY_MAP_NAVIGATION_VERSION_V2 },
  trainingExposure: {
    contract: BODY_MAP_EXPOSURE_CONTRACT_V2,
    version: BODY_MAP_EXPOSURE_VERSION_V2,
    source: "DEMO DATA",
    groups: demoExposure,
  },
  navigationMembership: {
    contract: BODY_MAP_NAVIGATION_MEMBERSHIP_V2.contract,
    version: BODY_MAP_NAVIGATION_MEMBERSHIP_V2.version,
    pairs: BODY_MAP_MEMBERSHIP_V2,
    primaryPickGroupByAnatomyId: BODY_MAP_PRIMARY_PICK_GROUP_BY_ANATOMY_ID_V2,
  },
  bodyMapGroups,
  anatomyCoverage,
  asset: {
    assetVersion: v2 ? `bodycast-bodyparts3d-runtime-${revision}.0.0` : "bodycast-bodyparts3d-runtime-v1.0.0",
    visualSelectionStatus: v2 ? "verified-source-and-bodycast-authored-mesh-identities" : "verified-source-mesh-identities-local-only",
    selectableRegionCount: regions.length,
    totalRuntimeBytes: assetPath.byteLength,
    totalSourceMeshCount: glbIdentityCount,
    sourceTriangleCount: report.triangleCount,
    triangleCount: glbTriangleCount(gltf),
    uniqueGeometryTriangleCount: glbTriangleCount(gltf),
    gltfPrimitiveCount: (gltf.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives?.length ?? 0), 0),
    contextMeshCount: contextNodes.length,
  },
  viewerAsset: {
    path: assetName,
    sha256: hash,
    status: v2 ? "versioned candidate; official current CC BY 4.0 terms and legacy OBJ header discrepancy documented; anatomy remains an educational approximation requiring review" : "local-only candidate; redistribution blocked pending source-license clarification and missing major anatomy",
    mayClaimMusclePicking: true,
    assetId,
    selectableMeshCount: regions.length,
    contextMeshCount: contextNodes.length,
    triangleCount: glbTriangleCount(gltf),
    byteLength: assetPath.byteLength,
  },
  runtimeAssets: [{
    assetId,
    path: assetName,
    sha256: hash,
    byteLength: assetPath.byteLength,
    meshNodeCount: glbIdentityCount,
    selectableMeshCount: regions.length,
    contextMeshCount: contextNodes.length,
    faceCount: report.faceCount,
    triangleCount: glbTriangleCount(gltf),
    vertexCount: report.vertexCount,
    materialSlots: (gltf.materials ?? []).length,
    compression: (gltf.extensionsUsed ?? []).includes("EXT_meshopt_compression") ? "EXT_meshopt_compression" : "none",
  }],
  visualIdentity: {
    manifestVersion: "bodycast-bodyparts3d-visual-identity-v1.0.0",
    supportedRegions: regions.map(withoutBounds),
    contextNodes: contextNodes.map(withoutContextMetadata),
    ...(mapping.presentation ? {
      contextVisibility: {
        contract: mapping.presentation.contract,
        version: mapping.presentation.version,
        defaultHiddenContextMeshIds,
      },
    } : {}),
    groupAssetIds,
  },
  demoData: {
    label: "DEMO DATA · FIXTURE",
    groupExposureStates: demoExposure,
    groupUniqueSetCounts: Object.fromEntries(demoExposure.map((row) => [row.groupId, row.totalUniqueSetCount])),
    note: "Deterministic fixture projected through the current BodyCast exercise mapping. No user training data or physiological score is inferred.",
  },
  provenance: {
    sourceName: "BodyParts3D",
    release: "4.0",
    officialDownloadUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html",
    officialLicenseUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
    sourceArchiveHashes: report.sourceArchiveHashes,
    visualMappingVersion: mapping.version,
    bodycastAuthoredGeometry: mapping.independentGeometry ?? [],
    geometryTransform: report.coordinateTransform,
    geometryProcessing: report.geometryProcessing,
    glbSha256: hash,
    glbBytes: assetPath.byteLength,
    licenseReview: mapping.licenseReview,
    redistribution: v2 ? "allowed under current official README CC BY 4.0 grant with required attribution and disclosed legacy OBJ header discrepancy; see licenseReview" : "not-cleared",
  },
  status: v2 ? "versioned validation candidate; source attribution and legacy header discrepancy disclosed; independently authored required muscles included, visual/anatomy review remains open" : "local-only validation candidate; licensing and major anatomy coverage remain open",
};

await writeFile(resolve(root, manifestName), JSON.stringify(output, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({
  manifest: manifestName,
  glbSha256: hash,
  glbBytes: assetPath.byteLength,
  groups: bodyMapGroups.length,
  anatomyIds: anatomyCoverage.length,
  mappedNodes: regions.length,
  contextNodes: contextNodes.length,
  representedAnatomyIds: anatomyCoverage.filter((row) => row.visualAvailability !== "unavailable").length,
  unavailableAnatomy: anatomyCoverage.filter((row) => row.visualAvailability === "unavailable").map((row) => row.anatomyId),
  partialGroups: bodyMapGroups.filter((group) => group.visualAvailability === "partial").map((group) => group.groupId),
}, null, 2));

}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function withoutBounds<T extends { bounds: Bounds }>(row: T): Omit<T, "bounds"> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "bounds")) as Omit<T, "bounds">;
}

function withoutContextMetadata<T extends { bounds: Bounds; sourceObjectId: string }>(row: T): Omit<T, "bounds" | "sourceObjectId"> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "bounds" && key !== "sourceObjectId")) as Omit<T, "bounds" | "sourceObjectId">;
}
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function glbTriangleCount(document: GltfDocument): number {
  const nodes = (document.nodes ?? []).filter((node): node is GltfNode & { mesh: number } => Number.isInteger(node.mesh));
  return nodes.reduce((sum, node) => sum + (document.meshes?.[node.mesh]?.primitives ?? []).reduce((meshSum, primitive) => {
    if (primitive.mode !== undefined && primitive.mode !== 4) return meshSum;
    const indexCount = Number.isInteger(primitive.indices) ? document.accessors?.[primitive.indices as number]?.count : null;
    const vertexCount = document.accessors?.[primitive.attributes?.POSITION ?? -1]?.count ?? 0;
    return meshSum + Math.floor((indexCount ?? vertexCount) / 3);
  }, 0), 0);
}

function readGlbJson(buffer: Buffer): GltfDocument {
  if (buffer.byteLength < 20 || buffer.readUInt32LE(0) !== 0x46546c67
    || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.byteLength) {
    throw new Error("Invalid GLB header or declared length.");
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB JSON chunk is missing.");
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trimEnd()) as GltfDocument;
}

type Bounds = { min: number[]; max: number[] };
type SourceMesh = {
  meshId: string;
  sourceObjectId: string;
  geometryOrigin?: string;
  geometryMethod?: string;
  geometryProfileContract?: string;
  geometryMetrics?: Record<string, unknown>;
  attachmentContract?: string;
  selectable: boolean;
  anatomyIds: AnatomyIdV2[]
  side: "left" | "right" | "midline" | "unspecified";
  depthLayer: "superficial" | "deep" | "supplemental" | "support";
  contextPresentation: "supplemental-muscle" | "support-only" | "skeletal-context" | "cranial-context" | "body-silhouette-context";
  contextKind?: string;
  bounds: Bounds;
};
type Region = {
  visualRegionId: string;
  meshId: string;
  gltfNodeName: string;
  anatomyId: AnatomyIdV2;
  anatomyIds: AnatomyIdV2[]
  bodyMapGroupIds: BodyMapGroupIdV2[];
  analyticsGroupIds: string[];
  primaryPickGroupId: BodyMapGroupIdV2;
  side: string;
  depthLayer: string;
  sourceObjectName: string;
  assetId: string;
  selectable: true;
  bounds: Bounds;
  sourceObjectId?: string;
  geometryOrigin?: string;
  geometryMethod?: string;
  geometryProfileContract?: string;
  geometryMetrics?: Record<string, unknown>;
  attachmentContract?: string;
};

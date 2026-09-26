import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputName, outputName, assetName, reportName, ...excludeIds] = process.argv.slice(2);
if (!inputName || !outputName || !assetName || !reportName) {
  throw new Error("Usage: node scripts/body-map/prepare-local-manifest.mjs <input-manifest> <output-manifest> <glb-path-from-repo-root> <blender-report> [context-mesh-id ...]");
}

const root = process.cwd();
const inputPath = resolve(root, inputName);
const outputPath = resolve(root, outputName);
const assetPath = resolve(root, assetName);
const reportPath = resolve(root, reportName);
const manifest = JSON.parse(await readFile(inputPath, "utf8"));
const report = JSON.parse(await readFile(reportPath, "utf8"));
const bytes = await readFile(assetPath);
const hash = createHash("sha256").update(bytes).digest("hex");
const removedIds = new Set(excludeIds);
if (removedIds.size !== excludeIds.length) throw new Error("Duplicate exclusion identity.");

const contextNodes = manifest.visualIdentity?.contextNodes;
if (!Array.isArray(contextNodes)) throw new Error("Input manifest has no context mesh identities.");
const found = new Set(contextNodes.filter(({ meshId }) => removedIds.has(meshId)).map(({ meshId }) => meshId));
if (found.size !== removedIds.size) throw new Error("At least one exclusion is absent or selectable in the input manifest.");
manifest.visualIdentity.contextNodes = contextNodes.filter(({ meshId }) => !removedIds.has(meshId));
if (Array.isArray(manifest.curation?.sourceMeshInventory)) {
  manifest.curation.sourceMeshInventory = manifest.curation.sourceMeshInventory.filter(({ meshId }) => !removedIds.has(meshId));
}

const gltf = readGlbJson(bytes);
const nodes = (gltf.nodes ?? []).filter((node) => Number.isInteger(node.mesh));
const identityNodes = nodes.filter((node) => typeof node.extras?.bodycastMeshId === "string");
let selectableCount = 0;
let contextCount = 0;
for (const node of identityNodes) {
  if (node.extras?.bodycastSelectable === true) selectableCount += 1;
  else if (node.extras?.bodycastSelectable === false) contextCount += 1;
  else throw new Error(`GLB node has no selectable contract: ${node.name ?? "<unnamed>"}`);
}
const primitiveCount = (gltf.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives?.length ?? 0), 0);
const trianglesForPrimitive = (primitive) => {
  if (primitive.mode !== undefined && primitive.mode !== 4) return 0;
  const indexCount = Number.isInteger(primitive.indices) ? gltf.accessors?.[primitive.indices]?.count : null;
  const positionCount = gltf.accessors?.[primitive.attributes?.POSITION]?.count ?? 0;
  return Math.floor((indexCount ?? positionCount) / 3);
};
const renderedTriangles = nodes.reduce((sum, node) => sum + (gltf.meshes[node.mesh]?.primitives ?? [])
  .reduce((meshSum, primitive) => meshSum + trianglesForPrimitive(primitive), 0), 0);
const uniqueTriangles = [...new Set(nodes.map(({ mesh }) => mesh))].reduce((sum, meshId) =>
  sum + (gltf.meshes[meshId]?.primitives ?? []).reduce((meshSum, primitive) => meshSum + trianglesForPrimitive(primitive), 0), 0);
if (selectableCount !== manifest.visualIdentity.supportedRegions.length
  || contextCount !== manifest.visualIdentity.contextNodes.length
  || identityNodes.length !== report.meshNodeCount) {
  throw new Error("Filtered GLB identity counts do not match the retained runtime manifest and Blender report.");
}
if (report.glbSha256 !== hash || report.glbByteLength !== bytes.byteLength
  || report.selectableMeshCount !== selectableCount || report.contextMeshCount !== contextCount) {
  throw new Error("GLB bytes or Blender counts do not match the local export report.");
}

const priorAssetId = manifest.viewerAsset.assetId;
const assetId = `${priorAssetId}-local`;
replaceValue(manifest, priorAssetId, assetId);
const runtimeAsset = manifest.runtimeAssets[0];
Object.assign(runtimeAsset, {
  assetId,
  path: assetName.replaceAll("\\", "/"),
  sha256: hash,
  byteLength: bytes.byteLength,
  meshNodeCount: identityNodes.length,
  selectableMeshCount: selectableCount,
  contextMeshCount: contextCount,
  faceCount: report.polygonCount,
  triangleCount: renderedTriangles,
  uniqueGeometryTriangleCount: uniqueTriangles,
  sourceTriangleCount: report.triangleCount,
  gltfPrimitiveCount: primitiveCount,
  gltfMeshCount: gltf.meshes?.length ?? 0,
  vertexCount: report.vertexCount,
  materialSlots: report.materialSlots,
  compression: gltf.extensionsUsed?.includes("EXT_meshopt_compression") ? "EXT_meshopt_compression" : "none",
  performanceStatus: "locally generated; validate before redistribution",
});
Object.assign(manifest.viewerAsset, {
  assetId,
  path: assetName.replaceAll("\\", "/"),
  sha256: hash,
  selectableMeshCount: selectableCount,
  contextMeshCount: contextCount,
  triangleCount: renderedTriangles,
  uniqueGeometryTriangleCount: uniqueTriangles,
  sourceTriangleCount: report.triangleCount,
  primitiveCount,
  gltfMeshCount: gltf.meshes?.length ?? 0,
  byteLength: bytes.byteLength,
});
Object.assign(manifest.asset, {
  assetVersion: "locally-filtered-runtime-asset-v1",
  selectableRegionCount: selectableCount,
  totalRuntimeBytes: bytes.byteLength,
  totalSourceMeshCount: identityNodes.length,
  sourceTriangleCount: report.triangleCount,
  triangleCount: renderedTriangles,
  uniqueGeometryTriangleCount: uniqueTriangles,
  gltfPrimitiveCount: primitiveCount,
  contextMeshCount: contextCount,
});
manifest.curation.counts = {
  ...(manifest.curation.counts ?? {}),
  totalMeshCount: identityNodes.length,
  selectableMeshCount: selectableCount,
  contextMeshCount: contextCount,
  sourceFaceCount: report.polygonCount,
  triangleCount: report.triangleCount,
  vertexCount: report.vertexCount,
  materialSlots: report.materialSlots,
};
manifest.provenance.derivedMeshCount = nodes.length;
manifest.provenance.glbSha256 = hash;
manifest.provenance.glbBytes = bytes.byteLength;
manifest.provenance.modifications = [
  ...(manifest.provenance.modifications ?? []),
  `Removed ${removedIds.size} explicitly requested non-selectable context meshes from this local derivative.`,
];
manifest.contract = "bodycast-body-map-local-runtime-v1";
manifest.contractVersion = "bodycast-body-map-local-runtime-v1.0.0";
manifest.status = "local-only runtime asset; no redistribution decision is implied";
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputManifest: outputName,
  assetPath: runtimeAsset.path,
  sha256: hash,
  byteLength: bytes.byteLength,
  meshNodeCount: identityNodes.length,
  selectableMeshCount: selectableCount,
  contextMeshCount: contextCount,
  excludedContextCount: removedIds.size,
  groupCount: manifest.bodyMapGroups.length,
  taxonomyCount: manifest.anatomyCoverage.length,
  triangleCount: renderedTriangles,
}, null, 2));

function replaceValue(value, oldValue, newValue) {
  if (typeof value === "string") return value === oldValue ? newValue : value;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) value[index] = replaceValue(item, oldValue, newValue);
    return value;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) value[key] = replaceValue(item, oldValue, newValue);
  }
  return value;
}

function readGlbJson(buffer) {
  if (buffer.byteLength < 20 || buffer.readUInt32LE(0) !== 0x46546c67
    || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.byteLength) {
    throw new Error("Invalid GLB header or declared length.");
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB JSON chunk is missing.");
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import validator from "gltf-validator";

const root = process.cwd();
const manifestPath = resolve(root, process.argv[2] ?? "3d-model/local-assets/body-map-runtime-manifest.json");
const localAssetRoot = resolve(root, "3d-model/local-assets");
const reportPath = resolve(root, process.argv[3] ?? "3d-model/local-assets/validation-report.json");

const content = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(content);
if (!Array.isArray(manifest.runtimeAssets) || manifest.runtimeAssets.length !== 1) {
  throw new Error("Expected one local full-body runtime asset.");
}
if (!Array.isArray(manifest.bodyMapGroups) || !Array.isArray(manifest.visualIdentity?.supportedRegions)
  || !Array.isArray(manifest.visualIdentity?.contextNodes)) {
  throw new Error("The local runtime manifest is missing its group or mesh identity collections.");
}

const asset = manifest.runtimeAssets[0];
const assetPath = resolve(root, asset.path);
const relativeAssetPath = relative(localAssetRoot, assetPath);
if (relativeAssetPath === ".." || relativeAssetPath.startsWith(`..${sep}`) || isAbsolute(relativeAssetPath)) {
  throw new Error("The GLB path must stay inside 3d-model/local-assets.");
}
const bytes = await readFile(assetPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== asset.sha256 || bytes.byteLength !== asset.byteLength
  || sha256 !== manifest.viewerAsset?.sha256 || bytes.byteLength !== manifest.viewerAsset?.byteLength) {
  throw new Error("The local GLB hash or byte length does not match its manifest.");
}

const gltf = readGlbJson(bytes);
const meshNodes = (gltf.nodes ?? []).filter((node) => Number.isInteger(node.mesh));
const identityNodes = meshNodes.filter((node) => typeof node.extras?.bodycastMeshId === "string");
const nodeById = new Map();
const failures = [];
let selectableCount = 0;
let contextCount = 0;
for (const node of identityNodes) {
  const meshId = node.extras?.bodycastMeshId;
  if (typeof meshId !== "string" || nodeById.has(meshId)) {
    failures.push(`missing or duplicate mesh identity on node ${node.name ?? "<unnamed>"}`);
    continue;
  }
  nodeById.set(meshId, node);
  if (node.extras?.bodycastSelectable === true) selectableCount += 1;
  else if (node.extras?.bodycastSelectable === false) contextCount += 1;
  else failures.push(`missing selectable flag on node ${node.name ?? meshId}`);
}

const groupIds = new Set(manifest.bodyMapGroups.map(({ groupId }) => groupId));
const supported = manifest.visualIdentity.supportedRegions;
const contexts = manifest.visualIdentity.contextNodes;
const seenRegions = new Set();
for (const region of supported) {
  const node = nodeById.get(region.meshId);
  if (seenRegions.has(region.meshId)) failures.push(`duplicate selectable manifest identity ${region.meshId}`);
  seenRegions.add(region.meshId);
  if (!node || node.name !== region.gltfNodeName || node.extras?.bodycastSelectable !== true) {
    failures.push(`selectable node mismatch ${region.meshId}`);
  }
  if (!groupIds.has(region.primaryPickGroupId) || !region.bodyMapGroupIds.includes(region.primaryPickGroupId)
    || region.bodyMapGroupIds.some((groupId) => !groupIds.has(groupId))) {
    failures.push(`invalid group binding ${region.meshId}`);
  }
  if (!Array.isArray(region.anatomyIds) || region.anatomyIds.length === 0
    || region.anatomyIds.some((id) => !manifest.anatomyCoverage?.some((entry) => entry.anatomyId === id))) {
    failures.push(`invalid taxonomy binding ${region.meshId}`);
  }
}
for (const context of contexts) {
  const node = nodeById.get(context.meshId);
  if (!node || node.name !== context.gltfNodeName || node.extras?.bodycastSelectable !== false) {
    failures.push(`context node mismatch ${context.meshId}`);
  }
}
if (identityNodes.length !== nodeById.size || supported.length !== selectableCount || contexts.length !== contextCount) {
  failures.push("GLB node counts differ from manifest identities.");
}
if (manifest.viewerAsset.selectableMeshCount !== selectableCount || manifest.viewerAsset.contextMeshCount !== contextCount) {
  failures.push("Viewer asset counts differ from GLB node counts.");
}
if (manifest.bodyMapGroups.some(({ groupId }) => !supported.some((region) => region.bodyMapGroupIds.includes(groupId)))) {
  failures.push("A catalog group has no selectable mesh binding.");
}

const validation = await validator.validateBytes(new Uint8Array(bytes), {
  uri: relative(root, assetPath).replaceAll("\\", "/"),
  format: "glb",
  writeTimestamp: false,
  maxIssues: 250,
});
if (validation.issues.numErrors > 0) failures.push(`Khronos validator reported ${validation.issues.numErrors} errors.`);
if (failures.length) throw new Error(failures.slice(0, 30).join("\n"));

const result = {
  status: "passed",
  validator: validator.version(),
  assetId: asset.assetId,
  sha256,
  byteLength: bytes.byteLength,
  meshNodeCount: identityNodes.length,
  gltfGeometryNodeCount: meshNodes.length,
  selectableMeshCount: selectableCount,
  contextMeshCount: contextCount,
  groupCount: groupIds.size,
  anatomyCount: manifest.anatomyCoverage?.length ?? null,
  issues: validation.issues,
};
await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));

function readGlbJson(buffer) {
  if (buffer.byteLength < 20 || buffer.readUInt32LE(0) !== 0x46546c67
    || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.byteLength) {
    throw new Error("Invalid GLB header or declared length.");
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB JSON chunk is missing.");
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

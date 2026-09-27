import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const revision = process.argv.includes('--v3') ? 'v3' : 'v2';
const sourceRoot = resolve(root, `3d-model/local-assets/bodyparts3d-${revision}`);
const glbName = `bodyparts3d-v4.0-full-body-${revision}.glb`;
const sourceManifestPath = join(sourceRoot, `body-map-runtime-manifest-${revision}.json`);
const sourceMappingPath = resolve(root, `3d-model/bodyparts3d-adapter-v2/visual-mapping-${revision}.json`);
const destinationRoot = resolve(root, `public/body-map/bodyparts3d-${revision}`);
const runtimeManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
const mapping = JSON.parse(await readFile(sourceMappingPath, 'utf8'));
const sourceGlb = join(sourceRoot, glbName);
const bytes = await readFile(sourceGlb);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== runtimeManifest.viewerAsset.sha256 || bytes.byteLength !== runtimeManifest.viewerAsset.byteLength) {
  throw new Error('Source GLB failed revision manifest hash/size verification.');
}
if (runtimeManifest.bodyMapGroups.length !== 20 || runtimeManifest.visualIdentity.supportedRegions.length !== runtimeManifest.viewerAsset.selectableMeshCount) {
  throw new Error('Source manifest is missing the expected catalog or selectable identities.');
}
const gltf = readGlbJson(bytes);
const nodes = new Map((gltf.nodes ?? []).filter((node) => typeof node.extras?.bodycastMeshId === 'string').map((node) => [node.extras.bodycastMeshId, node]));
for (const region of runtimeManifest.visualIdentity.supportedRegions) {
  const node = nodes.get(region.meshId);
  if (!node || node.name !== region.gltfNodeName || node.extras.bodycastSelectable !== true) throw new Error(`Missing selectable GLB identity ${region.meshId}`);
}
const authored = (mapping.independentGeometry ?? []).map((item) => ({
  anatomyId: item.anatomyId,
  geometryId: item.geometryId,
  construction: item.construction,
  reference: item.reference,
  meshIds: [item.leftMeshId, item.rightMeshId],
  geometryProfileContract: item.geometryProfileContract,
}));
for (const item of authored) for (const meshId of item.meshIds) {
  const node = nodes.get(meshId);
  if (!node || node.extras.bodycastGeometryOrigin !== item.geometryId
    || node.extras.bodycastGeometryProfileContract !== item.geometryProfileContract) {
    throw new Error(`BodyCast authored geometry is missing or has unexpected provenance: ${meshId}`);
  }
}
const document = {
  schema: 'https://bodycast.app/schemas/body-map-static-delivery-v2.json',
  schemaVersion: '2.0.0',
  release: `bodyparts3d-v4.0-bodycast-${revision}`,
  delivery: 'versioned-public-static-files',
  asset: {
    assetId: runtimeManifest.viewerAsset.assetId,
    url: `/body-map/bodyparts3d-${revision}/${glbName}`,
    mediaType: 'model/gltf-binary',
    sha256,
    byteLength: bytes.byteLength,
    triangleCount: runtimeManifest.viewerAsset.triangleCount,
    selectableMeshCount: runtimeManifest.viewerAsset.selectableMeshCount,
    contextMeshCount: runtimeManifest.viewerAsset.contextMeshCount,
    compression: 'EXT_meshopt_compression',
    extensionRequiredByViewer: true,
  },
  contracts: {
    catalog: runtimeManifest.catalog,
    taxonomyVersion: runtimeManifest.taxonomyVersion,
    navigation: runtimeManifest.navigationContract,
    camera: runtimeManifest.cameraContract,
    visualMappingVersion: mapping.version,
  },
  bodyMapGroups: runtimeManifest.bodyMapGroups,
  anatomyCoverage: runtimeManifest.anatomyCoverage,
  visualIdentity: runtimeManifest.visualIdentity,
  provenance: {
    dataset: 'BodyParts3D',
    release: '4.0',
    officialReadmeUrl: mapping.licenseReview.officialReadme,
    officialReadmeDate: mapping.licenseReview.officialReadmeDate,
    officialDownloadUrl: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
    officialLicenseUrl: mapping.licenseReview.officialLicenseUrl,
    sourceArchiveHashes: runtimeManifest.provenance.sourceArchiveHashes,
    license: 'CC BY 4.0 per the current official README, which lists these exact Release 4.0 archives.',
    attribution: mapping.licenseReview.currentOfficialAttribution,
    legacyObjHeaderNotice: mapping.licenseReview.legacyObjHeaderLicense,
    licenseInterpretation: mapping.licenseReview.interpretation,
    disclosedUncertainty: mapping.licenseReview.uncertainty,
    changes: 'Selected meshes, transformed axes and units, normalized object identities and materials, compressed to GLB; four missing anatomy concepts are separately authored BodyCast volumes and are not represented as BodyParts3D-derived.',
    bodycastAuthoredGeometry: authored,
  },
  restrictions: {
    noTrainingExposureData: true,
    noUserData: true,
    physiologyOrEnergyData: false,
  },
};
const attribution = `# Body Map asset attribution\n\n## BodyParts3D 4.0\n\n${mapping.licenseReview.currentOfficialAttribution}\n\nOfficial source: [BodyParts3D 2025-02-27 README](${mapping.licenseReview.officialReadme}) and [official database license](${mapping.licenseReview.officialLicenseUrl}). The current README lists the exact Release 4.0 archives used here and states CC BY 4.0, including permission to redistribute and adapt with attribution.\n\n**Changes:** selected and mapped source meshes; changed coordinate axes and units; normalized node names/metadata; combined selected structures in a GLB and applied mesh compression.\n\n**Embedded notice discrepancy:** all 3,492 OBJ headers scanned in the two official archives state CC BY-SA 2.1 Japan. The official README now lists those exact archive files under the current CC BY 4.0 terms; its document date is 2025-02-27, its license section says 2025-02-25, and its history says the license was updated 2025-02-27. Headers and archives are preserved unchanged. This delivery follows the current official database terms and makes the older embedded notices explicit; the discrepancy is not silently resolved or represented as a legal ruling.\n\n## Independently authored anatomy\n\nThe bilateral latissimus dorsi, rectus abdominis, internal oblique, and transversus abdominis volumes are BodyCast-authored educational visual approximations, built from documented attachments and muscle-layer/fiber directions. They are not copied or renamed BodyParts3D meshes and are not covered by the BodyParts3D attribution above. They require anatomy review before being treated as authoritative.\n`;
const parent = resolve(root, 'public/body-map');
await mkdir(parent, { recursive: true });
if (await exists(destinationRoot)) throw new Error(`Refusing to overwrite existing delivery directory: ${destinationRoot}`);
const stage = await mkdtemp(join(parent, '.bodyparts3d-v2-stage-'));
try {
  await copyFile(sourceGlb, join(stage, glbName));
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(stage, 'ATTRIBUTION.md'), attribution, { flag: 'wx' });
  await rename(stage, destinationRoot);
} catch (error) {
  await rm(stage, { recursive: true, force: true });
  throw error;
}
console.log(JSON.stringify({ directory: destinationRoot, glb: join(destinationRoot, glbName), manifest: join(destinationRoot, 'manifest.json'), sha256, byteLength: bytes.byteLength }, null, 2));

function readGlbJson(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('Invalid GLB header.');
  const length = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Missing GLB JSON chunk.');
  return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8').trimEnd());
}
async function exists(path) {
  try { await access(path); return true; }
  catch { return false; }
}

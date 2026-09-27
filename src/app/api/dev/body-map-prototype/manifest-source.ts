import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

type ViewerAssetManifest = {
  viewerAsset?: { assetId?: string; path?: string; sha256?: string };
  runtimeAssets?: Array<{ assetId: string; path: string; sha256: string }>;
  [key: string]: unknown;
};

export const LOCAL_BODY_MAP_MANIFEST_PATH = "3d-model/local-assets/bodyparts3d-v3/body-map-runtime-manifest-v3.json" as const;
export const BODY_MAP_MANIFEST_PATH_ENV = "BODY_MAP_MANIFEST_PATH" as const;

export async function readBodyMapPrototypeManifest(root: string): Promise<{
  content: string;
  manifest: ViewerAssetManifest;
}> {
  const relativeManifestPath = process.env[BODY_MAP_MANIFEST_PATH_ENV] ?? LOCAL_BODY_MAP_MANIFEST_PATH;
  const manifestPath = resolve(root, relativeManifestPath);
  const withinWorkspace = relative(resolve(root), manifestPath);
  if (isAbsolute(relativeManifestPath) || withinWorkspace === ".." || withinWorkspace.startsWith(`..${sep}`) || isAbsolute(withinWorkspace)) {
    throw new Error("Body Map manifest path must remain inside the repository workspace.");
  }
  const content = await readFile(/* turbopackIgnore: true */ manifestPath, "utf8");
  return { content, manifest: JSON.parse(content) as ViewerAssetManifest };
}

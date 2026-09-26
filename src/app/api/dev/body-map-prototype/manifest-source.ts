import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ViewerAssetManifest = {
  viewerAsset?: { assetId?: string; path?: string; sha256?: string };
  runtimeAssets?: Array<{ assetId: string; path: string; sha256: string }>;
  [key: string]: unknown;
};

export const LOCAL_BODY_MAP_MANIFEST_PATH = "3d-model/local-assets/body-map-runtime-manifest.json" as const;

export async function readBodyMapPrototypeManifest(root: string): Promise<{
  content: string;
  manifest: ViewerAssetManifest;
}> {
  const content = await readFile(/* turbopackIgnore: true */ resolve(root, LOCAL_BODY_MAP_MANIFEST_PATH), "utf8");
  return { content, manifest: JSON.parse(content) as ViewerAssetManifest };
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { readBodyMapPrototypeManifest } from "../manifest-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const root = process.cwd();
  try {
    const { manifest } = await readBodyMapPrototypeManifest(root);
    const assetId = new URL(request.url).searchParams.get("assetId") ?? manifest.viewerAsset?.assetId ?? "studio-male-overview";
    const asset = manifest.runtimeAssets?.find((candidate) => candidate.assetId === assetId)
      ?? (assetId === "studio-male-overview" && manifest.viewerAsset?.path && manifest.viewerAsset.sha256
        ? { assetId, path: manifest.viewerAsset.path, sha256: manifest.viewerAsset.sha256 }
        : undefined);
    if (!asset?.path || !asset.sha256) return new Response("Unknown or unavailable versioned viewer asset.", { status: 404 });
    const path = resolve(root, asset.path);
    const withinModelWorkspace = relative(resolve(root, "3d-model"), path);
    if (withinModelWorkspace === ".." || withinModelWorkspace.startsWith(`..${sep}`) || isAbsolute(withinModelWorkspace)) {
      return new Response("Viewer asset path is outside the local model workspace.", { status: 400 });
    }
    const bytes = await readFile(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) return new Response("GLB hash does not match the versioned manifest.", { status: 409 });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${assetId}.glb"`,
        "X-BodyCast-Asset-SHA256": digest,
      },
    });
  } catch {
    return new Response("The versioned viewer GLB is unavailable.", { status: 503 });
  }
}

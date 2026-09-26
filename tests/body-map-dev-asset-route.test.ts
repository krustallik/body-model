import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/dev/body-map-prototype/asset/route";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("../src/app/api/dev/body-map-prototype/manifest-source", () => ({
  readBodyMapPrototypeManifest: vi.fn(),
}));

const bytes = Buffer.from("isolated route test payload");
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  runtimeAssets: [{ assetId: "group-chest", path: "3d-model/checkpoint-8-20260925/exports/groups/chest.glb", sha256: hash }],
};
const mockedReadFile = vi.mocked(readFile);
const { readBodyMapPrototypeManifest } = await import("../src/app/api/dev/body-map-prototype/manifest-source");
const mockedReadManifest = vi.mocked(readBodyMapPrototypeManifest);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  mockedReadFile.mockResolvedValue(bytes);
  mockedReadManifest.mockResolvedValue({ manifest } as Awaited<ReturnType<typeof readBodyMapPrototypeManifest>>);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("isolated Body Map asset API", () => {
  it("serves an allowlisted versioned GLB payload with its verified hash", async () => {
    const response = await GET(new Request("http://localhost/api/dev/body-map-prototype/asset?assetId=group-chest"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("model/gltf-binary");
    expect(response.headers.get("x-bodycast-asset-sha256")).toBe(hash);
    expect(Number(response.headers.get("content-length"))).toBe(bytes.byteLength);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects unknown asset IDs without reading a file", async () => {
    const response = await GET(new Request("http://localhost/api/dev/body-map-prototype/asset?assetId=..%2F..%2F.env"));
    expect(response.status).toBe(404);
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it("reports a missing local prototype asset as unavailable", async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const response = await GET(new Request("http://localhost/api/dev/body-map-prototype/asset?assetId=group-chest"));
    expect(response.status).toBe(503);
  });

  it("rejects bytes that do not match the versioned asset checksum", async () => {
    mockedReadFile.mockResolvedValueOnce(Buffer.from("changed payload"));
    const response = await GET(new Request("http://localhost/api/dev/body-map-prototype/asset?assetId=group-chest"));
    expect(response.status).toBe(409);
  });

  it("returns 404 in production before reading the manifest or asset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(new Request("http://localhost/api/dev/body-map-prototype/asset?assetId=group-chest"));
    expect(response.status).toBe(404);
    expect(mockedReadManifest).not.toHaveBeenCalled();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });
});

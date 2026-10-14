import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("versioned Body Map static asset cache policy", () => {
  it("caches only GLB files with immutable headers", async () => {
    const rules = await nextConfig.headers?.();
    const rule = rules?.find(({ source }) => source.includes("bodyparts3d-v3"));
    expect(rule?.source).toBe("/body-map/bodyparts3d-v3/:asset(.*\\.glb)");
    expect(rule?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
    expect(rule?.source).not.toContain("manifest");
  });
});

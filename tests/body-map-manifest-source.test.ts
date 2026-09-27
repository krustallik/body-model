import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

import { readFile } from "node:fs/promises";
import {
  LOCAL_BODY_MAP_MANIFEST_PATH,
  readBodyMapPrototypeManifest,
} from "../src/app/api/dev/body-map-prototype/manifest-source";

const mockedReadFile = vi.mocked(readFile);

afterEach(() => vi.clearAllMocks());

describe("local Body Map manifest source", () => {
  it("reads the active feature branch v3 local asset manifest by default", async () => {
    const content = JSON.stringify({ contract: "bodycast-test-contract" });
    mockedReadFile.mockResolvedValueOnce(content);

    const result = await readBodyMapPrototypeManifest("D:/bodycast-publication");

    expect(mockedReadFile).toHaveBeenCalledExactlyOnceWith(
      resolve("D:/bodycast-publication", LOCAL_BODY_MAP_MANIFEST_PATH),
      "utf8",
    );
    expect(result).toEqual({ content, manifest: { contract: "bodycast-test-contract" } });
  });

  it("does not fall back to older checkpoint manifests when v3 local data is absent", async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(readBodyMapPrototypeManifest("D:/bodycast-publication")).rejects.toMatchObject({ code: "ENOENT" });
    expect(mockedReadFile).toHaveBeenCalledExactlyOnceWith(
      resolve("D:/bodycast-publication", LOCAL_BODY_MAP_MANIFEST_PATH),
      "utf8",
    );
  });

  it("allows a contained revision override and rejects traversal", async () => {
    const before = process.env.BODY_MAP_MANIFEST_PATH;
    try {
      process.env.BODY_MAP_MANIFEST_PATH = "3d-model/local-assets/bodyparts3d-v2/other.json";
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({ contract: "override" }));
      await readBodyMapPrototypeManifest("D:/bodycast-publication");
      expect(mockedReadFile).toHaveBeenLastCalledWith(
        resolve("D:/bodycast-publication", "3d-model/local-assets/bodyparts3d-v2/other.json"), "utf8",
      );

      process.env.BODY_MAP_MANIFEST_PATH = "../outside.json";
      await expect(readBodyMapPrototypeManifest("D:/bodycast-publication")).rejects.toThrow("must remain inside");
      expect(mockedReadFile).toHaveBeenCalledTimes(1);
    } finally {
      if (before === undefined) delete process.env.BODY_MAP_MANIFEST_PATH;
      else process.env.BODY_MAP_MANIFEST_PATH = before;
    }
  });
});

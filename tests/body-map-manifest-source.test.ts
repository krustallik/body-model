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
  it("reads only the ignored local asset manifest", async () => {
    const content = JSON.stringify({ contract: "bodycast-test-contract" });
    mockedReadFile.mockResolvedValueOnce(content);

    const result = await readBodyMapPrototypeManifest("D:/bodycast-publication");

    expect(mockedReadFile).toHaveBeenCalledExactlyOnceWith(
      resolve("D:/bodycast-publication", LOCAL_BODY_MAP_MANIFEST_PATH),
      "utf8",
    );
    expect(result).toEqual({ content, manifest: { contract: "bodycast-test-contract" } });
  });

  it("does not fall back to checkpoint manifests when local data is absent", async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(readBodyMapPrototypeManifest("D:/bodycast-publication")).rejects.toMatchObject({ code: "ENOENT" });
    expect(mockedReadFile).toHaveBeenCalledExactlyOnceWith(
      resolve("D:/bodycast-publication", LOCAL_BODY_MAP_MANIFEST_PATH),
      "utf8",
    );
  });
});

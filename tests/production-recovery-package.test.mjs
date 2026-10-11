import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../scripts/production-recovery/canonical.mjs";
import { installVerifiedAuthorityClient } from "../scripts/production-recovery/install-provenance.mjs";

const roots = [];
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const packageBuilderPath = fileURLToPath(new URL("../scripts/production-recovery/build-authority-package.mjs", import.meta.url));
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bodycast-recovery-package-"));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("immutable recovery authority package and public client artifacts", () => {
  it("builds separate syntax-valid authority/client bundles with the reviewed adapter compiled into authority", async () => {
    const root = await tempRoot();
    const adapterPath = path.join(root, "reviewed-host-adapter.mjs");
    const policyPath = path.join(root, "installation-policy.json");
    const outputPath = path.join(root, "authority.mjs");
    const adapterSource = "export async function createTrustedHostAdapter() { return Object.freeze({ adapterFixture: true }); }\n";
    const policy = {
      trustedInstallationKeys: { "fixture-install-key": "fixture-public-key" },
      allowedAuthorityVersions: ["1.0.0"],
      minimumAllowedVersion: "1.0.0",
    };
    await fs.writeFile(adapterPath, adapterSource);
    await fs.writeFile(policyPath, canonicalJson(policy));

    const output = execFileSync(process.execPath, [
      packageBuilderPath,
      "--out", outputPath,
      "--adapter", adapterPath,
      "--installation-policy", policyPath,
    ], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    const [authorityPath, clientPath] = output.trim().split(/\r?\n/);
    expect(authorityPath).toBe(outputPath);
    expect(clientPath).toBe(outputPath + ".client.mjs");
    const authority = await fs.readFile(authorityPath, "utf8");
    const client = await fs.readFile(clientPath, "utf8");
    expect(authority).toContain("adapterFixture");
    expect(authority).toContain("--serve");
    expect(client).toContain("runProductionOperationClient");
    expect(client).not.toContain("adapterFixture");
    execFileSync(process.execPath, ["--check", authorityPath], { stdio: "pipe" });
    execFileSync(process.execPath, ["--check", clientPath], { stdio: "pipe" });
  });

  it("installs only a bounded non-privileged client into a separate root-owned public directory", async () => {
    const root = await tempRoot();
    const publicDirectory = path.join(root, "public-bin");
    await fs.mkdir(publicDirectory, { mode: 0o755 });
    const clientBytes = Buffer.from("typed client fixture\n");
    const installationPath = path.join(publicDirectory, "production-recovery-client.mjs");
    const result = await installVerifiedAuthorityClient({
      clientBytes,
      installationPath,
      requireRoot: false,
      syncDirectory: async () => {},
    });
    expect(result).toEqual({ installationPath, clientDigest: sha256Hex(clientBytes) });
    expect(await fs.readFile(installationPath)).toEqual(clientBytes);
    await expect(installVerifiedAuthorityClient({ clientBytes: Buffer.alloc(0), installationPath, requireRoot: false }))
      .rejects.toThrow(/empty or exceeds/);
  });
});

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

const sampler = new URL("../scripts/ci/postgres-storage-peak-sampler.mjs", import.meta.url).pathname;

describe("isolated PostgreSQL storage peak sampler", () => {
  it("runs the sampler process and records transient PGDATA and WAL peaks", async () => {
    const root = mkdtempSync(join(tmpdir(), "bodycast-pg-storage-sampler-"));
    const bin = join(root, "bin");
    const docker = join(bin, "docker");
    const counter = join(root, "sample-count");
    const ready = join(root, "ready.json");
    const output = join(root, "peak.json");
    const containerId = "a".repeat(64);
    const source = `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == exec && "$2" == "${containerId}" ]]
count=0
[[ ! -f "${counter}" ]] || count="$(cat "${counter}")"
count=$((count + 1))
printf '%s' "$count" > "${counter}"
case "$count" in
  1) printf '1000|500\\n' ;;
  2) printf '2400|950\\n' ;;
  3) printf '1800|700\\n' ;;
  *) printf '1600|600\\n' ;;
esac
`;
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));
      writeFileSync(docker, source, { mode: 0o700 });
      chmodSync(docker, 0o700);
      const child = spawn(process.execPath, [sampler, "--container-id", containerId,
        "--output", output, "--ready-file", ready, "--interval-ms", "25"], {
        env: { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value; });
      child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value; });
      let readySeen = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try { readFileSync(ready, "utf8"); readySeen = true; break; } catch { await delay(10); }
      }
      expect(readySeen, stderr).toBe(true);
      await delay(80);
      child.kill("SIGTERM");
      const [code] = await once(child, "exit");
      expect(code, stderr).toBe(0);
      const peak = JSON.parse(readFileSync(output, "utf8"));
      expect(peak).toMatchObject({ containerId, baselineDataBytes: 1000, peakDataBytes: 2400,
        dataPeakGrowthBytes: 1400, baselineWalBytes: 500, peakWalBytes: 950, walPeakGrowthBytes: 450 });
      expect(peak.samples).toBeGreaterThanOrEqual(3);
      expect(stdout).toContain('"dataPeakGrowthBytes":1400');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed if the isolated PostgreSQL allocation cannot be sampled", async () => {
    const root = mkdtempSync(join(tmpdir(), "bodycast-pg-storage-sampler-fail-"));
    const bin = join(root, "bin");
    const docker = join(bin, "docker");
    const ready = join(root, "ready.json");
    const output = join(root, "peak.json");
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));
      writeFileSync(docker, "#!/usr/bin/env bash\nexit 17\n", { mode: 0o700 });
      chmodSync(docker, 0o700);
      const result = spawnSync(process.execPath, [sampler, "--container-id", "b".repeat(64),
        "--output", output, "--ready-file", ready], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Could not sample isolated PostgreSQL data/WAL allocation");
      expect(() => readFileSync(ready)).toThrow();
      expect(() => readFileSync(output)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

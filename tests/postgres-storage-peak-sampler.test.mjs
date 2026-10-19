import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sampler = fileURLToPath(new URL("../scripts/ci/postgres-storage-peak-sampler.mjs", import.meta.url));
// These tests install a temporary POSIX shell executable named `docker` in PATH.
const posixShellMockIt = process.platform === "win32" ? it.skip : it;

describe("isolated PostgreSQL storage peak sampler", () => {
  posixShellMockIt("runs the sampler process and records transient PGDATA and WAL peaks", async () => {
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
  1) printf 'R|8|512\\nD|1\\nW|1\\n' ;;
  2) printf 'R|8|512\\nD|3\\nD|1\\nW|2\\n' ;;
  3) printf 'R|8|512\\nD|2\\nW|1\\n' ;;
  *) printf 'R|8|512\\nD|1\\nW|1\\n' ;;
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
      expect(peak).toMatchObject({ containerId, baselineDataBytes: 5120, peakDataBytes: 8192,
        dataPeakGrowthBytes: 3072, baselineWalBytes: 1024, peakWalBytes: 2048, walPeakGrowthBytes: 1024 });
      expect(peak.samples).toBeGreaterThanOrEqual(3);
      expect(stdout).toContain('"dataPeakGrowthBytes":3072');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  posixShellMockIt("propagates the real command failure and stderr before writing headroom evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "bodycast-pg-storage-sampler-fail-"));
    const bin = join(root, "bin");
    const docker = join(bin, "docker");
    const ready = join(root, "ready.json");
    const output = join(root, "peak.json");
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));
      writeFileSync(docker, "#!/usr/bin/env bash\nprintf '%s\\n' 'du: permission denied while measuring allocated data' >&2\nexit 17\n", { mode: 0o700 });
      chmodSync(docker, 0o700);
      const result = spawnSync(process.execPath, [sampler, "--container-id", "b".repeat(64),
        "--output", output, "--ready-file", ready], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Could not sample isolated PostgreSQL data/WAL allocation");
      expect(result.stderr).toContain("du: permission denied while measuring allocated data");
      expect(() => readFileSync(ready)).toThrow();
      expect(() => readFileSync(output)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  posixShellMockIt("fails closed when docker exec emits stderr even with a zero exit status", () => {
    const root = mkdtempSync(join(tmpdir(), "bodycast-pg-storage-sampler-stderr-"));
    const bin = join(root, "bin");
    const docker = join(bin, "docker");
    const ready = join(root, "ready.json");
    const output = join(root, "peak.json");
    try {
      mkdirSync(bin, { recursive: true });
      writeFileSync(docker, "#!/usr/bin/env bash\nprintf '%s\\n' 'du: permission denied for a directory' >&2\nprintf 'R|8|512\\nD|1\\nW|1\\n'\n", { mode: 0o700 });
      chmodSync(docker, 0o700);
      const result = spawnSync(process.execPath, [sampler, "--container-id", "d".repeat(64),
        "--output", output, "--ready-file", ready], {
        env: { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` }, encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("du: permission denied for a directory");
      expect(() => readFileSync(ready)).toThrow();
      expect(() => readFileSync(output)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  posixShellMockIt.each([
    ["malformed", "printf '%s\\n' 'not-a-sample'\n"],
    ["missing", ":\n"],
  ])("fails closed for %s output before writing headroom evidence", (kind, command) => {
    const root = mkdtempSync(join(tmpdir(), `bodycast-pg-storage-sampler-${kind}-`));
    const bin = join(root, "bin");
    const docker = join(bin, "docker");
    const ready = join(root, "ready.json");
    const output = join(root, "peak.json");
    try {
      mkdirSync(bin, { recursive: true });
      writeFileSync(docker, `#!/usr/bin/env bash\n${command}`, { mode: 0o700 });
      chmodSync(docker, 0o700);
      const result = spawnSync(process.execPath, [sampler, "--container-id", "c".repeat(64),
        "--output", output, "--ready-file", ready], {
        env: { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` }, encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Isolated PostgreSQL allocation sample is malformed");
      expect(() => readFileSync(ready)).toThrow();
      expect(() => readFileSync(output)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

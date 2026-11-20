import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetScript = readFileSync(path.join(repoRoot, "scripts/production-db-target.sh"), "utf8");
const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy.sh"), "utf8");

describe("production DB read-only report input", () => {
  it("renders a read-only report query for the requested Auth schema manifest", () => {
    const sql = execFileSync(process.execPath, [
      path.join(repoRoot, "scripts/production-db-preflight.mjs"),
      "--manifest",
      "auth-multiuser-v1",
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(sql.trimStart()).toMatch(/^BEGIN READ ONLY;/);
    expect(sql).toContain("SELECT json_build_object(");
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
  });

  it("feeds generated SQL through psql stdin in every report mode", () => {
    expect(targetScript).toContain('printf \'%s\\n\' "$sql" | docker exec -i');
    expect(targetScript).toContain("--file=-");

    for (const mode of ["--preflight)", "--pre-maintenance-snapshot)", "--previous-app-compatibility-snapshot)"]) {
      const start = targetScript.indexOf(`  ${mode}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = targetScript.indexOf("\n  --", start + 1);
      const section = targetScript.slice(start, end < 0 ? targetScript.length : end);
      expect(section).toContain("run_readonly_db_report");
    }
  });

  it("binds Auth handoff re-attestation to its reviewed schema manifest", () => {
    expect(deployScript).toContain("BODYCAST_DB_PREFLIGHT_MANIFEST=auth-multiuser-v1");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalSchemaDumpBytes, schemaDumpSha256, SCHEMA_DIGEST_CONTRACT } from "../scripts/production-v4-schema-digest.mjs";

function dump(token, sql = "CREATE TABLE public.sample (id integer PRIMARY KEY);") {
  return Buffer.from([
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    `\\restrict ${token}`,
    "",
    "-- Dumped from database version 17.11",
    "-- Dumped by pg_dump version 17.11",
    "SET statement_timeout = 0;",
    sql,
    "",
    "--",
    "-- PostgreSQL database dump complete",
    "--",
    "",
    `\\unrestrict ${token}`,
    "",
  ].join("\n"));
}

describe("production V4 PostgreSQL schema digest", () => {
  it("uses a versioned, narrow digest contract and ignores only known random metadata", () => {
    const first = dump("A".repeat(63));
    const second = dump("Z".repeat(63));
    expect(SCHEMA_DIGEST_CONTRACT).toBe("bodycast-pg-dump-schema-v1");
    expect(first.equals(second)).toBe(false);
    expect(schemaDumpSha256(first)).toBe(schemaDumpSha256(second));
    expect(canonicalSchemaDumpBytes(first).toString("utf8")).toContain("CREATE TABLE public.sample (id integer PRIMARY KEY);");
    expect(canonicalSchemaDumpBytes(first).toString("utf8")).toContain("SET statement_timeout = 0;");
  });

  it("keeps SQL changes in the digest", () => {
    expect(schemaDumpSha256(dump("A".repeat(63))))
      .not.toBe(schemaDumpSha256(dump("B".repeat(63), "CREATE TABLE public.sample (id bigint PRIMARY KEY);")));
  });

  it("normalizes only the two known version banners and preserves every other schema line", () => {
    const original = dump("A".repeat(63));
    const otherVersionHeaders = Buffer.from(original.toString("utf8")
      .replace("-- Dumped from database version 17.11", "-- Dumped from database version 16.9")
      .replace("-- Dumped by pg_dump version 17.11", "-- Dumped by pg_dump version 18.1"));
    expect(schemaDumpSha256(original)).toBe(schemaDumpSha256(otherVersionHeaders));
    const extraMetadata = Buffer.from(original.toString("utf8").replace("SET statement_timeout = 0;", "-- Dumped custom metadata\nSET statement_timeout = 0;"));
    expect(schemaDumpSha256(original)).not.toBe(schemaDumpSha256(extraMetadata));
  });

  it("preserves version-like comments inside SQL function bodies", () => {
    const functionAt17 = dump("A".repeat(63), [
      "CREATE FUNCTION public.version_note() RETURNS integer",
      "LANGUAGE sql AS $function$",
      "-- Dumped by pg_dump version 17.11",
      "SELECT 1;",
      "$function$;",
    ].join("\n"));
    const functionAt18 = Buffer.from(functionAt17.toString("utf8")
      .replace("-- Dumped by pg_dump version 17.11\nSELECT 1;", "-- Dumped by pg_dump version 18.1\nSELECT 1;"));
    expect(schemaDumpSha256(functionAt17)).not.toBe(schemaDumpSha256(functionAt18));
  });

  it.each([
    ["malformed marker token", dump("A".repeat(62))],
    ["mismatched marker pair", Buffer.from(dump("A".repeat(63)).toString("utf8").replace(`\\unrestrict ${"A".repeat(63)}`, `\\unrestrict ${"B".repeat(63)}`))],
    ["unknown marker", Buffer.from(dump("A".repeat(63)).toString("utf8").replace(`\\restrict ${"A".repeat(63)}`, `\\connect ${"A".repeat(63)}`))],
    ["duplicate marker", Buffer.from(dump("A".repeat(63)).toString("utf8").replace(`\\unrestrict ${"A".repeat(63)}\n`, `\\unrestrict ${"A".repeat(63)}\n\\unrestrict ${"A".repeat(63)}\n`))],
    ["malformed version metadata", Buffer.from(dump("A".repeat(63)).toString("utf8").replace("-- Dumped from database version 17.11", "-- Dumped from database version unknown"))],
    ["missing version metadata", Buffer.from(dump("A".repeat(63)).toString("utf8").replace("-- Dumped by pg_dump version 17.11\n", ""))],
    ["incomplete stream", dump("A".repeat(63)).subarray(0, dump("A".repeat(63)).length - 1)],
  ])("fails closed on %s", (_name, value) => {
    expect(() => schemaDumpSha256(value)).toThrow();
  });

  it("uses one exact-hash-transferred helper for rehearsal, preflight, execute and postflight", () => {
    const workflow = readFileSync(".github/workflows/production-v4-derived-recovery.yml", "utf8");
    const host = readFileSync("scripts/production-v4-derived-recovery-host.sh", "utf8");
    const smoke = readFileSync("scripts/ci/production-v4-schema-digest-postgres-smoke.mjs", "utf8");
    expect(workflow.match(/\| node scripts\/production-v4-schema-digest\.mjs/g)).toHaveLength(1);
    expect(workflow).toContain('backup_schema="$(node scripts/restore-encrypted-postgres-backup.mjs --schema-digest)"');
    expect(workflow).toContain("Encrypted backup archive schema differs from canonical release migrations");
    expect(workflow).not.toContain("Restore schema differs from canonical 65 migrations");
    expect(workflow).toContain("production-v4-schema-digest.mjs \"$SSH_USER@$SSH_HOST:$artifact_dir/schema-digest.mjs\"");
    expect(workflow).toContain("schemaDigestHelperSha256");
    expect(workflow).toContain("SCHEMA_DIGEST_HELPER_SHA256");
    expect(workflow).not.toContain("| sed -E '/^-- Dumped (from database|by pg_dump) version /d' | sha256sum");
    expect(workflow).toContain("exec pg_dump --format=custom --no-owner --no-privileges");
    expect(workflow).not.toContain("pg_dump --format=custom --no-owner --no-privileges --username=\"$POSTGRES_USER\" --dbname=bodycast' | node scripts/production-v4-schema-digest.mjs");
    expect(host.match(/\| node \"\$BODYCAST_SCHEMA_DIGEST_SCRIPT\"\)/g)).toHaveLength(2);
    expect(host.indexOf("schema-digest-script-digest")).toBeLessThan(host.indexOf("schema_digest=\"$(docker exec"));
    expect(host).toContain("schemaDigestContract: process.argv[9]");
    expect(host).toContain("schemaDigestContract: preflight.schemaDigestContract");
    expect(smoke).toContain("docker run --rm --network host --env PGPASSWORD --entrypoint pg_dump");
    const restoreHelper = readFileSync("scripts/restore-encrypted-postgres-backup.mjs", "utf8");
    expect(restoreHelper).toContain('"--network", "none", "--entrypoint", "pg_restore"');
    expect(restoreHelper).toContain('"--schema-only", "--no-owner", "--no-privileges", "--file=-"');
    expect(restoreHelper).toContain("SCHEMA_DIGEST_HELPER_SHA256 does not match the exact checked-in helper.");
    expect(smoke).toContain("-Eeuo");
  });
});

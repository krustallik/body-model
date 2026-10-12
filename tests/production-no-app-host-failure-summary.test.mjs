import { describe, expect, it } from "vitest";
import { summarizeNoAppHostFailure } from "../scripts/production-no-app-host-failure-summary.mjs";

describe("summarizeNoAppHostFailure", () => {
  it("reports the pg_dump boundary without exposing the private host snapshot payload", () => {
    const summary = summarizeNoAppHostFailure([
      "BODYCAST_NO_APP_PREPARATION_B64=eyJwcml2YXRlIjoiZG9ub3Rsb2cifQ==",
      "BODYCAST_PGDUMP_INVOCATION_AT=2026-10-12T21:12:30Z",
      "pg_dump: permission denied",
    ].join("\n"), { sshExitCode: 1, encryptExitCode: 1 });

    expect(summary).toContain("SSH exit 1; encryption exit 1");
    expect(summary).toContain("pg_dump invocation boundary marker: observed once");
    expect(summary).toContain("host stderr: pg_dump: permission denied");
    expect(summary).not.toContain("eyJwcml2YXRl");
    expect(summary).not.toContain("BODYCAST_NO_APP_PREPARATION_B64");
  });

  it("distinguishes a host preflight failure before the dump boundary", () => {
    const summary = summarizeNoAppHostFailure(
      "Production database container identity or health is unexpected.",
      { sshExitCode: 1, encryptExitCode: 1 },
    );

    expect(summary).toContain("pg_dump invocation boundary marker: not observed");
    expect(summary).toContain("Production database container identity or health is unexpected.");
  });

  it("treats duplicate or malformed boundary markers as ambiguous", () => {
    const summary = summarizeNoAppHostFailure([
      "BODYCAST_PGDUMP_INVOCATION_AT=2026-10-12T21:12:30Z",
      "BODYCAST_PGDUMP_INVOCATION_AT=not-a-timestamp",
    ].join("\n"), { sshExitCode: 1, encryptExitCode: 1 });

    expect(summary).toContain("pg_dump invocation boundary marker: ambiguous or malformed");
  });

  it("redacts credentials, database URLs, and long base64-like values", () => {
    const privateValue = "A".repeat(120);
    const slashTerminated = `${"A".repeat(119)}/`;
    const summary = summarizeNoAppHostFailure([
      "DATABASE_URL=postgresql://user:password@db.example/bodycast",
      "postgresql://user:password@db.example/bodycast connection failed",
      `diagnostic ${privateValue}`,
      `diagnostic ${slashTerminated}`,
    ].join("\n"), { sshExitCode: 1, encryptExitCode: 1 });

    expect(summary).not.toContain("password@db.example");
    expect(summary).not.toContain("user:password");
    expect(summary).not.toContain(privateValue);
    expect(summary).not.toContain(slashTerminated);
    expect(summary).toContain("[REDACTED]");
  });

  it("does not emit remote lines as GitHub workflow commands or private-key material", () => {
    const summary = summarizeNoAppHostFailure([
      "::add-mask::secret-value",
      "-----BEGIN PRIVATE KEY-----",
      "A".repeat(64),
      "-----END PRIVATE KEY-----",
    ].join("\n"), { sshExitCode: 1, encryptExitCode: 1 });

    expect(summary).toContain("host stderr: ::add-mask::secret-value");
    expect(summary).not.toMatch(/^::add-mask::/m);
    expect(summary).not.toContain("PRIVATE KEY");
    expect(summary).not.toContain("A".repeat(64));
  });

  it("limits untrusted diagnostic output", () => {
    const summary = summarizeNoAppHostFailure(
      Array.from({ length: 60 }, (_, index) => `diagnostic ${index}`).join("\n"),
      { sshExitCode: 1, encryptExitCode: 1 },
    );

    expect(summary).toContain("diagnostic 59");
    expect(summary).not.toContain("diagnostic 0");
  });
});

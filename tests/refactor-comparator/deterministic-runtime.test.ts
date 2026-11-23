import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const runtimePath = require.resolve("../../scripts/refactor/deterministic-runtime.mjs");

function executeDeterministicRuntime() {
  const source = `
    import { randomBytes, randomInt, randomUUID } from "node:crypto";
    const start = { now: Date.now(), date: new Date().toISOString(), uuid: randomUUID(), bytes: randomBytes(8).toString("hex"), integer: randomInt(1000) };
    const web = new Uint8Array(8);
    globalThis.crypto.getRandomValues(web);
    const after = await new Promise((resolve) => setTimeout(() => resolve({ now: Date.now(), date: new Date().toISOString() }), 7));
    process.stdout.write(JSON.stringify({ start, web: Buffer.from(web).toString("hex"), after }));
  `;
  const env = {
    NODE_ENV: "test",
    BODYCAST_REFACTOR_FIXED_TIME: "2026-11-23T12:00:00.000Z",
    BODYCAST_REFACTOR_RANDOM_SEED: "bodycast-refactor-comparator-v1",
    NODE_OPTIONS: `--import=${pathToFileURL(runtimePath).href}`,
  };
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  return JSON.parse(output);
}

describe("deterministic comparator runtime", () => {
  it("replays clock, UUID, random bytes, and random integers exactly across isolated processes", () => {
    const first = executeDeterministicRuntime();
    const second = executeDeterministicRuntime();
    expect(first).toEqual(second);
    expect(first.start.now).toBe(Date.parse("2026-11-23T12:00:00.000Z"));
    expect(first.start.date).toBe("2026-11-23T12:00:00.000Z");
    expect(first.after.now - first.start.now).toBe(7);
    expect(first.after.date).toBe("2026-11-23T12:00:00.007Z");
    expect(first.start.uuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });
});

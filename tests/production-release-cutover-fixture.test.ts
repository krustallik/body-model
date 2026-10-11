import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashAvailable, createFixture, runFixtureAsync } from "./helpers/production-release-cutover-fixture";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("production release cutover fixture process cleanup", () => {
  it.skipIf(!bashAvailable)("terminates fixture descendants when aborted", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const result = runFixtureAsync(
      fixture,
      `node -e 'const fs=require("node:fs");fs.writeFileSync("child-started","yes");setTimeout(()=>fs.writeFileSync("child-survived","yes"),10000)' &`,
      {},
      { signal: controller.signal },
    );

    const deadline = Date.now() + 3_000;
    const startedPath = path.join(fixture.repo, "child-started");
    while (!existsSync(startedPath) && Date.now() < deadline) await delay(10);
    expect(existsSync(startedPath)).toBe(true);

    await delay(100);
    controller.abort();
    await result;

    expect(existsSync(path.join(fixture.repo, "child-survived"))).toBe(false);
  }, 15_000);

  it.skipIf(!bashAvailable || process.platform === "win32")(
    "kills the process group when the shell leader exits before inherited pipes close",
    async () => {
      const fixture = createFixture();
      const controller = new AbortController();
      const result = runFixtureAsync(
        fixture,
        `node -e 'const fs=require("node:fs");fs.writeFileSync("child-started","yes");setTimeout(()=>fs.writeFileSync("child-survived","yes"),1800)' & exit 0`,
        {},
        { signal: controller.signal, waitForBackgroundProcesses: false },
      );

      const deadline = Date.now() + 3_000;
      const startedPath = path.join(fixture.repo, "child-started");
      while (!existsSync(startedPath) && Date.now() < deadline) await delay(10);
      expect(existsSync(startedPath)).toBe(true);

      await delay(100);
      controller.abort();
      const completed = await result;
      expect(completed.status).toBe(0);

      await delay(1_900);
      expect(existsSync(path.join(fixture.repo, "child-survived"))).toBe(false);
    },
  );
});

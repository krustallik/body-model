import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { waitForLoopbackPort } from "../../scripts/refactor/database-evidence.mjs";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("comparator PostgreSQL TCP readiness", () => {
  it("waits for a published exact loopback endpoint", async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test TCP server did not bind an IP endpoint.");

    await expect(waitForLoopbackPort("127.0.0.1", address.port, { timeoutMs: 1_000 })).resolves.toBeUndefined();
  });

  it("rejects non-loopback targets and unbounded timeout values", async () => {
    await expect(waitForLoopbackPort("localhost", 5432)).rejects.toThrow(/exact loopback endpoint/);
    await expect(waitForLoopbackPort("127.0.0.1", 5432, { timeoutMs: 90_001 })).rejects.toThrow(/bounded timeout/);
  });
});

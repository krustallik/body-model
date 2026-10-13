import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function assertProductionDatabaseEndpointBinding(report, expectedAddress) {
  const identity = report?.identity;
  if (isIP(expectedAddress) !== 4
    || isIP(identity?.serverAddress) !== 4
    || identity.serverAddress !== expectedAddress
    || identity?.serverPort !== 5432) {
    throw new Error("Production database report does not identify the fixed PostgreSQL container endpoint.");
  }
  return true;
}

async function main() {
  if (process.argv[2] !== "--verify-stdin" || process.argv.length !== 4) {
    throw new Error("Usage: production-db-endpoint-binding.mjs --verify-stdin <fixed-container-ipv4>");
  }
  const report = JSON.parse(readFileSync(0, "utf8"));
  assertProductionDatabaseEndpointBinding(report, process.argv[3]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

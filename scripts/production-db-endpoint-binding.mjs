import { isIP } from "node:net";

export function assertNoAppDatabaseEndpointBinding(report, expectedAddress) {
  const identity = report?.identity;
  if (isIP(expectedAddress) !== 4
    || identity?.serverAddress !== expectedAddress
    || identity?.serverPort !== 5432) {
    throw new Error("No-app database report does not identify the fixed production PostgreSQL endpoint.");
  }
  return true;
}

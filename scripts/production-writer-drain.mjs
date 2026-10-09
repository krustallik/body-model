export const PRODUCTION_WRITER_TOPOLOGY_CONTRACT = "bodycast-compose-internal-db-single-writer-v1";
export const EXPECTED_PRODUCTION_DB_NETWORK = "bodycast-backend-prod";
export const EXPECTED_PRODUCTION_DB_CONTAINER = "bodycast-db-prod";
export const EXPECTED_PRODUCTION_APP_CONTAINER = "bodycast-app-prod";
export const EXPECTED_PRODUCTION_CADDY_CONTAINER = "gymbeam-caddy";
export const EXPECTED_MAINTENANCE_RESPONSE = 'respond "BodyCast is temporarily unavailable while the model is updated." 503';

function reject(message) {
  throw new Error("Production writer-drain gate blocked: " + message);
}

export function evaluateProductionWriterTopology(input) {
  const blockers = [];
  const app = input?.app;
  const database = input?.database;
  const caddy = input?.caddy;
  const network = input?.backendNetwork;
  const route = input?.routeFile;

  if (app?.name !== EXPECTED_PRODUCTION_APP_CONTAINER || app?.state !== "absent") {
    blockers.push("The old BodyCast app container still exists and could be restarted against the migrated schema.");
  }
  if (database?.name !== EXPECTED_PRODUCTION_DB_CONTAINER || database?.state !== "running" || database?.health !== "healthy") {
    blockers.push("The reviewed local PostgreSQL container is not the healthy target.");
  }
  if (database?.publishedPostgresPort !== false) blockers.push("PostgreSQL is published outside the internal Docker network or its port mapping is unknown.");
  if (JSON.stringify([...(database?.networks ?? [])].sort()) !== JSON.stringify([EXPECTED_PRODUCTION_DB_NETWORK])) {
    blockers.push("The PostgreSQL container is attached to an unreviewed network topology.");
  }
  if (network?.name !== EXPECTED_PRODUCTION_DB_NETWORK
    || JSON.stringify([...(network?.containers ?? [])].sort()) !== JSON.stringify([EXPECTED_PRODUCTION_DB_CONTAINER])) {
    blockers.push("The internal database network contains an unknown or unapproved client container.");
  }
  if (caddy?.name !== EXPECTED_PRODUCTION_CADDY_CONTAINER || caddy?.state !== "running" || caddy?.configValidated !== true) {
    blockers.push("The reviewed Caddy maintenance route cannot be verified on the production proxy.");
  }
  if (route?.verified !== true || route?.maintenanceResponse !== true || route?.containsReverseProxy !== false) {
    blockers.push("The BodyCast route file is not an unambiguous maintenance-only route.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(route?.sha256 ?? ""))) blockers.push("The maintenance route file digest is unavailable.");

  return {
    schemaVersion: 1,
    contract: PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
    ready: blockers.length === 0,
    blockers,
    observedAt: typeof input?.observedAt === "string" ? input.observedAt : new Date().toISOString(),
    app: app ? { name: app.name ?? null, state: app.state ?? null, restartPolicy: app.restartPolicy ?? null } : null,
    database: database ? {
      name: database.name ?? null,
      state: database.state ?? null,
      health: database.health ?? null,
      publishedPostgresPort: database.publishedPostgresPort === true,
      networks: Array.isArray(database.networks) ? [...database.networks].sort() : null,
    } : null,
    backendNetwork: network ? {
      name: network.name ?? null,
      containers: Array.isArray(network.containers) ? [...network.containers].sort() : null,
    } : null,
    caddy: caddy ? { name: caddy.name ?? null, state: caddy.state ?? null, configValidated: caddy.configValidated === true } : null,
    routeFile: route ? {
      verified: route.verified === true,
      maintenanceResponse: route.maintenanceResponse === true,
      containsReverseProxy: route.containsReverseProxy === true,
      sha256: route.sha256 ?? null,
    } : null,
  };
}

export function evaluateProductionWriterDrain(report) {
  const blockers = [];
  const drain = report?.writerDrain;
  if (!drain || drain.schemaVersion !== 1 || !Number.isSafeInteger(drain.observerPid) || drain.observerPid < 1
    || typeof drain.observedAt !== "string" || !Number.isFinite(Date.parse(drain.observedAt))
    || drain.observerApplicationName !== "bodycast-production-preflight"
    || drain.identityPolicy !== "no-other-client-backends"
    || !Array.isArray(drain.activeClientBackends)) {
    blockers.push("PostgreSQL writer-drain inventory is missing or malformed.");
  } else if (drain.activeClientBackends.length > 0) {
    const clients = drain.activeClientBackends.map((client) => {
      const applicationName = typeof client?.applicationName === "string" && client.applicationName ? client.applicationName : "<unknown application>";
      const address = typeof client?.clientAddress === "string" && client.clientAddress ? client.clientAddress : "<local-or-proxied identity>";
      return `${applicationName}@${address}`;
    });
    blockers.push(`PostgreSQL has ${drain.activeClientBackends.length} client backend(s) other than the preflight observer: ${clients.join(", ")}.`);
  }

  const topology = drain?.topology;
  const verifiedTopology = evaluateProductionWriterTopology(topology ?? {});
  if (topology?.schemaVersion !== 1 || topology?.contract !== PRODUCTION_WRITER_TOPOLOGY_CONTRACT || topology?.ready !== true
    || !Array.isArray(topology.blockers) || topology.blockers.length > 0 || !verifiedTopology.ready) {
    blockers.push("Production app/proxy/network topology drain evidence is missing or not ready.");
    for (const blocker of Array.isArray(topology?.blockers) ? topology.blockers : []) blockers.push(`Topology: ${blocker}`);
    for (const blocker of verifiedTopology.blockers) blockers.push(`Topology facts: ${blocker}`);
  }

  return {
    ready: blockers.length === 0,
    blockers,
    observerPid: Number.isSafeInteger(drain?.observerPid) ? drain.observerPid : null,
    observedAt: drain?.observedAt ?? null,
    activeClientBackends: Array.isArray(drain?.activeClientBackends) ? drain.activeClientBackends : null,
    topology: topology ?? null,
  };
}

export function assertFreshWriterDrain(report, { now = Date.now(), maxAgeMs = 30_000 } = {}) {
  const evaluated = evaluateProductionWriterDrain(report);
  if (!evaluated.ready) reject(evaluated.blockers.join(" "));
  const observedAt = Date.parse(evaluated.observedAt);
  const ageMs = now - observedAt;
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > maxAgeMs) {
    reject(`writer-drain evidence is stale or from the future (age ${Number.isFinite(ageMs) ? ageMs : "unknown"}ms).`);
  }
  const topologyObservedAt = Date.parse(evaluated.topology.observedAt);
  const topologyAgeMs = now - topologyObservedAt;
  if (!Number.isFinite(topologyAgeMs) || topologyAgeMs < -60_000 || topologyAgeMs > maxAgeMs) {
    reject(`host topology evidence is stale or from the future (age ${Number.isFinite(topologyAgeMs) ? topologyAgeMs : "unknown"}ms).`);
  }
  return { ...evaluated, ageMs, topologyAgeMs };
}

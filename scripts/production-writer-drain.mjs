export const PRODUCTION_WRITER_TOPOLOGY_CONTRACT = "bodycast-compose-internal-db-single-writer-v1";
export const EXPECTED_PRODUCTION_DB_NETWORK = "bodycast-backend-prod";
export const EXPECTED_PRODUCTION_DB_CONTAINER = "bodycast-db-prod";
export const EXPECTED_PRODUCTION_APP_CONTAINER = "bodycast-app-prod";
export const EXPECTED_PRODUCTION_CADDY_CONTAINER = "gymbeam-caddy";
export const EXPECTED_MAINTENANCE_RESPONSE = 'respond "BodyCast is temporarily unavailable while the model is updated." 503';

function check(id, passed, blockers, message) {
  if (!passed) blockers.push(message);
  return { id, passed: Boolean(passed) };
}

function reject(message, diagnostics) {
  throw new Error(`Production writer-drain gate blocked: ${message}; checks=${JSON.stringify(diagnostics)}`);
}

export function evaluateProductionWriterTopology(input) {
  const blockers = [];
  const checks = [];
  const app = input?.app;
  const database = input?.database;
  const caddy = input?.caddy;
  const network = input?.backendNetwork;
  const route = input?.routeFile;

  checks.push(check("app-absent", app?.name === EXPECTED_PRODUCTION_APP_CONTAINER && app?.state === "absent", blockers,
    "The old BodyCast app container still exists or its absence is unknown."));
  checks.push(check("postgres-healthy", database?.name === EXPECTED_PRODUCTION_DB_CONTAINER && database?.state === "running" && database?.health === "healthy", blockers,
    "The reviewed local PostgreSQL container is not the healthy target."));
  checks.push(check("postgres-unpublished", database?.publishedPostgresPort === false, blockers,
    "PostgreSQL is published outside the internal Docker network or its port mapping is unknown."));
  checks.push(check("postgres-network", JSON.stringify([...(database?.networks ?? [])].sort()) === JSON.stringify([EXPECTED_PRODUCTION_DB_NETWORK]), blockers,
    "The PostgreSQL container is attached to an unreviewed network topology."));
  checks.push(check("backend-network-membership", network?.name === EXPECTED_PRODUCTION_DB_NETWORK
    && JSON.stringify([...(network?.containers ?? [])].sort()) === JSON.stringify([EXPECTED_PRODUCTION_DB_CONTAINER]), blockers,
  "The internal database network contains an unknown or unapproved client container."));
  checks.push(check("caddy-healthy", caddy?.name === EXPECTED_PRODUCTION_CADDY_CONTAINER && caddy?.state === "running" && caddy?.configValidated === true, blockers,
    "The reviewed Caddy maintenance route cannot be verified on the production proxy."));
  checks.push(check("maintenance-route", route?.verified === true && route?.maintenanceResponse === true && route?.containsReverseProxy === false, blockers,
    "The BodyCast route file is not an unambiguous maintenance-only route."));
  checks.push(check("maintenance-route-digest", /^[a-f0-9]{64}$/.test(String(route?.sha256 ?? "")), blockers,
    "The maintenance route file digest is unavailable."));

  return {
    schemaVersion: 1,
    contract: PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
    ready: blockers.length === 0,
    blockers,
    checks,
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
  const checks = [];
  const drain = report?.writerDrain;
  const observerPidValid = Number.isSafeInteger(drain?.observerPid) && drain.observerPid > 0;
  checks.push(check("inventory-schema", drain?.schemaVersion === 1, blockers, "PostgreSQL writer-drain inventory schema is missing or unsupported."));
  checks.push(check("observer-pid", observerPidValid, blockers, "PostgreSQL writer-drain observer identity is missing or malformed."));
  checks.push(check("observed-at", typeof drain?.observedAt === "string" && Number.isFinite(Date.parse(drain.observedAt)), blockers,
    "PostgreSQL writer-drain observation time is missing or malformed."));
  checks.push(check("observer-application", drain?.observerApplicationName === "bodycast-production-preflight", blockers,
    "PostgreSQL writer-drain observer is not the fixed preflight connection."));
  checks.push(check("identity-policy", drain?.identityPolicy === "no-other-client-backends", blockers,
    "PostgreSQL writer-drain identity policy is not the zero-other-client contract."));
  checks.push(check("backend-inventory", Array.isArray(drain?.activeClientBackends), blockers,
    "PostgreSQL client-backend inventory is missing or malformed."));
  const activeCount = Array.isArray(drain?.activeClientBackends) ? drain.activeClientBackends.length : null;
  checks.push(check("zero-other-client-backends", activeCount === 0, blockers,
    activeCount === null ? "PostgreSQL client-backend inventory is unknown." : `PostgreSQL writer drain found ${activeCount} other client backend(s).`));

  const topology = drain?.topology;
  const verifiedTopology = evaluateProductionWriterTopology(topology ?? {});
  checks.push(check("topology-schema", topology?.schemaVersion === 1, blockers, "Production topology evidence schema is missing or unsupported."));
  checks.push(check("topology-contract", topology?.contract === PRODUCTION_WRITER_TOPOLOGY_CONTRACT, blockers,
    "Production topology evidence does not match the fixed reviewed contract."));
  checks.push(check("topology-reported-ready", topology?.ready === true && Array.isArray(topology?.blockers) && topology.blockers.length === 0, blockers,
    "Production topology evidence reports blocked or unknown predicates."));
  checks.push(...verifiedTopology.checks);
  if (!verifiedTopology.ready) blockers.push("Production app/proxy/network topology drain evidence is not ready.");

  return {
    ready: blockers.length === 0,
    blockers,
    checks,
    observerPid: observerPidValid ? drain.observerPid : null,
    observedAt: drain?.observedAt ?? null,
    activeClientBackendCount: activeCount,
    topology: verifiedTopology,
  };
}

export function assertFreshWriterDrain(report, { now = Date.now(), maxAgeMs = 30_000 } = {}) {
  const evaluated = evaluateProductionWriterDrain(report);
  if (!evaluated.ready) reject("one or more required predicates failed", evaluated.checks);
  const observedAt = Date.parse(evaluated.observedAt);
  const ageMs = now - observedAt;
  const writerFresh = Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs <= maxAgeMs;
  const topologyAgeMs = now - Date.parse(evaluated.topology.observedAt);
  const topologyFresh = Number.isFinite(topologyAgeMs) && topologyAgeMs >= -60_000 && topologyAgeMs <= maxAgeMs;
  const freshnessChecks = [
    { id: "writer-drain-freshness", passed: writerFresh },
    { id: "topology-freshness", passed: topologyFresh },
  ];
  if (!writerFresh || !topologyFresh) reject("writer-drain or topology observation is stale or from the future", [...evaluated.checks, ...freshnessChecks]);
  return { ...evaluated, checks: [...evaluated.checks, ...freshnessChecks], ageMs, topologyAgeMs };
}

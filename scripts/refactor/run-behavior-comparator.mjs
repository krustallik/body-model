import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile, symlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  aggregateSuiteCases,
  diffJson,
  parseComparatorArgs,
  sortObservationsByCaseId,
  stableJson,
  validateManifest,
  validateResolvedPostgresImage,
} from "./comparator-core.mjs";
import { capturePersistedState, waitForLoopbackPort, withAttestedDatabase } from "./database-evidence.mjs";

const PASSWORD = "bodycast-refactor-test-only-password";
const TEST_SECRET = "bodycast-comparator-only-secret-never-for-deployment";
const PROCESS_TIMEOUT_MS = 45 * 60 * 1000;

function fail(message) {
  throw new Error(message);
}

function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redact(value) {
  return String(value)
    .replaceAll(PASSWORD, "[REDACTED_TEST_PASSWORD]")
    .replaceAll(TEST_SECRET, "[REDACTED_TEST_SECRET]")
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]");
}

function runProcess(program, args, { cwd, env, input, onStdout, timeoutMs = PROCESS_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.from(chunk));
      onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const result = {
        code: code ?? -1,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (timedOut) reject(Object.assign(new Error(`${program} timed out.`), { result }));
      else resolve(result);
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function runChecked(program, args, options = {}) {
  const result = await runProcess(program, args, options);
  if (result.code !== 0) {
    const detail = redact(result.stderr.toString("utf8").slice(-4000));
    fail(`${program} failed with exit ${result.code}${result.signal ? ` (${result.signal})` : ""}.${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

async function runLogged(program, args, { logPath, label, ...options }) {
  let result;
  let error;
  try {
    result = await runProcess(program, args, options);
  } catch (caught) {
    error = caught;
    result = caught.result;
    if (!result) throw caught;
  }
  const command = redact([program, ...args].join(" "));
  const logText = [
    `# ${label}`,
    `# cwd: ${options.cwd ?? process.cwd()}`,
    `# command: ${command}`,
    `# exit: ${result.code}${result.signal ? ` signal=${result.signal}` : ""}${result.timedOut ? " timeout=true" : ""}`,
    "--- stdout ---",
    redact(result.stdout.toString("utf8")),
    "--- stderr ---",
    redact(result.stderr.toString("utf8")),
  ].join("\n");
  await writeFile(logPath, logText, { encoding: "utf8", flag: "wx" });
  if (error) throw error;
  if (result.code !== 0) {
    fail(`${label} failed with exit ${result.code}; see ${logPath}`);
  }
  return { result, command: [program, ...args] };
}

function integrationProgress(label) {
  let pending = "";
  const syntheticMilestones = new Map([
    ["synthetic-bodyweight-http-reproduction", "bodyweight API capture"],
    ["synthetic-resistance-band-http-reproduction", "resistance-band API capture"],
    ["synthetic-active-programless-http-reproduction", "active-session API capture"],
  ]);
  return (chunk) => {
    const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
      const match = plain.match(/^\s*✓\s+(tests\/integration\/[^\s>]+\.test\.[A-Za-z0-9]+)\s*>/);
      if (match) process.stdout.write(`[${label}] ${path.basename(match[1])}\n`);
      for (const [marker, description] of syntheticMilestones) {
        if (plain.includes(marker)) process.stdout.write(`[${label}] reached ${description}\n`);
      }
    }
  };
}

async function runToFile(program, args, { cwd, env, outputPath, timeoutMs = PROCESS_TIMEOUT_MS } = {}) {
  const child = spawn(program, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const file = createWriteStream(outputPath, { flags: "wx" });
  const stderr = [];
  child.stdout.pipe(file);
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const result = await new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, signal, timedOut });
    });
  });
  await new Promise((resolve, reject) => {
    file.once("error", reject);
    file.end(resolve);
  });
  if (result.timedOut || result.code !== 0) {
    const detail = redact(Buffer.concat(stderr).toString("utf8").slice(-4000));
    fail(`${program} stream failed with exit ${result.code}${detail ? `: ${detail}` : ""}`);
  }
}

async function runFromFile(program, args, { inputPath, cwd, env, timeoutMs = PROCESS_TIMEOUT_MS } = {}) {
  const child = spawn(program, args, { cwd, env, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  const stream = (await import("node:fs")).createReadStream(inputPath);
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  stream.pipe(child.stdin);
  const result = await new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      stream.destroy();
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, signal, timedOut });
    });
    stream.once("error", reject);
  });
  if (result.timedOut || result.code !== 0) {
    const detail = redact(Buffer.concat(stderr).toString("utf8").slice(-4000));
    fail(`${program} restore failed with exit ${result.code}${detail ? `: ${detail}` : ""}`);
  }
}

async function writeJson(target, value) {
  await writeFile(target, `${stableJson(value)}\n`, { encoding: "utf8", flag: "wx" });
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function git(root, args) {
  const result = await runChecked("git", args, { cwd: root, timeoutMs: 120_000 });
  return result.stdout.toString("utf8").trim();
}

async function gitExists(root, expression) {
  const result = await runProcess("git", ["cat-file", "-e", expression], { cwd: root, timeoutMs: 30_000 });
  return result.code === 0;
}

async function shaForFile(file) {
  return digestBytes(await readFile(file));
}

async function migrationInventory(repository) {
  const root = path.join(repository, "prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  if (directories.length === 0 || directories.some((name) => !/^\d{14}_[a-z0-9_]+$/.test(name))) {
    fail("Migration directory inventory is empty or malformed.");
  }
  const migrations = [];
  for (const name of directories) {
    const migrationPath = path.join(root, name, "migration.sql");
    migrations.push({ name, checksum: await shaForFile(migrationPath) });
  }
  return {
    migrations,
    digest: digestBytes(migrations.map(({ name, checksum }) => `${name}\t${checksum}\n`).join("")),
  };
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Comparator endpoint ${host}:${port} is already occupied.`)));
    server.listen(port, host, () => server.close((error) => error ? reject(error) : resolve(undefined)));
  });
}

function databaseUrl(target) {
  return `postgresql://${encodeURIComponent(target.role)}:${encodeURIComponent(PASSWORD)}@${target.host}:${target.port}/${encodeURIComponent(target.database)}`;
}

async function dockerJson(args, cwd) {
  const result = await runChecked("docker", args, { cwd, timeoutMs: 60_000 });
  try { return JSON.parse(result.stdout.toString("utf8").trim()); } catch { fail("Docker returned invalid JSON during comparator attestation."); }
}

async function verifyPinnedImage(root, image) {
  const details = await dockerJson(["image", "inspect", "--format", "{{json .}}", image], root);
  const imageId = details.Id;
  const repoDigests = Array.isArray(details.RepoDigests) ? details.RepoDigests : [];
  validateResolvedPostgresImage(image, repoDigests);
  if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(imageId)) {
    fail("Pinned PostgreSQL image digest is not present locally or did not resolve exactly.");
  }
  return { imageId, repoDigests };
}

async function inspectContainer(root, containerId, target, runId, image, imageId) {
  const details = await dockerJson(["inspect", containerId], root);
  const container = Array.isArray(details) ? details[0] : details;
  const mapping = container?.NetworkSettings?.Ports?.["5432/tcp"]?.[0];
  const networks = Object.values(container?.NetworkSettings?.Networks ?? {});
  const networkAddress = networks.map(({ IPAddress }) => IPAddress).find(Boolean);
  if (!container || container.Id !== containerId || !container.State?.Running
    || container.Image !== imageId || container.Config?.Image !== image
    || container.Config?.Labels?.["org.bodycast.refactor.run"] !== runId
    || container.Config?.Labels?.["org.bodycast.refactor.database"] !== target.database
    || container.Config?.Labels?.["org.bodycast.refactor.role"] !== target.role
    || mapping?.HostIp !== target.host || mapping?.HostPort !== String(target.port)
    || !networkAddress) {
    fail("Comparator Docker container identity, pinned image, label, or loopback port binding failed.");
  }
  return {
    containerId: container.Id,
    imageId: container.Image,
    configuredImage: container.Config.Image,
    networkAddress,
    mappedHost: mapping.HostIp,
    mappedPort: Number(mapping.HostPort),
    name: container.Name,
    startedAt: container.State.StartedAt,
  };
}

async function startDatabase(root, target, image, imageId, runId, label) {
  await assertPortAvailable(target.host, target.port);
  const name = `bodycast-refactor-${runId.slice(0, 8)}-${label}`.toLowerCase();
  const args = [
    "run", "--detach", "--name", name, "--stop-timeout", "10",
    "--label", `org.bodycast.refactor.run=${runId}`,
    "--label", `org.bodycast.refactor.database=${target.database}`,
    "--label", `org.bodycast.refactor.role=${target.role}`,
    "--publish", `${target.host}:${target.port}:5432`,
    "--env", `POSTGRES_DB=${target.database}`,
    "--env", `POSTGRES_USER=${target.role}`,
    "--env", `POSTGRES_PASSWORD=${PASSWORD}`,
    "--health-cmd", `pg_isready -U ${target.role} -d ${target.database}`,
    "--health-interval", "2s", "--health-timeout", "2s", "--health-retries", "30",
    image, "postgres", "-c", "timezone=UTC", "-c", "log_timezone=UTC",
  ];
  const result = await runChecked("docker", args, { cwd: root, timeoutMs: 120_000 });
  const containerId = result.stdout.toString("utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(containerId)) fail("Docker did not return a full container ID.");
  try {
    const inspected = await inspectContainer(root, containerId, target, runId, image, imageId);
    const started = Date.now();
    while (Date.now() - started < 90_000) {
      const ready = await runProcess("docker", ["exec", containerId, "pg_isready", "-U", target.role, "-d", target.database], {
        cwd: root,
        timeoutMs: 10_000,
      });
      if (ready.code === 0) {
        await waitForLoopbackPort(target.host, target.port);
        return { ...inspected, readiness: "ready" };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const logs = await runProcess("docker", ["logs", containerId], { cwd: root, timeoutMs: 30_000 });
    fail(`Comparator PostgreSQL did not become ready: ${redact(logs.stdout.toString("utf8")).slice(-3000)}`);
  } catch (error) {
    const current = await dockerJson(["inspect", containerId], root).catch(() => null);
    const owned = Array.isArray(current) ? current[0] : current;
    if (owned?.Id === containerId && owned.Config?.Labels?.["org.bodycast.refactor.run"] === runId) {
      await runProcess("docker", ["stop", "--time", "5", containerId], { cwd: root, timeoutMs: 30_000 }).catch(() => undefined);
      await runProcess("docker", ["rm", containerId], { cwd: root, timeoutMs: 30_000 }).catch(() => undefined);
    }
    throw error;
  }
}

async function stopDatabase(root, container, runId) {
  if (!container) return;
  const current = await dockerJson(["inspect", container.containerId], root).catch(() => null);
  const inspected = Array.isArray(current) ? current[0] : current;
  if (!inspected) return;
  if (inspected.Id !== container.containerId
    || inspected.Config?.Labels?.["org.bodycast.refactor.run"] !== runId) {
    fail("Refusing to stop a Docker container not owned by this exact comparator run.");
  }
  if (inspected.State?.Running) {
    await runChecked("docker", ["stop", "--time", "10", container.containerId], { cwd: root, timeoutMs: 30_000 });
  }
  await runChecked("docker", ["rm", container.containerId], { cwd: root, timeoutMs: 30_000 });
}

async function attest(target, container) {
  return withAttestedDatabase({
    databaseUrl: databaseUrl(target),
    expected: target,
    mode: "test",
    dockerIdentity: {
      ...container,
      imageDigest: container.configuredImage,
    },
  }, async (_client, identity) => identity);
}

async function captureDatabase(target, container, manifest) {
  return withAttestedDatabase({
    databaseUrl: databaseUrl(target),
    expected: target,
    mode: "test",
    dockerIdentity: {
      ...container,
      imageDigest: container.configuredImage,
    },
  }, async (client, identity) => ({
    identity,
    persisted: await capturePersistedState(client, manifest.postgres.snapshotTables),
  }));
}

async function prepareLegacyTree(root, sha, evidenceDir) {
  const legacyRoot = path.join(evidenceDir, "bootstrap", "legacy-74");
  await mkdir(legacyRoot, { recursive: true });
  const archive = spawn("git", ["archive", "--format=tar", sha, "prisma/schema.prisma", "prisma/migrations"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const tarPath = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const extract = spawn(tarPath, ["-xf", "-", "-C", legacyRoot], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  const archiveErrors = [];
  const extractErrors = [];
  archive.stderr.on("data", (chunk) => archiveErrors.push(Buffer.from(chunk)));
  extract.stderr.on("data", (chunk) => extractErrors.push(Buffer.from(chunk)));
  archive.stdout.pipe(extract.stdin);
  const [archiveResult, extractResult] = await Promise.all([
    new Promise((resolve, reject) => {
      archive.once("error", reject);
      archive.once("close", (code, signal) => resolve({ code, signal }));
    }),
    new Promise((resolve, reject) => {
      extract.once("error", reject);
      extract.once("close", (code, signal) => resolve({ code, signal }));
    }),
  ]);
  if (archiveResult.code !== 0 || extractResult.code !== 0) {
    fail(`Could not extract the pinned legacy migration tree: ${redact(Buffer.concat([...archiveErrors, ...extractErrors]).toString("utf8"))}`);
  }
  const migrations = await migrationInventory(legacyRoot);
  if (migrations.migrations.length !== 74) fail("Pinned legacy migration archive must contain exactly 74 migrations.");
  return { root: legacyRoot, migrations, schema: path.join(legacyRoot, "prisma", "schema.prisma") };
}

async function seedProfileOne(root, target, container) {
  const before = await withAttestedDatabase({
    databaseUrl: databaseUrl(target), expected: target, mode: "test",
    dockerIdentity: { ...container, imageDigest: container.configuredImage },
  }, async (client) => {
    const rows = await client.$queryRawUnsafe('SELECT count(*)::int AS count FROM public."Profile"');
    return rows[0]?.count;
  });
  if (before !== 0) fail("Synthetic comparator bootstrap requires an empty Profile table before seeding.");
  const sql = [
    "BEGIN;",
    `INSERT INTO public."Profile" ("id", "sex", "dateOfBirth", "heightCm", "createdAt", "updatedAt") VALUES (1, 'female', DATE '1990-01-01', 170.00, TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00');`,
    `SELECT setval(pg_get_serial_sequence('public."Profile"', 'id'), 1, true);`,
    "COMMIT;",
  ].join("\n");
  await runChecked("docker", ["exec", "-i", container.containerId, "psql", "--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "-U", target.role, "-d", target.database], {
    cwd: root,
    input: sql,
    timeoutMs: 120_000,
  });
  const verified = await withAttestedDatabase({
    databaseUrl: databaseUrl(target), expected: target, mode: "test",
    dockerIdentity: { ...container, imageDigest: container.configuredImage },
  }, async (client) => client.$queryRawUnsafe('SELECT "id", "createdAt"::text AS created_at FROM public."Profile" ORDER BY "id"'));
  if (verified.length !== 1 || Number(verified[0].id) !== 1 || !String(verified[0].created_at).startsWith("2026-01-01")) {
    fail("Deterministic Profile 1 fixture did not verify exactly.");
  }
}

async function createDatabaseTemplate({ root, beforeRepository, manifest, evidenceDir, runId, imageId }) {
  const target = manifest.postgres.before;
  let container;
  const legacy = await prepareLegacyTree(root, manifest.postgres.legacyMigrationBaselineSha, evidenceDir);
  try {
    container = await startDatabase(root, target, manifest.postgres.image, imageId, runId, "template");
    const identityBeforeWrites = await attest(target, container);
    await writeJson(path.join(evidenceDir, "bootstrap", "template-identity-before-writes.json"), identityBeforeWrites);
    await attest(target, container);
    await runLogged(process.execPath, [
      path.join(beforeRepository, "node_modules", "prisma", "build", "index.js"),
      "migrate", "deploy", "--schema", legacy.schema,
    ], {
      cwd: beforeRepository,
      env: safeEnvironment(target),
      logPath: path.join(evidenceDir, "bootstrap", "legacy-migrate.log"),
      label: "Apply the exact pinned 74-migration baseline",
    });
    await seedProfileOne(root, target, container);
    await attest(target, container);
    await runLogged(process.execPath, [
      path.join(beforeRepository, "node_modules", "prisma", "build", "index.js"),
      "migrate", "deploy", "--schema", path.join(beforeRepository, "prisma", "schema.prisma"),
    ], {
      cwd: beforeRepository,
      env: safeEnvironment(target),
      logPath: path.join(evidenceDir, "bootstrap", "current-migrate.log"),
      label: "Apply the exact complete repository migration tree",
    });
    await runLogged(process.execPath, [path.join(beforeRepository, "scripts", "production-empty-install-ledger.mjs"), "--test"], {
      cwd: beforeRepository,
      env: safeEnvironment(target),
      logPath: path.join(evidenceDir, "bootstrap", "migration-ledger-verification.log"),
      label: "Verify exact migration checksums and empty synthetic raw sources",
    });
    const initialState = await captureDatabase(target, container, manifest);
    await writeJson(path.join(evidenceDir, "bootstrap", "template-initial-state.json"), initialState);
    const dumpPath = path.join(evidenceDir, "bootstrap", "frozen-postgres-fixture.dump");
    await runToFile("docker", ["exec", container.containerId, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "-U", target.role, "-d", target.database], {
      cwd: root,
      outputPath: dumpPath,
    });
    const dumpStats = await stat(dumpPath);
    const dumpDigest = await shaForFile(dumpPath);
    await writeJson(path.join(evidenceDir, "bootstrap", "frozen-postgres-fixture.json"), {
      sha256: dumpDigest,
      bytes: dumpStats.size,
      baseSha: manifest.bootstrapBaseSha,
      legacyBaselineSha: manifest.postgres.legacyMigrationBaselineSha,
      legacyMigrationCount: legacy.migrations.migrations.length,
      legacyMigrationTreeSha256: legacy.migrations.digest,
      currentMigrationTreeSha256: (await migrationInventory(beforeRepository)).digest,
      profileFixture: { id: 1, sex: "female", dateOfBirth: "1990-01-01", heightCm: "170.00", createdAt: "2026-01-01T00:00:00.000Z" },
    });
    return { dumpPath, dumpDigest, initialState };
  } finally {
    await stopDatabase(root, container, runId);
  }
}

function safeEnvironment(target, extra = {}) {
  const keep = [
    "PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA",
  ];
  const env = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  const url = databaseUrl(target);
  Object.assign(env, {
    NODE_ENV: "test",
    TZ: "UTC",
    DATABASE_URL: url,
    BODYCAST_STAGE01_MODE: "test",
    BODYCAST_GLYCOGEN_TEST_DATABASE_URL: url,
    BODYCAST_RECOVERY_TEST_DATABASE_URL: url,
    IOS_SHORTCUT_API_KEY: "integration-test-secret",
    BETTER_AUTH_SECRET: TEST_SECRET,
    BETTER_AUTH_URL: "http://localhost:3000",
    AUTH_TRUSTED_PROXIES: "127.0.0.1/32",
    ...extra,
  });
  return env;
}

async function createDatabaseFromTemplate({ root, target, manifest, imageId, runId, label, dumpPath }) {
  const container = await startDatabase(root, target, manifest.postgres.image, imageId, runId, label);
  try {
    const identityBeforeRestore = await attest(target, container);
    const targetDir = path.join(path.dirname(dumpPath), `${label}-identity-before-restore.json`);
    await writeJson(targetDir, identityBeforeRestore);
    await runFromFile("docker", [
      "exec", "-i", container.containerId, "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
      "--role", target.role, "--username", target.role, "--dbname", target.database,
    ], { cwd: root, inputPath: dumpPath });
    const initial = await captureDatabase(target, container, manifest);
    return { container, initial };
  } catch (error) {
    await stopDatabase(root, container, runId).catch(() => undefined);
    throw error;
  }
}

async function readTestSummary(reportPath, label, repository, { allowFiltered = false } = {}) {
  const reportText = await readFile(reportPath, "utf8");
  const scrubbedText = redact(reportText);
  if (scrubbedText !== reportText) await writeFile(reportPath, scrubbedText, { encoding: "utf8" });
  const report = await readJson(reportPath);
  const suites = report.testResults;
  if (!Array.isArray(suites) || suites.length === 0 || !Number.isSafeInteger(report.numTotalTests) || report.numTotalTests <= 0) {
    fail(`${label} did not produce a non-empty Vitest JSON test report.`);
  }
  const tests = [];
  const files = [];
  for (const suite of suites) {
    if (!Array.isArray(suite.assertionResults)) fail(`${label} returned an unsupported Vitest report schema.`);
    const relative = path.relative(repository, suite.name).split(path.sep).join("/");
    files.push(relative);
    for (const test of suite.assertionResults) {
      tests.push({ file: relative, name: test.fullName, status: test.status });
    }
  }
  const allowedStatuses = allowFiltered ? ["passed", "skipped"] : ["passed"];
  if (tests.length !== report.numTotalTests || report.numFailedTests !== 0 || report.numTodoTests !== 0
    || tests.some(({ status }) => !allowedStatuses.includes(status))) {
    fail(`${label} contains failures, todos, or incomplete results.`);
  }
  if (allowFiltered && report.numPassedTests + report.numPendingTests !== report.numTotalTests) {
    fail(`${label} contains an unsupported pending result status.`);
  }
  if (!allowFiltered && report.numPendingTests !== 0) {
    fail(`${label} contains skipped or pending tests.`);
  }
  return {
    total: tests.length,
    passed: report.numPassedTests,
    filtered: report.numPendingTests,
    files: files.sort(),
    tests: tests.sort((a, b) => `${a.file}\0${a.name}`.localeCompare(`${b.file}\0${b.name}`)),
  };
}

async function runUnitSuite({ repository, target, manifest, evidenceDir, sideName, shimPath }) {
  const suite = manifest.unitSuites[0];
  const sideRoot = path.join(evidenceDir, sideName, "unit", suite.id);
  await mkdir(sideRoot, { recursive: true });
  const reportPath = path.join(sideRoot, "vitest-report.json");
  const capturePath = path.join(sideRoot, "observations.ndjson");
  await writeFile(capturePath, "", { encoding: "utf8", flag: "wx" });
  const env = safeEnvironment(target, {
    BODYCAST_REFACTOR_CAPTURE_FILE: capturePath,
    BODYCAST_REFACTOR_FIXED_TIME: manifest.determinism.clock,
    BODYCAST_REFACTOR_CLOCK_MODE: "frozen",
    BODYCAST_REFACTOR_RANDOM_SEED: manifest.determinism.randomSeed,
    NODE_OPTIONS: `--import=${pathToFileURL(shimPath).href}`,
  });
  const args = [
    path.join(repository, "node_modules", "vitest", "vitest.mjs"), "run",
    "--pool=forks", "--maxWorkers=1", "--minWorkers=1", "--reporter=json", `--outputFile=${reportPath}`,
    ...suite.paths,
  ];
  await runLogged(process.execPath, args, {
    cwd: repository,
    env,
    logPath: path.join(sideRoot, "test.log"),
    label: `${sideName} ${suite.id}`,
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  const cases = await readTestSummary(reportPath, `${sideName} ${suite.id}`, repository);
  if (stableJson(cases.files) !== stableJson([...suite.paths].sort())) {
    fail(`${sideName} frozen unit suite did not execute every manifest path exactly once.`);
  }
  const observationLines = (await readFile(capturePath, "utf8")).split(/\r?\n/).filter(Boolean);
  const observations = sortObservationsByCaseId(observationLines.map((line) => JSON.parse(line)));
  const expectedIds = manifest.observations.map(({ id }) => id).sort();
  const observedIds = observations.map(({ caseId }) => caseId).sort();
  if (stableJson(expectedIds) !== stableJson(observedIds)) fail(`${sideName} comparator observation set is missing, duplicated, or contains extra cases.`);
  await writeJson(path.join(sideRoot, "case-summary.json"), cases);
  await writeJson(path.join(sideRoot, "observations.json"), observations);
  return { cases, observations };
}

async function runComparatorSelfTests({ root, manifest, evidenceDir, shimPath }) {
  const selfRoot = path.join(evidenceDir, "comparator-self-tests");
  await mkdir(selfRoot, { recursive: true });
  const reportPath = path.join(selfRoot, "vitest-report.json");
  const env = safeEnvironment(manifest.postgres.before, {
    BODYCAST_REFACTOR_FIXED_TIME: manifest.determinism.clock,
    BODYCAST_REFACTOR_CLOCK_MODE: "frozen",
    BODYCAST_REFACTOR_RANDOM_SEED: manifest.determinism.randomSeed,
    NODE_OPTIONS: `--import=${pathToFileURL(shimPath).href}`,
  });
  await runLogged(process.execPath, [
    path.join(root, "node_modules", "vitest", "vitest.mjs"), "run",
    "--pool=forks", "--maxWorkers=1", "--minWorkers=1", "--reporter=json", `--outputFile=${reportPath}`,
    "tests/refactor-comparator",
  ], {
    cwd: root,
    env,
    logPath: path.join(selfRoot, "test.log"),
    label: "Comparator parser, isolation, deterministic runtime, and negative sentinel tests",
  });
  const cases = await readTestSummary(reportPath, "Comparator self-tests", root);
  await writeJson(path.join(selfRoot, "case-summary.json"), cases);
  return cases;
}

async function runIntegrationSuite({ root, repository, target, manifest, suite, evidenceDir, sideName, shimPath, dumpPath, imageId, runId }) {
  const sideRoot = path.join(evidenceDir, sideName, "integration", suite.id);
  await mkdir(sideRoot, { recursive: true });
  const reportPath = path.join(sideRoot, "vitest-report.json");
  const env = safeEnvironment(target, {
    BODYCAST_REFACTOR_FIXED_TIME: manifest.determinism.clock,
    BODYCAST_REFACTOR_CLOCK_MODE: "native",
    BODYCAST_REFACTOR_RANDOM_SEED: manifest.determinism.randomSeed,
    NODE_OPTIONS: `--import=${pathToFileURL(shimPath).href}`,
    ...(suite.authEnvironment ? { LEGACY_IOS_SHORTCUT_ENABLED: "true" } : {}),
  });
  const { container, initial } = await createDatabaseFromTemplate({
    root,
    target,
    manifest,
    imageId,
    runId,
    label: `${sideName}-${suite.id}`,
    dumpPath,
  });
  try {
    const initialIdentity = await attest(target, container);
    await writeJson(path.join(sideRoot, "database-identity-before-tests.json"), initialIdentity);
    await writeJson(path.join(sideRoot, "database-initial-state.json"), initial);
    const args = [
      path.join(repository, "node_modules", "vitest", "vitest.mjs"), "run",
      "--config", "vitest.integration.config.ts", "--reporter=verbose",
      "--pool=forks", "--maxWorkers=1", "--minWorkers=1", "--reporter=json", `--outputFile=${reportPath}`,
      ...suite.args,
    ];
    await runLogged(process.execPath, args, {
      cwd: repository,
      env,
      logPath: path.join(sideRoot, "test.log"),
      label: `${sideName} ${suite.id}`,
      onStdout: integrationProgress(`${sideName} ${suite.id}`),
      timeoutMs: PROCESS_TIMEOUT_MS,
    });
    const cases = await readTestSummary(reportPath, `${sideName} ${suite.id}`, repository, { allowFiltered: true });
    const finalState = await captureDatabase(target, container, manifest);
    await writeJson(path.join(sideRoot, "case-summary.json"), cases);
    await writeJson(path.join(sideRoot, "database-final-state.json"), finalState);
    return { cases, initial, finalState, identity: initialIdentity };
  } finally {
    await stopDatabase(root, container, runId);
  }
}

async function overlayFrozenTests(sourceRoot, destinationRoot, backupRoot) {
  const backup = [];
  async function walk(sourceDirectory, relativeDirectory) {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const source = path.join(sourceDirectory, entry.name);
      const destination = path.join(destinationRoot, relative);
      if (entry.isDirectory()) {
        await walk(source, relative);
        continue;
      }
      if (!entry.isFile()) fail(`Frozen test overlay refuses non-file entry: ${relative}`);
      let previousExists = true;
      try {
        const previous = await lstat(destination);
        if (!previous.isFile()) fail(`Frozen test overlay target is not a regular file: ${relative}`);
      } catch (error) {
        if (error?.code === "ENOENT") previousExists = false;
        else throw error;
      }
      if (previousExists) {
        const backupPath = path.join(backupRoot, relative);
        await mkdir(path.dirname(backupPath), { recursive: true });
        await copyFile(destination, backupPath);
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      backup.push({ relative, previousExists });
    }
  }
  await walk(path.join(sourceRoot, "tests"), "tests");
  for (const relative of ["vitest.config.ts", "vitest.integration.config.ts", "tsconfig.json"]) {
    const source = path.join(sourceRoot, relative);
    const destination = path.join(destinationRoot, relative);
    let previousExists = true;
    try {
      const previous = await lstat(destination);
      if (!previous.isFile()) fail(`Frozen test overlay target is not a regular file: ${relative}`);
    } catch (error) {
      if (error?.code === "ENOENT") previousExists = false;
      else throw error;
    }
    if (previousExists) {
      const backupPath = path.join(backupRoot, relative);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(destination, backupPath);
    }
    await copyFile(source, destination);
    backup.push({ relative, previousExists });
  }
  return backup;
}

async function restoreOverlay(destinationRoot, backupRoot, entries) {
  for (const entry of [...entries].reverse()) {
    const destination = path.join(destinationRoot, entry.relative);
    if (entry.previousExists) {
      await copyFile(path.join(backupRoot, entry.relative), destination);
    } else {
      await rm(destination, { force: true });
    }
  }
}

async function ensureNodeModulesLink(repository, dependencyRoot) {
  const linkPath = path.join(repository, "node_modules");
  try {
    await lstat(linkPath);
    fail(`Temporary comparator worktree unexpectedly contains node_modules: ${repository}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await access(dependencyRoot);
  await symlink(dependencyRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function cleanupWorktree(root, repository, overlayEntries, backupRoot) {
  if (!repository) return;
  if (overlayEntries?.length) await restoreOverlay(repository, backupRoot, overlayEntries);
  const linkPath = path.join(repository, "node_modules");
  await rm(linkPath, { force: true, recursive: false }).catch(() => undefined);
  const status = await git(root, ["-C", repository, "status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) fail(`Comparator scratch worktree is not clean after verification; preserving it at ${repository}: ${status}`);
  await git(root, ["worktree", "remove", repository]);
}

async function sourceTreeEvidence(repository) {
  const packageJson = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  const packageLock = await shaForFile(path.join(repository, "package-lock.json"));
  const schemaSha = await shaForFile(path.join(repository, "prisma", "schema.prisma"));
  const migrations = await migrationInventory(repository);
  return {
    treeSha: await git(repository, ["rev-parse", "HEAD^{tree}"]),
    packageLockSha256: packageLock,
    dependencyManifest: {
      dependencies: packageJson.dependencies ?? {},
      devDependencies: packageJson.devDependencies ?? {},
      optionalDependencies: packageJson.optionalDependencies ?? {},
    },
    prismaSchemaSha256: schemaSha,
    migrations,
  };
}

async function writeRunMetadata({ root, evidenceDir, args, manifest, manifestText, sourceEvidence, harnessRoot, shimPath, runId }) {
  const commitEvidence = {};
  for (const [label, sha] of [["base", args.baseSha], ["candidate", args.candidateSha]]) {
    commitEvidence[label] = {
      sha,
      treeSha: await git(root, ["rev-parse", `${sha}^{tree}`]),
      parentShas: (await git(root, ["rev-list", "--parents", "-n", "1", sha])).split(" ").slice(1),
    };
  }
  const lockfileText = await readFile(path.join(root, "package-lock.json"));
  const evidence = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    baseSha: args.baseSha,
    candidateSha: args.candidateSha,
    commits: commitEvidence,
    comparator: {
      scriptSha256: await shaForFile(path.join(root, "scripts", "refactor", "run-behavior-comparator.mjs")),
      coreSha256: await shaForFile(path.join(root, "scripts", "refactor", "comparator-core.mjs")),
      databaseEvidenceSha256: await shaForFile(path.join(root, "scripts", "refactor", "database-evidence.mjs")),
      deterministicRuntimeSha256: await shaForFile(shimPath),
      manifestSha256: digestBytes(manifestText),
      manifest,
    },
    frozenHarness: {
      sha: harnessRoot === root ? args.candidateSha : await git(harnessRoot, ["rev-parse", "HEAD"]),
      treeSha: await git(harnessRoot, ["rev-parse", "HEAD^{tree}"]),
      sourceRepository: harnessRoot,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      tz: "UTC",
      fixedClock: manifest.determinism.clock,
      randomSeedSha256: digestBytes(manifest.determinism.randomSeed),
      packageLockSha256: digestBytes(lockfileText),
    },
    beforeSource: sourceEvidence.before,
    candidateSource: sourceEvidence.candidate,
  };
  await writeJson(path.join(evidenceDir, "run-metadata.json"), evidence);
  return evidence;
}

function stableTestResults(left, right) {
  return stableJson(left) === stableJson(right);
}

async function preflight(args, root) {
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (path.resolve(top) !== path.resolve(root)) fail("Comparator must run from the task-owned repository root.");
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (head !== args.candidateSha) fail("Candidate SHA must equal the exact current HEAD.");
  const dirty = await git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty) fail("Comparator candidate worktree must be completely clean before running.");
  const baseExists = await gitExists(root, `${args.baseSha}^{commit}`);
  if (!baseExists) fail("Comparator base SHA is unavailable locally.");
  const ancestor = await runProcess("git", ["merge-base", "--is-ancestor", args.baseSha, args.candidateSha], { cwd: root, timeoutMs: 30_000 });
  if (ancestor.code !== 0) fail("Comparator base SHA must be an ancestor of candidate SHA.");
  const manifestExistsAtBase = await gitExists(root, `${args.baseSha}:${args.manifest}`);
  return { head, manifestExistsAtBase };
}

async function assertEvidenceLocation(root, evidenceDir) {
  if (await access(evidenceDir).then(() => true).catch(() => false)) {
    fail("Comparator evidence directory must be new; refusing to overwrite prior evidence.");
  }
  const parent = await realpath(path.dirname(evidenceDir));
  const commonDirText = await git(root, ["rev-parse", "--git-common-dir"]);
  const commonDir = path.resolve(root, commonDirText);
  const worktreeLines = (await git(root, ["worktree", "list", "--porcelain"])).split(/\r?\n/);
  const worktrees = worktreeLines.filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length)));
  if (isWithin(commonDir, parent) || isWithin(parent, commonDir)) {
    fail("Comparator evidence directory must be outside the shared Git metadata directory.");
  }
  for (const worktree of worktrees) {
    if (isWithin(worktree, parent) || isWithin(parent, worktree)) {
      fail("Comparator evidence directory must not overlap any existing Git worktree.");
    }
  }
}

async function main() {
  const args = parseComparatorArgs(process.argv.slice(2));
  const root = await git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const preflightResult = await preflight(args, root);
  const manifestPath = path.resolve(root, args.manifest);
  if (!isWithin(root, manifestPath)) fail("Comparator manifest path escapes the repository root.");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = validateManifest(JSON.parse(manifestText));
  if (!preflightResult.manifestExistsAtBase && manifest.bootstrapBaseSha !== args.baseSha) {
    fail("A comparator harness absent at base can only bootstrap its exact frozen base SHA.");
  }
  if (preflightResult.manifestExistsAtBase) {
    const baseManifest = await git(root, ["show", `${args.baseSha}:${args.manifest}`]);
    if (stableJson(JSON.parse(baseManifest)) !== stableJson(manifest)) {
      fail("Frozen comparator manifest differs from the exact stage base.");
    }
  }

  const evidenceDir = path.resolve(args.evidenceDir);
  if (!path.isAbsolute(evidenceDir) || isWithin(root, evidenceDir)) fail("Evidence directory must be absolute and outside the repository/worktree.");
  const runId = digestBytes(`${process.pid}:${process.hrtime.bigint()}:${randomUUID()}`);
  const baseWorktree = path.join(evidenceDir, "scratch", "base");
  const candidateWorktree = path.join(evidenceDir, "scratch", "candidate");
  const backups = path.join(evidenceDir, "scratch", "frozen-test-backups");
  await assertEvidenceLocation(root, evidenceDir);
  await mkdir(evidenceDir, { recursive: false });
  await mkdir(path.dirname(baseWorktree), { recursive: true });
  await mkdir(backups, { recursive: true });
  let baseAdded = false;
  let candidateAdded = false;
  let harnessAdded = false;
  let baseOverlay;
  let candidateOverlay;
  let verdict = "FAIL";
  let failure = null;

  try {
    await git(root, ["worktree", "add", "--detach", baseWorktree, args.baseSha]);
    baseAdded = true;
    await git(root, ["worktree", "add", "--detach", candidateWorktree, args.candidateSha]);
    candidateAdded = true;
    const baseEvidence = await sourceTreeEvidence(baseWorktree);
    const candidateEvidence = await sourceTreeEvidence(candidateWorktree);
    if (baseEvidence.packageLockSha256 !== candidateEvidence.packageLockSha256
      || stableJson(baseEvidence.dependencyManifest) !== stableJson(candidateEvidence.dependencyManifest)) {
      fail("Comparator requires the exact same installed dependency manifest and lockfile on both sides.");
    }
    if (baseEvidence.prismaSchemaSha256 !== candidateEvidence.prismaSchemaSha256
      || baseEvidence.migrations.digest !== candidateEvidence.migrations.digest
      || stableJson(baseEvidence.migrations.migrations) !== stableJson(candidateEvidence.migrations.migrations)) {
      fail("Comparator refuses Prisma schema or migration-tree changes in an architecture-only stage.");
    }
    if (baseEvidence.migrations.migrations.length !== 79) {
      fail(`Comparator currently requires the audited complete migration tree of 79 entries; found ${baseEvidence.migrations.migrations.length}.`);
    }
    const harnessRoot = path.join(evidenceDir, "scratch", "frozen-harness-source");
    await git(root, ["worktree", "add", "--detach", harnessRoot, preflightResult.manifestExistsAtBase ? args.baseSha : args.candidateSha]);
    harnessAdded = true;
    const harnessSource = path.join(evidenceDir, "scratch", "frozen-tests-source");
    await mkdir(harnessSource, { recursive: true });
    // Materialize the frozen tests from the exact harness tree; this source stays in the evidence directory.
    await copyTree(path.join(harnessRoot, "tests"), path.join(harnessSource, "tests"));
    for (const relative of ["vitest.config.ts", "vitest.integration.config.ts", "tsconfig.json"]) {
      await copyFile(path.join(harnessRoot, relative), path.join(harnessSource, relative));
    }
    const baseBackup = path.join(backups, "base");
    const candidateBackup = path.join(backups, "candidate");
    baseOverlay = await overlayFrozenTests(harnessSource, baseWorktree, baseBackup);
    candidateOverlay = await overlayFrozenTests(harnessSource, candidateWorktree, candidateBackup);
    const dependencyRoot = path.join(root, "node_modules");
    await ensureNodeModulesLink(baseWorktree, dependencyRoot);
    await ensureNodeModulesLink(candidateWorktree, dependencyRoot);
    const shimPath = path.join(root, "scripts", "refactor", "deterministic-runtime.mjs");
    const image = await verifyPinnedImage(root, manifest.postgres.image);
    const sourceEvidence = { before: baseEvidence, candidate: candidateEvidence };
    await writeRunMetadata({ root, evidenceDir, args, manifest, manifestText, sourceEvidence, harnessRoot, shimPath, runId });
    const comparatorSelfTests = await runComparatorSelfTests({ root, manifest, evidenceDir, shimPath });
    await writeJson(path.join(evidenceDir, "comparator-self-tests", "accepted.json"), {
      status: "PASS",
      total: comparatorSelfTests.total,
      testFiles: comparatorSelfTests.files,
    });

    const dump = await createDatabaseTemplate({
      root, beforeRepository: baseWorktree, manifest, evidenceDir, runId, imageId: image.imageId,
    });
    const dumpPath = dump.dumpPath;
    const unitBefore = await runUnitSuite({
      repository: baseWorktree,
      target: manifest.postgres.before,
      manifest,
      evidenceDir,
      sideName: "before",
      shimPath,
    });
    const unitAfter = await runUnitSuite({
      repository: candidateWorktree,
      target: manifest.postgres.after,
      manifest,
      evidenceDir,
      sideName: "after",
      shimPath,
    });
    const unitCaseEqual = stableTestResults(unitBefore.cases, unitAfter.cases);
    const observationDifferences = diffJson(unitBefore.observations, unitAfter.observations);
    await writeJson(path.join(evidenceDir, "unit-comparison.json"), {
      casesEqual: unitCaseEqual,
      observationsEqual: observationDifferences.length === 0,
      observationDifferences,
    });
    if (!unitCaseEqual) fail("Frozen unit test inventory/status differs between base and candidate.");
    if (observationDifferences.length > 0) fail("Frozen behavior observations differ between base and candidate.");

    const integrationResults = [];
    const beforeIntegrationRuns = [];
    const afterIntegrationRuns = [];
    for (const suite of manifest.integrationSuites) {
      const profile = suite.databaseProfile === "auth" ? manifest.postgres.auth : manifest.postgres;
      const before = await runIntegrationSuite({
        root,
        repository: baseWorktree,
        target: profile.before,
        manifest,
        suite,
        evidenceDir,
        sideName: "before",
        shimPath,
        dumpPath,
        imageId: image.imageId,
        runId,
      });
      const after = await runIntegrationSuite({
        root,
        repository: candidateWorktree,
        target: profile.after,
        manifest,
        suite,
        evidenceDir,
        sideName: "after",
        shimPath,
        dumpPath,
        imageId: image.imageId,
        runId,
      });
      const caseEqual = stableTestResults(before.cases, after.cases);
      beforeIntegrationRuns.push({ suiteId: suite.id, cases: before.cases.tests });
      afterIntegrationRuns.push({ suiteId: suite.id, cases: after.cases.tests });
      const initialDifferences = diffJson(before.initial.persisted, after.initial.persisted);
      const finalDifferences = diffJson(before.finalState.persisted, after.finalState.persisted);
      const comparison = {
        suite: suite.id,
        casesEqual: caseEqual,
        initialPersistedStateEqual: initialDifferences.length === 0,
        finalPersistedStateEqual: finalDifferences.length === 0,
        initialIdentityValid: true,
        finalIdentityValid: true,
        initialDifferences,
        finalDifferences,
      };
      const comparisonRoot = path.join(evidenceDir, "integration-comparisons");
      await mkdir(comparisonRoot, { recursive: true });
      await writeJson(path.join(comparisonRoot, `${suite.id}.json`), comparison);
      integrationResults.push(comparison);
      if (!caseEqual || initialDifferences.length > 0 || finalDifferences.length > 0) {
        fail(`Frozen integration suite ${suite.id} differs between base and candidate.`);
      }
    }
    const beforeIntegrationCoverage = aggregateSuiteCases(beforeIntegrationRuns);
    const afterIntegrationCoverage = aggregateSuiteCases(afterIntegrationRuns);
    if (!stableTestResults(beforeIntegrationCoverage, afterIntegrationCoverage)) {
      fail("Required integration test execution coverage differs between base and candidate.");
    }
    await writeJson(path.join(evidenceDir, "integration-case-coverage.json"), {
      allRequiredCasesExecuted: true,
      caseCount: beforeIntegrationCoverage.length,
      before: beforeIntegrationCoverage,
      after: afterIntegrationCoverage,
    });

    const combined = {
      schemaVersion: 1,
      baseSha: args.baseSha,
      candidateSha: args.candidateSha,
      pass: true,
      unit: { cases: unitCaseEqual, observations: observationDifferences.length === 0 },
      integration: integrationResults,
      integrationCaseCount: beforeIntegrationCoverage.length,
      postgres: {
        image: manifest.postgres.image,
        migrationTreeSha256: baseEvidence.migrations.digest,
        fixtureDumpSha256: dump.dumpDigest,
      },
    };
    await writeJson(path.join(evidenceDir, "comparison-summary.json"), combined);
    verdict = "PASS";
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    await writeJson(path.join(evidenceDir, "failure.json"), {
      schemaVersion: 1,
      baseSha: args.baseSha,
      candidateSha: args.candidateSha,
      status: "FAIL",
      reason: redact(failure),
    }).catch(() => undefined);
    throw error;
  } finally {
    let cleanupFailure = null;
    for (const [repository, entries, backupRoot, added] of [
      [candidateWorktree, candidateOverlay, path.join(backups, "candidate"), candidateAdded],
      [baseWorktree, baseOverlay, path.join(backups, "base"), baseAdded],
    ]) {
      if (!added) continue;
      try { await cleanupWorktree(root, repository, entries, backupRoot); } catch (error) { cleanupFailure ??= error; }
    }
    const harnessRoot = path.join(evidenceDir, "scratch", "frozen-harness-source");
    if (harnessAdded) {
      try { await git(root, ["worktree", "remove", harnessRoot]); } catch (error) { cleanupFailure ??= error; }
    }
    if (cleanupFailure) {
      verdict = "FAIL";
      failure = `Comparator scratch cleanup failed: ${cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure)}`;
    }
    await writeJson(path.join(evidenceDir, "verdict.json"), {
      schemaVersion: 1,
      status: verdict,
      baseSha: args.baseSha,
      candidateSha: args.candidateSha,
      failure: failure ? redact(failure) : null,
    }).catch(() => undefined);
    if (cleanupFailure) throw cleanupFailure;
  }
}

async function copyTree(sourceRoot, destinationRoot) {
  await mkdir(destinationRoot, { recursive: true });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) await copyTree(source, destination);
    else if (entry.isFile()) {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    } else fail(`Comparator harness contains unsupported file type: ${source}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${redact(error instanceof Error ? error.stack ?? error.message : error)}\n`);
  process.exitCode = 1;
});

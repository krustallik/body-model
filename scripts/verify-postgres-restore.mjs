import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { decodeBackupKey, decryptBackupToWritable } from "./production-backup-envelope.mjs";

function parseArguments(args) {
  const parsed = new Map();
  const allowed = new Set(["--container", "--user", "--backup", "--confirm-disposable-target"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || !value || parsed.has(name)) throw new Error("Invalid or duplicate restore option.");
    parsed.set(name, value);
  }
  return parsed;
}

function runDocker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export function isDisposableNonProductionTarget({ container, environment, disposable }) {
  return typeof container === "string"
    && !isProductionLikeName(container)
    && environment === "nonproduction"
    && disposable === "true";
}

export function isProductionLikeName(name) {
  return typeof name === "string" && /(^|[-_/])prod(uction)?($|[-_/])/i.test(name);
}

export function isLocalDockerEndpoint(endpoint) {
  return typeof endpoint === "string"
    && (/^(unix|npipe):\/\//i.test(endpoint)
      || /^tcp:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(endpoint));
}

function inspectRestoreTarget(container, dockerHostOverride) {
  if (isProductionLikeName(container)) {
    throw new Error("Restore target rejected: production-like container names are forbidden.");
  }
  const context = runDocker(["context", "show"]);
  if (!context) throw new Error("Cannot identify the Docker context; restore target was not changed.");
  if (isProductionLikeName(context)) {
    throw new Error("Restore refused: production-like Docker contexts are forbidden.");
  }
  let endpoint = dockerHostOverride;
  if (!endpoint) {
    endpoint = runDocker(["context", "inspect", context, "--format", '{{ (index .Endpoints "docker").Host }}']);
  }
  if (!isLocalDockerEndpoint(endpoint)) {
    throw new Error("Restore refused: Docker must target a local daemon, not a remote production host/context.");
  }

  const result = runDocker([
    "inspect", "--format",
    '{{ index .Config.Labels "bodycast.environment" }}|{{ index .Config.Labels "bodycast.disposable" }}',
    container,
  ]);
  if (!result) throw new Error("Cannot inspect the explicitly named restore container.");
  const [environment, disposable] = result.split("|");
  if (!isDisposableNonProductionTarget({ container, environment, disposable })) {
    throw new Error("Restore target rejected: require a non-production container labelled bodycast.environment=nonproduction and bodycast.disposable=true; production-like names are forbidden.");
  }
}

function runDockerChecked(args, input) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Disposable PostgreSQL command failed; restore verification stopped.");
  return result.stdout.trim();
}

async function restoreEncryptedBackup({ container, user, backup, key }) {
  const restoreDatabase = `bodycast_restore_${randomBytes(8).toString("hex")}`;
  let created = false;
  try {
    runDockerChecked(["exec", container, "createdb", "--username", user, restoreDatabase]);
    created = true;

    const restore = spawn("docker", [
      "exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
      "--username", user, "--dbname", restoreDatabase,
    ], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    const exited = new Promise((resolve, reject) => {
      restore.once("error", reject);
      restore.once("close", (code) => resolve(code));
    });
    exited.catch(() => {});

    await decryptBackupToWritable(backup, restore.stdin, key);
    const exitCode = await exited;
    if (exitCode !== 0) throw new Error("pg_restore failed in the disposable PostgreSQL target.");

    const restoreSummaryText = runDockerChecked([
      "exec", container, "psql", "--username", user, "--dbname", restoreDatabase,
      "--tuples-only", "--no-align", "--command",
      `SELECT jsonb_build_object(
        'completedMigrations', (SELECT COUNT(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
        'StrengthDiarySessionRows', (SELECT COUNT(*) FROM public."StrengthDiarySession"),
        'ExerciseCatalogRows', (SELECT COUNT(*) FROM public."ExerciseCatalog")
      )::text;`,
    ]);
    let summary;
    try { summary = JSON.parse(restoreSummaryText); } catch { throw new Error("Restored migration history and baseline tables could not be read."); }
    if (![summary.completedMigrations, summary.StrengthDiarySessionRows, summary.ExerciseCatalogRows].every(Number.isSafeInteger)) {
      throw new Error("Restored migration history and baseline tables returned invalid counts.");
    }
    return {
      database: restoreDatabase,
      completedMigrationCount: summary.completedMigrations,
      strengthDiarySessionRows: summary.StrengthDiarySessionRows,
      exerciseCatalogRows: summary.ExerciseCatalogRows,
    };
  } finally {
    if (created) {
      const dropped = spawnSync("docker", ["exec", container, "dropdb", "--if-exists", "--force", "--username", user, restoreDatabase], {
        encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024,
      });
      if (dropped.error || dropped.status !== 0) throw new Error("Could not remove the temporary database from the explicitly disposable target.");
    }
  }
}

export async function verifyEncryptedBackupOnDisposableTarget(options, environment = process.env) {
  const { container, user, backup, confirmation } = options;
  if (!container || !user || !backup || confirmation !== "nonproduction-disposable") {
    throw new Error("Explicit container/user/backup and nonproduction-disposable confirmation are required.");
  }
  if (isProductionLikeName(container)) {
    throw new Error("Restore target rejected: production-like container names are forbidden.");
  }
  if (!path.resolve(backup).endsWith(".pgdump.enc")) throw new Error("Restore verifier accepts encrypted .pgdump.enc backups only.");
  const key = decodeBackupKey(environment.PRODUCTION_BACKUP_ENCRYPTION_KEY);
  const backupMetadata = await stat(path.resolve(backup)).catch(() => null);
  if (!backupMetadata || backupMetadata.size <= 36) throw new Error("Encrypted backup is missing, empty, or truncated.");
  inspectRestoreTarget(container, environment.DOCKER_HOST);
  return restoreEncryptedBackup({ container, user, backup: path.resolve(backup), key });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const required = ["--container", "--user", "--backup", "--confirm-disposable-target"];
  for (const option of required) if (!args.has(option)) throw new Error(`Required option is missing: ${option}`);
  const result = await verifyEncryptedBackupOnDisposableTarget({
    container: args.get("--container"),
    user: args.get("--user"),
    backup: args.get("--backup"),
    confirmation: args.get("--confirm-disposable-target"),
  });
  process.stdout.write(`Disposable restore verified: ${result.completedMigrationCount} completed migrations; `
    + `${result.strengthDiarySessionRows} StrengthDiarySession rows; ${result.exerciseCatalogRows} ExerciseCatalog rows. `
    + "Temporary database removed.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

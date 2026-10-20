import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { decodeBackupKey, decryptBackupToWritable } from "./production-backup-envelope.mjs";
import { schemaDumpSha256, SCHEMA_DIGEST_CONTRACT } from "./production-v4-schema-digest.mjs";

const MAX_STDERR_BYTES = 32 * 1024;
const MAX_SCHEMA_DUMP_BYTES = 64 * 1024 * 1024;
export const PINNED_POSTGRES_IMAGE = "docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const SCHEMA_DIGEST_HELPER_PATH = fileURLToPath(new URL("./production-v4-schema-digest.mjs", import.meta.url));

export function assertPinnedPostgresImage(image) {
  if (image !== PINNED_POSTGRES_IMAGE) {
    throw new Error("POSTGRES_IMAGE must equal the approved pinned image " + PINNED_POSTGRES_IMAGE + ".");
  }
  return image;
}

function sanitizedStderr(chunks, redactValues) {
  let value = Buffer.concat(chunks).toString("utf8");
  for (const secret of redactValues.filter((entry) => typeof entry === "string" && entry.length > 0)) {
    value = value.split(secret).join("[REDACTED]");
  }
  value = value
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED DATABASE URL]")
    .replace(/((?:password|passwd|token|secret|key)=)[^\s&]+/gi, "$1[REDACTED]");
  if (Buffer.byteLength(value, "utf8") > MAX_STDERR_BYTES) {
    value = Buffer.from(value, "utf8").subarray(-MAX_STDERR_BYTES).toString("utf8");
    value = `[earlier stderr truncated]\n${value}`;
  }
  return value.trim();
}

function waitForClose(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ spawnError: error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function isExpectedEarlyPipeClose(error) {
  // Node reports a closed child-stdin pipe as EPIPE on Linux and EOF on
  // Windows. Both mean the consumer intentionally stopped reading here.
  return error?.code === "EPIPE" || error?.code === "EOF";
}

export async function restoreEncryptedPostgresBackup({
  inputPath,
  key,
  command = "docker",
  args,
  env = process.env,
  redactValues = [],
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  if (!Array.isArray(args)) throw new Error("Restore command arguments are required.");
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], env, windowsHide: true });
  const stderr = [];
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    const buffer = Buffer.from(chunk);
    stderr.push(buffer);
    stderrBytes += buffer.length;
    while (stderrBytes > MAX_STDERR_BYTES && stderr.length > 1) stderrBytes -= stderr.shift().length;
  });
  // pipeline() reports a closed restore stdin as EPIPE. Observe it without
  // treating it as the root failure; pg_restore's close status is authoritative.
  let stdinError;
  child.stdin.on("error", (error) => { stdinError = error; });
  const closed = waitForClose(child);
  let decryptError;
  try {
    await decryptBackupToWritable(inputPath, child.stdin, key);
  } catch (error) {
    decryptError = error;
  }
  const result = await closed;
  const detail = sanitizedStderr(stderr, [
    ...redactValues,
    ...Object.entries(env)
      .filter(([name, value]) => /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|CONNECTION_STRING/i.test(name) && typeof value === "string")
      .map(([, value]) => value),
  ]);

  if (result.spawnError) {
    throw new Error(`pg_restore could not be started: ${result.spawnError.message}${detail ? `\n${detail}` : ""}`, { cause: result.spawnError });
  }
  if (result.code !== 0) {
    const exit = result.code === null ? `signal ${result.signal ?? "unknown"}` : `exit code ${result.code}`;
    const message = [`pg_restore failed with ${exit}.`, detail || "pg_restore produced no stderr output."];
    if (stdinError?.code === "EPIPE" || decryptError?.code === "EPIPE") {
      message.push("The decrypt-to-restore stream also received EPIPE after pg_restore terminated; this is a secondary symptom.");
    }
    const failure = new Error(message.join("\n"));
    failure.exitCode = result.code;
    log(failure.message);
    throw failure;
  }
  if (decryptError) {
    throw new Error(`Backup decryption/streaming failed after pg_restore exited successfully: ${decryptError.message}`, { cause: decryptError });
  }
  log("pg_restore completed successfully (exit code 0).");
}

/**
 * Read only schema DDL from the immutable encrypted custom archive. This runs
 * pg_restore offline (no database/network) and streams the decrypted archive
 * directly into it; neither plaintext archive nor schema is written to disk.
 * Comparing this source DDL avoids PostgreSQL's equivalent CHECK-constraint
 * cast deparser changes after a restore/re-dump.
 */
export async function digestEncryptedPostgresBackupSchema({
  inputPath,
  key,
  command = "docker",
  args,
  env = process.env,
  redactValues = [],
  digest = schemaDumpSha256,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  if (!Array.isArray(args)) throw new Error("Schema extraction command arguments are required.");
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
  const stderr = [];
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    const buffer = Buffer.from(chunk);
    stderr.push(buffer);
    stderrBytes += buffer.length;
    while (stderrBytes > MAX_STDERR_BYTES && stderr.length > 1) stderrBytes -= stderr.shift().length;
  });
  const schemaChunks = [];
  let schemaBytes = 0;
  let schemaOverflow = false;
  child.stdout.on("data", (chunk) => {
    const buffer = Buffer.from(chunk);
    if (schemaBytes + buffer.length > MAX_SCHEMA_DUMP_BYTES) {
      schemaOverflow = true;
      return; // Keep draining stdout so pg_restore can exit cleanly.
    }
    schemaChunks.push(buffer);
    schemaBytes += buffer.length;
  });
  let stdinError;
  let stdinClosedEarly = false;
  let forwardToPgRestore = true;
  // pg_restore --schema-only intentionally ignores archive data blocks. On a
  // data-bearing custom archive it can therefore close stdin before the
  // encrypted source reaches EOF. Stop forwarding after that expected EPIPE,
  // but keep consuming the decrypted stream so AES-GCM authenticates the
  // entire immutable archive. Full database restore above keeps its stricter
  // pipeline behavior unchanged.
  const schemaInput = new Writable({
    write(chunk, _encoding, callback) {
      if (!forwardToPgRestore || child.stdin.destroyed || !child.stdin.writable) {
        stdinClosedEarly = true;
        forwardToPgRestore = false;
        callback();
        return;
      }
      child.stdin.write(chunk, (error) => {
        if (isExpectedEarlyPipeClose(error)) {
          stdinClosedEarly = true;
          forwardToPgRestore = false;
          callback();
          return;
        }
        callback(error);
      });
    },
    final(callback) {
      if (!forwardToPgRestore || child.stdin.destroyed || !child.stdin.writable) {
        callback();
        return;
      }
      child.stdin.end();
      callback();
    },
  });
  child.stdin.on("error", (error) => {
    stdinError = error;
    if (isExpectedEarlyPipeClose(error)) {
      stdinClosedEarly = true;
      forwardToPgRestore = false;
    } else {
      schemaInput.destroy(error);
    }
  });
  child.stdin.on("close", () => {
    if (!child.stdin.writableFinished) {
      stdinClosedEarly = true;
      forwardToPgRestore = false;
    }
  });
  const closed = waitForClose(child);
  let decryptError;
  try {
    await decryptBackupToWritable(inputPath, schemaInput, key);
  } catch (error) {
    decryptError = error;
  }
  const result = await closed;
  const detail = sanitizedStderr(stderr, [
    ...redactValues,
    ...Object.entries(env)
      .filter(([name, value]) => /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|CONNECTION_STRING/i.test(name) && typeof value === "string")
      .map(([, value]) => value),
  ]);

  if (result.spawnError) {
    throw new Error(`pg_restore schema extraction could not be started: ${result.spawnError.message}${detail ? `\n${detail}` : ""}`, { cause: result.spawnError });
  }
  if (result.code !== 0) {
    const exit = result.code === null ? `signal ${result.signal ?? "unknown"}` : `exit code ${result.code}`;
    const message = [`pg_restore schema extraction failed with ${exit}.`, detail || "pg_restore produced no stderr output."];
    if (stdinError?.code === "EPIPE" || decryptError?.code === "EPIPE") {
      message.push("The decrypt-to-pg_restore stream also received EPIPE after pg_restore terminated; this is a secondary symptom.");
    }
    const failure = new Error(message.join("\n"));
    failure.exitCode = result.code;
    log(failure.message);
    throw failure;
  }
  if (decryptError) {
    throw new Error(`Backup decryption/streaming failed after pg_restore exited successfully: ${decryptError.message}`, { cause: decryptError });
  }
  if (schemaOverflow) throw new Error(`pg_restore schema output exceeded the ${MAX_SCHEMA_DUMP_BYTES}-byte safety limit.`);
  if (stdinError && !isExpectedEarlyPipeClose(stdinError)) {
    throw new Error(`pg_restore schema input failed: ${stdinError.message}`, { cause: stdinError });
  }

  const schemaDump = Buffer.concat(schemaChunks, schemaBytes);
  const schemaSha256 = digest(schemaDump);
  if (stdinClosedEarly) {
    log("pg_restore closed schema input early; the remaining encrypted archive was fully consumed and authenticated.");
  }
  log(`Encrypted backup schema digest verified (${schemaBytes} bytes).`);
  return schemaSha256;
}

function currentSchemaDigestHelperSha256() {
  return createHash("sha256").update(readFileSync(SCHEMA_DIGEST_HELPER_PATH)).digest("hex");
}

export async function runSchemaDigestFromEnvironment({ env = process.env, digestBackupSchema = digestEncryptedPostgresBackupSchema } = {}) {
  const inputPath = env.BACKUP_FILE;
  const encodedKey = env.PRODUCTION_BACKUP_ENCRYPTION_KEY;
  if (!inputPath || !encodedKey) throw new Error("BACKUP_FILE and PRODUCTION_BACKUP_ENCRYPTION_KEY are required.");
  const image = assertPinnedPostgresImage(env.POSTGRES_IMAGE);
  if (env.SCHEMA_DIGEST_CONTRACT !== SCHEMA_DIGEST_CONTRACT) {
    throw new Error("SCHEMA_DIGEST_CONTRACT does not match the approved schema digest contract.");
  }
  const actualHelperSha256 = currentSchemaDigestHelperSha256();
  if (!/^[a-f0-9]{64}$/.test(env.SCHEMA_DIGEST_HELPER_SHA256 ?? "")
      || env.SCHEMA_DIGEST_HELPER_SHA256 !== actualHelperSha256) {
    throw new Error("SCHEMA_DIGEST_HELPER_SHA256 does not match the exact checked-in helper.");
  }
  const key = decodeBackupKey(encodedKey);
  return digestBackupSchema({
    inputPath,
    key,
    args: [
      "run", "--rm", "--interactive", "--network", "none", "--entrypoint", "pg_restore", image,
      "--schema-only", "--no-owner", "--no-privileges", "--file=-",
    ],
    redactValues: [encodedKey],
  });
}

export async function runRestoreFromEnvironment({ env = process.env, restore = restoreEncryptedPostgresBackup } = {}) {
  const inputPath = env.BACKUP_FILE;
  const encodedKey = env.PRODUCTION_BACKUP_ENCRYPTION_KEY;
  const databaseUrl = env.DATABASE_URL;
  const password = env.PGPASSWORD;
  if (!inputPath || !databaseUrl || !password) throw new Error("BACKUP_FILE, DATABASE_URL, and PGPASSWORD are required.");
  const image = assertPinnedPostgresImage(env.POSTGRES_IMAGE);
  const key = decodeBackupKey(encodedKey);
  await restore({
    inputPath,
    key,
    args: [
      "run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${password}`,
      "--entrypoint", "pg_restore", image, "--exit-on-error", "--no-owner", "--no-privileges",
      "--single-transaction", `--dbname=${databaseUrl}`,
    ],
    redactValues: [encodedKey, password, databaseUrl],
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await runRestoreFromEnvironment();
    return;
  }
  if (args.length === 1 && args[0] === "--schema-digest") {
    const digest = await runSchemaDigestFromEnvironment();
    process.stdout.write(`${digest}\n`);
    return;
  }
  throw new Error("Usage: restore-encrypted-postgres-backup.mjs [--schema-digest]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

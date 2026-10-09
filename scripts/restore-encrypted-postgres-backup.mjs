import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { decodeBackupKey, decryptBackupToWritable } from "./production-backup-envelope.mjs";

const MAX_STDERR_BYTES = 32 * 1024;

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

async function main() {
  const inputPath = process.env.BACKUP_FILE;
  const encodedKey = process.env.PRODUCTION_BACKUP_ENCRYPTION_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  const password = process.env.PGPASSWORD;
  if (!inputPath || !databaseUrl || !password) throw new Error("BACKUP_FILE, DATABASE_URL, and PGPASSWORD are required.");
  const image = process.env.POSTGRES_IMAGE;
  if (!image || !/^public\.ecr\.aws\/docker\/library\/postgres@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("POSTGRES_IMAGE must be the pinned ECR public PostgreSQL image digest.");
  const key = decodeBackupKey(encodedKey);
  await restoreEncryptedPostgresBackup({
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

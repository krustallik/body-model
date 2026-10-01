import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodeBackupKey, encryptBackupStream } from "./production-backup-envelope.mjs";

function parseArguments(args) {
  const parsed = new Map();
  const allowed = new Set(["--container", "--database", "--user", "--output", "--output-directory", "--confirm-production-backup"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || !value || parsed.has(name)) throw new Error("Invalid or duplicate backup option.");
    parsed.set(name, value);
  }
  if (parsed.has("--output") && parsed.has("--output-directory")) throw new Error("Choose either --output or --output-directory.");
  return parsed;
}

function utcTimestamp() {
  return new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function restrictBackupPermissions(output) {
  if (process.platform !== "win32") return chmod(output, 0o600);

  const identity = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = identity.stdout?.match(/"(S-1-[^"]+)"/)?.[1];
  if (identity.error || identity.status !== 0 || !sid) throw new Error("Could not resolve the current Windows user SID to secure the encrypted backup.");

  const acl = spawnSync("icacls", [output, "/inheritance:r", "/grant:r", `*${sid}:F`], { encoding: "utf8", windowsHide: true });
  if (acl.error || acl.status !== 0) throw new Error("Could not restrict encrypted backup access to the current Windows user.");
}

export async function createEncryptedPostgresBackup(options, environment = process.env) {
  const { container, database, user, output, confirmation } = options;
  if (!container || !database || !user || !output || confirmation !== "read-only-production-snapshot") {
    throw new Error("Explicit container/database/user/output and read-only-production-snapshot confirmation are required.");
  }
  if (!output.endsWith(".pgdump.enc")) throw new Error("Encrypted PostgreSQL backups must use the .pgdump.enc suffix.");
  if (!/\d{8}T\d{6}Z/.test(path.basename(output))) throw new Error("Backup filenames must include a UTC timestamp (YYYYMMDDTHHmmssZ).");

  const key = decodeBackupKey(environment.PRODUCTION_BACKUP_ENCRYPTION_KEY);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const dump = spawn("docker", [
    "exec", container, "pg_dump", "--format=custom", "--no-owner", "--no-privileges",
    `--username=${user}`, `--dbname=${database}`,
  ], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((resolve, reject) => {
    dump.once("error", reject);
    dump.once("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    const [encryption, result] = await Promise.all([encryptBackupStream(dump.stdout, output, key), exited]);
    if (result.code !== 0) throw new Error(`pg_dump failed${result.code === null ? " after signal" : ` with exit code ${result.code}`}.`);
    await restrictBackupPermissions(output);
    const encrypted = await stat(output);
    if (encrypted.size <= 36 || encryption.inputBytes <= 0) throw new Error("Encrypted PostgreSQL backup is empty.");
    return { output: path.resolve(output), inputBytes: encryption.inputBytes, encryptedBytes: encrypted.size };
  } catch (error) {
    dump.kill();
    await unlink(output).catch(() => {});
    throw error;
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const required = ["--container", "--database", "--user", "--confirm-production-backup"];
  for (const option of required) if (!args.has(option)) throw new Error(`Required option is missing: ${option}`);

  const output = args.get("--output") ?? path.join(
    path.resolve(args.get("--output-directory") ?? "backups"),
    `bodycast-${args.get("--database").replace(/[^A-Za-z0-9_-]/g, "_")}-${utcTimestamp()}.pgdump.enc`,
  );
  const result = await createEncryptedPostgresBackup({
    container: args.get("--container"),
    database: args.get("--database"),
    user: args.get("--user"),
    output,
    confirmation: args.get("--confirm-production-backup"),
  });
  process.stdout.write(`Encrypted PostgreSQL backup created: ${result.output} (${result.encryptedBytes} bytes)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

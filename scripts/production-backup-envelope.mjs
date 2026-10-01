import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const MAGIC = Buffer.from("BCPGDMP1", "ascii");
const HEADER_LENGTH = MAGIC.length + 12;
const TAG_LENGTH = 16;

export function decodeBackupKey(encodedKey) {
  if (typeof encodedKey !== "string" || encodedKey.length === 0) {
    throw new Error("PRODUCTION_BACKUP_ENCRYPTION_KEY is required.");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("PRODUCTION_BACKUP_ENCRYPTION_KEY must be canonical base64 for exactly 32 bytes.");
  }
  return key;
}

export async function encryptBackupStream(source, outputPath, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Backup encryption requires a 32-byte AES-256 key.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const header = Buffer.concat([MAGIC, iv]);
  let inputBytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      inputBytes += chunk.length;
      callback(null, chunk);
    },
  });

  try {
    output.write(header);
    await pipeline(source, counter, cipher, output);
    if (inputBytes === 0) throw new Error("Refusing to publish an empty PostgreSQL backup.");
    await appendFile(outputPath, cipher.getAuthTag(), { mode: 0o600 });
    await chmod(outputPath, 0o600);
    return { inputBytes, encryptedBytes: (await stat(outputPath)).size };
  } catch (error) {
    output.destroy();
    await unlink(outputPath).catch(() => {});
    throw error;
  }
}

export async function decryptBackupToWritable(inputPath, destination, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Backup decryption requires a 32-byte AES-256 key.");
  }

  const file = await open(inputPath, "r");
  try {
    const metadata = await file.stat();
    if (metadata.size <= HEADER_LENGTH + TAG_LENGTH) {
      throw new Error("Encrypted backup is empty or truncated.");
    }

    const header = Buffer.alloc(HEADER_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, metadata.size - TAG_LENGTH);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Encrypted backup has an unsupported format.");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(inputPath, { start: HEADER_LENGTH, end: metadata.size - TAG_LENGTH - 1 }),
      decipher,
      destination,
    );
  } finally {
    await file.close();
  }
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const valueIndex = rest.indexOf("--output");
  const outputPath = valueIndex >= 0 ? rest[valueIndex + 1] : null;
  const inputIndex = rest.indexOf("--input");
  const inputPath = inputIndex >= 0 ? rest[inputIndex + 1] : null;
  const key = decodeBackupKey(process.env.PRODUCTION_BACKUP_ENCRYPTION_KEY);

  if (mode === "encrypt" && outputPath) {
    const result = await encryptBackupStream(process.stdin, outputPath, key);
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (mode === "decrypt" && inputPath) {
    await decryptBackupToWritable(inputPath, process.stdout, key);
    return;
  }
  throw new Error("Usage: production-backup-envelope.mjs encrypt --output <ciphertext-file> | decrypt --input <ciphertext-file>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

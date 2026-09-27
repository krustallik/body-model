import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? "3d-model/checkpoint-11-20260926/sources/bodyparts3d-release-4.0");
const officialData = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST";
const officialPage = "https://dbarchive.biosciencedbc.jp/en/bodyparts3d";
const chunkBytes = 8 * 1024 * 1024;
const concurrency = 4;
const retries = 4;
const archiveNames = ["isa_BP3D_4.0_obj_99.zip", "partof_BP3D_4.0_obj_99.zip"];
const metadataFiles = [
  ["README_e.html", `${officialData}/README_e.html`],
  ["isa_parts_list_e.txt", `${officialData}/isa_parts_list_e.txt`],
  ["partof_parts_list_e.txt", `${officialData}/partof_parts_list_e.txt`],
  ["isa_inclusion_relation_list.txt", `${officialData}/isa_inclusion_relation_list.txt`],
  ["partof_inclusion_relation_list.txt", `${officialData}/partof_inclusion_relation_list.txt`],
  ["isa_element_parts.txt", `${officialData}/isa_element_parts.txt`],
  ["partof_element_parts.txt", `${officialData}/partof_element_parts.txt`],
  ["official-download-page.html", `${officialPage}/download.html`],
  ["official-license-page.html", `${officialPage}/lic.html`],
];

await mkdir(root, { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fetchWithRetry = async (url, init, label) => {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(`${label}: retry ${attempt}/${retries - 1} after ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`${label}: exhausted retries`);
};
const records = [];
for (const [name, url] of metadataFiles) {
  const target = resolve(root, name);
  try { await stat(target); throw new Error(`Refusing to overwrite existing file: ${target}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const response = await fetchWithRetry(url, {}, name);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(target, bytes, { flag: "wx" });
  records.push({ name, url, bytes: bytes.byteLength, sha256: sha256(bytes), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") });
  console.log(`saved ${name} (${bytes.byteLength} bytes)`);
}
for (const name of archiveNames) {
  const target = resolve(root, name);
  try { await stat(target); throw new Error(`Refusing to overwrite existing file: ${target}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const url = `${officialData}/${name}`;
  const head = await fetchWithRetry(url, { method: "HEAD" }, `${name} HEAD`);
  const size = Number(head.headers.get("content-length"));
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`${name}: official response has no valid Content-Length`);
  const etag = head.headers.get("etag");
  const lastModified = head.headers.get("last-modified");
  const partDir = `${target}.parts`;
  await mkdir(partDir, { recursive: false });
  const count = Math.ceil(size / chunkBytes);
  const parts = Array.from({ length: count }, (_, index) => ({ index, start: index * chunkBytes, end: Math.min(size - 1, (index + 1) * chunkBytes - 1) }));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (true) {
      const part = parts[cursor++];
      if (!part) return;
      const partPath = resolve(partDir, `${String(part.index).padStart(4, "0")}.part`);
      const expected = part.end - part.start + 1;
      let bytes;
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
          const response = await fetchWithRetry(url, { headers: { Range: `bytes=${part.start}-${part.end}`, ...(etag ? { "If-Range": etag } : {}) } }, `${name} range ${part.index}`);
          if (response.status !== 206) throw new Error(`${name} range ${part.index}: expected HTTP 206, got ${response.status}`);
          const range = response.headers.get("content-range");
          if (range !== `bytes ${part.start}-${part.end}/${size}`) throw new Error(`${name} range ${part.index}: unexpected Content-Range ${range}`);
          bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.byteLength !== expected) throw new Error(`${name} range ${part.index}: expected ${expected} bytes, got ${bytes.byteLength}`);
          break;
        } catch (error) {
          if (attempt === retries) throw error;
          console.warn(`${name} chunk ${part.index}: retry ${attempt}/${retries - 1}`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      await writeFile(partPath, bytes, { flag: "wx" });
      console.log(`${name}: chunk ${part.index + 1}/${count} (${bytes.byteLength} bytes)`);
    }
  }));
  const temp = `${target}.download`;
  const output = await open(temp, "wx");
  try {
    let position = 0;
    for (const part of parts) {
      const bytes = await readFile(resolve(partDir, `${String(part.index).padStart(4, "0")}.part`));
      await output.write(bytes, 0, bytes.length, position);
      position += bytes.length;
    }
    if (position !== size) throw new Error(`${name}: assembled ${position} bytes but expected ${size}`);
    await output.sync();
  } finally { await output.close(); }
  await rename(temp, target);
  const bytes = await readFile(target);
  records.push({ name, url, bytes: bytes.byteLength, sha256: sha256(bytes), etag, lastModified, release: "BodyParts3D 4.0", polygonReductionRate: "99%" });
  console.log(`saved ${name} (${bytes.byteLength} bytes), SHA-256 ${sha256(bytes)}`);
}
const provenance = {
  dataset: "BodyParts3D",
  release: "4.0",
  officialDownloadPage: `${officialPage}/download.html`,
  officialLicensePage: `${officialPage}/lic.html`,
  license: "CC BY 4.0",
  attribution: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International",
  acquiredAt: new Date().toISOString(),
  sourceDataBaseUrl: officialData,
  files: records,
};
await writeFile(resolve(root, "source-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, { flag: "wx" });
console.log(`wrote source-provenance.json (${records.length} files)`);
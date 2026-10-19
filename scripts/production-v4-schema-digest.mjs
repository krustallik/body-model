#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_DIGEST_CONTRACT = "bodycast-pg-dump-schema-v1";

const RESTRICT = /^\\restrict ([A-Za-z0-9]{63})$/;
const UNRESTRICT = /^\\unrestrict ([A-Za-z0-9]{63})$/;
const FROM_DATABASE_VERSION = /^-- Dumped from database version [0-9]+(?:\.[0-9]+){1,2}$/;
const BY_PG_DUMP_VERSION = /^-- Dumped by pg_dump version [0-9]+(?:\.[0-9]+){1,2}$/;
const FROM_DATABASE_PREFIX = "-- Dumped from database version";
const BY_PG_DUMP_PREFIX = "-- Dumped by pg_dump version";

/**
 * Remove only the two PostgreSQL 17 pg_dump control lines and its two version
 * banner lines from the pre-SQL header. This is for schema-digest calculation
 * only; callers must keep the original dump bytes for any restore or backup
 * operation.
 */
export function canonicalSchemaDumpBytes(input) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.at(-1) !== 0x0a) {
    throw new Error("Schema dump is empty or is not a complete newline-terminated pg_dump stream.");
  }

  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(input);
  const strings = decoded.slice(0, -1).split("\n");
  if (strings.some((line) => line.endsWith("\r"))) {
    throw new Error("Unexpected schema dump line ending.");
  }

  const lines = [];
  let offset = 0;
  for (const line of strings) {
    const length = Buffer.byteLength(line, "utf8");
    lines.push({ text: line, bytes: input.subarray(offset, offset + length) });
    offset += length + 1;
  }

  const restrictLines = [];
  const unrestrictLines = [];
  const removed = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const { text } = lines[index];
    if (text.startsWith("\\")) {
      const restrict = RESTRICT.exec(text);
      const unrestrict = UNRESTRICT.exec(text);
      if (restrict) restrictLines.push({ index, token: restrict[1] });
      else if (unrestrict) unrestrictLines.push({ index, token: unrestrict[1] });
      else throw new Error("Unknown or malformed pg_dump control marker.");
      removed.add(index);
    }
  }

  if (restrictLines.length !== 1 || unrestrictLines.length !== 1
      || restrictLines[0].index >= unrestrictLines[0].index
      || restrictLines[0].token !== unrestrictLines[0].token) {
    throw new Error("Expected one matching, ordered pg_dump restrict marker pair.");
  }

  const restrictIndex = restrictLines[0].index;
  const unrestrictIndex = unrestrictLines[0].index;
  if (lines.slice(0, restrictIndex).some(({ text }) => text.trim() !== "" && !text.startsWith("--"))
      || lines.slice(unrestrictIndex + 1).some(({ text }) => text.trim() !== "" && !text.startsWith("--"))) {
    throw new Error("pg_dump control markers are outside the expected dump boundaries.");
  }
  if ([...lines.slice(0, restrictIndex), ...lines.slice(unrestrictIndex + 1)]
    .some(({ text }) => text.startsWith(FROM_DATABASE_PREFIX) || text.startsWith(BY_PG_DUMP_PREFIX))) {
    throw new Error("pg_dump version banner is outside the expected dump header.");
  }

  const firstSqlIndex = lines.findIndex(({ text }, index) => index > restrictIndex
    && index < unrestrictIndex && text.trim() !== "" && !text.startsWith("--"));
  if (firstSqlIndex === -1) throw new Error("pg_dump stream has no SQL content between its control markers.");

  let fromDatabaseVersionCount = 0;
  let byPgDumpVersionCount = 0;
  for (let index = restrictIndex + 1; index < firstSqlIndex; index += 1) {
    const { text } = lines[index];
    if (text.startsWith(FROM_DATABASE_PREFIX)) {
      if (!FROM_DATABASE_VERSION.test(text)) throw new Error("Malformed pg_dump database-version banner.");
      fromDatabaseVersionCount += 1;
      removed.add(index);
    } else if (text.startsWith(BY_PG_DUMP_PREFIX)) {
      if (!BY_PG_DUMP_VERSION.test(text)) throw new Error("Malformed pg_dump client-version banner.");
      byPgDumpVersionCount += 1;
      removed.add(index);
    }
  }
  if (fromDatabaseVersionCount !== 1 || byPgDumpVersionCount !== 1) {
    throw new Error("Expected exactly one known pg_dump version banner of each type in the pre-SQL header.");
  }

  const canonical = Buffer.concat(lines.flatMap(({ bytes }, index) => removed.has(index) ? [] : [bytes, Buffer.from("\n")]));
  if (canonical.length === 0) throw new Error("Schema dump has no canonical SQL content.");
  return canonical;
}

export function schemaDumpSha256(input) {
  return createHash("sha256").update(canonicalSchemaDumpBytes(input)).digest("hex");
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  if (process.argv.length === 3 && process.argv[2] === "--contract") {
    process.stdout.write(`${SCHEMA_DIGEST_CONTRACT}\n`);
  } else if (process.argv.length === 2) {
    try {
      process.stdout.write(`${schemaDumpSha256(readFileSync(0))}\n`);
    } catch (error) {
      process.stderr.write(`schema-digest: ${error instanceof Error ? error.message : "invalid dump"}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stderr.write("schema-digest: invalid invocation\n");
    process.exitCode = 2;
  }
}

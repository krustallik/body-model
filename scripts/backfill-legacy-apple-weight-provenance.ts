import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  backfillLegacyWeightProvenance,
  summarizeLegacyWeightProvenanceBackfill,
} from "../src/modules/health/legacy-weight-provenance-backfill";

const CONFIRMATION = "I_CONFIRM_ALL_LEGACY_WEIGHT_SAMPLES_ARE_APPLE_HEALTH";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

type Options = {
  apply: boolean;
  target: "production" | "non-production";
  expected: { count: number; minDate: string | null; maxDate: string | null } | null;
};

function parseOptions(args: readonly string[]): Options {
  let apply = false;
  let target: Options["target"] | null = null;
  let expectedCount: number | null = null;
  let expectedMinDate: string | null | undefined;
  let expectedMaxDate: string | null | undefined;
  let confirmed = false;

  for (const arg of args) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--target=production") target = "production";
    else if (arg === "--target=non-production") target = "non-production";
    else if (arg.startsWith("--expected-count=")) {
      const value = arg.slice("--expected-count=".length);
      if (!/^\d+$/.test(value)) throw new Error("--expected-count must be a non-negative integer.");
      expectedCount = Number(value);
    } else if (arg.startsWith("--expected-min-date=")) {
      expectedMinDate = arg.slice("--expected-min-date=".length);
    } else if (arg.startsWith("--expected-max-date=")) {
      expectedMaxDate = arg.slice("--expected-max-date=".length);
    } else if (arg === `--confirm-authoritative-apple-origin=${CONFIRMATION}`) confirmed = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!target) throw new Error("Set --target=production or --target=non-production explicitly.");
  if (!apply) return { apply, target, expected: null };
  if (!confirmed) throw new Error(`Apply requires --confirm-authoritative-apple-origin=${CONFIRMATION}.`);
  if (expectedCount === null || expectedMinDate === undefined || expectedMaxDate === undefined) {
    throw new Error("Apply requires --expected-count, --expected-min-date, and --expected-max-date from a reviewed dry-run.");
  }
  if (expectedCount === 0) {
    if (expectedMinDate !== "none" || expectedMaxDate !== "none") throw new Error("A zero-row scope must use expected dates 'none'.");
    return { apply, target, expected: { count: 0, minDate: null, maxDate: null } };
  }
  if (typeof expectedMinDate !== "string" || typeof expectedMaxDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(expectedMinDate) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedMaxDate)) {
    throw new Error("Expected min/max dates must use YYYY-MM-DD.");
  }
  return { apply, target, expected: { count: expectedCount, minDate: expectedMinDate, maxDate: expectedMaxDate } };
}

function safeDatabaseIdentity(databaseUrl: string, expectedTarget: Options["target"]): { target: string; host: string; database: string } {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is invalid.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("Only PostgreSQL targets are allowed.");
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(host);
  if (expectedTarget === "non-production" && !isLoopback) throw new Error("Non-production target must use a loopback PostgreSQL host.");
  if (expectedTarget === "production" && isLoopback) throw new Error("Production target cannot use a loopback PostgreSQL host.");
  return {
    target: expectedTarget,
    host,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required; no fallback is allowed.");
  const identity = safeDatabaseIdentity(databaseUrl, options.target);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await prisma.$connect();
    if (!options.apply) {
      const summary = await summarizeLegacyWeightProvenanceBackfill(prisma);
      console.log(JSON.stringify({ mode: "dry-run", database: identity, selection: "metric=weight-kg AND source IS NULL", ...summary }, null, 2));
      return;
    }
    const result = await prisma.$transaction(
      (transaction: Prisma.TransactionClient) => backfillLegacyWeightProvenance(transaction, options.expected!),
      { isolationLevel: "Serializable" },
    );
    console.log(JSON.stringify({ mode: "applied", database: identity, selection: "metric=weight-kg AND source IS NULL", ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed with an unknown error.");
  process.exitCode = 1;
});

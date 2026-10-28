import { createHash } from "node:crypto";
import type { BetterAuthRateLimitStorage } from "better-auth";
import { prisma } from "@/lib/db/prisma";

function storageKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const databaseAuthRateLimitStorage: BetterAuthRateLimitStorage = {
  async consume(key, rule) {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const windowSeconds = BigInt(Math.max(1, Math.floor(rule.window)));
    // The longest BodyCast limiter window is the daily mail quota. Prune only
    // expired windows so caller-chosen email addresses cannot grow this table
    // without bound; live windows remain untouched.
    await prisma.authRateLimitBucket.deleteMany({ where: { windowStart: { lt: now - BigInt(86_400) } } });
    const rows = await prisma.$queryRaw<Array<{ hitCount: number; windowStart: bigint }>>`
      INSERT INTO "AuthRateLimitBucket" ("bucketKey", "hitCount", "windowStart")
      VALUES (${storageKey(key)}, 1, ${now})
      ON CONFLICT ("bucketKey") DO UPDATE SET
        "hitCount" = CASE
          WHEN "AuthRateLimitBucket"."windowStart" <= ${now} - ${windowSeconds} THEN 1
          ELSE "AuthRateLimitBucket"."hitCount" + 1
        END,
        "windowStart" = CASE
          WHEN "AuthRateLimitBucket"."windowStart" <= ${now} - ${windowSeconds} THEN ${now}
          ELSE "AuthRateLimitBucket"."windowStart"
        END
      RETURNING "hitCount", "windowStart"
    `;
    const row = rows[0];
    if (!row) throw new Error("Auth rate limit storage did not return its atomic update");
    const age = Number(now - row.windowStart);
    return {
      allowed: row.hitCount <= rule.max,
      retryAfter: row.hitCount <= rule.max ? null : Math.max(1, Math.ceil(rule.window - age)),
    };
  },
};

export async function consumeApplicationAuthLimit(key: string, windowSeconds: number, max: number) {
  return databaseAuthRateLimitStorage.consume(key, { window: windowSeconds, max });
}

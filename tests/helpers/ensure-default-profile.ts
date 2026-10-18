import type { PrismaClient } from "@prisma/client";

/** Ensure suites that use the default profile own their precondition instead
 * of depending on another integration file to seed it. Keep this shared row
 * in place because PostgreSQL integration shards share one disposable DB. */
export async function ensureDefaultTestProfile(client: PrismaClient): Promise<void> {
  await client.profile.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      sex: "male",
      dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180,
    },
    update: {},
  });
}

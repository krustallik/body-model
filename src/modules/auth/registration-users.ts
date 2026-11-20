import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

/** Create an unverified identity with no credential until its owner proves the email. */
export async function createPendingRegistrationUser(email: string, name: string): Promise<void> {
  await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      name,
      emailVerified: false,
    },
  });
}

/** Remove only the unreachable random credential used by the previous pending-signup flow. */
export async function removePendingRegistrationCredential(userId: string): Promise<void> {
  await prisma.account.deleteMany({ where: { userId, providerId: "credential" } });
}

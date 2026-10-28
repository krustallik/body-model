import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { trainingRepository } from "@/modules/training/training.repository";

export async function provisionProfileAfterEmailVerification(user: { id: string }): Promise<void> {
  const verified = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!verified?.emailVerified) throw new Error("Verified identity is required before Profile provisioning");

  const env = getEnv();
  const ownerEmail = env.AUTH_PROFILE_ONE_OWNER_EMAIL?.trim().toLowerCase();
  const isProfileOneBootstrap = env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED === "true"
    && ownerEmail !== undefined
    && verified.email.trim().toLowerCase() === ownerEmail;
  const profile = await prisma.$transaction(async (tx) => {
    if (isProfileOneBootstrap) {
      const legacy = await tx.profile.findUnique({ where: { id: 1 }, select: { userId: true } });
      if (!legacy) throw new Error("Profile 1 must exist before its separately authorized owner bootstrap");
      if (legacy.userId && legacy.userId !== verified.id) {
        throw new Error("Profile 1 is already bound to a different User");
      }
      const existing = await tx.profile.findUnique({ where: { userId: verified.id }, select: { id: true } });
      if (existing && existing.id !== 1) throw new Error("Owner User already has a non-legacy Profile");
      if (!legacy.userId) {
        await tx.profile.update({ where: { id: 1 }, data: { userId: verified.id } });
        await tx.user.update({ where: { id: verified.id }, data: { passwordChangeRequired: true } });
      }
      return { id: 1, isLegacyOwner: true };
    }

    const created = await tx.profile.upsert({
      where: { userId: verified.id },
      create: { userId: verified.id, locale: "uk" },
      update: {},
      select: { id: true },
    });
    return { ...created, isLegacyOwner: false };
  });

  // Seed only the new user's canonical exercise catalog. Profile 1's catalog
  // and all historical records remain untouched by account bootstrap.
  if (!profile.isLegacyOwner) await trainingRepository.ensureCanonicalExerciseCatalog(profile.id);
}

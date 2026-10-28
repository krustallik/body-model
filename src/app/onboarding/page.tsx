import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProfileClient } from "@/app/settings/profile/profile-client";
import { getAuthenticatedUser } from "@/modules/auth/access";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const user = await getAuthenticatedUser(await headers());
  if (!user) redirect("/login");
  if (user.passwordChangeRequired) redirect("/password-setup");
  const profile = await prisma.profile.findUnique({ where: { id: user.profileId }, select: { sex: true, dateOfBirth: true, heightCm: true } });
  if (profile?.sex && profile.dateOfBirth && profile.heightCm) redirect("/dashboard");
  return <ProfileClient onboarding />;
}

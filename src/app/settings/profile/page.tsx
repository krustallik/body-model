import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProfileClient } from "./profile-client";
import { getAuthenticatedUser } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile settings · BodyCast",
  description: "Manage the personal inputs and weight goal used by BodyCast.",
};

export default async function ProfilePage() {
  const user = await getAuthenticatedUser(await headers());
  if (!user) redirect("/login");
  if (user.passwordChangeRequired) redirect("/password-setup");
  return <ProfileClient accountEmail={user.email} />;
}

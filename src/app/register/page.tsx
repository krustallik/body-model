import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFlow } from "@/app/auth-flow";
import { prisma } from "@/lib/db/prisma";
import { getAuthenticatedUser } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getAuthenticatedUser(await headers());
  if (!user) return <AuthFlow mode="register" />;
  if (user.passwordChangeRequired) redirect("/password-setup");

  const credential = await prisma.account.findFirst({
    where: { userId: user.userId, providerId: "credential" },
    select: { password: true },
  });
  if (credential?.password) redirect("/dashboard");
  return <AuthFlow mode="registration-password" signedInEmail={user.email} />;
}

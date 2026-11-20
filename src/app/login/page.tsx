import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFlow } from "@/app/auth-flow";
import { prisma } from "@/lib/db/prisma";
import { getAuthenticatedUser } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getAuthenticatedUser(await headers());
  if (user) {
    if (user.passwordChangeRequired) redirect("/password-setup");
    const credential = await prisma.account.findFirst({
      where: { userId: user.userId, providerId: "credential" },
      select: { password: true },
    });
    redirect(credential?.password ? "/dashboard" : "/register");
  }
  return <AuthFlow mode="login" />;
}

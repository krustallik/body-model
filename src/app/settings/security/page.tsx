import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFlow } from "@/app/auth-flow";
import { getAuthenticatedUser } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await getAuthenticatedUser(await headers());
  if (!user) redirect("/login");
  if (user.passwordChangeRequired) redirect("/password-setup");
  return <AuthFlow mode="change-password" signedInEmail={user.email} />;
}

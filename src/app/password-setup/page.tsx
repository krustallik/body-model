import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFlow } from "@/app/auth-flow";
import { getAuthenticatedUser } from "@/modules/auth/access";

export const dynamic = "force-dynamic";
export default async function PasswordSetupPage() {
  const user = await getAuthenticatedUser(await headers());
  if (!user) redirect("/login");
  if (!user.passwordChangeRequired) redirect("/dashboard");
  return <AuthFlow mode="password-setup" signedInEmail={user.email} />;
}

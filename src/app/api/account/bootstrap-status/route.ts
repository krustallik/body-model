import { getAuthenticatedUser } from "@/modules/auth/access";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getAuthenticatedUser(request.headers);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const profile = await prisma.profile.findUnique({
    where: { id: user.profileId },
    select: { sex: true, dateOfBirth: true, heightCm: true },
  });
  return Response.json({
    passwordChangeRequired: user.passwordChangeRequired,
    onboardingRequired: !profile?.sex || !profile.dateOfBirth || !profile.heightCm,
  }, { headers: { "cache-control": "no-store" } });
}

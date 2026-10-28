import { getProfilePrincipal, type ProfilePrincipal } from "@/modules/auth/access";

export async function modelPrincipal(request: Request): Promise<ProfilePrincipal | null> {
  return getProfilePrincipal(request);
}

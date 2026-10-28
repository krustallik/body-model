export function requireProfileId(profileId: number | null | undefined): number {
  if (!Number.isSafeInteger(profileId) || profileId === null || profileId === undefined || profileId < 1) {
    throw new Error("profile_scope_required");
  }
  return profileId;
}

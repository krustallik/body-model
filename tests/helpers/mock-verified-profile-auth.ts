const principal = { profileId: 1, userId: "test-user-1", method: "session" as const };
const user = {
  userId: "test-user-1",
  email: "verified@example.test",
  profileId: 1,
  passwordChangeRequired: false,
};

export const mockProfileAuth = {
  getProfilePrincipal: async () => principal,
  getSessionPrincipal: async () => principal,
  getAuthenticatedUser: async () => user,
  getPageUser: async () => user,
  isTrustedOrigin: () => true,
  originRejected: () => Response.json({ error: "origin_not_allowed" }, { status: 403 }),
  enforceAuthRequestLimit: async () => null,
  configuredAuthEmailLimit: () => 250,
};


import { beforeEach, describe, expect, it, vi } from "vitest";

const authAccess = vi.hoisted(() => ({
  getSessionPrincipal: vi.fn(),
  isTrustedOrigin: vi.fn(),
  originRejected: vi.fn(() => Response.json({ error: "origin_not_allowed" }, { status: 403 })),
}));
const trainingService = vi.hoisted(() => ({
  recordCompletedSessionLoadAssessment: vi.fn(),
}));

vi.mock("@/modules/auth/access", () => authAccess);
vi.mock("@/modules/training/training.service", () => ({ trainingService }));

import { PUT } from "@/app/api/v1/training/sessions/[id]/load-assessment/route";

const url = "http://localhost/api/v1/training/sessions/74/load-assessment";
const context = { params: Promise.resolve({ id: "74" }) };

describe("PUT /api/v1/training/sessions/[id]/load-assessment", () => {
  beforeEach(() => {
    authAccess.getSessionPrincipal.mockReset();
    authAccess.isTrustedOrigin.mockReset();
    trainingService.recordCompletedSessionLoadAssessment.mockReset();
  });

  it("stores a user-confirmed lighter assessment separately from pre-session intent", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 41, userId: "u41", method: "session" });
    authAccess.isTrustedOrigin.mockReturnValue(true);
    trainingService.recordCompletedSessionLoadAssessment.mockResolvedValue({ saved: true, assessment: "LIGHTER" });

    const response = await PUT(new Request(url, {
      method: "PUT",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ status: "lighter" }),
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: true, assessment: "LIGHTER" });
    expect(trainingService.recordCompletedSessionLoadAssessment).toHaveBeenCalledWith(74, 41, "LIGHTER");
  });

  it("rejects invalid answers and non-trusted origins before writing", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 41, userId: "u41", method: "session" });
    authAccess.isTrustedOrigin.mockReturnValue(false);

    const response = await PUT(new Request(url, {
      method: "PUT",
      headers: { origin: "http://attacker.invalid", "content-type": "application/json" },
      body: JSON.stringify({ status: "maybe" }),
    }), context);

    expect(response.status).toBe(403);
    expect(trainingService.recordCompletedSessionLoadAssessment).not.toHaveBeenCalled();
  });

  it("validates answer values for a trusted origin before writing", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 41, userId: "u41", method: "session" });
    authAccess.isTrustedOrigin.mockReturnValue(true);

    const response = await PUT(new Request(url, {
      method: "PUT",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ status: "maybe" }),
    }), context);

    expect(response.status).toBe(400);
    expect(trainingService.recordCompletedSessionLoadAssessment).not.toHaveBeenCalled();
  });
});

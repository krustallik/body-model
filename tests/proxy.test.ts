import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSessionCookie } = vi.hoisted(() => ({ getSessionCookie: vi.fn() }));

vi.mock("better-auth/cookies", () => ({ getSessionCookie }));

import { proxy } from "@/proxy";

describe("page proxy", () => {
  beforeEach(() => getSessionCookie.mockReturnValue(null));

  it.each([
    "/training/categories/arms.webp",
    "/training/exercises/lying-ez-bar-triceps-extension-flat.webp",
    "/training/exercises/goblet-squat.png",
  ])("allows public training illustration %s through without a session", (pathname) => {
    const response = proxy(new NextRequest(`https://bodycast.example${pathname}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects protected Training pages without a session", () => {
    const response = proxy(new NextRequest("https://bodycast.example/training/programs/new"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://bodycast.example/login");
  });
});

import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * This is an optimistic UI redirect only. Every data API independently
 * authenticates and resolves its Profile; the presence of a cookie is never
 * treated as authorization.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/history/:path*",
    "/training/:path*",
    "/body-map/:path*",
    "/forecast/:path*",
    "/goal/:path*",
    "/diagnostics/:path*",
    "/settings/:path*",
    "/onboarding",
    "/password-setup",
  ],
};

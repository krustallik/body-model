import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * This is an optimistic UI redirect only. Every data API independently
 * authenticates and resolves its Profile; the presence of a cookie is never
 * treated as authorization.
 */
export function proxy(request: NextRequest) {
  // Exercise/category illustrations are public static files. The image optimizer
  // fetches them without the browser session cookie, so they must bypass the
  // optimistic page redirect. Training APIs still authenticate independently.
  if (/^\/training\/(?:categories|exercises)\/[^/]+\.(?:webp|png|jpe?g)$/i.test(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
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

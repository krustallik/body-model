import { getEnv } from "@/lib/env";
import { isValidApiKey } from "@/modules/health/auth";

export function modelAuthorizationError(request: Request): Response | null {
  return isValidApiKey(
    request.headers.get("x-api-key"),
    getEnv().IOS_SHORTCUT_API_KEY,
  )
    ? null
    : Response.json({ error: "unauthorized" }, { status: 401 });
}

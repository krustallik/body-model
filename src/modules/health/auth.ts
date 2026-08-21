import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isValidApiKey(provided: string | null, expected: string): boolean {
  if (!provided || provided.trim().length === 0) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

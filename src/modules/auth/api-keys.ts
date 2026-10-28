import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { ProfilePrincipal } from "./access";

const TOKEN_PREFIX = "bc_live_";
const LOOKUP_LENGTH = 20;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function parseToken(token: string): { lookupId: string; secret: string } | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const parts = token.slice(TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || parts[0]?.length !== LOOKUP_LENGTH || !/^[A-Za-z0-9_-]+$/.test(parts[1] ?? "")) return null;
  return { lookupId: parts[0]!, secret: parts[1]! };
}

function secretHash(secret: string): string {
  return digest(secret).toString("hex");
}

function equalHash(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function newCredential() {
  const lookupId = randomBytes(15).toString("base64url").slice(0, LOOKUP_LENGTH);
  const secret = randomBytes(32).toString("base64url");
  return { lookupId, secret, token: `${TOKEN_PREFIX}${lookupId}.${secret}`, secretHash: secretHash(secret) };
}

export async function resolveProfileApiKey(token: string): Promise<ProfilePrincipal | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;
  const record = await prisma.profileApiKey.findUnique({
    where: { lookupId: parsed.lookupId },
    select: {
      id: true,
      profileId: true,
      secretHash: true,
      revokedAt: true,
      profile: { select: { user: { select: { emailVerified: true, passwordChangeRequired: true } } } },
    },
  });
  if (!record || record.revokedAt || !record.profile.user?.emailVerified || record.profile.user.passwordChangeRequired
    || !equalHash(secretHash(parsed.secret), record.secretHash)) return null;
  const used = await prisma.profileApiKey.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
  if (used.count !== 1) return null;
  return { profileId: record.profileId, userId: null, method: "api-key", apiKeyId: record.id };
}

export async function createProfileApiKey(profileId: number, name: string) {
  const credential = newCredential();
  const key = await prisma.profileApiKey.create({
    data: {
      profileId,
      lookupId: credential.lookupId,
      secretHash: credential.secretHash,
      name: name.trim(),
    },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return { ...key, token: credential.token };
}

export async function rotateProfileApiKey(profileId: number, id: string) {
  const credential = newCredential();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.profileApiKey.findFirst({
      where: { id, profileId, revokedAt: null },
      select: { name: true },
    });
    if (!existing) return null;
    const revoked = await tx.profileApiKey.updateMany({
      where: { id, profileId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) return null;
    const key = await tx.profileApiKey.create({
      data: {
        profileId,
        lookupId: credential.lookupId,
        secretHash: credential.secretHash,
        name: existing.name,
      },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });
    return { ...key, token: credential.token };
  });
}

export async function revokeProfileApiKey(profileId: number, id: string): Promise<boolean> {
  const result = await prisma.profileApiKey.updateMany({
    where: { id, profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function listProfileApiKeys(profileId: number) {
  return prisma.profileApiKey.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
}

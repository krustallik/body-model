import { z } from "zod";
import { isIP } from "node:net";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  IOS_SHORTCUT_API_KEY: z.string().min(16, "must contain at least 16 characters"),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  AUTH_TRUSTED_PROXIES: z.string().optional(),
  AUTH_PUBLIC_REGISTRATION_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTH_PROFILE_ONE_OWNER_EMAIL: z.string().email().optional(),
  LEGACY_IOS_SHORTCUT_ENABLED: z.enum(["true", "false"]).default("false"),
  BREVO_API_KEY: z.string().min(1).optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  BREVO_SENDER_NAME: z.string().min(1).max(100).optional(),
  AUTH_EMAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(250),
  AUTH_EMAIL_RECIPIENT_DAILY_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
});

const insecureProductionValues = new Set([
  "change_me",
  "replace_with_long_random_secret",
  "replace_with_strong_database_password",
  "replace_with_at_least_32_random_characters",
]);

export type Environment = z.infer<typeof envSchema>;

export function validateEnv(source: NodeJS.ProcessEnv): Environment {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const trustedProxies = result.data.AUTH_TRUSTED_PROXIES?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (trustedProxies.some((entry) => !isTrustedProxyEntry(entry))) {
    throw new Error("Invalid environment configuration: AUTH_TRUSTED_PROXIES must contain only valid IP addresses or CIDR ranges");
  }

  if (result.data.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED === "true") {
    if (result.data.AUTH_PUBLIC_REGISTRATION_ENABLED === "true") {
      throw new Error("Invalid environment configuration: Profile 1 bootstrap and public registration cannot be enabled together");
    }
    if (!result.data.AUTH_PROFILE_ONE_OWNER_EMAIL) {
      throw new Error("Invalid environment configuration: AUTH_PROFILE_ONE_OWNER_EMAIL is required for Profile 1 bootstrap");
    }
    if (!result.data.BREVO_API_KEY || !result.data.BREVO_SENDER_EMAIL || !result.data.BREVO_SENDER_NAME) {
      throw new Error("Invalid environment configuration: Brevo credentials and sender are required for Profile 1 bootstrap");
    }
  }

  if (result.data.NODE_ENV === "production") {
    if (insecureProductionValues.has(result.data.IOS_SHORTCUT_API_KEY)) {
      throw new Error("Invalid environment configuration: IOS_SHORTCUT_API_KEY uses a placeholder value");
    }
    const database = new URL(result.data.DATABASE_URL);
    if ([database.username, database.password].some((value) => insecureProductionValues.has(decodeURIComponent(value)))) {
      throw new Error("Invalid environment configuration: DATABASE_URL uses placeholder credentials");
    }
    if (!result.data.BETTER_AUTH_SECRET || result.data.BETTER_AUTH_SECRET.length < 32) {
      throw new Error("Invalid environment configuration: BETTER_AUTH_SECRET must contain at least 32 characters");
    }
    if (!result.data.BETTER_AUTH_URL) {
      throw new Error("Invalid environment configuration: BETTER_AUTH_URL is required in production");
    }
    if (!result.data.AUTH_TRUSTED_PROXIES?.split(",").some((proxy) => proxy.trim().length > 0)) {
      throw new Error("Invalid environment configuration: AUTH_TRUSTED_PROXIES must identify the trusted reverse proxy in production");
    }
    if (result.data.AUTH_PUBLIC_REGISTRATION_ENABLED === "true"
      && (!result.data.BREVO_API_KEY || !result.data.BREVO_SENDER_EMAIL || !result.data.BREVO_SENDER_NAME)) {
      throw new Error("Invalid environment configuration: Brevo credentials and sender are required when public registration is enabled");
    }
  }

  return result.data;
}

function isTrustedProxyEntry(entry: string): boolean {
  const slash = entry.lastIndexOf("/");
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(address);
  if (!family) return false;
  if (slash === -1) return true;
  if (entry.indexOf("/") !== slash) return false;
  const prefixText = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  return prefix > 0 && prefix <= (family === 4 ? 32 : 128);
}

export function getEnv(): Environment {
  return validateEnv(process.env);
}

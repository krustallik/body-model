import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  IOS_SHORTCUT_API_KEY: z.string().min(16, "must contain at least 16 characters"),
});

const insecureProductionValues = new Set([
  "change_me",
  "replace_with_long_random_secret",
  "replace_with_strong_database_password",
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

  if (result.data.NODE_ENV === "production") {
    if (insecureProductionValues.has(result.data.IOS_SHORTCUT_API_KEY)) {
      throw new Error("Invalid environment configuration: IOS_SHORTCUT_API_KEY uses a placeholder value");
    }
    const database = new URL(result.data.DATABASE_URL);
    if ([database.username, database.password].some((value) => insecureProductionValues.has(decodeURIComponent(value)))) {
      throw new Error("Invalid environment configuration: DATABASE_URL uses placeholder credentials");
    }
  }

  return result.data;
}

export function getEnv(): Environment {
  return validateEnv(process.env);
}

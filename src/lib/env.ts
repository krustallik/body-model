import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  IOS_SHORTCUT_API_KEY: z.string().min(16, "must contain at least 16 characters"),
});

export type Environment = z.infer<typeof envSchema>;

export function validateEnv(source: NodeJS.ProcessEnv): Environment {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}

export function getEnv(): Environment {
  return validateEnv(process.env);
}

import { loadEnvConfig } from "@next/env";
import { getEnv } from "../src/lib/env";

loadEnvConfig(process.cwd());
// Accessing the parsed object ensures validation runs before the application starts.
void getEnv();
console.log("Environment configuration is valid.");

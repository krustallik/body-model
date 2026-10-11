import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { assertExactKeys, canonicalJson } from "./canonical.mjs";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || values[key.slice(2)] !== undefined || index + 1 >= argv.length) {
      throw new Error("Package build requires unique --out, --adapter, and --installation-policy arguments.");
    }
    values[key.slice(2)] = argv[++index];
  }
  assertExactKeys(values, ["out", "adapter", "installation-policy"], "Authority package build arguments");
  for (const key of ["out", "adapter", "installation-policy"]) {
    if (typeof values[key] !== "string" || values[key].length === 0) throw new Error("Missing package build argument: --" + key + ".");
  }
  return values;
}

export async function buildAuthorityPackage({ outputPath, adapterEntry, installationPolicyPath }) {
  const output = path.resolve(outputPath);
  const clientOutput = output + ".client.mjs";
  const adapter = path.resolve(adapterEntry);
  const policyPath = path.resolve(installationPolicyPath);
  const policyText = await readFile(policyPath, "utf8");
  const policy = JSON.parse(policyText);
  if (canonicalJson(policy) !== policyText) throw new Error("Installation trust policy must be canonical JSON.");
  assertExactKeys(policy, ["trustedInstallationKeys", "allowedAuthorityVersions", "minimumAllowedVersion"],
    "Authority installation trust policy");
  if (!policy.trustedInstallationKeys || typeof policy.trustedInstallationKeys !== "object"
    || Array.isArray(policy.trustedInstallationKeys) || !Array.isArray(policy.allowedAuthorityVersions)
    || policy.allowedAuthorityVersions.length === 0 || typeof policy.minimumAllowedVersion !== "string") {
    throw new Error("Authority installation trust policy is incomplete.");
  }
  const runtimePath = path.resolve("scripts/production-recovery/authority-package-runtime.mjs").replaceAll("\\", "/");
  const clientRuntimePath = path.resolve("scripts/production-recovery/authority-client-runtime.mjs").replaceAll("\\", "/");
  const adapterPathForImport = adapter.replaceAll("\\", "/");
  const source = `import { runAuthorityPackageCli } from ${JSON.stringify(runtimePath)};\n`
    + `import { createTrustedHostAdapter } from ${JSON.stringify(adapterPathForImport)};\n`
    + `const installationPolicy = ${JSON.stringify(policy)};\n`
    + `await runAuthorityPackageCli({ createTrustedHostAdapter, installationPolicy });\n`;
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "bodycast-recovery-authority-entry.mjs", loader: "js" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: output,
    packages: "external",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  if (result.errors.length) throw new Error("Authority package bundle did not compile.");
  const clientSource = `import { runProductionOperationClient } from ${JSON.stringify(clientRuntimePath)};\n`
    + "await runProductionOperationClient();\n";
  const clientResult = await build({
    stdin: { contents: clientSource, resolveDir: process.cwd(), sourcefile: "bodycast-production-operation-client.mjs", loader: "js" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: clientOutput,
    packages: "external",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  if (clientResult.errors.length) throw new Error("Production operation client bundle did not compile.");
  return { authority: output, client: clientOutput };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const output = await buildAuthorityPackage({ outputPath: args.out, adapterEntry: args.adapter,
      installationPolicyPath: args["installation-policy"] });
    process.stdout.write(output.authority + "\n" + output.client + "\n");
  } catch (error) {
    process.stderr.write("Authority package build blocked: " + error.message + "\n");
    process.exitCode = 1;
  }
}

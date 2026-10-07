import { verifyInstalledAuthorityPackage } from "./install-provenance.mjs";
import { parseOperationArguments, sendProductionOperation } from "./host-operation-client.mjs";
import { createRecoveryHostRuntime, AUTHORITY_CONFIG_KEYS } from "./host-runtime.mjs";
import { assertExactKeys, canonicalJson } from "./canonical.mjs";

export const AUTHORITY_INSTALL_ROOT = "/usr/local/lib/bodycast/production-recovery";
const PACKAGE_CONFIG_KEYS = Object.freeze(["authority", "host"]);
const HOST_CONFIG_KEYS = Object.freeze(["releaseGroupGid", "adapter"]);

function verifyPolicy(policy) {
  assertExactKeys(policy, ["trustedInstallationKeys", "allowedAuthorityVersions", "minimumAllowedVersion"],
    "Embedded authority installation trust policy");
  if (!policy.trustedInstallationKeys || typeof policy.trustedInstallationKeys !== "object"
    || Array.isArray(policy.trustedInstallationKeys) || Object.keys(policy.trustedInstallationKeys).length === 0
    || !Array.isArray(policy.allowedAuthorityVersions) || policy.allowedAuthorityVersions.length === 0
    || typeof policy.minimumAllowedVersion !== "string") {
    throw new Error("Embedded authority installation trust policy is incomplete.");
  }
  return policy;
}

async function verifyCurrentPackage(installationPolicy) {
  const policy = verifyPolicy(installationPolicy);
  const installed = await verifyInstalledAuthorityPackage({
    installationRoot: AUTHORITY_INSTALL_ROOT,
    trustedInstallationKeys: policy.trustedInstallationKeys,
    allowedAuthorityVersions: policy.allowedAuthorityVersions,
    minimumAllowedVersion: policy.minimumAllowedVersion,
    requireRoot: true,
  });
  const text = installed.configBytes.toString("utf8");
  const config = JSON.parse(text);
  if (canonicalJson(config) !== text) throw new Error("Installed authority configuration is not canonical JSON.");
  assertExactKeys(config, PACKAGE_CONFIG_KEYS, "Installed recovery authority package configuration");
  assertExactKeys(config.authority, AUTHORITY_CONFIG_KEYS, "Installed root authority configuration");
  assertExactKeys(config.host, HOST_CONFIG_KEYS, "Installed fixed host adapter configuration");
  if (!Number.isSafeInteger(config.host.releaseGroupGid) || config.host.releaseGroupGid < 1) {
    throw new Error("Installed release group identity is invalid.");
  }
  return { installed, config };
}

/** Runtime shared by the immutable bundle's fixed --serve and --client modes. */
export async function runAuthorityPackageCli({ argv = process.argv.slice(2), createTrustedHostAdapter, installationPolicy }) {
  const [mode, ...args] = argv;
  if (mode === "--client") {
    const request = parseOperationArguments(args);
    const response = await sendProductionOperation(request);
    process.stdout.write(canonicalJson(response) + "\n");
    return;
  }
  if (mode === "--verify-install") {
    if (args.length !== 0) throw new Error("--verify-install accepts no caller-selected paths or options.");
    const { installed } = await verifyCurrentPackage(installationPolicy);
    process.stdout.write(canonicalJson({ ok: true, authorityVersion: installed.authorityVersion,
      binaryDigest: installed.binaryDigest, configDigest: installed.configDigest }) + "\n");
    return;
  }
  if (mode !== "--serve" || args.length !== 0) throw new Error("Only fixed --serve, --verify-install, and --client modes are supported.");
  if (process.getuid?.() !== 0) throw new Error("Production recovery authority service must run as root.");
  if (typeof createTrustedHostAdapter !== "function") throw new Error("Immutable package host adapter factory is missing.");
  const { config } = await verifyCurrentPackage(installationPolicy);
  const adapter = await createTrustedHostAdapter(config.host.adapter);
  const runtime = createRecoveryHostRuntime({
    authorityConfig: { authority: config.authority },
    trustedHostAdapter: adapter,
    releaseGroupGid: config.host.releaseGroupGid,
  });
  await runtime.start();
  const stop = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await new Promise(() => {});
}

export { verifyCurrentPackage, verifyPolicy };

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

export function productionAppRuntimeDigest(container) {
  if (!container || typeof container !== "object" || Array.isArray(container)) throw new Error("Docker app inspect result is malformed.");
  const config = container.Config ?? {};
  const host = container.HostConfig ?? {};
  const networks = Object.keys(container.NetworkSettings?.Networks ?? {}).sort();
  const runtime = {
    env: Array.isArray(config.Env) ? [...config.Env].sort() : null,
    entrypoint: config.Entrypoint ?? null,
    command: config.Cmd ?? null,
    user: config.User ?? "",
    workingDir: config.WorkingDir ?? "",
    healthcheck: config.Healthcheck ?? null,
    exposedPorts: config.ExposedPorts ?? {},
    binds: [...(host.Binds ?? [])].sort(),
    mounts: (container.Mounts ?? []).map(({ Type, Name, Source, Destination, Mode, RW, Propagation }) => ({
      Type, Name: Name ?? "", Source, Destination, Mode, RW, Propagation,
    })).sort((a, b) => a.Destination.localeCompare(b.Destination)),
    portBindings: host.PortBindings ?? {},
    restartPolicy: host.RestartPolicy?.Name ?? "",
    networks,
  };
  if (runtime.env === null) throw new Error("Docker app runtime environment is unavailable.");
  return createHash("sha256").update(JSON.stringify(runtime)).digest("hex");
}

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const containers = JSON.parse(text);
  const container = Array.isArray(containers) ? containers[0] : containers;
  process.stdout.write(`${productionAppRuntimeDigest(container)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

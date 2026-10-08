import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
const PREVIOUS_SHA = "1".repeat(40);
const PREVIOUS_IMAGE_ID = `sha256:${"a".repeat(64)}`;
const LATEST_IMAGE_ID = `sha256:${"b".repeat(64)}`;
const CANDIDATE_IMAGE_ID = `sha256:${"c".repeat(64)}`;
const WRONG_IMAGE_ID = `sha256:${"d".repeat(64)}`;

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findBash(): string | null {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return "bash";
  if (process.platform !== "win32") return null;
  const where = spawnSync("where.exe", ["git"], { encoding: "utf8" });
  const gitExe = where.stdout.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith("\\git.exe"));
  if (!gitExe) return null;
  const gitBash = path.resolve(path.dirname(gitExe), "..", "bin", "bash.exe");
  return existsSync(gitBash) ? gitBash : null;
}

function findGitExecutable(): string {
  if (process.platform !== "win32") return "git";
  const where = spawnSync("where.exe", ["git"], { encoding: "utf8" });
  const gitExe = where.stdout.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith("\\git.exe"));
  if (!gitExe) throw new Error("Git executable is required for the release-cutover fixture.");
  return gitExe;
}

function toBashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const match = /^([A-Za-z]):\\(.*)$/.exec(value);
  if (!match) return value.replace(/\\/g, "/");
  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function maintenanceRoute(): string {
  return `http://bodycast.example.test {
    redir https://bodycast.example.test{uri} permanent
}

bodycast.example.test {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    respond "BodyCast is temporarily unavailable while the model is updated." 503
}
`;
}

function servingRoute(): string {
  return maintenanceRoute().replace(
    'respond "BodyCast is temporarily unavailable while the model is updated." 503',
    "reverse_proxy bodycast-app-prod:3000",
  );
}

function shellScript(strings: TemplateStringsArray): string {
  return strings.raw[0].replaceAll("\\${", "${");
}

const fakeDocker = shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
event() { printf '%s\n' "$*" >> "$EVENT_LOG"; }
advance_main() {
  local trigger="\${1:-v4}"
  case "$trigger" in
    v4) [[ "\${ADVANCE_ONCE:-}" == "1" ]] || return 0 ;;
    validate) [[ "\${ADVANCE_ON_VALIDATE:-}" == "1" ]] || return 0 ;;
  esac
  [[ ! -e "$ADVANCE_MARKER" ]] || return 0
  "\${REAL_GIT}" -C "$FIXTURE_REPO" push --quiet origin "\${ADVANCE_SHA}:refs/heads/main"
  : > "$ADVANCE_MARKER"
  event "main-advanced"
}
joined=" $* "
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  if [[ "$3" == "--format" ]]; then format="$4"; image="$5"; else format=""; image="$3"; fi
  case "$image" in
    bodycast-app:latest) image_file="$IMAGE_LATEST" ;;
    bodycast-app:rollback) image_file="$IMAGE_ROLLBACK" ;;
    *) exit 1 ;;
  esac
  [[ -s "$image_file" ]] || exit 1
  if [[ "$format" == *".Id"* ]]; then cat "$image_file"; fi
  exit 0
fi
if [[ "$1" == "image" && "$2" == "tag" ]]; then
  case "$3:$4" in
    bodycast-app:latest:bodycast-app:rollback) cp "$IMAGE_LATEST" "$IMAGE_ROLLBACK" ;;
    bodycast-app:rollback:bodycast-app:latest) cp "$IMAGE_ROLLBACK" "$IMAGE_LATEST" ;;
    sha256:*:bodycast-app:rollback)
      printf '%s\n' "$3" > "$IMAGE_ROLLBACK"
      ;;
    *) exit 2 ;;
  esac
  event "image-tag:$3:$4"
  exit 0
fi
if [[ "$1" == "image" && "$2" == "rm" ]]; then
  rm -f "$IMAGE_ROLLBACK"
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  if [[ "$joined" == *" config --quiet "* || "$joined" == *" up -d db "* \
      || "$joined" == *" build migrate "* || "$joined" == *" logs --tail=100 "* ]]; then exit 0; fi
  if [[ "$joined" == *" run --rm --no-deps --entrypoint node migrate "* ]]; then
    if [[ "$joined" == *"unified-v4-traffic-check.mjs"* ]]; then event "unified-v4-check"; fi
    if [[ "$joined" == *"unified-v4-traffic-check.mjs"* \
        && "$(cat "$APP_SHA_FILE" 2>/dev/null || true)" == "\${CANDIDATE_SHA:-}" \
        && "$(cat "$ACTIVE_ROUTE_FILE" 2>/dev/null || true)" == "maintenance" ]]; then
      advance_main
    fi
    exit 0
  fi
  if [[ "$joined" == *" build app "* ]]; then
    printf '%s\n' "$CANDIDATE_IMAGE_ID" > "$IMAGE_LATEST"
    exit 0
  fi
  if [[ "$joined" == *" up -d --no-deps --force-recreate app "* ]]; then
    if [[ "\${FAIL_CANDIDATE_UP:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${CANDIDATE_SHA:-}" \
        && ! -e "$FAIL_CANDIDATE_MARKER" ]]; then
      : > "$FAIL_CANDIDATE_MARKER"
      exit 31
    fi
    restored_image_id="$(cat "$IMAGE_LATEST")"
    if [[ "\${ROLLBACK_CONTAINER_IMAGE_MISMATCH:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${PREVIOUS_SHA:-}" ]]; then
      restored_image_id="$WRONG_IMAGE_ID"
    fi
    printf '%s\n' "$restored_image_id" > "$APP_IMAGE_ID_FILE"
    printf '%s\n' "\${BODYCAST_DEPLOY_SHA:?}" > "$APP_SHA_FILE"
    printf '%s\n' healthy > "$APP_STATUS_FILE"
    printf '%s\n' true > "$APP_PRESENT_FILE"
    printf '%s\n' always > "$APP_RESTART_FILE"
    exit 0
  fi
  if [[ "$joined" == *" stop app "* ]]; then
    printf '%s\n' exited > "$APP_STATUS_FILE"
    exit 0
  fi
  if [[ "$joined" == *" rm --force app "* ]]; then
    printf '%s\n' false > "$APP_PRESENT_FILE"
    exit 0
  fi
  echo "unhandled docker compose fixture command: $*" >&2
  exit 90
fi
if [[ "$1" == "inspect" ]]; then
  format="$3"
  target="$4"
  case "$target:$format" in
    bodycast-db-prod:*State.Status*Health*) printf '%s\n' 'running|healthy' ;;
    bodycast-db-prod:*Health.Status*|bodycast-db-prod:*State.Health*) printf '%s\n' healthy ;;
    bodycast-db-prod:*NetworkSettings.Networks*) printf '%s\n' bodycast-backend-prod ;;
    bodycast-db-prod:*) printf '%s\n' running ;;
    bodycast-app-prod:*Image*) cat "$APP_IMAGE_ID_FILE" ;;
    bodycast-app-prod:*Health.Status*|bodycast-app-prod:*State.Health*) cat "$APP_STATUS_FILE" ;;
    bodycast-app-prod:*org.bodycast.release-sha*) cat "$APP_SHA_FILE" ;;
    bodycast-app-prod:*HostConfig.RestartPolicy.Name*) cat "$APP_RESTART_FILE" ;;
    bodycast-app-prod:*State.Status*) cat "$APP_STATUS_FILE" ;;
    gymbeam-caddy:*State.Status*) printf '%s\n' running ;;
    *) echo "unhandled docker inspect fixture target/format: $target $format" >&2; exit 91 ;;
  esac
  exit 0
fi
if [[ "$1" == "ps" ]]; then
  if [[ "$(cat "$APP_PRESENT_FILE" 2>/dev/null || true)" == "true" ]]; then printf '%s\n' bodycast-app-prod; fi
  exit 0
fi
if [[ "$1" == "update" ]]; then
  printf '%s\n' no > "$APP_RESTART_FILE"
  exit 0
fi
if [[ "$1" == "info" || "$1" == "port" ]]; then exit 0; fi
if [[ "$1" == "network" && "$2" == "inspect" ]]; then printf '%s\n' bodycast-db-prod; exit 0; fi
if [[ "$1" == "exec" && ( "$2" == "gymbeam-caddy" || ( "$2" == "-i" && "$3" == "gymbeam-caddy" ) ) ]]; then
  if [[ "$*" == *" validate "* ]]; then
    if [[ "$*" == *"--config -"* ]]; then
      staged_route="$(cat)"
      if grep -q reverse_proxy "$ROUTE_FILE"; then event "live-route-before-validate:serving"; else event "live-route-before-validate:maintenance"; fi
      event "staged-route-validated"
      if [[ "$staged_route" == *"reverse_proxy"* ]]; then advance_main validate; fi
    fi
    exit 0
  fi
  if [[ "$*" == *" reload "* ]]; then
    event "caddy-reload"
    if grep -q reverse_proxy "$ROUTE_FILE"; then printf '%s\n' serving > "$ACTIVE_ROUTE_FILE"; else printf '%s\n' maintenance > "$ACTIVE_ROUTE_FILE"; fi
    exit 0
  fi
fi
if [[ "$1" == "exec" && "$2" == "bodycast-app-prod" ]]; then
  printf '%s\n' '{"status":"ok"}'
  exit 0
fi
echo "unhandled docker fixture command: $*" >&2
exit 92
`;

const fakeCurl = shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$(cat "$ACTIVE_ROUTE_FILE" 2>/dev/null || true)" == "serving" ]]; then
  printf '%s\n' '{"status":"ok"}'
  exit 0
fi
exit 22
`;

const fakeGit = shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == "fetch" && "$*" == *"refs/heads/main:refs/remotes/origin/main"* \
    && "\${ADVANCE_ON_MAIN_FETCH:-0}" == "1" && ! -e "$ADVANCE_MARKER" ]]; then
  "$REAL_GIT" -C "$FIXTURE_REPO" push --quiet origin "\${ADVANCE_SHA}:refs/heads/main"
  : > "$ADVANCE_MARKER"
  printf '%s\n' main-advanced >> "$EVENT_LOG"
fi
if [[ "$1" == "fetch" && "$*" == *"refs/heads/main:refs/remotes/origin/main"* ]]; then
  printf '%s\n' canonical-main-fetch >> "$EVENT_LOG"
fi
exec "$REAL_GIT" "$@"
`;

const fakeMv = shellScript`mv() {
  local destination source_index source
  destination="\${!#}"
  source_index=$(( $# - 1 ))
  source="\${!source_index}"
  command mv "$@"
  if [[ "$destination" == "$ROUTE_FILE" ]]; then
    if grep -q reverse_proxy "$ROUTE_FILE"; then
      printf '%s\n' serving > "$ACTIVE_ROUTE_FILE"
      printf '%s\n' live-route-mutation:serving >> "$EVENT_LOG"
    else
      printf '%s\n' maintenance > "$ACTIVE_ROUTE_FILE"
      printf '%s\n' live-route-mutation:maintenance >> "$EVENT_LOG"
    fi
  fi
}
export -f mv`;

type Fixture = {
  root: string;
  repo: string;
  routes: string;
  candidateSha: string;
  advanceSha: string;
  bash: string;
  realGit: string;
  env: NodeJS.ProcessEnv;
};

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "bodycast-release-freshness-"));
  temporaryRoots.push(root);
  const repo = path.join(root, "repo");
  const remote = path.join(root, "origin.git");
  const bin = path.join(root, "bin");
  const routes = path.join(root, "routes");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(routes, { recursive: true });

  for (const file of [
    "deploy.sh",
    "deploy-main-freshness.sh",
    "deploy-preflight-schema.sh",
    "production-release-marker.sh",
    "production-traffic-cutover.sh",
    "production-writer-drain.sh",
  ]) {
    copyFileSync(path.resolve("scripts", file), path.join(repo, "scripts", file));
  }
  writeFileSync(path.join(repo, "scripts", "deploy-preflight-schema.sh"), "#!/usr/bin/env bash\nset -Eeuo pipefail\nexit 0\n");
  writeFileSync(path.join(repo, "docker-compose.prod.yml"), "services: {}\n");
  writeFileSync(path.join(bin, "docker"), fakeDocker, { mode: 0o755 });
  writeFileSync(path.join(bin, "curl"), fakeCurl, { mode: 0o755 });
  writeFileSync(path.join(bin, "git"), fakeGit, { mode: 0o755 });
  writeFileSync(path.join(routes, "bodycast.caddy"), servingRoute());

  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "ignore" });
  execFileSync("git", ["init", "--initial-branch=main", repo], { stdio: "ignore" });
  runGit(repo, "config", "user.name", "Cutover fixture");
  runGit(repo, "config", "user.email", "cutover@example.invalid");
  runGit(repo, "remote", "add", "origin", remote);
  runGit(repo, "add", "scripts", "docker-compose.prod.yml");
  runGit(repo, "commit", "-m", "release fixture candidate");
  const candidateSha = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "push", "--set-upstream", "origin", "main");
  writeFileSync(path.join(repo, "advance.txt"), "main advanced\n");
  runGit(repo, "add", "advance.txt");
  runGit(repo, "commit", "-m", "advance canonical main");
  const advanceSha = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "push", "origin", `${advanceSha}:refs/heads/advance`);
  runGit(repo, "checkout", "--detach", "--force", candidateSha);

  const paths = {
    APP_SHA_FILE: path.join(root, "app-sha"),
    APP_IMAGE_ID_FILE: path.join(root, "app-image-id"),
    APP_STATUS_FILE: path.join(root, "app-status"),
    APP_PRESENT_FILE: path.join(root, "app-present"),
    APP_RESTART_FILE: path.join(root, "app-restart"),
    IMAGE_LATEST: path.join(root, "image-latest"),
    IMAGE_ROLLBACK: path.join(root, "image-rollback"),
    ACTIVE_ROUTE_FILE: path.join(root, "active-route"),
    DOCKER_LOG: path.join(root, "docker.log"),
    EVENT_LOG: path.join(root, "events.log"),
    ADVANCE_MARKER: path.join(root, "advance-once"),
    FAIL_CANDIDATE_MARKER: path.join(root, "fail-candidate-once"),
  };
  writeFileSync(paths.APP_SHA_FILE, `${PREVIOUS_SHA}\n`);
  writeFileSync(paths.APP_IMAGE_ID_FILE, `${PREVIOUS_IMAGE_ID}\n`);
  writeFileSync(paths.APP_STATUS_FILE, "healthy\n");
  writeFileSync(paths.APP_PRESENT_FILE, "true\n");
  writeFileSync(paths.APP_RESTART_FILE, "always\n");
  writeFileSync(paths.IMAGE_LATEST, `${LATEST_IMAGE_ID}\n`);
  writeFileSync(paths.ACTIVE_ROUTE_FILE, "serving\n");

  return {
    root,
    repo,
    routes,
    candidateSha,
    advanceSha,
    bash: findBash() ?? "bash",
    realGit: findGitExecutable(),
    env: {
      ...process.env,
      ...Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, toBashPath(value)])),
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      FIXTURE_BIN: toBashPath(bin),
      FIXTURE_REPO: toBashPath(repo),
      REAL_GIT: toBashPath(findGitExecutable()),
      ROUTE_FILE: toBashPath(path.join(routes, "bodycast.caddy")),
      APP_HOST: "bodycast.example.test",
      CADDY_ROUTES_PATH: toBashPath(routes),
      CANDIDATE_SHA: candidateSha,
      ADVANCE_SHA: advanceSha,
      PREVIOUS_SHA,
      PREVIOUS_IMAGE_ID,
      LATEST_IMAGE_ID,
      CANDIDATE_IMAGE_ID,
      WRONG_IMAGE_ID,
    },
  };
}

function runFixture(fixture: Fixture, command: string, overrides: Record<string, string | undefined> = {}) {
  return spawnSync(fixture.bash, ["--noprofile", "--norc", "-c",
    `export PATH="$FIXTURE_BIN:$PATH"; curl() { "$FIXTURE_BIN/curl" "$@"; }; export -f curl; ${fakeMv}; ${command}`], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { ...fixture.env, ...overrides },
  });
}

function advanceMain(fixture: Fixture): void {
  runGit(fixture.repo, "push", "origin", `${fixture.advanceSha}:refs/heads/main`);
}

function appState(fixture: Fixture): { sha: string; imageId: string; status: string; present: string } {
  return {
    sha: readFileSync(path.join(fixture.root, "app-sha"), "utf8").trim(),
    imageId: readFileSync(path.join(fixture.root, "app-image-id"), "utf8").trim(),
    status: readFileSync(path.join(fixture.root, "app-status"), "utf8").trim(),
    present: readFileSync(path.join(fixture.root, "app-present"), "utf8").trim(),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const bashAvailable = findBash() !== null;

describe("fallback production traffic cutover freshness and recovery", () => {
  it.skipIf(!bashAvailable)("serves the exact candidate when canonical main remains unchanged", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.indexOf("live-route-before-validate:maintenance")).toBeLessThan(events.indexOf("canonical-main-fetch"));
    expect(events.indexOf("canonical-main-fetch")).toBeLessThan(events.indexOf("live-route-mutation:serving"));
    expect(events.indexOf("live-route-mutation:serving")).toBeLessThan(events.indexOf("caddy-reload"));
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks serving when main advances during the final V4 child check", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ONCE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks the route write when main advances at its final freshness fence", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ONCE: "1",
      ADVANCE_ON_MAIN_FETCH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("staged-route-validated");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("stages candidate bytes away from the live route and rejects them if main advances before atomic publish", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ON_VALIDATE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.indexOf("live-route-before-validate:maintenance")).toBeLessThan(events.indexOf("staged-route-validated"));
    expect(events.indexOf("staged-route-validated")).toBeLessThan(events.indexOf("main-advanced"));
    expect(events).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("leaves the previous app and live route unchanged when the candidate is stale before maintenance", () => {
    const fixture = createFixture();
    advanceMain(fixture);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("pins and restores the running immutable app image even when :latest differs", () => {
    const fixture = createFixture();
    expect(readFileSync(path.join(fixture.root, "app-image-id"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    expect(readFileSync(path.join(fixture.root, "image-latest"), "utf8").trim()).toBe(LATEST_IMAGE_ID);
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim(), `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).toContain(`image tag ${PREVIOUS_IMAGE_ID} bodycast-app:rollback`);
    expect(dockerLog).not.toContain("image tag bodycast-app:latest bodycast-app:rollback");
    expect(readFileSync(path.join(fixture.root, "image-latest"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
  }, 30_000);

  it.skipIf(!bashAvailable)("restores the exact previous release despite candidate becoming stale after replacement", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADVANCE_ONCE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim(), `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("main-advanced");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.lastIndexOf("unified-v4-check")).toBeLessThan(events.lastIndexOf("staged-route-validated"));
    expect(events.lastIndexOf("staged-route-validated")).toBeLessThan(events.lastIndexOf("live-route-mutation:serving"));
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance when rollback SHA matches but recreated image ID is wrong", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      ROLLBACK_CONTAINER_IMAGE_MISMATCH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: WRONG_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("image tag bodycast-app:latest bodycast-app:rollback");
  }, 30_000);

  it.skipIf(!bashAvailable)("preserves explicit non-serving deployment semantics without reopening traffic", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
  }, 30_000);
});

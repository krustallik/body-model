import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  filterModuleCoverageSourcePaths,
  validateModuleCoverageManifest,
  validateModuleCoverageRelativePath,
  verifyFrozenModuleCoverageInventory,
  verifyModuleCoverage,
} from "./module-coverage-core.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = "tests/refactor-comparator/module-coverage-v1.json";
const VITEST_ENTRY = "node_modules/vitest/vitest.mjs";
const TEST_DATABASE_URL = "postgresql://bodycast_module_coverage_test:unit-only@127.0.0.1:59999/bodycast_module_coverage_test";
const TEST_API_KEY = "bodycast-module-coverage-test-only";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--manifest", "--reports-dir"].includes(flag)) throw new Error(`Unknown module coverage argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate module coverage argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value);
    index += 1;
  }
  const manifest = values.get("--manifest") ?? DEFAULT_MANIFEST;
  validateModuleCoverageRelativePath(manifest, "--manifest");
  const reportsDir = values.get("--reports-dir");
  if (!reportsDir) throw new Error("Required: --reports-dir <path>.");
  return { manifest, reportsDir };
}

function gitOutput(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function trackedSourcePaths(manifest) {
  const result = spawnSync("git", ["ls-files", "-z", "--", ...manifest.sourceRoots], {
    cwd: REPO_ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString("utf8")}`);
  const paths = result.stdout.toString("utf8").split("\0").filter(Boolean);
  return filterModuleCoverageSourcePaths(paths, manifest);
}

function frozenSourceInventory(manifest) {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", "-z", manifest.baselineSha, "--", ...manifest.sourceRoots], {
    cwd: REPO_ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-tree failed for frozen baseline: ${result.stderr.toString("utf8")}`);
  const paths = result.stdout.toString("utf8").split("\0").filter(Boolean);
  const blobShas = {};
  for (const entry of [...manifest.files, ...manifest.excludedPaths]) {
    blobShas[entry.path] = gitOutput(["rev-parse", `${manifest.baselineSha}:${entry.path}`]);
  }
  return verifyFrozenModuleCoverageInventory({ manifest, baselinePaths: paths, baselineBlobShas: blobShas });
}

function assertBaselineIsAncestor(baselineSha) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", baselineSha, "HEAD"], {
    cwd: REPO_ROOT,
    windowsHide: true,
    stdio: "ignore",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Current HEAD is not a descendant of module coverage baseline ${baselineSha}.`);
}

function assertCandidateInputsAreCommitted(manifestPath, sourceRoots) {
  const paths = [
    ...sourceRoots,
    manifestPath,
    "tests/refactor-comparator/module-coverage.test.ts",
    ".github/workflows/ci.yml",
    "scripts/refactor/module-coverage-core.mjs",
    "scripts/refactor/module-coverage-core.d.mts",
    "scripts/refactor/run-module-coverage-gate.mjs",
  ];
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all", "--", ...paths]);
  if (status) throw new Error(`Module coverage inputs must match committed HEAD; dirty scoped paths:\n${status}`);
}

function assertSupportedRuntime(expectedVitestVersion) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== 24) throw new Error(`Module coverage requires Node 24; received ${process.versions.node}.`);
  const vitestPackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "node_modules/vitest/package.json"), "utf8"));
  if (vitestPackage.version !== expectedVitestVersion) {
    throw new Error(`Module coverage expects Vitest ${expectedVitestVersion}; received ${vitestPackage.version}.`);
  }
}

function prepareReportsDirectory(reportsDir) {
  validateModuleCoverageRelativePath(reportsDir, "--reports-dir");
  const segments = reportsDir.split("/");
  const directories = [];
  let current = REPO_ROOT;
  for (const segment of segments) {
    current = path.join(current, segment);
    directories.push(current);
    if (existsSync(current)) {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Refusing to write coverage reports through a non-directory or symbolic link: ${current}`);
      }
    }
  }
  for (const directory of directories) {
    if (!existsSync(directory)) mkdirSync(directory);
  }
  if (readdirSync(current).length > 0) throw new Error(`Coverage reports directory must be empty: ${current}`);
  return current;
}

function runRelatedCoverage(manifest, sourcePaths, reportsDir) {
  if (sourcePaths.length === 0) throw new Error("No tracked production source paths were found for module coverage.");
  if (!existsSync(path.join(REPO_ROOT, VITEST_ENTRY))) throw new Error("Locked Vitest runner is not installed.");

  const args = [VITEST_ENTRY, "related", ...sourcePaths];
  for (const sourcePath of sourcePaths) args.push(`--coverage.include=${sourcePath}`);
  args.push(
    "--coverage.enabled",
    "--coverage.all",
    `--coverage.reportsDirectory=${reportsDir}`,
    "--coverage.reporter=json-summary",
    "--coverage.thresholds.lines=0",
    "--coverage.thresholds.functions=0",
    "--coverage.thresholds.statements=0",
    "--coverage.thresholds.branches=0",
    "--reporter=dot",
    "--silent=passed-only",
    "--maxWorkers=4",
    "--minWorkers=1",
  );
  const env = {
    ...process.env,
    CI: "1",
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    IOS_SHORTCUT_API_KEY: TEST_API_KEY,
  };
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    env,
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const stdout = result.stdout?.toString("utf8") ?? "";
  const stderr = result.stderr?.toString("utf8") ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  writeFileSync(
    path.join(reportsDir, "module-coverage-test-run.log"),
    `Node: ${process.version}\nVitest: ${manifest.measurement.vitestVersion}\nTracked production source paths: ${sourcePaths.length}\nExit status: ${result.status ?? "unknown"}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    "utf8",
  );
  if (result.status !== 0) throw new Error(`Related module unit tests or V8 coverage failed (exit ${result.status ?? "unknown"}).`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function runModuleCoverageGate(argv = process.argv.slice(2)) {
  const { manifest: manifestPath, reportsDir: reportsDirInput } = parseArgs(argv);
  const manifest = validateModuleCoverageManifest(JSON.parse(readFileSync(path.join(REPO_ROOT, manifestPath), "utf8")));
  assertSupportedRuntime(manifest.measurement.vitestVersion);
  assertBaselineIsAncestor(manifest.baselineSha);
  assertCandidateInputsAreCommitted(manifestPath, manifest.sourceRoots);
  const baselineInventory = frozenSourceInventory(manifest);

  const candidateSha = gitOutput(["rev-parse", "HEAD"]);
  const sourcePaths = trackedSourcePaths(manifest);
  const reportsDir = prepareReportsDirectory(reportsDirInput);
  runRelatedCoverage(manifest, sourcePaths, reportsDir);

  const summaryPath = path.join(reportsDir, "coverage-summary.json");
  if (!existsSync(summaryPath)) throw new Error(`Vitest did not emit ${summaryPath}.`);
  const summaryBytes = readFileSync(summaryPath);
  const coverageSummary = JSON.parse(summaryBytes.toString("utf8"));
  const verification = verifyModuleCoverage({
    manifest,
    coverageSummary,
    trackedPaths: sourcePaths,
    repoRoot: REPO_ROOT,
  });
  const manifestBytes = readFileSync(path.join(REPO_ROOT, manifestPath));
  const evidence = {
    verdict: "PASS",
    candidateSha,
    baselineSha: manifest.baselineSha,
    node: process.version,
    vitest: manifest.measurement.vitestVersion,
    provider: manifest.measurement.provider,
    sourcePaths: sourcePaths.length,
    ...baselineInventory,
    ...verification,
    manifestSha256: sha256(manifestBytes),
    coverageSummarySha256: sha256(summaryBytes),
    coverageSummaryPath: path.relative(REPO_ROOT, summaryPath).replaceAll("\\", "/"),
  };
  writeFileSync(path.join(reportsDir, "module-coverage-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`MODULE_COVERAGE_GATE ${JSON.stringify(evidence)}`);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runModuleCoverageGate();
  } catch (error) {
    console.error(`MODULE_COVERAGE_GATE FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

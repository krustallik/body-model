import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UNIT_COVERAGE_INCLUDE, UNIT_COVERAGE_THRESHOLDS } from "./coverage-scopes.mjs";
import {
  filterModuleCoverageSourcePaths,
  validateModuleCoverageManifest,
  validateModuleCoverageRelativePath,
  verifyFrozenModuleCoverageInventory,
  verifyGlobalCoverage,
  verifyModuleCoverage,
} from "./module-coverage-core.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = "tests/refactor-comparator/module-coverage-v1.json";
const DEFAULT_SUMMARY = "coverage/coverage-summary.json";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--manifest", "--reports-dir", "--coverage-summary"].includes(flag)) throw new Error(`Unknown module coverage argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate module coverage argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value);
    index += 1;
  }
  const manifest = values.get("--manifest") ?? DEFAULT_MANIFEST;
  const reportsDir = values.get("--reports-dir");
  const coverageSummary = values.get("--coverage-summary") ?? DEFAULT_SUMMARY;
  if (!reportsDir) throw new Error("Required: --reports-dir <path>.");
  validateModuleCoverageRelativePath(manifest, "--manifest");
  validateModuleCoverageRelativePath(reportsDir, "--reports-dir");
  validateModuleCoverageRelativePath(coverageSummary, "--coverage-summary");
  return { manifest, reportsDir, coverageSummary };
}

function gitOutput(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitBytes(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString("utf8")}`);
  return result.stdout;
}

function trackedPaths(roots) {
  return gitBytes(["ls-files", "-z", "--", ...roots]).toString("utf8").split("\0").filter(Boolean);
}

function baselineInventory(manifest) {
  const paths = gitBytes(["ls-tree", "-r", "--name-only", "-z", manifest.baselineSha, "--", ...manifest.sourceRoots])
    .toString("utf8").split("\0").filter(Boolean);
  return verifyFrozenModuleCoverageInventory({ manifest, baselinePaths: paths });
}

function assertBaselineIsAncestor(baselineSha) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", baselineSha, "HEAD"], {
    cwd: REPO_ROOT, windowsHide: true, stdio: "ignore",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Current HEAD is not a descendant of coverage baseline ${baselineSha}.`);
}

function assertCommittedCandidate() {
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
  if (status) throw new Error(`Coverage gate requires a clean committed worktree:\n${status}`);
}

function assertExcludedPathsUnchanged(manifest) {
  const paths = manifest.excludedPaths.map((entry) => entry.path);
  if (paths.length === 0) return;
  const result = spawnSync("git", ["diff", "--quiet", manifest.baselineSha, "HEAD", "--", ...paths], {
    cwd: REPO_ROOT, windowsHide: true, stdio: "ignore",
  });
  if (result.error) throw result.error;
  if (result.status === 1) throw new Error("An excluded module path changed; review its behavior and update the coverage baseline explicitly.");
  if (result.status !== 0) throw new Error("Could not verify excluded module paths against the coverage baseline.");
}

function prepareEvidenceDirectory(reportsDir) {
  const absolute = path.join(REPO_ROOT, reportsDir);
  if (existsSync(absolute)) throw new Error(`Coverage evidence directory already exists: ${reportsDir}.`);
  mkdirSync(absolute, { recursive: true });
  return absolute;
}

export function runModuleCoverageGate(argv = process.argv.slice(2)) {
  const { manifest: manifestPath, reportsDir, coverageSummary: summaryPath } = parseArgs(argv);
  const manifest = validateModuleCoverageManifest(JSON.parse(readFileSync(path.join(REPO_ROOT, manifestPath), "utf8")));
  assertBaselineIsAncestor(manifest.baselineSha);
  assertCommittedCandidate();
  const frozenInventory = baselineInventory(manifest);
  const trackedModulePaths = trackedPaths(manifest.sourceRoots);
  const modulePaths = filterModuleCoverageSourcePaths(trackedModulePaths, manifest);
  const globalPaths = trackedPaths(["src"]);
  const coverageSummary = JSON.parse(readFileSync(path.join(REPO_ROOT, summaryPath), "utf8"));
  const global = verifyGlobalCoverage({
    coverageSummary,
    trackedPaths: globalPaths,
    includePatterns: UNIT_COVERAGE_INCLUDE,
    excludedPaths: ["src/modules/health/health.types.ts"],
    thresholds: UNIT_COVERAGE_THRESHOLDS,
    repoRoot: REPO_ROOT,
  });
  const moduleResult = verifyModuleCoverage({
    manifest,
    coverageSummary,
    trackedPaths: trackedModulePaths,
    repoRoot: REPO_ROOT,
  });
  assertExcludedPathsUnchanged(manifest);
  const evidence = {
    verdict: "PASS",
    candidateSha: gitOutput(["rev-parse", "HEAD"]),
    baselineSha: manifest.baselineSha,
    coverageSummaryPath: summaryPath,
    globalCoverage: global,
    moduleCoverage: { ...moduleResult, excludedFilesChecked: manifest.excludedPaths.length },
    baselineSourceFilesChecked: frozenInventory.baselineSourceFilesChecked,
    moduleSourceFiles: modulePaths.length,
  };
  const evidenceDir = prepareEvidenceDirectory(reportsDir);
  writeFileSync(path.join(evidenceDir, "module-coverage-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
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

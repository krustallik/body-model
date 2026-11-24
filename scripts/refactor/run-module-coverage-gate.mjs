import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertRepeatedModuleCoverageMatches,
  filterModuleCoverageSourcePaths,
  validateModuleCoverageManifest,
  validateModuleCoverageRelativePath,
  validateModuleCoverageTestPath,
  verifyFrozenModuleCoverageInventory,
  verifyFrozenExcludedPathBlobs,
  verifyModuleCoverage,
  verifyPinnedModuleCoverageManifest,
} from "./module-coverage-core.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = "tests/refactor-comparator/module-coverage-v1.json";
const VITEST_ENTRY = "node_modules/vitest/vitest.mjs";
const TEST_DATABASE_URL = "postgresql://bodycast_module_coverage_test:unit-only@bodycast-module-coverage-db.invalid:59999/bodycast_module_coverage_test";
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

function gitBytes(args) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString("utf8")}`);
  return result.stdout;
}

function trackedSourcePaths(manifest) {
  const paths = gitBytes(["ls-files", "-z", "--", ...manifest.sourceRoots]).toString("utf8").split("\0").filter(Boolean);
  return filterModuleCoverageSourcePaths(paths, manifest);
}

function frozenSourceInventory(manifest) {
  const baselinePaths = gitBytes([
    "ls-tree", "-r", "--name-only", "-z", manifest.baselineSha, "--", ...manifest.sourceRoots,
  ]).toString("utf8").split("\0").filter(Boolean);
  const baselineBlobShas = {};
  for (const entry of [...manifest.files, ...manifest.excludedPaths]) {
    baselineBlobShas[entry.path] = gitOutput(["rev-parse", `${manifest.baselineSha}:${entry.path}`]);
  }
  return verifyFrozenModuleCoverageInventory({ manifest, baselinePaths, baselineBlobShas });
}

function trackedTestBlobShas() {
  const entries = gitBytes(["ls-files", "-s", "-z"]).toString("utf8").split("\0").filter(Boolean);
  const blobShas = new Map();
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    if (tab < 0) throw new Error("git ls-files returned a malformed test entry.");
    const [, blobSha, stage] = entry.slice(0, tab).split(" ");
    if (stage !== "0") throw new Error(`Test input has an unmerged index entry: ${entry.slice(tab + 1)}.`);
    const filePath = entry.slice(tab + 1).replaceAll("\\", "/");
    if (/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i.test(filePath)) blobShas.set(filePath, blobSha);
  }
  return blobShas;
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

function assertCandidateInputsAreCommitted() {
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
  if (status) throw new Error(`Module coverage requires a clean committed worktree so every imported input is bound to HEAD:\n${status}`);
}

function frozenExcludedCandidateBlobs(manifest, candidateSha) {
  const candidateBlobShas = {};
  for (const entry of manifest.excludedPaths) {
    try {
      candidateBlobShas[entry.path] = gitOutput(["rev-parse", `${candidateSha}:${entry.path}`]);
    } catch {
      throw new Error(`Frozen excluded path is missing from the candidate tree: ${entry.path}.`);
    }
  }
  return verifyFrozenExcludedPathBlobs({ manifest, candidateBlobShas });
}

function assertSupportedRuntime(measurement) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== 24) throw new Error(`Module coverage requires Node 24; received ${process.versions.node}.`);
  if (process.version !== measurement.nodeVersion || process.versions.v8 !== measurement.v8Version) {
    throw new Error(`Module coverage requires ${measurement.nodeVersion} / V8 ${measurement.v8Version}; received ${process.version} / V8 ${process.versions.v8}.`);
  }
  const vitestPackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "node_modules/vitest/package.json"), "utf8"));
  if (vitestPackage.version !== measurement.vitestVersion) {
    throw new Error(`Module coverage expects Vitest ${measurement.vitestVersion}; received ${vitestPackage.version}.`);
  }
  const providerPackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "node_modules/@vitest/coverage-istanbul/package.json"), "utf8"));
  if (providerPackage.version !== measurement.coverageProviderVersion) {
    throw new Error(`Module coverage expects @vitest/coverage-istanbul ${measurement.coverageProviderVersion}; received ${providerPackage.version}.`);
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

function parseVitestConsoleCount(stdout, label) {
  const line = stdout.split(/\r?\n/).find((candidate) => new RegExp(`^\\s*${label}\\b`).test(candidate));
  if (!line) throw new Error(`Vitest output did not include its ${label} summary.`);
  const total = /\((\d+)\)\s*$/.exec(line);
  if (!total) throw new Error(`Vitest ${label} summary has no total count: ${line.trim()}`);
  const counts = { passed: 0, failed: 0, skipped: 0, pending: 0, todo: 0 };
  for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped|pending|todo)\b/g)) {
    counts[match[2]] = Number(match[1]);
  }
  const expectedTotal = Number(total[1]);
  if (counts.passed !== expectedTotal
    || counts.failed !== 0 || counts.skipped !== 0 || counts.pending !== 0 || counts.todo !== 0) {
    throw new Error(`Vitest ${label} summary must be fully passing with no skipped or pending tests: ${line.trim()}`);
  }
  return { total: expectedTotal, passed: counts.passed };
}

function normalizeTestPath(testPath) {
  if (typeof testPath !== "string" || testPath.length === 0) throw new Error("Vitest reported an invalid test path.");
  const absolutePath = path.isAbsolute(testPath) ? path.resolve(testPath) : path.resolve(REPO_ROOT, testPath);
  const relative = path.relative(REPO_ROOT, absolutePath);
  if (relative === "" || relative === "." || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Vitest test path is outside the repository: ${testPath}`);
  }
  const normalized = relative.replaceAll("\\", "/");
  try {
    return validateModuleCoverageTestPath(normalized);
  } catch {
    throw new Error(`Related Vitest selection included a non-test input: ${normalized}`);
  }
}

function summarizeTestReport(testReport, stdout, testBlobShas) {
  if (!testReport || typeof testReport !== "object" || testReport.success !== true || !Array.isArray(testReport.testResults)) {
    throw new Error("Vitest did not produce a successful JSON test report.");
  }
  for (const field of ["numTotalTestSuites", "numPassedTestSuites", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"]) {
    if (!Number.isSafeInteger(testReport[field]) || testReport[field] < 0) throw new Error(`Vitest JSON report has an invalid ${field}.`);
  }
  if (testReport.numFailedTestSuites !== 0 || testReport.numFailedTests !== 0
    || testReport.numPendingTestSuites !== 0 || testReport.numPendingTests !== 0 || testReport.numTodoTests !== 0
    || testReport.numPassedTestSuites !== testReport.numTotalTestSuites
    || testReport.numPassedTests !== testReport.numTotalTests) {
    throw new Error("Vitest JSON report must contain only passing test files and test cases.");
  }

  const consoleFiles = parseVitestConsoleCount(stdout, "Test Files");
  const consoleTests = parseVitestConsoleCount(stdout, "Tests");
  if (consoleFiles.total !== testReport.testResults.length || consoleTests.total !== testReport.numTotalTests) {
    throw new Error("Vitest console summary and JSON test report counts do not match.");
  }

  const selectedTests = testReport.testResults.map((result) => {
    const testPath = normalizeTestPath(result.name);
    const gitBlobSha = testBlobShas.get(testPath);
    if (!gitBlobSha) throw new Error(`Selected test input is not tracked at HEAD: ${testPath}`);
    if (result.status !== "passed" || !Array.isArray(result.assertionResults)) {
      throw new Error(`Selected test file did not pass or has no assertion results: ${testPath}`);
    }
    const cases = result.assertionResults.map((assertion) => {
      if (assertion.status !== "passed" || typeof assertion.fullName !== "string") {
        throw new Error(`Selected test case did not pass in ${testPath}.`);
      }
      return { fullName: assertion.fullName, status: assertion.status };
    }).sort((left, right) => left.fullName.localeCompare(right.fullName));
    return { path: testPath, gitBlobSha, cases };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const assertionCount = selectedTests.reduce((total, result) => total + result.cases.length, 0);
  if (assertionCount !== testReport.numTotalTests) throw new Error("Vitest selected test case count does not match its JSON report.");
  const testInputFingerprint = sha256(JSON.stringify(selectedTests.map(({ path: testPath, gitBlobSha }) => ({ path: testPath, gitBlobSha }))));
  const testSelectionFingerprint = sha256(JSON.stringify(selectedTests));
  return {
    testFileCount: consoleFiles.passed,
    testsPassed: consoleTests.passed,
    selectedTests,
    testInputFingerprint,
    testSelectionFingerprint,
  };
}

function runRelatedCoverage(manifest, sourcePaths, reportsDir, testBlobShas) {
  if (sourcePaths.length === 0) throw new Error("No tracked production source paths were found for module coverage.");
  if (!existsSync(path.join(REPO_ROOT, VITEST_ENTRY))) throw new Error("Locked Vitest runner is not installed.");

  const testReportPath = path.join(reportsDir, "vitest-results.json");
  const args = [VITEST_ENTRY, "related", ...sourcePaths];
  for (const sourcePath of sourcePaths) args.push(`--coverage.include=${sourcePath}`);
  args.push(
    "--coverage.enabled",
    "--coverage.all",
    "--coverage.provider=istanbul",
    `--coverage.reportsDirectory=${reportsDir}`,
    "--coverage.reporter=json-summary",
    "--coverage.thresholds.lines=0",
    "--coverage.thresholds.functions=0",
    "--coverage.thresholds.statements=0",
    "--coverage.thresholds.branches=0",
    "--reporter=dot",
    "--reporter=json",
    `--outputFile.json=${testReportPath}`,
    "--silent=passed-only",
    "--no-color",
    `--maxWorkers=${manifest.measurement.maxWorkers}`,
    `--minWorkers=${manifest.measurement.minWorkers}`,
  );
  const inheritedEnvNames = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]);
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => inheritedEnvNames.has(name.toUpperCase()))
    .map(([name, value]) => [name.toUpperCase(), value]));
  Object.assign(env, {
    CI: "1",
    NODE_ENV: "test",
    TZ: "UTC",
    DATABASE_URL: TEST_DATABASE_URL,
    IOS_SHORTCUT_API_KEY: TEST_API_KEY,
    BODYCAST_REQUIRE_POSTGRES_STORAGE_CONTAINER_TEST: "0",
    BODYCAST_TEST_DATABASE_URL: TEST_DATABASE_URL,
    BODYCAST_RECOVERY_TEST_DATABASE_URL: TEST_DATABASE_URL,
    BODYCAST_GLYCOGEN_TEST_DATABASE_URL: TEST_DATABASE_URL,
    PGHOST: "bodycast-module-coverage-db.invalid",
    PGPORT: "59999",
    PGDATABASE: "bodycast_module_coverage_test",
    PGUSER: "bodycast_module_coverage_test",
    PGPASSWORD: "unit-only",
    PGSERVICE: "bodycast-module-coverage-no-service",
  });
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
  const logBytes = Buffer.from(
    `Node: ${process.version}\nV8: ${process.versions.v8}\nVitest: ${manifest.measurement.vitestVersion}\nProvider: Istanbul ${manifest.measurement.coverageProviderVersion}\nWorkers: ${manifest.measurement.maxWorkers}/${manifest.measurement.minWorkers}\nTracked production source paths: ${sourcePaths.length}\nDatabase sentinel: .invalid hostname; PostgreSQL containers disabled\nExit status: ${result.status ?? "unknown"}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    "utf8",
  );
  writeFileSync(path.join(reportsDir, "module-coverage-test-run.log"), logBytes);
  if (result.status !== 0) throw new Error(`Related module unit tests or Istanbul coverage failed (exit ${result.status ?? "unknown"}).`);

  const summaryPath = path.join(reportsDir, "coverage-summary.json");
  if (!existsSync(summaryPath)) throw new Error(`Vitest did not emit ${summaryPath}.`);
  if (!existsSync(testReportPath)) throw new Error(`Vitest did not emit ${testReportPath}.`);
  const coverageSummaryBytes = readFileSync(summaryPath);
  const testReportBytes = readFileSync(testReportPath);
  const testCounts = summarizeTestReport(JSON.parse(testReportBytes.toString("utf8")), stdout, testBlobShas);
  return {
    coverageSummary: JSON.parse(coverageSummaryBytes.toString("utf8")),
    coverageSummaryBytes,
    coverageSummaryPath: path.relative(REPO_ROOT, summaryPath).replaceAll("\\", "/"),
    testReportBytes,
    testReportPath: path.relative(REPO_ROOT, testReportPath).replaceAll("\\", "/"),
    testLogBytes: logBytes,
    testLogPath: path.relative(REPO_ROOT, path.join(reportsDir, "module-coverage-test-run.log")).replaceAll("\\", "/"),
    ...testCounts,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertRepeatedTestInputsMatch(first, second) {
  if (first.testFileCount !== second.testFileCount || first.testsPassed !== second.testsPassed
    || first.testInputFingerprint !== second.testInputFingerprint
    || first.testSelectionFingerprint !== second.testSelectionFingerprint) {
    throw new Error("Repeated related test runs did not use the same committed test inputs and passing cases.");
  }
}

function evidenceForRun(run, index) {
  return {
    run: index + 1,
    coverageSummaryPath: run.coverageSummaryPath,
    coverageSummarySha256: sha256(run.coverageSummaryBytes),
    testReportPath: run.testReportPath,
    testReportSha256: sha256(run.testReportBytes),
    testLogPath: run.testLogPath,
    testLogSha256: sha256(run.testLogBytes),
    testFileCount: run.testFileCount,
    testsPassed: run.testsPassed,
    testInputFingerprint: run.testInputFingerprint,
    testSelectionFingerprint: run.testSelectionFingerprint,
  };
}

export function runModuleCoverageGate(argv = process.argv.slice(2)) {
  const { manifest: manifestPath, reportsDir: reportsDirInput } = parseArgs(argv);
  const manifestPathAbsolute = path.join(REPO_ROOT, manifestPath);
  const manifestBytes = readFileSync(manifestPathAbsolute);
  const manifestSha256 = verifyPinnedModuleCoverageManifest(manifestBytes);
  const manifest = validateModuleCoverageManifest(JSON.parse(manifestBytes.toString("utf8")));
  assertSupportedRuntime(manifest.measurement);
  assertBaselineIsAncestor(manifest.baselineSha);
  assertCandidateInputsAreCommitted();
  const baselineInventory = frozenSourceInventory(manifest);

  const candidateSha = gitOutput(["rev-parse", "HEAD"]);
  const excludedInventory = frozenExcludedCandidateBlobs(manifest, candidateSha);
  const sourcePaths = trackedSourcePaths(manifest);
  const testBlobShas = trackedTestBlobShas();
  const reportsRoot = prepareReportsDirectory(reportsDirInput);
  const runDirectories = [1, 2].map((index) => {
    const directory = path.join(reportsRoot, `run-${index}`);
    mkdirSync(directory);
    return directory;
  });
  const runs = runDirectories.map((directory) => runRelatedCoverage(manifest, sourcePaths, directory, testBlobShas));

  if (gitOutput(["rev-parse", "HEAD"]) !== candidateSha) throw new Error("Candidate HEAD changed during repeated module coverage verification.");
  assertCandidateInputsAreCommitted();
  const repeatComparison = assertRepeatedModuleCoverageMatches({
    firstSummary: runs[0].coverageSummary,
    secondSummary: runs[1].coverageSummary,
    repoRoot: REPO_ROOT,
  });
  assertRepeatedTestInputsMatch(runs[0], runs[1]);

  const verification = verifyModuleCoverage({
    manifest,
    coverageSummary: runs[0].coverageSummary,
    trackedPaths: sourcePaths,
    repoRoot: REPO_ROOT,
  });
  const evidence = {
    verdict: "PASS",
    candidateSha,
    baselineSha: manifest.baselineSha,
    node: process.version,
    v8: process.versions.v8,
    vitest: manifest.measurement.vitestVersion,
    provider: manifest.measurement.provider,
    providerVersion: manifest.measurement.coverageProviderVersion,
    sourcePaths: sourcePaths.length,
    ...baselineInventory,
    ...excludedInventory,
    ...verification,
    repeatedCoverageComparison: repeatComparison,
    repeatedTestInputsMatch: true,
    baselineTestInputFingerprint: manifest.measurement.baselineTestInputFingerprintSha256,
    baselineTestSelectionFingerprint: manifest.measurement.baselineTestSelectionFingerprintSha256,
    manifestSha256,
    runs: runs.map(evidenceForRun),
    selectedTestInputs: runs[0].selectedTests.map(({ path: testPath, gitBlobSha }) => ({ path: testPath, gitBlobSha })),
  };
  writeFileSync(path.join(reportsRoot, "module-coverage-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
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

import { createHash } from "node:crypto";
import path from "node:path";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
export const EXPECTED_MODULE_COVERAGE_MANIFEST_SHA256 = "472213cd749705cdaecade5d557bd0e84e7347e9c1479b23fb0a84f1713703b4";
const METRICS = Object.freeze(["lines", "functions", "statements", "branches"]);
const NEW_FILE_FLOORS = Object.freeze({ lines: 85, functions: 85, statements: 85, branches: 80 });
const SOURCE_EXTENSION_PATTERN = /\.(?:ts|tsx|js|jsx)$/i;
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__|tests|fixtures?)(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/i;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates.`);
}

export function validateModuleCoverageRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} must be a repository-relative POSIX path.`);
  }
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must not escape the repository root.`);
  }
  return value;
}

export function validateModuleCoverageTestPath(value, label = "Vitest test path") {
  const testPath = validateModuleCoverageRelativePath(value, label);
  if (!/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i.test(testPath)) {
    throw new Error(`${label} is not a Vitest test file: ${testPath}`);
  }
  return testPath;
}

function isWithinRoots(filePath, roots) {
  return roots.some((root) => filePath.startsWith(`${root}/`));
}

function validateCoverageMetric(value, label) {
  requireObject(value, label);
  for (const field of ["covered", "total"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`${label}.${field} must be a non-negative safe integer.`);
    }
  }
  if (value.covered > value.total) throw new Error(`${label}.covered cannot exceed total.`);
  const expectedPct = value.total === 0 ? 100 : Number(((value.covered / value.total) * 100).toFixed(2));
  // The reporter rounds percentages; covered/total remain the authoritative counts.
  if (!Number.isFinite(value.pct) || value.pct < 0 || value.pct > 100 || Math.abs(value.pct - expectedPct) > 0.02) {
    throw new Error(`${label}.pct does not match its covered/total counts.`);
  }
}

export function verifyPinnedModuleCoverageManifest(bytes) {
  if (typeof bytes !== "string" && !(bytes instanceof Uint8Array)) {
    throw new TypeError("Module coverage manifest bytes must be a string or Uint8Array.");
  }
  const text = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
  const actual = createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
  if (actual !== EXPECTED_MODULE_COVERAGE_MANIFEST_SHA256) {
    throw new Error(`Module coverage manifest SHA-256 ${actual} does not match the reviewed pin.`);
  }
  return actual;
}

export function validateModuleCoverageManifest(value) {
  requireObject(value, "Module coverage manifest");
  if (value.schemaVersion !== 1) throw new Error("Unsupported module coverage manifest schema.");
  if (!SHA_PATTERN.test(value.baselineSha ?? "")) throw new Error("Module coverage baseline SHA is invalid.");
  requireObject(value.measurement, "measurement");
  if (value.measurement.provider !== "v8" || value.measurement.selection !== "related" || value.measurement.nodeMajor !== 24) {
    throw new Error("Module coverage measurement must use the reviewed Vitest V8 related profile on Node 24.");
  }
  if (!/^v24\.\d+\.\d+$/.test(value.measurement.nodeVersion ?? "")
    || typeof value.measurement.v8Version !== "string" || !/^\d+(?:\.\d+){2,3}-node\.\d+$/.test(value.measurement.v8Version)) {
    throw new Error("Module coverage measurement Node and V8 versions are invalid.");
  }
  if (value.measurement.profile !== "exact-tracked-paths-v8-ast-aware-single-worker-v1"
    || value.measurement.coverageAll !== true
    || value.measurement.ci !== true
    || value.measurement.nodeEnv !== "test"
    || value.measurement.maxWorkers !== 1
    || value.measurement.minWorkers !== 1) {
    throw new Error("Module coverage measurement must match the pinned exact-path V8 AST-aware CI profile.");
  }
  if (typeof value.measurement.vitestVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(value.measurement.vitestVersion)) {
    throw new Error("Module coverage Vitest version is invalid.");
  }
  if (typeof value.measurement.coverageProviderVersion !== "string"
    || !/^\d+\.\d+\.\d+$/.test(value.measurement.coverageProviderVersion)) {
    throw new Error("Module coverage provider version is invalid.");
  }
  for (const field of [
    "reportSha256",
    "logSha256",
    "confirmationReportSha256",
    "confirmationLogSha256",
    "baselineTestInputFingerprintSha256",
    "baselineTestSelectionFingerprintSha256",
  ]) {
    if (!/^[a-f0-9]{64}$/i.test(value.measurement[field] ?? "")) {
      throw new Error(`Module coverage measurement ${field} is invalid.`);
    }
  }
  if (value.measurement.confirmationReportSha256 !== value.measurement.reportSha256
    || value.measurement.repeatedRunCount !== 2) {
    throw new Error("Module coverage baseline must have two byte-identical confirmation reports.");
  }
  for (const field of ["sourceFileCount", "testFileCount", "testsPassed"]) {
    if (!Number.isSafeInteger(value.measurement[field]) || value.measurement[field] < 0) {
      throw new Error(`Module coverage measurement ${field} must be a non-negative safe integer.`);
    }
  }
  if (!Array.isArray(value.sourceRoots) || value.sourceRoots.length === 0) {
    throw new Error("Module coverage sourceRoots must be a non-empty array.");
  }
  const sourceRoots = value.sourceRoots.map((root, index) =>
    validateModuleCoverageRelativePath(root, `sourceRoots[${index}]`));
  requireUnique(sourceRoots, "sourceRoots");
  if (sourceRoots.some((root, index) => sourceRoots.some((other, otherIndex) =>
    index !== otherIndex && root.startsWith(`${other}/`)))) {
    throw new Error("sourceRoots must not overlap.");
  }

  requireObject(value.minimumForNewFiles, "minimumForNewFiles");
  for (const metric of METRICS) {
    if (value.minimumForNewFiles[metric] !== NEW_FILE_FLOORS[metric]) {
      throw new Error(`minimumForNewFiles.${metric} must remain ${NEW_FILE_FLOORS[metric]}.`);
    }
  }

  if (!Array.isArray(value.excludedPaths)) throw new Error("excludedPaths must be an array.");
  const excludedPaths = value.excludedPaths.map((entry, index) => {
    requireObject(entry, `excludedPaths[${index}]`);
    const filePath = validateModuleCoverageRelativePath(entry.path, `excludedPaths[${index}].path`);
    if (!isWithinRoots(filePath, sourceRoots)) throw new Error(`Excluded path is outside sourceRoots: ${filePath}`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 8) {
      throw new Error(`excludedPaths[${index}].reason must explain the exclusion.`);
    }
    if (!SHA_PATTERN.test(entry.gitBlobSha ?? "")) throw new Error(`Invalid baseline Git blob SHA for excluded path ${filePath}.`);
    return filePath;
  });
  requireUnique(excludedPaths, "excludedPaths");
  const sortedExcludedPaths = [...excludedPaths].sort();
  if (excludedPaths.some((filePath, index) => filePath !== sortedExcludedPaths[index])) {
    throw new Error("excludedPaths must be sorted lexically.");
  }
  if (excludedPaths.some((filePath) => !isEligibleSourcePath(filePath, sourceRoots))) {
    throw new Error("Excluded paths must otherwise qualify as executable source files.");
  }

  if (!Array.isArray(value.files) || value.files.length === 0) throw new Error("files must be a non-empty array.");
  const filePaths = value.files.map((entry, index) => {
    requireObject(entry, `files[${index}]`);
    const filePath = validateModuleCoverageRelativePath(entry.path, `files[${index}].path`);
    if (!isWithinRoots(filePath, sourceRoots)) throw new Error(`Baseline path is outside sourceRoots: ${filePath}`);
    if (excludedPaths.includes(filePath)) throw new Error(`Baseline path is also excluded: ${filePath}`);
    if (!SHA_PATTERN.test(entry.gitBlobSha ?? "")) throw new Error(`Invalid baseline Git blob SHA for ${filePath}.`);
    requireObject(entry.baseline, `files[${index}].baseline`);
    for (const metric of METRICS) validateCoverageMetric(entry.baseline[metric], `${filePath}.${metric}`);
    return filePath;
  });
  requireUnique(filePaths, "Baseline file paths");
  const sortedFilePaths = [...filePaths].sort();
  if (filePaths.some((filePath, index) => filePath !== sortedFilePaths[index])) {
    throw new Error("Baseline file paths must be sorted lexically.");
  }
  if (value.measurement.sourceFileCount !== filePaths.length) {
    throw new Error("measurement.sourceFileCount must match the frozen per-file baseline count.");
  }

  if (!Array.isArray(value.pathMoves)) throw new Error("pathMoves must be an array.");
  const moveSources = [];
  const moveTargets = [];
  for (const [index, move] of value.pathMoves.entries()) {
    requireObject(move, `pathMoves[${index}]`);
    const from = validateModuleCoverageRelativePath(move.from, `pathMoves[${index}].from`);
    const to = validateModuleCoverageRelativePath(move.to, `pathMoves[${index}].to`);
    if (!filePaths.includes(from)) throw new Error(`Path move source is not a frozen baseline file: ${from}`);
    if (!isWithinRoots(to, sourceRoots) || excludedPaths.includes(to)) {
      throw new Error(`Path move target is outside the eligible source inventory: ${to}`);
    }
    if (filePaths.includes(to)) throw new Error(`Path move target is already a baseline file: ${to}`);
    moveSources.push(from);
    moveTargets.push(to);
  }
  requireUnique(moveSources, "Path move sources");
  requireUnique(moveTargets, "Path move targets");
  const sortedMoves = [...value.pathMoves].sort((left, right) => left.from.localeCompare(right.from));
  if (value.pathMoves.some((move, index) => move.from !== sortedMoves[index].from)) {
    throw new Error("pathMoves must be sorted by source path.");
  }

  return value;
}

export function normalizeModuleCoverageReportPath(value, repoRoot) {
  if (typeof value !== "string" || value.length === 0) throw new Error("Coverage report contains an invalid file path.");
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new Error("Repository root is required to normalize coverage paths.");

  let relative;
  if (path.win32.isAbsolute(value)) {
    if (!path.win32.isAbsolute(repoRoot)) throw new Error(`Coverage path uses a different path style: ${value}`);
    relative = path.win32.relative(path.win32.normalize(repoRoot), path.win32.normalize(value));
  } else if (path.posix.isAbsolute(value)) {
    if (!path.posix.isAbsolute(repoRoot)) throw new Error(`Coverage path uses a different path style: ${value}`);
    relative = path.posix.relative(path.posix.normalize(repoRoot), path.posix.normalize(value));
  } else {
    relative = value;
  }
  if (relative === "" || relative === "." || relative === ".." || relative.startsWith("../")
    || relative.startsWith("..\\") || path.win32.isAbsolute(relative)) {
    throw new Error(`Coverage path is outside the repository root: ${value}`);
  }
  return validateModuleCoverageRelativePath(relative.replaceAll("\\", "/"), "Coverage report path");
}

function normalizeCoverageSummary(summary, repoRoot) {
  requireObject(summary, "Coverage summary");
  const normalized = new Map();
  for (const [rawPath, metrics] of Object.entries(summary)) {
    if (rawPath === "total") continue;
    const filePath = normalizeModuleCoverageReportPath(rawPath, repoRoot);
    if (normalized.has(filePath)) throw new Error(`Coverage summary repeats normalized path ${filePath}.`);
    requireObject(metrics, `Coverage summary for ${filePath}`);
    for (const metric of METRICS) validateCoverageMetric(metrics[metric], `${filePath}.${metric}`);
    normalized.set(filePath, metrics);
  }
  return normalized;
}

export function assertRepeatedModuleCoverageMatches({ firstSummary, secondSummary, repoRoot }) {
  const first = normalizeCoverageSummary(firstSummary, repoRoot);
  const second = normalizeCoverageSummary(secondSummary, repoRoot);
  const firstPaths = [...first.keys()].sort();
  const secondPaths = [...second.keys()].sort();
  if (firstPaths.length !== secondPaths.length
    || firstPaths.some((filePath, index) => filePath !== secondPaths[index])) {
    const missingFromSecond = firstPaths.filter((filePath) => !second.has(filePath));
    const unexpectedInSecond = secondPaths.filter((filePath) => !first.has(filePath));
    throw new Error(`Repeated module coverage path set differs; missingFromSecond=${missingFromSecond.join(",") || "none"}; unexpectedInSecond=${unexpectedInSecond.join(",") || "none"}.`);
  }

  for (const filePath of firstPaths) {
    for (const metric of METRICS) {
      const left = first.get(filePath)[metric];
      const right = second.get(filePath)[metric];
      if (left.covered !== right.covered || left.total !== right.total) {
        throw new Error(`Repeated module coverage differs for ${filePath} ${metric}: ${left.covered}/${left.total} vs ${right.covered}/${right.total}.`);
      }
    }
  }
  return { filesCompared: firstPaths.length };
}

function isEligibleSourcePath(filePath, roots) {
  return isWithinRoots(filePath, roots)
    && SOURCE_EXTENSION_PATTERN.test(filePath)
    && !filePath.endsWith(".d.ts")
    && !TEST_FILE_PATTERN.test(filePath);
}

export function filterModuleCoverageSourcePaths(paths, manifest) {
  validateModuleCoverageManifest(manifest);
  if (!Array.isArray(paths)) throw new Error("Source paths must be an array.");
  const excludedPaths = new Set(manifest.excludedPaths.map((entry) => entry.path));
  const eligible = paths.map((filePath, index) =>
    validateModuleCoverageRelativePath(filePath, `sourcePaths[${index}]`))
    .filter((filePath) => isEligibleSourcePath(filePath, manifest.sourceRoots) && !excludedPaths.has(filePath));
  requireUnique(eligible, "Eligible source paths");
  return eligible.sort();
}

export function verifyFrozenModuleCoverageInventory({ manifest, baselinePaths, baselineBlobShas }) {
  validateModuleCoverageManifest(manifest);
  if (!Array.isArray(baselinePaths)) throw new Error("baselinePaths must be the source inventory from the frozen Git tree.");
  if (!baselineBlobShas || typeof baselineBlobShas !== "object" || Array.isArray(baselineBlobShas)) {
    throw new Error("baselineBlobShas must map frozen paths to Git blob SHAs.");
  }

  const eligibleBaselinePaths = filterModuleCoverageSourcePaths(baselinePaths, { ...manifest, excludedPaths: [] });
  const manifestPaths = [
    ...manifest.files.map((entry) => entry.path),
    ...manifest.excludedPaths.map((entry) => entry.path),
  ].sort();
  if (eligibleBaselinePaths.length !== manifestPaths.length
    || eligibleBaselinePaths.some((filePath, index) => filePath !== manifestPaths[index])) {
    const missingFromManifest = eligibleBaselinePaths.filter((filePath) => !manifestPaths.includes(filePath));
    const absentFromBaseline = manifestPaths.filter((filePath) => !eligibleBaselinePaths.includes(filePath));
    throw new Error(`Frozen source inventory mismatch; missingFromManifest=${missingFromManifest.join(",") || "none"}; absentFromBaseline=${absentFromBaseline.join(",") || "none"}.`);
  }

  for (const entry of [...manifest.files, ...manifest.excludedPaths]) {
    if (baselineBlobShas[entry.path] !== entry.gitBlobSha) {
      throw new Error(`Frozen Git blob identity changed for ${entry.path}.`);
    }
  }
  return { baselineSourceFilesChecked: eligibleBaselinePaths.length, baselineBlobFilesChecked: manifestPaths.length };
}

export function verifyFrozenExcludedPathBlobs({ manifest, candidateBlobShas }) {
  validateModuleCoverageManifest(manifest);
  if (!candidateBlobShas || typeof candidateBlobShas !== "object" || Array.isArray(candidateBlobShas)) {
    throw new Error("candidateBlobShas must map excluded paths to candidate Git blob SHAs.");
  }

  for (const entry of manifest.excludedPaths) {
    const candidateBlobSha = candidateBlobShas[entry.path];
    if (!SHA_PATTERN.test(candidateBlobSha ?? "")) {
      throw new Error(`Frozen excluded path is missing from the candidate tree: ${entry.path}.`);
    }
    if (candidateBlobSha !== entry.gitBlobSha) {
      throw new Error(`Frozen excluded path changed without an executable coverage baseline update: ${entry.path}.`);
    }
  }
  return { excludedFilesChecked: manifest.excludedPaths.length };
}

function isAtLeastPercent(coverage, minimumPct) {
  return coverage.total === 0 || coverage.covered * 100 >= minimumPct * coverage.total;
}

function hasCoverageAtOrAbove(current, baseline, minimumPct) {
  if (baseline.total === 0) {
    return isAtLeastPercent(current, minimumPct);
  }
  if (current.total === 0) return false;
  return current.covered * baseline.total >= baseline.covered * current.total;
}

function requirePathCoverage(filePath, metrics, baselineMetrics, minimumForNewFiles, isNewFile) {
  if (!metrics) throw new Error(`Coverage report is missing required path ${filePath}.`);
  for (const metric of METRICS) {
    const minimumPct = minimumForNewFiles[metric];
    if (isNewFile && !isAtLeastPercent(metrics[metric], minimumPct)) {
      const currentPct = metrics[metric].total === 0
        ? 100
        : (metrics[metric].covered / metrics[metric].total) * 100;
      throw new Error(`${filePath} ${metric} coverage ${currentPct.toFixed(2)}% is below the new-file floor ${minimumPct}%.`);
    } else if (!isNewFile && baselineMetrics[metric].total > 0 && metrics[metric].total === 0) {
      throw new Error(`${filePath} ${metric} coverage has no instrumented points; frozen baseline had ${baselineMetrics[metric].total}.`);
    } else if (!isNewFile && !hasCoverageAtOrAbove(metrics[metric], baselineMetrics[metric], minimumPct)) {
      const currentPct = metrics[metric].total === 0
        ? 100
        : (metrics[metric].covered / metrics[metric].total) * 100;
      const baselinePct = baselineMetrics[metric].total === 0
        ? minimumPct
        : (baselineMetrics[metric].covered / baselineMetrics[metric].total) * 100;
      throw new Error(`${filePath} ${metric} coverage ${currentPct.toFixed(2)}% is below frozen floor ${baselinePct.toFixed(2)}%.`);
    }
  }
}

export function verifyModuleCoverage({ manifest, coverageSummary, trackedPaths, repoRoot }) {
  validateModuleCoverageManifest(manifest);
  if (!Array.isArray(trackedPaths)) throw new Error("trackedPaths must be an array of Git-tracked paths.");

  const currentPaths = new Set(filterModuleCoverageSourcePaths(trackedPaths, manifest));
  const baselineByPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const moveByFrom = new Map(manifest.pathMoves.map((move) => [move.from, move.to]));
  const moveTargets = new Set(manifest.pathMoves.map((move) => move.to));
  const reportByPath = normalizeCoverageSummary(coverageSummary, repoRoot);
  const unexpectedReportPaths = [...reportByPath.keys()].filter((filePath) => !currentPaths.has(filePath)).sort();
  if (unexpectedReportPaths.length > 0) {
    throw new Error(`Coverage report contains paths outside the tracked module inventory: ${unexpectedReportPaths.join(", ")}.`);
  }

  for (const move of manifest.pathMoves) {
    if (currentPaths.has(move.from)) throw new Error(`Path move source still exists in the candidate inventory: ${move.from}.`);
    if (!currentPaths.has(move.to)) throw new Error(`Mapped path is missing from the candidate source inventory: ${move.to}.`);
  }

  const checkedPaths = [];
  const movedPaths = [];
  for (const baseline of manifest.files) {
    let candidatePath = baseline.path;
    if (!currentPaths.has(candidatePath)) {
      candidatePath = moveByFrom.get(baseline.path);
      if (!candidatePath) throw new Error(`Frozen baseline path is missing without an explicit path move: ${baseline.path}.`);
      if (!currentPaths.has(candidatePath)) throw new Error(`Mapped path is missing from the candidate source inventory: ${candidatePath}.`);
      movedPaths.push({ from: baseline.path, to: candidatePath });
    }
    requirePathCoverage(
      candidatePath,
      reportByPath.get(candidatePath),
      baseline.baseline,
      manifest.minimumForNewFiles,
      false,
    );
    checkedPaths.push(candidatePath);
  }

  const newPaths = [];
  for (const filePath of currentPaths) {
    if (baselineByPath.has(filePath) || moveTargets.has(filePath)) continue;
    requirePathCoverage(filePath, reportByPath.get(filePath), null, manifest.minimumForNewFiles, true);
    newPaths.push(filePath);
  }

  return {
    baselineSha: manifest.baselineSha.toLowerCase(),
    baselineFilesChecked: manifest.files.length,
    movedPaths,
    newFilesChecked: newPaths.sort(),
    totalFilesChecked: checkedPaths.length + newPaths.length,
  };
}

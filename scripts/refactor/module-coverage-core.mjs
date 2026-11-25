import path from "node:path";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const METRICS = Object.freeze(["lines", "functions", "statements", "branches"]);
const SOURCE_EXTENSION_PATTERN = /\.(?:ts|tsx|js|jsx)$/i;
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__|tests|fixtures?)(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/i;
const NEW_FILE_FLOORS = Object.freeze({ lines: 85, functions: 85, statements: 85, branches: 80 });

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
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

function validateMetric(value, label) {
  requireObject(value, label);
  for (const field of ["covered", "total"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new Error(`${label}.${field} must be a non-negative safe integer.`);
  }
  if (value.covered > value.total) throw new Error(`${label}.covered cannot exceed total.`);
  const expectedPct = value.total === 0 ? 100 : Number(((value.covered / value.total) * 100).toFixed(2));
  if (!Number.isFinite(value.pct) || value.pct < 0 || value.pct > 100 || Math.abs(value.pct - expectedPct) > 0.02) {
    throw new Error(`${label}.pct does not match its covered/total counts.`);
  }
}

export function validateModuleCoverageManifest(value) {
  requireObject(value, "Module coverage manifest");
  if (value.schemaVersion !== 2) throw new Error("Unsupported module coverage manifest schema.");
  if (!SHA_PATTERN.test(value.baselineSha ?? "")) throw new Error("Module coverage baseline SHA is invalid.");
  if (value.measurement !== "vitest-unit-shards-v8") {
    throw new Error("Module coverage must use the merged Vitest unit-shard V8 report.");
  }
  if (!Array.isArray(value.sourceRoots) || value.sourceRoots.length === 0) throw new Error("sourceRoots must be a non-empty array.");
  const roots = value.sourceRoots.map((root, index) => validateModuleCoverageRelativePath(root, `sourceRoots[${index}]`));
  requireUnique(roots, "sourceRoots");
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && root.startsWith(`${other}/`)))) {
    throw new Error("sourceRoots must not overlap.");
  }
  if (!value.minimumForNewFiles || METRICS.some((metric) => value.minimumForNewFiles[metric] !== NEW_FILE_FLOORS[metric])) {
    throw new Error("New module files must retain the 85/85/85/80 percent floors.");
  }
  if (!Array.isArray(value.excludedPaths) || !Array.isArray(value.files) || value.files.length === 0 || !Array.isArray(value.pathMoves)) {
    throw new Error("Module coverage manifest has an invalid source inventory.");
  }
  for (const entry of [...value.excludedPaths, ...value.files]) {
    requireObject(entry, "Module coverage source entry");
    validateModuleCoverageRelativePath(entry.path, "Module coverage source path");
    if (!roots.some((root) => entry.path.startsWith(`${root}/`))) throw new Error(`Source path is outside sourceRoots: ${entry.path}`);
  }
  const excludedPaths = value.excludedPaths.map((entry) => {
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 8) throw new Error(`excludedPaths reason is missing for ${entry.path}.`);
    return entry.path;
  });
  requireUnique(excludedPaths, "excludedPaths");
  const paths = value.files.map((entry) => {
    requireObject(entry.baseline, `Baseline for ${entry.path}`);
    for (const metric of METRICS) validateMetric(entry.baseline[metric], `${entry.path}.${metric}`);
    return entry.path;
  });
  requireUnique(paths, "Baseline file paths");
  if ([...paths].sort().some((entry, index) => entry !== paths[index])) throw new Error("Baseline file paths must be sorted lexically.");
  if ([...excludedPaths].sort().some((entry, index) => entry !== excludedPaths[index])) throw new Error("excludedPaths must be sorted lexically.");
  if (paths.some((entry) => excludedPaths.includes(entry))) throw new Error("A source path cannot be both measured and excluded.");

  const movesFrom = [];
  const movesTo = [];
  for (const move of value.pathMoves) {
    requireObject(move, "path move");
    validateModuleCoverageRelativePath(move.from, "pathMoves.from");
    validateModuleCoverageRelativePath(move.to, "pathMoves.to");
    if (!paths.includes(move.from) || !roots.some((root) => move.to.startsWith(`${root}/`))) throw new Error("Invalid module coverage path move.");
    movesFrom.push(move.from);
    movesTo.push(move.to);
  }
  requireUnique(movesFrom, "path move sources");
  requireUnique(movesTo, "path move targets");
  if (movesTo.some((entry) => paths.includes(entry))) throw new Error("Path move target is already a baseline path.");
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
  } else relative = value;

  if (relative === "" || relative === "." || relative === ".." || relative.startsWith("../")
    || relative.startsWith("..\\") || path.win32.isAbsolute(relative)) {
    throw new Error(`Coverage path is outside the repository root: ${value}`);
  }
  return validateModuleCoverageRelativePath(relative.replaceAll("\\", "/"), "Coverage report path");
}

function normalizeSummary(summary, repoRoot) {
  requireObject(summary, "Coverage summary");
  requireObject(summary.total, "Coverage summary total");
  for (const metric of METRICS) validateMetric(summary.total[metric], `Coverage summary total.${metric}`);
  const normalized = new Map();
  for (const [rawPath, metrics] of Object.entries(summary)) {
    if (rawPath === "total") continue;
    const filePath = normalizeModuleCoverageReportPath(rawPath, repoRoot);
    if (normalized.has(filePath)) throw new Error(`Coverage summary repeats normalized path ${filePath}.`);
    requireObject(metrics, `Coverage summary for ${filePath}`);
    for (const metric of METRICS) validateMetric(metrics[metric], `${filePath}.${metric}`);
    normalized.set(filePath, metrics);
  }
  if (normalized.size === 0) throw new Error("Coverage summary contains no file results.");
  return normalized;
}

function isWithinRoots(filePath, roots) {
  return roots.some((root) => filePath.startsWith(`${root}/`));
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
  const excluded = new Set(manifest.excludedPaths.map((entry) => entry.path));
  const eligible = paths.map((filePath, index) => validateModuleCoverageRelativePath(filePath, `sourcePaths[${index}]`))
    .filter((filePath) => isEligibleSourcePath(filePath, manifest.sourceRoots) && !excluded.has(filePath));
  requireUnique(eligible, "Eligible source paths");
  return eligible.sort();
}

export function verifyFrozenModuleCoverageInventory({ manifest, baselinePaths }) {
  validateModuleCoverageManifest(manifest);
  if (!Array.isArray(baselinePaths)) {
    throw new Error("Frozen baseline source inventory is invalid.");
  }
  const eligible = filterModuleCoverageSourcePaths(baselinePaths, { ...manifest, excludedPaths: [] });
  const listed = [...manifest.files.map((entry) => entry.path), ...manifest.excludedPaths.map((entry) => entry.path)].sort();
  if (eligible.length !== listed.length || eligible.some((filePath, index) => filePath !== listed[index])) {
    throw new Error("Frozen source inventory does not match the checked-in per-file baseline.");
  }
  return { baselineSourceFilesChecked: eligible.length };
}

function pct(metric) {
  return metric.total === 0 ? 100 : (metric.covered / metric.total) * 100;
}

function atLeast(metric, threshold) {
  return metric.total === 0 || metric.covered * 100 >= threshold * metric.total;
}

export function verifyGlobalCoverage({ coverageSummary, trackedPaths, includePatterns, excludedPaths = [], thresholds, repoRoot }) {
  const report = normalizeSummary(coverageSummary, repoRoot);
  const expected = trackedPaths.filter((filePath) => includePatterns.some((pattern) => path.matchesGlob(filePath, pattern))
    && !excludedPaths.includes(filePath));
  requireUnique(expected, "Global coverage source paths");
  if (expected.length === 0) throw new Error("No tracked files match the configured global coverage scope.");

  const aggregate = Object.fromEntries(METRICS.map((metric) => [metric, { covered: 0, total: 0 }]));
  for (const filePath of expected) {
    const metrics = report.get(filePath);
    if (!metrics) throw new Error(`Merged coverage report is missing global-scope path ${filePath}.`);
    for (const metric of METRICS) {
      aggregate[metric].covered += metrics[metric].covered;
      aggregate[metric].total += metrics[metric].total;
    }
  }
  for (const metric of METRICS) {
    const threshold = thresholds[metric];
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error(`Invalid global ${metric} threshold.`);
    if (aggregate[metric].total === 0) throw new Error(`Merged global ${metric} coverage has no instrumented points.`);
    const reportedPercent = Number(pct(aggregate[metric]).toFixed(2));
    if (reportedPercent < threshold) {
      throw new Error(`Global ${metric} coverage ${reportedPercent.toFixed(2)}% is below ${threshold}%.`);
    }
  }
  return {
    filesChecked: expected.length,
    metrics: Object.fromEntries(METRICS.map((metric) => [metric, { ...aggregate[metric], pct: Number(pct(aggregate[metric]).toFixed(2)) }])),
  };
}

function requirePathCoverage(filePath, metrics, baselineMetrics, minimumForNewFiles, isNewFile) {
  if (!metrics) throw new Error(`Merged coverage report is missing required module path ${filePath}.`);
  if (metrics.lines.total === 0 || metrics.statements.total === 0) {
    throw new Error(`${filePath} has no instrumented lines or statements; merged coverage cannot verify executable code.`);
  }
  for (const metric of METRICS) {
    const floor = isNewFile || baselineMetrics[metric].total === 0
      ? minimumForNewFiles[metric]
      : pct(baselineMetrics[metric]);
    if (!isNewFile && baselineMetrics[metric].total > 0 && metrics[metric].total === 0) {
      throw new Error(`${filePath} ${metric} coverage has no instrumented points; frozen baseline had ${baselineMetrics[metric].total}.`);
    }
    if (!atLeast(metrics[metric], floor)) {
      throw new Error(`${filePath} ${metric} coverage ${pct(metrics[metric]).toFixed(2)}% is below frozen floor ${floor.toFixed(2)}%.`);
    }
  }
}

export function verifyModuleCoverage({ manifest, coverageSummary, trackedPaths, repoRoot }) {
  validateModuleCoverageManifest(manifest);
  const currentPaths = new Set(filterModuleCoverageSourcePaths(trackedPaths, manifest));
  const report = normalizeSummary(coverageSummary, repoRoot);
  const baselineByPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const moveByFrom = new Map(manifest.pathMoves.map((move) => [move.from, move.to]));
  const moveTargets = new Set(manifest.pathMoves.map((move) => move.to));
  const movedPaths = [];

  for (const move of manifest.pathMoves) {
    if (currentPaths.has(move.from)) throw new Error(`Path move source still exists in the candidate inventory: ${move.from}.`);
    if (!currentPaths.has(move.to)) throw new Error(`Mapped path is missing from the candidate source inventory: ${move.to}.`);
  }

  for (const baseline of manifest.files) {
    let candidatePath = baseline.path;
    if (!currentPaths.has(candidatePath)) {
      candidatePath = moveByFrom.get(baseline.path);
      if (!candidatePath || !currentPaths.has(candidatePath)) throw new Error(`Frozen baseline path is missing without a valid path move: ${baseline.path}.`);
      movedPaths.push({ from: baseline.path, to: candidatePath });
    }
    requirePathCoverage(candidatePath, report.get(candidatePath), baseline.baseline, manifest.minimumForNewFiles, false);
  }

  const newFiles = [...currentPaths].filter((filePath) => !baselineByPath.has(filePath) && !moveTargets.has(filePath)).sort();
  for (const filePath of newFiles) requirePathCoverage(filePath, report.get(filePath), null, manifest.minimumForNewFiles, true);
  return {
    baselineFilesChecked: manifest.files.length,
    movedPaths,
    newFilesChecked: newFiles,
    totalFilesChecked: manifest.files.length + newFiles.length,
  };
}

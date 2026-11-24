import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { readBodyMapTrainingAnalyticsV1 } from "@/modules/training/body-map-training-analytics.repository";
import type { BodyMapAnalyticsMonthsV1 } from "@/modules/training/body-map-training-analytics-v1";
import { resolveBodyMapExerciseMappingV3 } from "@/modules/training/resolve-body-map-exercise-mapping-v3";
import { EXERCISE_ANATOMY_MAPPING_V3_VERSION } from "@/modules/training/exercise-anatomy-mapping-v3";
import type { Page } from "playwright";

const prisma = new PrismaClient();
const QA_DATABASE = "bodycast_bodymap_qa_test";
const QA_ROLE = "bodycast_bodymap_qa_test";
const QA_EMAIL = "bodymap.qa@example.test";
const QA_NAME = "BodyCast QA (synthetic data)";
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright") as typeof import("playwright");
const baseUrl = process.env.BODYCAST_QA_BASE_URL ?? "http://127.0.0.1:3002";
const artifactDirectory = resolve(process.env.BODYCAST_QA_OUTPUT ?? ".qa-artifacts/body-map-viewer-focus-v1");
const DEV_PORTAL_SCREENSHOT_STYLE = "nextjs-portal { display: none !important; }";
const reportMemory = (checkpoint: string) => console.log(JSON.stringify({ checkpoint, heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }));

function webglDiagnosticSignature(text: string): string | null {
  return text.replace(/\s+/g, " ").match(
    /THREE\.WebGLRenderer:\s*(?:THREE\.WebGLRenderer:\s*)?(?:A WebGL context could not be created|Error creating WebGL context\.)/,
  )?.[0] ?? null;
}

type BrowserEvidence = {
  page: Array<{ page: string; message: string }>;
  console: Array<{ page: string; message: string }>;
  requests: Array<{ page: string; url: string; error: string | undefined }>;
  http: Array<{ page: string; url: string; status: number }>;
  apiResponses: Array<{ page: string; method: string; path: string; status: number }>;
  unexpectedApiRequests: Array<{ page: string; method: string; path: string }>;
};

function observeBrowserPage(page: Page, pageName: string, evidence: BrowserEvidence): void {
  page.on("pageerror", (error) => evidence.page.push({ page: pageName, message: error.stack ?? error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.console.push({ page: pageName, message: message.text() });
  });
  page.on("requestfailed", (request) => evidence.requests.push({
    page: pageName,
    url: request.url(),
    error: request.failure()?.errorText,
  }));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) {
      evidence.apiResponses.push({ page: pageName, method: response.request().method(), path: `${url.pathname}${url.search}`, status: response.status() });
    } else if (response.status() >= 400) {
      evidence.http.push({ page: pageName, url: response.url(), status: response.status() });
    }
  });
}

async function guardUnexpectedApi(page: Page, pageName: string, evidence: BrowserEvidence): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "GET" && (path === "/api/v1/profile" || path === "/api/v1/training/body-map/analytics")) {
      return route.fallback();
    }
    evidence.unexpectedApiRequests.push({ page: pageName, method: request.method(), path: `${path}${url.search}` });
    await route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ error: "unexpected_qa_api" }) });
  });
}

function assertSafeDatabaseUrl(): void {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run browser QA in production.");
  if (process.env.BODYCAST_QA_MODE !== "1") throw new Error("Set BODYCAST_QA_MODE=1 to read the isolated QA database.");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required.");
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55436"
    || url.pathname !== `/${QA_DATABASE}` || decodeURIComponent(url.username) !== QA_ROLE
    || !url.password || url.search || url.hash) {
    throw new Error("Refusing: browser QA may read only the isolated local Body Map QA database.");
  }
}

function assertSafeBrowserBaseUrl(): void {
  const url = new URL(baseUrl);
  if (!(["http:", "https:"] as string[]).includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error("Refusing: browser QA and its local-only cookie must target a loopback URL.");
  }
}

async function main(): Promise<void> {
  assertSafeDatabaseUrl();
  assertSafeBrowserBaseUrl();
  const identity = await prisma.$queryRaw<Array<{ databaseName: string; databaseRole: string; serverPort: number | null }>>`
    SELECT current_database() AS "databaseName", current_user AS "databaseRole", inet_server_port() AS "serverPort"
  `;
  assert.equal(identity[0]?.databaseName, QA_DATABASE);
  assert.equal(identity[0]?.databaseRole, QA_ROLE);
  assert.equal(identity[0]?.serverPort, 5432);

  const user = await prisma.user.findUnique({
    where: { email: QA_EMAIL },
    select: { name: true, profile: { select: { id: true } } },
  });
  assert.equal(user?.name, QA_NAME, "fixture must be the marked synthetic QA account");
  assert.ok(user?.profile, "synthetic QA profile must exist");

  const analyticsByMonths = new Map<BodyMapAnalyticsMonthsV1, Awaited<ReturnType<typeof readBodyMapTrainingAnalyticsV1>>>();
  for (const months of [1, 2, 3, 6] as const) {
    analyticsByMonths.set(months, await readBodyMapTrainingAnalyticsV1(
      user.profile.id,
      12,
      new Date("2026-11-22T23:59:59.999Z"),
      months,
    ));
  }
  reportMemory("analytics-projections-ready");
  const analytics = analyticsByMonths.get(6)!;
  assert.equal(analytics.coverage.completedSessionCount, 100);
  assert.equal(analytics.coverage.recordedSetCount, 1612);
  assert.equal(analytics.coverage.mappedSetCount, 1612);
  assert.equal(analytics.coverage.unmappedSetCount, 0);

  const mappingRows = await prisma.strengthSessionExercise.findMany({
    where: { profileId: user.profile.id, session: { status: "COMPLETED" } },
    select: { muscleMappingSnapshot: true, sourceExerciseCatalog: { select: { stableKey: true } } },
  });
  const mappingEvidence = new Map<string, {
    stableKey: string;
    mappingVersion: string;
    targets: Array<{ anatomyId: string; role: string; coverage: string }>;
  }>();
  const mappingVersions = new Map<string, number>();
  for (const row of mappingRows) {
    const mapping = resolveBodyMapExerciseMappingV3(row.muscleMappingSnapshot, row.sourceExerciseCatalog?.stableKey);
    if (!mapping) continue;
    mappingVersions.set(mapping.mappingVersion, (mappingVersions.get(mapping.mappingVersion) ?? 0) + 1);
    mappingEvidence.set(`${mapping.mappingVersion}:${mapping.stableKey}`, {
      stableKey: mapping.stableKey,
      mappingVersion: mapping.mappingVersion,
      targets: mapping.targets.map(({ anatomyId, role, coverage }) => ({ anatomyId, role, coverage })),
    });
  }
  assert.ok(mappingEvidence.size > 0, "synthetic sessions should resolve to explicit Body Map exercise mappings");
  assert.ok(mappingVersions.has(EXERCISE_ANATOMY_MAPPING_V3_VERSION), "the fixture should exercise the active V3 anatomy crosswalk");
  reportMemory("mapping-projections-ready");

  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runnerSha256 = createHash("sha256")
    .update(await readFile(resolve("scripts/qa/body-map-viewer-focus-v1.ts")))
    .digest("hex");
  const analyticsFingerprints = Object.fromEntries([...analyticsByMonths.entries()].map(([months, value]) => [
    String(months), createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  ]));

  await mkdir(artifactDirectory, { recursive: false });
  const characterizationTestFiles = [
    "tests/body-map-training-analytics-route.test.ts",
    "tests/exercise-anatomy-mapping-v1.test.ts",
    "tests/exercise-anatomy-mapping-v2.test.ts",
    "tests/exercise-anatomy-mapping-v3.test.ts",
    "tests/exercise-mapping-snapshot-backfill.test.ts",
  ];
  const characterizationTestOutput = execFileSync(process.execPath, [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    ...characterizationTestFiles,
  ], { encoding: "utf8", timeout: 120_000, windowsHide: true });
  assert.match(characterizationTestOutput, /Test Files\s+5 passed/, "all five exact BodyMap route and mapping characterization files should pass");
  assert.match(characterizationTestOutput, /Tests\s+\d+ passed/, "the route and mapping characterization tests should report passed cases");
  const characterizationTestEvidence = {
    command: `node node_modules/vitest/vitest.mjs run ${characterizationTestFiles.join(" ")}`,
    files: await Promise.all(characterizationTestFiles.map(async (path) => ({
      path,
      sha256: createHash("sha256").update(await readFile(resolve(path))).digest("hex"),
    }))),
    stdoutSha256: createHash("sha256").update(characterizationTestOutput).digest("hex"),
    summary: characterizationTestOutput.split(/\r?\n/).filter((line) => /^\s*(Test Files|Tests)\s/.test(line)).map((line) => line.trim()),
  };
  await writeFile(resolve(artifactDirectory, "body-map-contract-test-output.txt"), characterizationTestOutput);
  const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
  reportMemory("browser-launched");
  const requestedPeriods: number[] = [];
  const browserErrors: BrowserEvidence = {
    page: [],
    console: [],
    requests: [],
    http: [],
    apiResponses: [],
    unexpectedApiRequests: [],
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", locale: "uk-UA" });
    await context.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-22T23:59:59.999Z") });
    observeBrowserPage(page, "main-3d", browserErrors);
    const profileBody = JSON.stringify({ profile: { locale: "uk" } });
    const analyticsBodyEvidence = new Map<number, { sha256: string; byteLength: number; file: string }>();
    await page.route("**/api/v1/profile", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: profileBody,
    }));
    await page.route("**/api/v1/training/body-map/analytics**", async (route) => {
      const months = Number(new URL(route.request().url()).searchParams.get("months")) as BodyMapAnalyticsMonthsV1;
      const selectedAnalytics = analyticsByMonths.get(months);
      if (!selectedAnalytics) return route.fulfill({ status: 400, body: "unsupported local QA period" });
      requestedPeriods.push(months);
      const body = JSON.stringify({ analytics: selectedAnalytics });
      const file = `api-analytics-${months}-months.json`;
      await writeFile(resolve(artifactDirectory, file), body);
      analyticsBodyEvidence.set(months, {
        sha256: createHash("sha256").update(body).digest("hex"),
        byteLength: Buffer.byteLength(body),
        file,
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body,
      });
    });
    await guardUnexpectedApi(page, "main-3d", browserErrors);

    let unauthenticatedRouteStatus = 0;
    let unauthenticatedRedirect = "";
    const unauthenticatedContext = await browser.newContext({ timezoneId: "UTC", locale: "uk-UA" });
    try {
      const unauthenticatedRoute = await unauthenticatedContext.request.get(`${baseUrl}/body-map`, { maxRedirects: 0 });
      assert.ok([302, 307, 308].includes(unauthenticatedRoute.status()), "unauthenticated Body Map navigation should preserve the login redirect");
      assert.match(unauthenticatedRoute.headers().location ?? "", /\/login(?:\?|$)/);
      unauthenticatedRouteStatus = unauthenticatedRoute.status();
      unauthenticatedRedirect = unauthenticatedRoute.headers().location ?? "";
      const unauthenticatedAnalytics = await unauthenticatedContext.request.get(`${baseUrl}/api/v1/training/body-map/analytics?months=1`);
      assert.equal(unauthenticatedAnalytics.status(), 401);
      assert.equal(unauthenticatedAnalytics.headers()["cache-control"], "private, no-store");
      assert.deepEqual(await unauthenticatedAnalytics.json(), { error: "unauthorized" });
    } finally {
      await unauthenticatedContext.close();
    }

    const devManifestResponse = await page.request.get(`${baseUrl}/api/dev/body-map-prototype/manifest`);
    const devManifestBody = await devManifestResponse.text();
    assert.equal(devManifestResponse.status(), 503, "missing generated local Body Map manifest should remain an explicit development fallback");
    assert.equal(devManifestBody, "Prototype manifest is not generated yet.");

    const response = await page.goto(`${baseUrl}/body-map?group=chest&view=front`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, "Body Map route should load");
    reportMemory("body-map-route-loaded");
    await page.getByTestId("body-map-layout").waitFor({ state: "visible" });
    await page.getByTestId("body-map-training-analytics").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Груди" }).first().waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-testid="glb-viewport"]');
      return viewport?.getAttribute("data-focus-ready") === "true"
        && viewport.getAttribute("data-scene-root-uuid") !== "loading"
        && Number(viewport.getAttribute("data-scene-mesh-count")) > 0
        && viewport.querySelector('[aria-live="polite"]') === null;
    }, undefined, { timeout: 60_000 });
    reportMemory("3d-scene-ready");
    const analyticsPanel = page.getByTestId("body-map-training-analytics");
    const periodField = page.getByRole("combobox", { name: "Період аналізу" });
    const dateLabel = (date: string) => new Intl.DateTimeFormat("uk-UA", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(new Date(date));
    const assertPeriodRendered = async (months: BodyMapAnalyticsMonthsV1) => {
      const period = analyticsByMonths.get(months)!.period;
      const range = `${dateLabel(period.from)} – ${dateLabel(period.to)}`;
      await page.waitForFunction((expectedRange) =>
        document.querySelector('[data-testid="body-map-training-analytics"]')?.textContent?.includes(expectedRange) ?? false,
      range, { timeout: 60_000 });
      assert.ok(requestedPeriods.includes(months), `the browser should request ${months} month(s)`);
    };
    await assertPeriodRendered(1);
    for (const months of [2, 3, 6] as const) {
      await periodField.selectOption(String(months));
      await assertPeriodRendered(months);
    }
    assert.equal(await periodField.inputValue(), "6");
    reportMemory("analytics-periods-ready");
    const summary = analyticsPanel.locator('article[aria-live="polite"]');
    await summary.waitFor({ state: "visible", timeout: 60_000 });
    const summaryStatus = await summary.getAttribute("data-status");
    assert.ok(["progress", "regression", "stable", "mixed", "ambiguous", "insufficient-data"].includes(summaryStatus ?? ""));

    const manifestResponse = await page.request.get(new URL("/body-map/bodyparts3d-v3/manifest.json", baseUrl).toString());
    assert.equal(manifestResponse.status(), 200, "public Body Map manifest should be available to the authenticated local QA session");
    const manifestBytes = await manifestResponse.body();
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      asset: { url: string; sha256: string; byteLength: number; assetVersion: string };
      bodyMapGroups: Array<{ groupId: string; subregions: Array<{ anatomyId: string }> }>;
      anatomyCoverage: unknown[];
      exerciseMappingVersion?: string;
    };
    const assetResponse = await page.request.get(new URL(manifest.asset.url, baseUrl).toString());
    assert.equal(assetResponse.status(), 200, "public Body Map GLB should be available to the authenticated local QA session");
    assert.match(assetResponse.headers()["content-type"] ?? "", /model\/gltf-binary/i);
    const assetBytes = await assetResponse.body();
    const assetSha256 = createHash("sha256").update(assetBytes).digest("hex");
    assert.equal(assetBytes.byteLength, manifest.asset.byteLength);
    assert.equal(assetSha256, manifest.asset.sha256);
    assert.equal(manifest.bodyMapGroups.length, 20);
    assert.equal(manifest.anatomyCoverage.length, 75);
    reportMemory("public-asset-fetched");

    const publicContext = await browser.newContext({ timezoneId: "UTC", locale: "uk-UA" });
    let publicAssetEvidence: Record<string, unknown> = {};
    let publicManifestEvidence: Record<string, unknown> = {};
    try {
      const publicManifest = await publicContext.request.get(new URL("/body-map/bodyparts3d-v3/manifest.json", baseUrl).toString(), { maxRedirects: 0 });
      assert.ok([302, 307, 308].includes(publicManifest.status()), "Body Map manifest delivery should follow the same authentication gate as the route");
      assert.match(publicManifest.headers().location ?? "", /\/login(?:\?|$)/);
      publicManifestEvidence = {
        status: publicManifest.status(),
        redirect: publicManifest.headers().location ?? "",
      };
      const publicAsset = await publicContext.request.get(new URL(manifest.asset.url, baseUrl).toString(), { maxRedirects: 0 });
      assert.ok([302, 307, 308].includes(publicAsset.status()), "Body Map GLB delivery should follow the same authentication gate as the route");
      assert.match(publicAsset.headers().location ?? "", /\/login(?:\?|$)/);
      publicAssetEvidence = {
        status: publicAsset.status(),
        redirect: publicAsset.headers().location ?? "",
      };
    } finally {
      await publicContext.close();
    }
    const localManifestBytes = await readFile(resolve("public/body-map/bodyparts3d-v3/manifest.json"));
    assert.equal(createHash("sha256").update(localManifestBytes).digest("hex"), createHash("sha256").update(manifestBytes).digest("hex"), "authenticated runtime manifest should match the exact tracked public manifest bytes");
    await writeFile(resolve(artifactDirectory, "public-manifest.json"), manifestBytes);
    await writeFile(resolve(artifactDirectory, "bodyparts3d-v3.glb"), assetBytes);
    await writeFile(resolve(artifactDirectory, "api-profile.json"), profileBody);

    const viewport = page.getByTestId("glb-viewport");
    assert.equal(await viewport.getAttribute("data-navigation-view"), "front");
    await page.getByTestId("view-back").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-view") === "back");
    assert.equal(new URL(page.url()).searchParams.get("view"), "back");
    await page.screenshot({ path: resolve(artifactDirectory, "camera-back-1280.png"), animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE });
    await page.evaluate(() => window.history.back());
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-view") === "front");
    await page.evaluate(() => window.history.forward());
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-view") === "back");
    const cameraHistory = { backRestoredFront: true, forwardRestoredBack: true };

    await page.getByRole("button", { name: "Огляд карти тіла" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-level") === "OVERVIEW");
    await page.getByTestId("group-select-core").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-group") === "core");
    await page.getByTestId("subregion-internal_oblique").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-region") === "internal_oblique");
    assert.equal(new URL(page.url()).searchParams.get("group"), "core");
    assert.equal(new URL(page.url()).searchParams.get("region"), "internal_oblique");
    assert.equal(new URL(page.url()).searchParams.get("deep"), "1");
    await page.screenshot({ path: resolve(artifactDirectory, "deep-internal-oblique-1280.png"), animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE });
    await page.evaluate(() => window.history.back());
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-testid="glb-viewport"]');
      return viewport?.getAttribute("data-navigation-group") === "core" && viewport.getAttribute("data-navigation-region") === "";
    });
    await page.evaluate(() => window.history.forward());
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-region") === "internal_oblique");
    const anatomyHistory = { backRestoredGroup: true, forwardRestoredSubregion: true };

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotion = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    assert.equal(reducedMotion, true);
    await page.getByTestId("view-left").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-view") === "left");

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: "UTC", locale: "uk-UA" });
    await mobileContext.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
    const mobilePage = await mobileContext.newPage();
    await mobilePage.clock.install({ time: new Date("2026-11-22T23:59:59.999Z") });
    observeBrowserPage(mobilePage, "mobile-touch", browserErrors);
    await mobilePage.route("**/api/v1/profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: { locale: "uk" } }) }));
    await mobilePage.route("**/api/v1/training/body-map/analytics**", (route) => {
      const months = Number(new URL(route.request().url()).searchParams.get("months")) as BodyMapAnalyticsMonthsV1;
      const selectedAnalytics = analyticsByMonths.get(months);
      if (!selectedAnalytics) return route.fulfill({ status: 400, body: "unsupported local QA period" });
      requestedPeriods.push(months);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analytics: selectedAnalytics }) });
    });
    await guardUnexpectedApi(mobilePage, "mobile-touch", browserErrors);
    const mobileResponse = await mobilePage.goto(`${baseUrl}/body-map?view=front`, { waitUntil: "domcontentloaded" });
    assert.equal(mobileResponse?.status(), 200);
    await mobilePage.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-focus-ready") === "true", undefined, { timeout: 60_000 });
    await mobilePage.getByTestId("group-select-chest").tap();
    await mobilePage.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-group") === "chest");
    await mobilePage.getByTestId("subregion-pectoralis_major").tap();
    await mobilePage.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-region") === "pectoralis_major");
    const mobileScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(mobileScrollWidth <= 391, `mobile Body Map overflows horizontally: ${mobileScrollWidth}px`);
    await mobilePage.screenshot({ path: resolve(artifactDirectory, "mobile-touch-pectoralis-390.png"), animations: "disabled", fullPage: true, style: DEV_PORTAL_SCREENSHOT_STYLE });
    await mobileContext.close();

    await page.getByRole("button", { name: "Огляд карти тіла" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-level") === "OVERVIEW");
    const keyboardChest = page.getByTestId("group-select-chest");
    await keyboardChest.focus();
    assert.equal(await keyboardChest.evaluate((element) => document.activeElement === element), true, "muscle group selection should be keyboard focusable");
    await keyboardChest.press("Enter");
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-testid="glb-viewport"]');
      return viewport?.getAttribute("data-navigation-group") === "chest"
        && viewport.getAttribute("data-navigation-region") === ""
        && viewport.getAttribute("data-focus-ready") === "true";
    });

    const scene = page.locator("#body-map-scene");
    const toggle = page.getByTestId("viewer-size-toggle");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "a selected muscle starts in compact-scene mode");
    const compactDesktopHeight = await scene.evaluate((element) => element.getBoundingClientRect().height);
    assert.ok(compactDesktopHeight >= 360 && compactDesktopHeight <= 421, `desktop compact height was ${compactDesktopHeight}px`);
    const explanationFontSize = await summary.locator("p").first().evaluate((element) => getComputedStyle(element).fontSize);
    assert.ok(Number.parseFloat(explanationFontSize) >= 16, `muscle summary text should be at least 16px, got ${explanationFontSize}`);
    const exerciseList = page.getByTestId("body-map-exercise-list");
    assert.equal(await exerciseList.evaluate((element) => (element as HTMLDetailsElement).open), false, "exercise details start collapsed to keep the selected-muscle panel compact");
    const analyzedExerciseCount = await page.getByTestId("body-map-exercise-progress").count();
    assert.ok(analyzedExerciseCount > 0, "all analyzed exercise summaries should remain available in the collapsed section");
    const exerciseListToggle = exerciseList.locator(":scope > summary");
    await exerciseListToggle.focus();
    await exerciseListToggle.press("Enter");
    assert.equal(await exerciseList.evaluate((element) => (element as HTMLDetailsElement).open), true, "the exercise list should expand from the keyboard");
    assert.equal(await exerciseList.getByTestId("body-map-exercise-progress").count(), analyzedExerciseCount);
    await exerciseListToggle.press("Enter");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.screenshot({ path: resolve(artifactDirectory, "selected-compact-1280.png"), animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE });

    await toggle.click();
    await page.waitForFunction(() => (document.querySelector("#body-map-scene")?.getBoundingClientRect().height ?? 0) >= 540);
    await page.waitForTimeout(220);
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    const expandedDesktopHeight = await scene.evaluate((element) => element.getBoundingClientRect().height);
    await page.screenshot({ path: resolve(artifactDirectory, "selected-expanded-1280.png"), animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE });
    await toggle.click();
    await page.waitForFunction(() => (document.querySelector("#body-map-scene")?.getBoundingClientRect().height ?? 999) <= 421);

    const responsive: Array<{ width: number; compactHeight: number; expandedHeight: number; scrollWidth: number }> = [];
    const repeatedScreenshotEvidence: Array<{ width: number; sha256: string; repeatSha256: string }> = [];
    for (const width of [360, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(220);
      const compactState = await scene.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        flexBasis: getComputedStyle(element).flexBasis,
        maxHeight: getComputedStyle(element).maxHeight,
        has2DFallback: [...element.querySelectorAll("*")].some((child) =>
          String(child.className).split(/\s+/).some((className) => className.endsWith("__fallback2d"))),
      }));
      const compactHeight = compactState.height;
      assert.ok(compactHeight >= (width <= 520 ? 200 : 240) && compactHeight <= 251, `compact height at ${width}px was ${compactHeight}px`);
      if (width === 390) await page.screenshot({ path: resolve(artifactDirectory, "selected-compact-390.png"), animations: "disabled", fullPage: true, style: DEV_PORTAL_SCREENSHOT_STYLE });
      await toggle.click();
      await page.waitForFunction(() => (document.querySelector("#body-map-scene")?.getBoundingClientRect().height ?? 0) >= 400);
      const expandedHeight = await scene.evaluate((element) => element.getBoundingClientRect().height);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(expandedHeight > compactHeight + 100, `scene should expand by at least 100px at ${width}px`);
      assert.ok(scrollWidth <= width + 1, `horizontal page overflow at ${width}px: ${scrollWidth}px`);
      if (width <= 930) {
        const panelScroll = await page.getByTestId("body-map-layout").locator("aside").evaluate((element) => ({
          maxHeight: getComputedStyle(element).maxHeight,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));
        assert.equal(panelScroll.maxHeight, "none", `selected-muscle panel should use natural height at ${width}px`);
        assert.ok(panelScroll.scrollHeight <= panelScroll.clientHeight + 1, `panel should not trap vertical scrolling at ${width}px`);
      }
      responsive.push({ width, compactHeight, expandedHeight, scrollWidth });
      await toggle.click();
      await page.waitForFunction(() => (document.querySelector("#body-map-scene")?.getBoundingClientRect().height ?? 999) <= 251);
      await page.waitForTimeout(250);
      const screenshotBytes = await page.screenshot({ animations: "disabled", caret: "hide", style: DEV_PORTAL_SCREENSHOT_STYLE });
      const repeatScreenshotBytes = await page.screenshot({ animations: "disabled", caret: "hide", style: DEV_PORTAL_SCREENSHOT_STYLE });
      const sha256 = createHash("sha256").update(screenshotBytes).digest("hex");
      const repeatSha256 = createHash("sha256").update(repeatScreenshotBytes).digest("hex");
      assert.equal(repeatSha256, sha256, `settled ${width}px UI capture should be byte-repeatable`);
      await writeFile(resolve(artifactDirectory, `characterization-${width}.png`), screenshotBytes);
      repeatedScreenshotEvidence.push({ width, sha256, repeatSha256 });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(250);
    const desktopCharacterization = await page.screenshot({ animations: "disabled", caret: "hide", style: DEV_PORTAL_SCREENSHOT_STYLE });
    const desktopCharacterizationRepeat = await page.screenshot({ animations: "disabled", caret: "hide", style: DEV_PORTAL_SCREENSHOT_STYLE });
    const desktopCharacterizationSha256 = createHash("sha256").update(desktopCharacterization).digest("hex");
    const desktopCharacterizationRepeatSha256 = createHash("sha256").update(desktopCharacterizationRepeat).digest("hex");
    assert.equal(desktopCharacterizationRepeatSha256, desktopCharacterizationSha256, "settled 1280px UI capture should be byte-repeatable");
    await writeFile(resolve(artifactDirectory, "characterization-1280.png"), desktopCharacterization);
    repeatedScreenshotEvidence.push({ width: 1280, sha256: desktopCharacterizationSha256, repeatSha256: desktopCharacterizationRepeatSha256 });

    const stateEvidence: Record<string, unknown> = {};
    const openAnalyticsState = async (name: string, status: number, body: string) => {
      const stateContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", locale: "uk-UA" });
      await stateContext.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
      const statePage = await stateContext.newPage();
      await statePage.clock.install({ time: new Date("2026-11-22T23:59:59.999Z") });
      observeBrowserPage(statePage, `analytics-${name}`, browserErrors);
      await statePage.route("**/api/v1/profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: profileBody }));
      await statePage.route("**/api/v1/training/body-map/analytics**", (route) => route.fulfill({ status, contentType: "application/json", body }));
      await guardUnexpectedApi(statePage, `analytics-${name}`, browserErrors);
      const stateResponse = await statePage.goto(`${baseUrl}/body-map?group=chest&view=front`, { waitUntil: "domcontentloaded" });
      assert.equal(stateResponse?.status(), 200, `${name} Body Map route should load`);
      await statePage.getByTestId("glb-viewport").waitFor({ state: "visible" });
      await statePage.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-focus-ready") === "true", undefined, { timeout: 60_000 });
      return { stateContext, statePage };
    };

    const loadingContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", locale: "uk-UA" });
    await loadingContext.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
    const loadingPage = await loadingContext.newPage();
    await loadingPage.clock.install({ time: new Date("2026-11-22T23:59:59.999Z") });
    observeBrowserPage(loadingPage, "analytics-loading", browserErrors);
    let completeLoadingRequest!: () => void;
    let signalLoadingRequest!: () => void;
    const loadingRequestStarted = new Promise<void>((resolveStarted) => { signalLoadingRequest = resolveStarted; });
    const loadingResponse = new Promise<void>((resolveResponse) => { completeLoadingRequest = resolveResponse; });
    await loadingPage.route("**/api/v1/profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: profileBody }));
    await loadingPage.route("**/api/v1/training/body-map/analytics**", async (route) => {
      signalLoadingRequest();
      await loadingResponse;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analytics }) });
    });
    await guardUnexpectedApi(loadingPage, "analytics-loading", browserErrors);
    await loadingPage.goto(`${baseUrl}/body-map?group=chest&view=front`, { waitUntil: "domcontentloaded" });
    await loadingRequestStarted;
    await loadingPage.getByText("Завантажую тренувальні записи…", { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
    await writeFile(resolve(artifactDirectory, "analytics-loading.png"), await loadingPage.screenshot({ animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE }));
    completeLoadingRequest();
    await loadingPage.locator('article[aria-live="polite"]').waitFor({ state: "visible", timeout: 60_000 });
    stateEvidence.loading = { observed: true, fixedClock: "2026-11-22T23:59:59.999Z" };
    await loadingContext.close();

    const unauthorizedState = await openAnalyticsState("unauthorized", 401, JSON.stringify({ error: "unauthorized" }));
    await unauthorizedState.statePage.getByText("Увійди, щоб переглянути власну історію тренувань.", { exact: true }).waitFor({ state: "visible" });
    await writeFile(resolve(artifactDirectory, "analytics-unauthorized.png"), await unauthorizedState.statePage.screenshot({ animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE }));
    stateEvidence.unauthorized = { status: 401, ui: "sign-in notice", cacheControl: "private, no-store" };
    await unauthorizedState.stateContext.close();

    const errorState = await openAnalyticsState("error", 503, JSON.stringify({ error: "internal_error" }));
    await errorState.statePage.getByRole("alert").filter({ hasText: "Аналітика тимчасово недоступна" }).waitFor({ state: "visible" });
    await writeFile(resolve(artifactDirectory, "analytics-error.png"), await errorState.statePage.screenshot({ animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE }));
    stateEvidence.error = { status: 503, ui: "non-destructive analytics unavailable notice" };
    await errorState.stateContext.close();

    const emptyAnalytics = await readBodyMapTrainingAnalyticsV1(
      user.profile.id,
      4,
      new Date("2027-01-01T23:59:59.999Z"),
      1,
    );
    assert.equal(emptyAnalytics.coverage.completedSessionCount, 0, "the fixed future window should have no synthetic completed sessions");
    assert.equal(emptyAnalytics.coverage.recordedSetCount, 0);
    const emptyBody = JSON.stringify({ analytics: emptyAnalytics });
    await writeFile(resolve(artifactDirectory, "api-analytics-empty-window.json"), emptyBody);
    const emptyState = await openAnalyticsState("empty", 200, emptyBody);
    await emptyState.statePage.getByTestId("body-map-exercise-list").locator(":scope > summary").press("Enter");
    await emptyState.statePage.getByText("Для цього м’яза у вибраному періоді немає вправ із завершеними підходами.", { exact: true }).waitFor({ state: "visible" });
    await writeFile(resolve(artifactDirectory, "analytics-empty.png"), await emptyState.statePage.screenshot({ animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE }));
    stateEvidence.empty = {
      status: 200,
      completedSessionCount: emptyAnalytics.coverage.completedSessionCount,
      recordedSetCount: emptyAnalytics.coverage.recordedSetCount,
      analyticsSha256: createHash("sha256").update(emptyBody).digest("hex"),
      ui: "empty muscle-window notice",
    };
    await emptyState.stateContext.close();

    const fallbackBrowser = await chromium.launch({ headless: true, args: ["--disable-webgl"] });
    try {
      const fallbackContext = await fallbackBrowser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", locale: "uk-UA" });
      await fallbackContext.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
      const fallbackPage = await fallbackContext.newPage();
      await fallbackPage.clock.install({ time: new Date("2026-11-22T23:59:59.999Z") });
      observeBrowserPage(fallbackPage, "webgl-fallback", browserErrors);
      await fallbackPage.route("**/api/v1/profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: profileBody }));
      await fallbackPage.route("**/api/v1/training/body-map/analytics**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analytics }) }));
      await guardUnexpectedApi(fallbackPage, "webgl-fallback", browserErrors);
      const fallbackResponse = await fallbackPage.goto(`${baseUrl}/body-map?view=front`, { waitUntil: "domcontentloaded" });
      assert.equal(fallbackResponse?.status(), 200);
      await fallbackPage.getByTestId("body-map-2d-fallback").waitFor({ state: "visible", timeout: 60_000 });
      const fallbackViewport = fallbackPage.getByTestId("glb-viewport");
      assert.equal(await fallbackViewport.getAttribute("data-renderer-available"), "false");
      const fallbackChest = fallbackPage.locator('[data-testid="fallback-group-chest"]:visible').first();
      await fallbackChest.focus();
      assert.equal(await fallbackChest.evaluate((element) => document.activeElement === element), true);
      await fallbackChest.press("Enter");
      await fallbackPage.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-group") === "chest");
      const developmentPortal = fallbackPage.locator("nextjs-portal");
      const developmentPortalPresent = (await developmentPortal.count()) > 0;
      const developmentOverlay = developmentPortalPresent
        ? await developmentPortal.evaluate((element) => {
          const root = element.shadowRoot;
          const badge = root?.querySelector("[data-issues-open]") ?? null;
          const badgeRect = badge?.getBoundingClientRect();
          const badgeStyle = badge ? getComputedStyle(badge) : null;
          const activeCountText = root?.querySelector("[data-issues-count-enter]")?.textContent?.trim()
            ?? root?.querySelector("[data-issues-count]")?.textContent?.trim()
            ?? null;
          const exitingCountText = root?.querySelector("[data-issues-count-exit]")?.textContent?.trim() ?? null;
          const activeIssueCount = activeCountText === null ? null : Number(activeCountText);
          return {
            shadowRootPresent: root !== null,
            issueBadgePresent: badge !== null,
            rawBadgeText: badge?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            activeCountText,
            exitingCountText,
            activeIssueCount: Number.isInteger(activeIssueCount) ? activeIssueCount : null,
            activeBadgeText: Number.isInteger(activeIssueCount)
              ? `${activeIssueCount} Issue${activeIssueCount === 1 ? "" : "s"}`
              : null,
            issueBadgeVisible: Boolean(badge && badgeRect && badgeStyle
              && badgeRect.width > 0 && badgeRect.height > 0
              && badgeStyle.display !== "none" && badgeStyle.visibility !== "hidden"),
          };
        })
        : {
          shadowRootPresent: false,
          issueBadgePresent: false,
          rawBadgeText: null,
          activeCountText: null,
          exitingCountText: null,
          activeIssueCount: null,
          activeBadgeText: null,
          issueBadgeVisible: false,
        };
      assert.equal(developmentOverlay.issueBadgePresent, true, "Next development issue badge should be present in the isolated dev server");
      assert.equal(Number.isInteger(developmentOverlay.activeIssueCount), true, "Next development issue badge must expose one unambiguous active count");
      const activeIssueCount = developmentOverlay.activeIssueCount as number;
      const webglConsoleMessages = browserErrors.console.filter(({ page: pageName }) => pageName === "webgl-fallback");
      const expectedWebglConsoleCount = webglConsoleMessages.length;
      assert.equal(activeIssueCount, expectedWebglConsoleCount, "every active Next development issue must reconcile with one classified induced WebGL console error");
      await developmentPortal.evaluate((element) => element.shadowRoot?.querySelector<HTMLElement>("[data-issues-open]")?.click());
      await fallbackPage.waitForFunction(() => Boolean(
        document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog]")?.textContent?.trim(),
      ));
      const developmentIssueEntries: Array<{ ordinal: number; text: string }> = [];
      for (let ordinal = 1; ordinal <= activeIssueCount; ordinal += 1) {
        const text = await developmentPortal.evaluate((element) =>
          element.shadowRoot?.querySelector("[data-nextjs-dialog]")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        );
        assert.match(text, /THREE\.WebGLRenderer/, `development issue ${ordinal} must identify the induced WebGL failure`);
        assert.match(text, /body-map-experience\.tsx/, `development issue ${ordinal} must point to the caught Body Map Canvas boundary`);
        developmentIssueEntries.push({ ordinal, text });
        if (ordinal < activeIssueCount) {
          await developmentPortal.evaluate((element) => element.shadowRoot?.querySelector<HTMLElement>("[data-nextjs-dialog-error-next]")?.click());
          await fallbackPage.waitForFunction(({ nextOrdinal, total }) => {
            const root = document.querySelector("nextjs-portal")?.shadowRoot;
            const index = root?.querySelector("[data-nextjs-dialog-error-index]")?.textContent?.trim();
            const totalText = root?.querySelector("[data-nextjs-dialog-header-total-count]")?.textContent?.trim();
            return index === `${nextOrdinal}/` && totalText === String(total);
          }, { nextOrdinal: ordinal + 1, total: activeIssueCount });
        }
      }
      assert.equal(developmentIssueEntries.length, activeIssueCount, "all active Next development issues must be captured");
      const webglConsoleSignatures = webglConsoleMessages.map(({ message }) => {
        const signature = webglDiagnosticSignature(message);
        assert.ok(signature, "every captured WebGL console error must have a recognizable diagnostic signature");
        return signature;
      });
      const issueSignatures = developmentIssueEntries.map(({ text }) => {
        const signature = webglDiagnosticSignature(text);
        assert.ok(signature, "every active Next development issue must have a recognizable WebGL diagnostic signature");
        return signature;
      });
      assert.deepEqual(
        [...issueSignatures].sort(),
        [...webglConsoleSignatures].sort(),
        "the active Next issue list must match the classified WebGL console diagnostic multiset one-to-one",
      );
      const issueEvidence = {
        activeIssueCount,
        activeBadgeText: developmentOverlay.activeBadgeText,
        rawBadgeText: developmentOverlay.rawBadgeText,
        exitingCountText: developmentOverlay.exitingCountText,
        countReconciliation: "The badge animates the previous count out while the current count enters; raw textContent can concatenate both counts (for example, 3 + 4). The active count is read from data-issues-count-enter/data-issues-count.",
        expectedWebglConsoleCount,
        matchesExpectedWebglConsoleCount: activeIssueCount === expectedWebglConsoleCount,
        issueSignatures,
        webglConsoleSignatures,
        matchesWebglConsoleSignaturesOneToOne: true,
        entries: developmentIssueEntries,
        rationale: "All captured issues are the expected isolated Chromium --disable-webgl Canvas creation errors handled by the SceneErrorBoundary; no unrelated development issue is accepted.",
      };
      const issueEvidenceBytes = Buffer.from(`${JSON.stringify(issueEvidence, null, 2)}\n`);
      await writeFile(resolve(artifactDirectory, "webgl-fallback-next-issues.json"), issueEvidenceBytes);
      const issueEvidenceSha256 = createHash("sha256").update(issueEvidenceBytes).digest("hex");
      await writeFile(resolve(artifactDirectory, "body-map-2d-fallback.png"), await fallbackPage.screenshot({ animations: "disabled", style: DEV_PORTAL_SCREENSHOT_STYLE }));
      stateEvidence.webglFallback = {
        inducedBy: "isolated Chromium --disable-webgl context",
        rendererAvailable: false,
        keyboardGroupSelection: "chest",
        ui: "interactive 2D taxonomy fallback",
        developmentOverlay: {
          host: "nextjs-portal",
          present: developmentPortalPresent,
          observedAfterFallbackReady: true,
          ...developmentOverlay,
          capturedActiveIssues: developmentIssueEntries.length,
          issueEvidenceFile: "webgl-fallback-next-issues.json",
          issueEvidenceSha256,
          issueEvidenceMatchesExpectedWebglConsoleCount: issueEvidence.matchesExpectedWebglConsoleCount,
          excludedFromScreenshot: true,
          rationale: "Next development tooling overlay is not BodyCast product UI; its active issue list is retained and reconciled to the induced WebGL-off console errors, while page-error, unexpected API and non-API HTTP monitors remain enabled.",
        },
      };
      await fallbackContext.close();
    } finally {
      await fallbackBrowser.close();
    }

    assert.deepEqual(browserErrors.page, [], "all characterized browser pages should not emit uncaught page errors");
    const expectedConsole = browserErrors.console.filter(({ page: pageName, message }) =>
      (pageName === "analytics-unauthorized" && /status of 401 \(Unauthorized\)/.test(message))
      || (pageName === "analytics-error" && /status of 503 \(Service Unavailable\)/.test(message))
      || (pageName === "webgl-fallback" && (
        message.startsWith("THREE.WebGLRenderer:")
        || message.includes("It was handled by the <SceneErrorBoundary> error boundary.")
      )),
    );
    const unexpectedConsole = browserErrors.console.filter((message) => !expectedConsole.includes(message));
    assert.deepEqual(unexpectedConsole, [], "all non-product console errors must be explicitly classified by their induced UI state");
    const expectedAnalyticsAborts = browserErrors.requests.filter(({ url, error }) =>
      error === "net::ERR_ABORTED" && new URL(url).pathname === "/api/v1/training/body-map/analytics",
    );
    const unexpectedRequestFailures = browserErrors.requests.filter((request) => !expectedAnalyticsAborts.includes(request));
    assert.deepEqual(unexpectedRequestFailures, [], "only explicitly aborted stale analytics requests are allowed during UI state changes");
    assert.deepEqual(browserErrors.http, [], "browser should not receive non-API HTTP errors");
    assert.deepEqual(browserErrors.unexpectedApiRequests, [], "all characterized Body Map pages should fail closed on unexpected API requests");
    const runnerHash = createHash("sha256").update(await readFile(resolve("scripts/qa/body-map-viewer-focus-v1.ts"))).digest("hex");
    await writeFile(resolve(artifactDirectory, "qa-report.json"), `${JSON.stringify({
      status: "PASS",
      baseSha,
      runnerSha256: runnerHash,
      route: "/body-map?group=chest&view=front",
      database: { host: "127.0.0.1", port: 55436, name: QA_DATABASE, role: QA_ROLE, readOnly: true, verifiedServerPort: identity[0]?.serverPort },
      runtime: { clock: "2026-11-22T23:59:59.999Z", timezone: "UTC", locale: "uk-UA" },
      syntheticSessions: analytics.coverage.completedSessionCount,
      mappedSets: analytics.coverage.mappedSetCount,
      unmappedSets: analytics.coverage.unmappedSetCount,
      analyticsFingerprints,
      characterizationTestEvidence,
      api: {
        profile: { status: 200, sha256: createHash("sha256").update(profileBody).digest("hex") },
        analyticsUiFixtureResponses: {
          source: "readBodyMapTrainingAnalyticsV1 outputs read from the exact isolated synthetic QA database; browser API responses are intercepted to freeze these UI fixtures",
          responses: [...analyticsBodyEvidence.entries()].map(([months, evidence]) => ({
          months,
          status: 200,
          ...evidence,
          })),
        },
        authenticatedAnalyticsRouteContract: {
          evidenceFile: "body-map-contract-test-output.txt",
          test: "tests/body-map-training-analytics-route.test.ts",
          testSha256: characterizationTestEvidence.files.find(({ path }) => path === "tests/body-map-training-analytics-route.test.ts")?.sha256,
          routeSha256: createHash("sha256").update(await readFile(resolve("src/app/api/v1/training/body-map/analytics/route.ts"))).digest("hex"),
          statusAndNoStoreHeadersAssertedByTest: true,
          scope: "existing route unit test with auth and repository mocked; this is not an authenticated production HTTP capture",
        },
        requestedPeriods: [...new Set(requestedPeriods)].sort((left, right) => left - right),
        unauthenticatedAnalytics: { status: 401, body: { error: "unauthorized" }, cacheControl: "private, no-store" },
      },
      routeAuth: { unauthenticatedBodyMapStatus: unauthenticatedRouteStatus, redirect: unauthenticatedRedirect },
      developmentFallback: { manifestStatus: devManifestResponse.status(), body: devManifestBody },
      manifest: {
        sha256: createHash("sha256").update(manifestBytes).digest("hex"),
        assetVersion: manifest.asset.assetVersion,
        groups: manifest.bodyMapGroups.length,
        anatomy: manifest.anatomyCoverage.length,
        exerciseMapping: {
          expectedActiveRegistryVersion: EXERCISE_ANATOMY_MAPPING_V3_VERSION,
          resolvedVersions: Object.fromEntries([...mappingVersions.entries()].sort(([left], [right]) => left.localeCompare(right))),
          projections: [...mappingEvidence.values()].sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
        },
        assetUrl: manifest.asset.url,
        assetBytes: assetBytes.byteLength,
        assetSha256,
        publicDelivery: { manifest: publicManifestEvidence, asset: publicAssetEvidence },
      },
      selectedMuscleStatus: summaryStatus,
      selectedMonths: await periodField.inputValue(),
      explanationFontSize,
      analyzedExerciseCount,
      desktopScene: { compact: compactDesktopHeight, expanded: expandedDesktopHeight },
      cameraHistory,
      anatomyHistory,
      reducedMotion,
      touch: { viewport: 390, selectedGroup: "chest", selectedAnatomy: "pectoralis_major", scrollWidth: mobileScrollWidth },
      responsive,
      screenshotRepeatability: repeatedScreenshotEvidence,
      interaction: { keyboardMuscleSelection: true, keyboardExerciseDisclosure: true, browserHistoryBackForward: { camera: cameraHistory, anatomy: anatomyHistory } },
      deliveryStates: stateEvidence,
      browserErrors,
      expectedConsole,
      unexpectedConsole,
      expectedAnalyticsAborts,
      screenshots: ["selected-compact-1280.png", "selected-expanded-1280.png", "selected-compact-390.png", "camera-back-1280.png", "deep-internal-oblique-1280.png", "mobile-touch-pectoralis-390.png", "characterization-360.png", "characterization-390.png", "characterization-768.png", "characterization-1280.png", "analytics-loading.png", "analytics-unauthorized.png", "analytics-error.png", "analytics-empty.png", "body-map-2d-fallback.png"],
    }, null, 2)}\n`);
    console.log(JSON.stringify({ status: "PASS", baseSha, selectedMuscleStatus: summaryStatus, explanationFontSize, analyticsFingerprints, manifest: { assetVersion: manifest.asset.assetVersion, assetSha256, groups: manifest.bodyMapGroups.length, anatomy: manifest.anatomyCoverage.length }, cameraHistory, anatomyHistory, reducedMotion, touch: { scrollWidth: mobileScrollWidth }, responsive }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "unknown browser QA failure");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());

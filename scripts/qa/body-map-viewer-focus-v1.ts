import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { readBodyMapTrainingAnalyticsV1 } from "@/modules/training/body-map-training-analytics.repository";
import type { BodyMapAnalyticsMonthsV1 } from "@/modules/training/body-map-training-analytics-v1";

const prisma = new PrismaClient();
const QA_DATABASE = "bodycast_bodymap_qa_test";
const QA_ROLE = "bodycast_bodymap_qa_test";
const QA_EMAIL = "bodymap.qa@example.test";
const QA_NAME = "BodyCast QA (synthetic data)";
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright") as typeof import("playwright");
const baseUrl = process.env.BODYCAST_QA_BASE_URL ?? "http://127.0.0.1:3002";
const artifactDirectory = resolve(".qa-artifacts/body-map-viewer-focus-v1");

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
  const analytics = analyticsByMonths.get(6)!;
  assert.equal(analytics.coverage.completedSessionCount, 100);
  assert.equal(analytics.coverage.recordedSetCount, 1612);
  assert.equal(analytics.coverage.mappedSetCount, 1612);
  assert.equal(analytics.coverage.unmappedSetCount, 0);

  await mkdir(artifactDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
  const failures: string[] = [];
  const requestedPeriods: number[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
    const page = await context.newPage();
    page.on("pageerror", (error) => failures.push(error.message));
    await page.route("**/api/v1/profile", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: { locale: "uk" } }),
    }));
    await page.route("**/api/v1/training/body-map/analytics**", (route) => {
      const months = Number(new URL(route.request().url()).searchParams.get("months")) as BodyMapAnalyticsMonthsV1;
      const selectedAnalytics = analyticsByMonths.get(months);
      if (!selectedAnalytics) return route.fulfill({ status: 400, body: "unsupported local QA period" });
      requestedPeriods.push(months);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ analytics: selectedAnalytics }),
      });
    });

    const response = await page.goto(`${baseUrl}/body-map?group=chest&view=front`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, "Body Map route should load");
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
    const summary = analyticsPanel.locator('article[aria-live="polite"]');
    await summary.waitFor({ state: "visible", timeout: 60_000 });
    const summaryStatus = await summary.getAttribute("data-status");
    assert.ok(["progress", "regression", "stable", "mixed", "ambiguous", "insufficient-data"].includes(summaryStatus ?? ""));

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
    await page.screenshot({ path: resolve(artifactDirectory, "selected-compact-1280.png"), animations: "disabled" });

    await toggle.click();
    await page.waitForFunction(() => (document.querySelector("#body-map-scene")?.getBoundingClientRect().height ?? 0) >= 540);
    await page.waitForTimeout(220);
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    const expandedDesktopHeight = await scene.evaluate((element) => element.getBoundingClientRect().height);
    await page.screenshot({ path: resolve(artifactDirectory, "selected-expanded-1280.png"), animations: "disabled" });
    await toggle.click();
    await page.waitForFunction(() => (document.querySelector("#body-map-scene")?.getBoundingClientRect().height ?? 999) <= 421);

    const responsive: Array<{ width: number; compactHeight: number; expandedHeight: number; scrollWidth: number }> = [];
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
      if (width === 390) await page.screenshot({ path: resolve(artifactDirectory, "selected-compact-390.png"), animations: "disabled", fullPage: true });
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
    }

    assert.deepEqual(failures, [], "browser should not emit uncaught page errors");
    await writeFile(resolve(artifactDirectory, "qa-report.json"), `${JSON.stringify({
      status: "PASS",
      route: "/body-map?group=chest&view=front",
      database: "read-only isolated local QA database",
      syntheticSessions: analytics.coverage.completedSessionCount,
      mappedSets: analytics.coverage.mappedSetCount,
      unmappedSets: analytics.coverage.unmappedSetCount,
      selectedMuscleStatus: summaryStatus,
      selectedMonths: await periodField.inputValue(),
      explanationFontSize,
      analyzedExerciseCount,
      desktopScene: { compact: compactDesktopHeight, expanded: expandedDesktopHeight },
      responsive,
      browserErrors: failures,
      screenshots: ["selected-compact-1280.png", "selected-expanded-1280.png", "selected-compact-390.png"],
    }, null, 2)}\n`);
    console.log(JSON.stringify({ status: "PASS", selectedMuscleStatus: summaryStatus, explanationFontSize, responsive }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "unknown browser QA failure");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());

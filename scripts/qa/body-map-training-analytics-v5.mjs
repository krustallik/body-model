import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");
const baseUrl = process.env.BODYCAST_QA_BASE_URL ?? "http://127.0.0.1:3000";
const artifactDirectory = resolve("artifacts/body-map-training-analytics-v5");
const manifest = JSON.parse(await readFile("public/body-map/bodyparts3d-v3/manifest.json", "utf8"));
const failures = { page: [], console: [], request: [] };
const expectedFallbackDiagnostics = [];
const screenshotStyle = "nextjs-portal { display: none !important; }";
const screenshotOptions = { animations: "disabled", style: screenshotStyle };
let mockLocale = "uk";
let mockScenario = "partial";
const analyticsRequests = [];

const week = {
  weekStart: "2026-11-16",
  loggedSessionCount: 1,
  directUniqueSetCount: 1,
  indirectUniqueSetCount: 0,
  totalUniqueSetCount: 1,
  mappingCoverage: "partial",
};

const set = {
  id: 7001,
  sessionId: 77,
  exerciseName: "Жим гантелей на похилій лаві вгору (30°)",
  stableKey: "incline_dumbbell_press_30deg",
  resistanceType: "EXTERNAL_WEIGHT",
  order: 0,
  setNumber: 1,
  reps: 8,
  weightKg: 25,
  bandNominalResistanceKg: null,
  rir: 4,
  restBeforeSeconds: 90,
  completedAt: "2026-11-20T17:00:00.000Z",
  sessionDate: "2026-11-20",
  sessionIntent: "easy-deload",
  trainingBlockLabel: "Deload",
  trainingWeekNumber: 4,
  plannedSets: 3,
  actualExerciseSetCount: 1,
  plannedRepsMin: 8,
  plannedRepsMax: 10,
  plannedRir: 4,
  exerciseIndex: 2,
  exercisesInSession: 2,
  precedingExercises: [{ stableKey: null, name: "Жим гантелей лежачи", loggedSets: 2 }],
  exposure: "direct",
  anatomyIds: ["pectoralis_major", "pectoralis_major_clavicular_head"],
  directAnatomyIds: ["pectoralis_major", "pectoralis_major_clavicular_head"],
  indirectAnatomyIds: [],
};

const curlSet = {
  ...set,
  id: 7003,
  exerciseName: "Згинання однієї руки від коліна",
  stableKey: "one_arm_concentration_curl",
  resistanceType: "EXTERNAL_WEIGHT",
  order: 2,
  setNumber: 1,
  reps: 10,
  weightKg: 12,
  rir: 3,
  exerciseIndex: 3,
  precedingExercises: [
    { stableKey: null, name: "Жим гантелей лежачи", loggedSets: 2 },
    { stableKey: set.stableKey, name: set.exerciseName, loggedSets: 1 },
  ],
  anatomyIds: ["biceps_brachii", "brachialis", "brachioradialis", "forearm_flexor_region"],
  directAnatomyIds: ["biceps_brachii"],
  indirectAnatomyIds: ["brachialis", "brachioradialis", "forearm_flexor_region"],
};

const chestReport = {
  groupId: "chest",
  source: "canonical-analytics-contract",
  status: "recorded-direct",
  directUniqueSetCount: 1,
  indirectUniqueSetCount: 0,
  totalUniqueSetCount: 1,
  mappingCoverage: "partial",
  note: "Synthetic QA fixture; not user data.",
  loggedTrainingDayCount: 1,
  loggedExposureIntervals: [{ previousDate: "2026-11-06", nextDate: "2026-11-20", calendarDays: 14 }],
  reportedRirSetCount: 1,
  unreportedRirSetCount: 0,
  rirCounts: [{ rir: 4, uniqueSetCount: 1 }],
  anatomy: [
    {
      anatomyId: "pectoralis_major",
      directUniqueSetCount: 1,
      indirectUniqueSetCount: 0,
      totalUniqueSetCount: 1,
      loggedTrainingDayCount: 1,
      loggedExposureIntervals: [{ previousDate: "2026-11-06", nextDate: "2026-11-20", calendarDays: 14 }],
      mappingCoverage: "partial",
    },
    {
      anatomyId: "pectoralis_major_clavicular_head",
      directUniqueSetCount: 1,
      indirectUniqueSetCount: 0,
      totalUniqueSetCount: 1,
      loggedTrainingDayCount: 1,
      loggedExposureIntervals: [{ previousDate: "2026-11-06", nextDate: "2026-11-20", calendarDays: 14 }],
      mappingCoverage: "partial",
    },
  ],
  weekly: [week],
  exercises: [{
    stableKey: set.stableKey,
    exerciseName: set.exerciseName,
    resistanceType: set.resistanceType,
    directUniqueSetCount: 1,
    indirectUniqueSetCount: 0,
    totalUniqueSetCount: 1,
    sessions: 1,
    sets: [set],
    performanceTrend: {
      status: "insufficient-data",
      comparableSessionCount: 1,
      comparedSetPairs: 0,
      note: "Synthetic QA fixture; not user data.",
      segments: [
        {
          phaseNumber: 1,
          blockLabel: "Base",
          sessionIntent: "regular",
          fromDate: "2026-11-06",
          toDate: "2026-11-06",
          status: "improving",
          comparableSessionCount: 3,
          comparedSetPairs: 4,
          note: "Synthetic QA fixture; not user data.",
        },
        {
          phaseNumber: 2,
          blockLabel: "Deload",
          sessionIntent: "easy-deload",
          fromDate: "2026-11-20",
          toDate: "2026-11-20",
          status: "insufficient-data",
          comparableSessionCount: 1,
          comparedSetPairs: 0,
          note: "Synthetic QA fixture; not user data.",
        },
      ],
    },
  }],
};

const bicepsReport = {
  groupId: "biceps",
  source: "canonical-analytics-contract",
  status: "recorded-direct",
  directUniqueSetCount: 1,
  indirectUniqueSetCount: 1,
  totalUniqueSetCount: 1,
  mappingCoverage: "partial",
  note: "Synthetic QA fixture; not user data.",
  loggedTrainingDayCount: 1,
  loggedExposureIntervals: [],
  reportedRirSetCount: 1,
  unreportedRirSetCount: 0,
  rirCounts: [{ rir: 3, uniqueSetCount: 1 }],
  anatomy: [
    { anatomyId: "biceps_brachii", directUniqueSetCount: 1, indirectUniqueSetCount: 0, totalUniqueSetCount: 1, loggedTrainingDayCount: 1, loggedExposureIntervals: [], mappingCoverage: "partial" },
    { anatomyId: "brachialis", directUniqueSetCount: 0, indirectUniqueSetCount: 1, totalUniqueSetCount: 1, loggedTrainingDayCount: 1, loggedExposureIntervals: [], mappingCoverage: "partial" },
    { anatomyId: "brachioradialis", directUniqueSetCount: 0, indirectUniqueSetCount: 1, totalUniqueSetCount: 1, loggedTrainingDayCount: 1, loggedExposureIntervals: [], mappingCoverage: "partial" },
    { anatomyId: "forearm_flexor_region", directUniqueSetCount: 0, indirectUniqueSetCount: 1, totalUniqueSetCount: 1, loggedTrainingDayCount: 1, loggedExposureIntervals: [], mappingCoverage: "partial" },
  ],
  weekly: [{ ...week, indirectUniqueSetCount: 1 }],
  exercises: [{
    stableKey: curlSet.stableKey,
    exerciseName: curlSet.exerciseName,
    resistanceType: curlSet.resistanceType,
    directUniqueSetCount: 1,
    indirectUniqueSetCount: 1,
    totalUniqueSetCount: 1,
    sessions: 1,
    sets: [curlSet],
    performanceTrend: { status: "insufficient-data", comparableSessionCount: 1, comparedSetPairs: 0, note: "Synthetic QA fixture; not user data.", segments: [] },
  }],
};

function emptyGroup(groupId) {
  return {
    groupId,
    source: "canonical-analytics-contract",
    status: "unavailable",
    directUniqueSetCount: null,
    indirectUniqueSetCount: null,
    totalUniqueSetCount: null,
    mappingCoverage: "unknown",
    note: "No synthetic source entries.",
    loggedTrainingDayCount: null,
    loggedExposureIntervals: [],
    reportedRirSetCount: 0,
    unreportedRirSetCount: 0,
    rirCounts: [],
    anatomy: [],
    weekly: [],
    exercises: [],
  };
}

function makeAnalytics(weeks) {
  const empty = mockScenario === "empty";
  return {
    contract: "bodycast-body-map-training-analytics-v1",
    weeks,
    period: { from: "2026-10-23T00:00:00.000Z", to: "2026-11-20T23:59:59.999Z" },
    coverage: empty
      ? { completedSessionCount: 0, recordedSetCount: 0, mappedSetCount: 0, partiallyMappedSetCount: 0, unmappedSetCount: 0, mapping: "unknown", note: "No synthetic source entries.", sources: [] }
      : {
        completedSessionCount: 1,
        recordedSetCount: 3,
        mappedSetCount: 2,
        partiallyMappedSetCount: 2,
        unmappedSetCount: 1,
        mapping: "partial",
        note: "Synthetic QA fixture; not user data.",
        sources: [
          { setId: 7001, sessionId: 77, sessionDate: "2026-11-20", exerciseName: set.exerciseName, exerciseStableKey: set.stableKey, exerciseIndex: 2, setNumber: 1, reps: 8, resistanceType: "EXTERNAL_WEIGHT", weightKg: 25, bandNominalResistanceKg: null, rir: 4, mappingCoverage: "partial", projectedToBodyMap: true, anatomyIds: set.anatomyIds },
          { setId: 7002, sessionId: 77, sessionDate: "2026-11-20", exerciseName: "Нерозпізнена вправа", exerciseStableKey: null, exerciseIndex: 1, setNumber: 1, reps: 6, resistanceType: "EXTERNAL_WEIGHT", weightKg: 20, bandNominalResistanceKg: null, rir: null, mappingCoverage: "unavailable", projectedToBodyMap: false, anatomyIds: [] },
          { setId: 7003, sessionId: 77, sessionDate: "2026-11-20", exerciseName: curlSet.exerciseName, exerciseStableKey: curlSet.stableKey, exerciseIndex: 3, setNumber: 1, reps: 10, resistanceType: "EXTERNAL_WEIGHT", weightKg: 12, bandNominalResistanceKg: null, rir: 3, mappingCoverage: "partial", projectedToBodyMap: true, anatomyIds: curlSet.anatomyIds },
        ],
      },
    sessions: empty ? [] : [{ id: 77, sessionDate: "2026-11-20", sessionIntent: "easy-deload", trainingBlockLabel: "Deload", trainingWeekNumber: 4, exerciseCount: 3, recordedSetCount: 3 }],
    groups: manifest.bodyMapGroups.map(({ groupId }) => !empty && groupId === "chest" ? chestReport : !empty && groupId === "biceps" ? bicepsReport : emptyGroup(groupId)),
    sessionContexts: empty ? [] : [{
      sessionId: 77,
      sessionDate: "2026-11-20",
      timeZone: "UTC",
      sleep: mockScenario === "unavailable-context" ? null : { status: "recorded", sleepDate: "2026-11-20", totalSleepMinutes: 450, segmentCount: 1, source: ["Synthetic QA fixture"], dateAttribution: "calendar-date" },
      nutrition: mockScenario === "unavailable-context"
        ? { status: "unavailable", date: "2026-11-20", caloriesKcal: null, proteinG: null, source: null, updatedAt: null }
        : { status: "recorded", date: "2026-11-20", caloriesKcal: 2400, proteinG: 150, source: "daily-health-record", updatedAt: "2026-11-20T23:00:00.000Z" },
    }],
  };
}

async function readNextDevIssues(page) {
  return page.evaluate(async () => {
    const root = document.querySelector("nextjs-portal")?.shadowRoot;
    if (!root) return { label: null, messages: [] };
    const button = root.querySelector("[data-issues-open]");
    const label = button?.textContent?.trim() ?? null;
    if (!label || !/\d+\s+Issues?/i.test(label)) return { label, messages: [] };
    button.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
    const messages = [...root.querySelectorAll("div")]
      .filter((element) => element.innerText?.includes("Runtime TypeError") || element.innerText?.includes("Runtime Error"))
      .sort((left, right) => left.innerText.length - right.innerText.length)
      .slice(0, 3)
      .map((element) => element.innerText.slice(0, 1800));
    root.querySelector("[data-issues-collapse]")?.click();
    return { label, messages };
  });
}

await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
let fallbackBrowser;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("bodyparts3d-v4.0-full-body-v3.glb")) failures.console.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const intentionalAssetFailure = url.endsWith(".glb") && request.failure()?.errorText === "net::ERR_FAILED";
    const cancelledAnalyticsRefresh = url.includes("/api/v1/training/body-map/analytics") && request.failure()?.errorText === "net::ERR_ABORTED";
    if (!intentionalAssetFailure && !cancelledAnalyticsRefresh) failures.request.push({ url, error: request.failure()?.errorText });
  });
  await context.route("**/api/v1/profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: { locale: mockLocale } }),
  }));
  await context.route("**/api/v1/training/body-map/analytics**", (route) => {
    const weeks = Number(new URL(route.request().url()).searchParams.get("weeks") ?? 4);
    analyticsRequests.push({ locale: mockLocale, weeks, scenario: mockScenario });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analytics: makeAnalytics(weeks) }) });
  });

  const routeResponse = await page.goto(`${baseUrl}/body-map`, { waitUntil: "domcontentloaded" });
  assert.equal(routeResponse?.status(), 200, "public Body Map route should render");
  await page.getByTestId("body-map-training-analytics").waitFor({ state: "visible" });
  await page.getByText("Записана робота за період", { exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const viewport = document.querySelector('[data-testid="glb-viewport"]');
    return viewport?.getAttribute("data-renderer-available") === "true"
      && Number(viewport.getAttribute("data-scene-mesh-count")) > 0;
  }, undefined, { timeout: 90000 });
  const sceneMeshCount = Number(await page.locator('[data-testid="glb-viewport"]').getAttribute("data-scene-mesh-count"));
  assert.ok(sceneMeshCount > 0, "3D GLB mesh scene should be available");

  const responsive = [];
  for (const width of [360, 390, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(80);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scrollWidth <= dimensions.width + 1, `horizontal overflow at ${width}px: ${dimensions.scrollWidth}px`);
    if (width <= 620) {
      const navItems = await page.locator("header nav a").evaluateAll((links) => links.map((link) => ({
        label: link.textContent?.trim(),
        width: link.clientWidth,
        contentWidth: link.scrollWidth,
        height: link.getBoundingClientRect().height,
      })));
      assert.ok(navItems.every(({ width: itemWidth, contentWidth, height }) => itemWidth >= contentWidth && height >= 44), `mobile navigation clips text or misses touch target at ${width}px`);
    }
    responsive.push(dimensions);
    await page.screenshot({ path: resolve(artifactDirectory, `overview-uk-${width}.png`), ...screenshotOptions });
  }

  const coverageChecks = [
    { label: "Завершені сесії", rows: 1, count: 1 },
    { label: "Записані підходи", rows: 3, count: 3 },
    { label: "Зіставлені підходи", rows: 2, count: 2 },
    { label: "Частковий мапінг", rows: 2, count: 2 },
    { label: "Підходи без мапінгу", rows: 1, count: 1 },
  ];
  for (const check of coverageChecks) {
    await page.getByRole("button", { name: new RegExp(`Показати джерельні записи для показника «${check.label}»: ${check.count}`) }).click();
    const sources = page.locator("#body-map-source-records");
    await sources.waitFor({ state: "visible" });
    assert.equal(await sources.locator("li").count(), check.rows, `${check.label} should open the grouped raw records that explain its count`);
    assert.ok((await sources.locator("a").count()) > 0, `${check.label} source rows should link back to the Training diary`);
    if (check.label === "Підходи без мапінгу") {
      await page.locator("aside").screenshot({ path: resolve(artifactDirectory, "coverage-unmapped-source-uk.png"), ...screenshotOptions });
    }
    await sources.getByRole("button", { name: "Закрити" }).click();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(120);
  await page.waitForFunction(() => typeof window.__bodycastBodyMapDebug?.getPickCandidates === "function");
  const meshPickCandidate = await page.evaluate(() => window.__bodycastBodyMapDebug.getPickCandidates()
    .find((candidate) => candidate.groupId === "chest"));
  assert.ok(meshPickCandidate, "3D chest mesh should expose a pickable raycast point");
  const meshPickProbe = await page.evaluate(({ x, y }) => window.__bodycastBodyMapDebug.getPickAtClient(x, y), meshPickCandidate);
  assert.equal(meshPickProbe?.groupId, "chest", `3D pick ray should resolve to chest; probe=${JSON.stringify(meshPickProbe)}`);
  await page.mouse.click(meshPickCandidate.x, meshPickCandidate.y);
  await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-navigation-group") === "chest", undefined, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-focus-ready") === "true", undefined, { timeout: 30000 });
  await page.getByRole("heading", { name: "Груди" }).first().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(new URL(page.url()).searchParams.get("group"), "chest", "clicking the 3D mesh should select its mapped muscle group");
  await page.screenshot({ path: resolve(artifactDirectory, "chest-mesh-pick-uk-1280.png"), ...screenshotOptions });
  await page.getByRole("button", { name: /Показати джерельні записи для показника «Допоміжні підходи»: 0/ }).click();
  await page.getByText("Для цього показника немає зіставлених джерельних підходів.", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Показати джерельні підходи за тиждень від/ }).first().click();
  assert.match(await page.locator("#body-map-source-records").innerText(), /Жим гантелей на похилій лаві/);
  await page.getByRole("button", { name: /Показати джерельні підходи з RIR 4: 1/ }).click();
  assert.match(await page.locator("#body-map-source-records").innerText(), /Жим гантелей на похилій лаві/);
  await page.getByRole("button", { name: /Показати джерельні записи для показника «Прямі підходи»/ }).click();
  await page.getByRole("region", { name: "Джерельні записи" }).waitFor({ state: "visible" });
  assert.match(await page.locator("#body-map-source-records").innerText(), /Жим гантелей на похилій лаві/);
  assert.match(await page.locator("#body-map-source-records a").getAttribute("href"), /\/training\/sessions\/77\?exercise=2/);
  const devIssueSummary = await readNextDevIssues(page);
  await page.locator("aside").screenshot({ path: resolve(artifactDirectory, "chest-direct-source-uk.png"), ...screenshotOptions });

  const periodResponses = [];
  for (const weeks of [8, 12, 4]) {
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/v1/training/body-map/analytics?weeks=${weeks}`));
    await page.getByLabel("Період журналу").selectOption(String(weeks));
    periodResponses.push({ weeks, status: (await responsePromise).status() });
    assert.equal(periodResponses.at(-1).status, 200, `period ${weeks} should load`);
  }

  const exercise = page.locator("details").filter({ hasText: "Жим гантелей на похилій лаві вгору (30°)" }).first();
  await exercise.locator("summary").click();
  await page.getByText("90 с", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Перед цією вправою: Жим гантелей лежачи (2)", { exact: true }).waitFor({ state: "visible" });
  await page.locator('[aria-label="Тренди за фазами тренування"]').waitFor({ state: "visible" });
  await page.getByText("Base", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Deload", { exact: true }).waitFor({ state: "visible" });
  await page.locator('[data-status="different"]').waitFor({ state: "visible" });
  await page.getByText("Повнота харчового журналу", { exact: false }).waitFor({ state: "visible" });
  await exercise.screenshot({ path: resolve(artifactDirectory, "easy-day-plan-and-context-uk.png"), ...screenshotOptions });

  await page.getByTestId("subregion-pectoralis_major_clavicular_head").click();
  await page.getByTestId("subregion-identity-card").waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("heading", { name: "Ключична частина великого грудного м’яза" }).first().waitFor({ state: "visible" });
  await page.locator("aside").screenshot({ path: resolve(artifactDirectory, "chest-subregion-uk.png"), ...screenshotOptions });

  await page.goto(`${baseUrl}/body-map?group=biceps`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Згиначі ліктя" }).first().waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: /Показати джерельні записи для показника «Допоміжні підходи»: 1/ }).click();
  assert.match(await page.locator("#body-map-source-records").innerText(), /Згинання однієї руки від коліна/);
  await page.locator("aside").screenshot({ path: resolve(artifactDirectory, "biceps-group-indirect-uk.png"), ...screenshotOptions });
  await page.getByRole("button", { name: /Показати допоміжні джерельні підходи за тиждень від/ }).click();
  assert.match(await page.locator("#body-map-source-records").innerText(), /Згинання однієї руки від коліна/);
  await page.getByTestId("subregion-brachialis").click();
  await page.getByTestId("subregion-identity-card").waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: /Показати джерельні записи для показника «Прямі підходи»: 0/ }).click();
  await page.getByText("Для цього показника немає зіставлених джерельних підходів.", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Показати джерельні записи для показника «Допоміжні підходи»: 1/ }).click();
  assert.match(await page.locator("#body-map-source-records").innerText(), /Згинання однієї руки від коліна/);
  await page.locator("aside").screenshot({ path: resolve(artifactDirectory, "biceps-brachialis-indirect-uk.png"), ...screenshotOptions });

  mockScenario = "unavailable-context";
  await page.goto(`${baseUrl}/body-map?group=biceps`, { waitUntil: "domcontentloaded" });
  const curlExercise = page.locator("details").filter({ hasText: "Згинання однієї руки від коліна" }).first();
  await curlExercise.locator("summary").click();
  await page.getByText("Запису сну немає; це не означає нуль сну.", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Запису ккал або білка за цю дату немає; це не означає нульове споживання.", { exact: true }).waitFor({ state: "visible" });
  await page.locator("aside").screenshot({ path: resolve(artifactDirectory, "context-unavailable-uk.png"), ...screenshotOptions });
  mockScenario = "partial";

  mockLocale = "en";
  await page.goto(`${baseUrl}/body-map`, { waitUntil: "domcontentloaded" });
  await page.getByText("Diary window", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.getByTestId("group-select-chest").focus();
  await page.keyboard.press("Tab");
  const keyboardFocusIndicator = await page.evaluate(() => document.activeElement instanceof HTMLElement
    && document.activeElement.matches(":focus-visible")
    && getComputedStyle(document.activeElement).boxShadow !== "none");
  assert.ok(keyboardFocusIndicator, "keyboard tab navigation should show a visible focus indicator");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Chest" }).first().waitFor({ state: "visible", timeout: 20000 });
  assert.match(new URL(page.url()).searchParams.get("group") ?? "", /chest/);
  await page.screenshot({ path: resolve(artifactDirectory, "chest-group-en-1280.png"), ...screenshotOptions });

  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  await page.getByTestId("subregion-pectoralis_major_clavicular_head").click();
  await page.getByTestId("subregion-identity-card").waitFor({ state: "visible", timeout: 20000 });
  const subregionUrl = page.url();
  await page.goBack();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("region") === null);
  await page.waitForFunction(() => document.querySelector('[data-navigation-level="GROUP_DETAIL"]'));
  await page.goForward();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("region") === "pectoralis_major_clavicular_head");
  await page.waitForFunction(() => document.querySelector('[data-navigation-level="SUBREGION_DETAIL"]'));
  assert.equal(page.url(), subregionUrl, "forward navigation should restore the selected anatomy URL");

  mockScenario = "empty";
  await page.goto(`${baseUrl}/body-map`, { waitUntil: "domcontentloaded" });
  await page.getByText("No completed diary sessions were logged in this window.", { exact: false }).waitFor({ state: "visible" });
  assert.match(await page.getByTestId("body-map-training-analytics").innerText(), /No diary data|No completed diary sessions/);
  await page.screenshot({ path: resolve(artifactDirectory, "empty-state-en-1280.png"), ...screenshotOptions });
  await context.close();

  mockScenario = "partial";
  mockLocale = "uk";
  fallbackBrowser = await chromium.launch({ headless: true, args: ["--disable-webgl"] });
  const mobileContext = await fallbackBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobileContext.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
  await mobileContext.route("**/api/v1/profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: { locale: mockLocale } }) }));
  await mobileContext.route("**/api/v1/training/body-map/analytics**", (route) => {
    const weeks = Number(new URL(route.request().url()).searchParams.get("weeks") ?? 4);
    analyticsRequests.push({ locale: mockLocale, weeks, scenario: mockScenario, renderer: "2d-fallback" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analytics: makeAnalytics(weeks) }) });
  });
  const fallbackPage = await mobileContext.newPage();
  fallbackPage.on("pageerror", (error) => failures.page.push(error.message));
  fallbackPage.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("WebGL context could not be created") || text.includes("Error creating WebGL context")) {
      expectedFallbackDiagnostics.push(text.split("\n")[0]);
    } else {
      failures.console.push(text);
    }
  });
  const fallbackResponse = await fallbackPage.goto(`${baseUrl}/body-map`, { waitUntil: "domcontentloaded" });
  assert.equal(fallbackResponse?.status(), 200);
  await fallbackPage.getByTestId("body-map-2d-fallback").waitFor({ state: "visible", timeout: 30000 });
  const fallbackDevIssueSummary = {
    label: "Expected renderer diagnostics from the deliberate WebGL-disabled run",
    messages: [...expectedFallbackDiagnostics],
  };
  await fallbackPage.getByTestId("fallback-list-chest").click();
  await fallbackPage.getByRole("heading", { name: "Груди" }).first().waitFor({ state: "visible" });
  await fallbackPage.locator('[data-testid="glb-viewport"]').screenshot({ path: resolve(artifactDirectory, "fallback-2d-map-uk-390.png"), ...screenshotOptions });
  await fallbackPage.locator("aside").screenshot({ path: resolve(artifactDirectory, "fallback-2d-chest-uk-390.png"), ...screenshotOptions });
  const fallbackTouchTargets = await fallbackPage.locator('[data-testid^="fallback-list-"]').evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  assert.ok(fallbackTouchTargets.length > 0, "fallback map should expose selectable touch hotspots");
  assert.ok(fallbackTouchTargets.every(({ width, height }) => width >= 44 && height >= 44), "2D map hotspots should meet 44px touch targets");
  await fallbackPage.getByRole("button", { name: "Показати джерельні записи для показника «Прямі підходи»: 1" }).click();
  await fallbackPage.getByRole("region", { name: "Джерельні записи" }).waitFor({ state: "visible" });
  const analyticsTouchTargets = await fallbackPage.locator("#body-map-source-records a, .sourceClose").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  assert.ok(analyticsTouchTargets.every(({ height }) => height >= 44), "source actions should meet 44px touch targets");
  await mobileContext.close();
  await fallbackBrowser.close();
  fallbackBrowser = undefined;

  assert.deepEqual(failures, { page: [], console: [], request: [] }, "no unexpected page, console, or network errors");
  const report = {
    status: "PASS",
    route: "/body-map",
    routeStatus: routeResponse.status(),
    database: "not used; profile and analytics API responses mocked with synthetic fixtures",
    renderer: "WebGL 3D asset loaded and selectable scene mesh count was positive",
    sceneMeshCount,
    meshPick: { groupId: meshPickCandidate.groupId, meshId: meshPickCandidate.meshId, role: meshPickCandidate.role, raycastConfirmed: meshPickProbe.groupId === "chest" },
    responsive,
    periods: periodResponses,
    flows: {
      sourceDrilldown: "all five period coverage metrics open their actual sessions or set records; mapped, partial, and unmapped records match the corresponding counters; direct, indirect, weekly, RIR, and subregion metrics have source filters",
      mixedAnatomyExposure: "concentration curl is direct for biceps brachii and indirect for brachialis; group and weekly indirect drilldowns return the set, and brachialis indirect is separate from direct",
      unavailableContext: "session with missing sleep and nutrition logs states unavailable without treating them as zero",
      easyDay: "explicit easy-day plan/actual comparison; different plan reported without inferring regression",
      exerciseOrderAndRest: "session order and recorded rest rendered",
      periodTrends: "phase-separated example rendered with insufficient-data state for the easy-day segment",
      anatomy: "pectoralis major clavicular head selected and linked to partial mapped exposure",
      keyboard: "Tab focus ring was visible, then Enter activated the Chest group button",
      reducedMotion: "prefers-reduced-motion emulation active during subregion navigation and browser history checks",
      history: "back/forward restored the group and subregion URL states",
      emptyState: "no completed diary sessions rendered without presenting missing data as a physiological zero",
      fallback: "2D fallback selected chest and opened the same source records",
      touchTargets: { fallback: fallbackTouchTargets, sourceActions: analyticsTouchTargets },
      localization: ["uk", "en"],
    },
    analyticsRequests,
    unexpectedErrors: failures,
    devIssueSummary,
    fallbackDevIssueSummary,
    expectedFallbackDiagnostics,
    screenshots: [
      ...[360, 390, 768, 1280, 1440, 1920].map((width) => `overview-uk-${width}.png`),
      "coverage-unmapped-source-uk.png",
      "chest-direct-source-uk.png",
      "easy-day-plan-and-context-uk.png",
      "chest-subregion-uk.png",
      "biceps-group-indirect-uk.png",
      "biceps-brachialis-indirect-uk.png",
      "context-unavailable-uk.png",
      "chest-mesh-pick-uk-1280.png",
      "chest-group-en-1280.png",
      "empty-state-en-1280.png",
      "fallback-2d-map-uk-390.png",
      "fallback-2d-chest-uk-390.png",
    ],
  };
  await writeFile(resolve(artifactDirectory, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, sceneMeshCount, responsive, periods: periodResponses, screenshots: report.screenshots.length, failures }, null, 2));
} finally {
  if (fallbackBrowser) await fallbackBrowser.close();
  await browser.close();
}

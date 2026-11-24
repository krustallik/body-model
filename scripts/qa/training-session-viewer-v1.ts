import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import type { StrengthSessionDto, StrengthSetDto } from "@/modules/training/training.types";
import type { Page } from "playwright";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright") as typeof import("playwright");
const sharp = require("sharp") as typeof import("sharp").default;
const baseUrl = process.env.BODYCAST_QA_BASE_URL ?? "http://127.0.0.1:3002";
const artifactDirectory = resolve(process.env.BODYCAST_QA_OUTPUT ?? ".qa-artifacts/training-session-viewer-v1");
const FIXED_TIME = "2026-11-22T23:59:59.999Z";
const SESSION_ID = 42;
const SCREENSHOT_STYLE = "nextjs-portal { display: none !important; }";

type BrowserEvidence = {
  page: Array<{ page: string; message: string }>;
  console: Array<{ page: string; message: string }>;
  request: Array<{ page: string; url: string; error: string | undefined }>;
  http: Array<{ page: string; url: string; status: number }>;
  apiResponses: Array<{ page: string; method: string; path: string; status: number }>;
};

function observeBrowserPage(page: Page, pageName: string, evidence: BrowserEvidence): void {
  page.on("pageerror", (error) => evidence.page.push({ page: pageName, message: error.stack ?? error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.console.push({ page: pageName, message: message.text() });
  });
  page.on("requestfailed", (request) => evidence.request.push({
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

function buildSession(overrides: Partial<StrengthSessionDto> = {}): StrengthSessionDto {
  return {
    id: SESSION_ID,
    status: SESSION_STATUS.ACTIVE,
    entryMode: ENTRY_MODE.LIVE,
    revision: 1,
    programId: 7,
    programName: "ТИСНИ",
    programVersionId: 11,
    programVersionNumber: 1,
    webStartedAt: "2026-09-17T16:00:00.000Z",
    webEndedAt: null,
    matchStatus: MATCH_STATUS.PENDING,
    matchMethod: null,
    matchedAt: null,
    matchedWorkoutId: null,
    matchedWorkout: null,
    ordinaryTonnageKg: null,
    createdAt: "2026-09-17T16:00:00.000Z",
    updatedAt: "2026-09-17T16:00:00.000Z",
    exercises: [
      {
        id: 1,
        sourceExerciseCatalogId: 3,
        stableKey: null,
        snapshotExerciseName: "Жим гантелей на похилій лаві вгору (30°)",
        order: 0,
        plannedSets: 4,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
      {
        id: 2,
        sourceExerciseCatalogId: 4,
        stableKey: null,
        snapshotExerciseName: "Розведення гантелей на горизонтальній лаві",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
      {
        id: 3,
        sourceExerciseCatalogId: 5,
        stableKey: null,
        snapshotExerciseName: "Віджимання від ручок",
        order: 2,
        plannedSets: 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
    ],
    ...overrides,
  };
}

function completionSession(): StrengthSessionDto {
  return buildSession({
    exercises: [{
      id: 3,
      sourceExerciseCatalogId: 5,
      stableKey: null,
      snapshotExerciseName: "Віджимання від ручок",
      order: 0,
      plannedSets: 1,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      muscleMappingSnapshot: null,
      sets: [],
    }],
  });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function compareScreenshotPixels(firstPng: Buffer, secondPng: Buffer) {
  const [first, second] = await Promise.all([
    sharp(firstPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(secondPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(first.info.width, second.info.width);
  assert.equal(first.info.height, second.info.height);
  let differentPixels = 0;
  let maxChannelDelta = 0;
  let minX = first.info.width;
  let minY = first.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < first.info.width * first.info.height; pixel += 1) {
    const offset = pixel * 4;
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      pixelDelta = Math.max(pixelDelta, Math.abs(first.data[offset + channel]! - second.data[offset + channel]!));
    }
    if (pixelDelta === 0) continue;
    differentPixels += 1;
    maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
    const x = pixel % first.info.width;
    const y = Math.floor(pixel / first.info.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    differentPixels,
    maxChannelDelta,
    bounds: differentPixels === 0 ? null : { minX, minY, maxX, maxY },
  };
}

function jsonResponse(status: number, value: unknown) {
  const body = JSON.stringify(value);
  return { status, contentType: "application/json", body };
}

type ApiEvent = {
  method: string;
  path: string;
  status: number;
  requestBodySha256: string | null;
  responseBodySha256: string;
  idempotencyKey: string | null;
};

type ApiState = {
  currentSession: StrengthSessionDto;
  requests: ApiEvent[];
  unexpected: Array<{ method: string; path: string }>;
  setCalls: Array<{ idempotencyKey: string | null; payload: Record<string, unknown> }>;
  finishCalls: number;
  cancelCalls: number;
  postFinishRequests: Array<{ method: string; path: string }>;
  scenario: "normal" | "retry" | "finish" | "cancel" | "load-error";
};

async function installApi(page: import("playwright").Page, session: StrengthSessionDto, scenario: ApiState["scenario"]): Promise<ApiState> {
  const state: ApiState = {
    currentSession: structuredClone(session),
    requests: [],
    unexpected: [],
    setCalls: [],
    finishCalls: 0,
    cancelCalls: 0,
    postFinishRequests: [],
    scenario,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;
    const requestBody = request.postData() ?? "";
    const requestBodySha256 = requestBody ? sha256(requestBody) : null;
    const idempotencyKey = request.headers()["idempotency-key"] ?? null;
    let response = jsonResponse(200, {});
    let expected = true;

    if (url.pathname === "/api/v1/profile" && method === "GET") {
      response = jsonResponse(200, { profile: { locale: "uk" } });
    } else if (url.pathname === `/api/v1/training/sessions/${SESSION_ID}` && method === "GET") {
      response = scenario === "load-error"
        ? jsonResponse(503, { error: "internal_error" })
        : jsonResponse(200, { session: state.currentSession });
    } else if (url.pathname.startsWith(`/api/v1/training/sessions/${SESSION_ID}/exercises/`) && url.pathname.endsWith("/history") && method === "GET") {
      response = jsonResponse(200, { entries: [] });
    } else if (url.pathname === `/api/v1/training/sessions/${SESSION_ID}/match-candidates` && method === "GET") {
      response = jsonResponse(200, { candidates: [] });
    } else if (url.pathname.startsWith("/api/v1/training/set-create-operations/") && method === "GET") {
      const operationId = url.pathname.split("/").at(-1) ?? "";
      const committed = state.setCalls.length > 1 && scenario === "retry";
      const latestSet = state.currentSession.exercises.flatMap(({ sets }) => sets).at(-1) ?? null;
      response = jsonResponse(200, committed && latestSet
        ? { operationId, state: "COMMITTED", set: latestSet }
        : { operationId, state: "NOT_FOUND" });
    } else if (url.pathname.match(new RegExp(`^/api/v1/training/sessions/${SESSION_ID}/exercises/\\d+/sets$`)) && method === "POST") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      state.setCalls.push({ idempotencyKey, payload });
      if (scenario === "retry" && state.setCalls.length === 1) {
        response = jsonResponse(409, { error: "training_concurrent_mutation" });
      } else {
        const exerciseId = Number(url.pathname.split("/").at(-2));
        const exercise = state.currentSession.exercises.find(({ id }) => id === exerciseId);
        assert.ok(exercise, `fixture exercise ${exerciseId} should exist`);
        const now = FIXED_TIME;
        const savedSet: StrengthSetDto = {
          id: 91 + state.setCalls.length - 1,
          sessionExerciseId: exerciseId,
          setNumber: exercise.sets.length + 1,
          reps: Number(payload.reps),
          weightKg: payload.weightKg === null || payload.weightKg === undefined ? null : Number(payload.weightKg),
          bandNominalResistanceKg: payload.bandNominalResistanceKg === null || payload.bandNominalResistanceKg === undefined
            ? null : Number(payload.bandNominalResistanceKg),
          rir: payload.rir === null || payload.rir === undefined ? null : Number(payload.rir),
          restBeforeSeconds: payload.restBeforeSeconds === null || payload.restBeforeSeconds === undefined ? null : Number(payload.restBeforeSeconds),
          comment: typeof payload.comment === "string" ? payload.comment : null,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
          loadAccountingOverride: payload.loadAccountingOverride ?? null,
        };
        state.currentSession = {
          ...state.currentSession,
          exercises: state.currentSession.exercises.map((candidate) => candidate.id !== exerciseId
            ? candidate : { ...candidate, sets: [...candidate.sets, savedSet] }),
        };
        response = scenario === "retry" && state.setCalls.length > 1
          ? jsonResponse(201, { operationId: idempotencyKey, state: "COMMITTED", set: savedSet })
          : jsonResponse(201, { set: savedSet });
      }
    } else if (url.pathname === `/api/v1/training/sessions/${SESSION_ID}/finish` && method === "POST") {
      state.finishCalls += 1;
      state.currentSession = {
        ...state.currentSession,
        status: SESSION_STATUS.COMPLETED,
        webEndedAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
      };
      response = jsonResponse(200, { session: state.currentSession, modelPublicationStatus: "current" });
    } else if (url.pathname === `/api/v1/training/sessions/${SESSION_ID}/cancel` && method === "POST") {
      state.cancelCalls += 1;
      state.currentSession = { ...state.currentSession, status: SESSION_STATUS.CANCELLED, updatedAt: FIXED_TIME };
      response = jsonResponse(200, { ok: true });
    } else {
      expected = false;
      if (state.currentSession.status === SESSION_STATUS.COMPLETED || state.currentSession.status === SESSION_STATUS.CANCELLED) {
        state.postFinishRequests.push({ method, path });
      } else {
        state.unexpected.push({ method, path });
      }
      response = jsonResponse(501, { error: "unexpected_qa_request" });
    }

    state.requests.push({
      method,
      path,
      status: response.status,
      requestBodySha256,
      responseBodySha256: sha256(response.body),
      idempotencyKey,
    });
    await route.fulfill(response);
    if (!expected && state.currentSession.status !== SESSION_STATUS.COMPLETED && state.currentSession.status !== SESSION_STATUS.CANCELLED) {
      return;
    }
  });
  return state;
}

async function createPage(
  browser: import("playwright").Browser,
  session: StrengthSessionDto,
  scenario: ApiState["scenario"],
): Promise<{ context: import("playwright").BrowserContext; page: import("playwright").Page; api: ApiState }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "uk-UA", timezoneId: "UTC" });
  await context.addCookies([{ name: "better-auth.session_token", value: "local-qa-only", url: baseUrl }]);
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript({
    content: `let sequence = 0;
      Object.defineProperty(window.crypto, "randomUUID", {
        configurable: true,
        value: function deterministicQaUuid() {
          sequence += 1;
          return "00000000-0000-4000-8000-" + String(sequence).padStart(12, "0");
        },
      });`,
  });
  const api = await installApi(page, session, scenario);
  return { context, page, api };
}

function waitForSetResponse(page: import("playwright").Page) {
  return page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/sets"));
}

function activePane(page: import("playwright").Page) {
  return page.getByTestId("active-exercise-pane");
}

async function main(): Promise<void> {
  const url = new URL(baseUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname), "Training UI QA must target a loopback preview server");
  assert.ok(!["production"].includes(process.env.NODE_ENV ?? ""), "Training UI QA cannot run in production");
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runnerPath = resolve("scripts/qa/training-session-viewer-v1.ts");
  const sessionClientPath = resolve("src/app/training/sessions/[id]/session-client.tsx");
  const workspacePath = resolve("src/app/training/training-exercise-workspace.tsx");
  const panePath = resolve("src/app/training/training-exercise-pane.tsx");
  const fixture = buildSession();
  await mkdir(artifactDirectory, { recursive: false });
  await writeFile(resolve(artifactDirectory, "training-session-fixture.json"), JSON.stringify(fixture, null, 2));

  const browser = await chromium.launch({ headless: true });
  const apiTrace: ApiEvent[] = [];
  const browserErrors: BrowserEvidence = { page: [], console: [], request: [], http: [], apiResponses: [] };
  const viewportResults: Array<{
    viewportWidth: number;
    documentWidth: number;
    bodyWidth: number;
    activePaneWidth: number;
    domStateSha256: string;
    screenshotSha256: string;
    repeatSha256: string;
    rasterDiff: Awaited<ReturnType<typeof compareScreenshotPixels>>;
  }> = [];
  let interactionEvidence: Record<string, unknown> = {};
  let retryEvidence: Record<string, unknown> = {};
  let finishEvidence: Record<string, unknown> = {};
  let cancelEvidence: Record<string, unknown> = {};
  let loadingEvidence: Record<string, unknown> = {};
  let loadErrorEvidence: Record<string, unknown> = {};
  try {
    const baseline = await createPage(browser, fixture, "normal");
    observeBrowserPage(baseline.page, "baseline-interactions-and-views", browserErrors);
    await baseline.page.emulateMedia({ reducedMotion: "reduce" });
    await baseline.page.goto(`${baseUrl}/training/sessions/${SESSION_ID}?returnTo=%2Ftraining`, { waitUntil: "domcontentloaded" });
    await baseline.page.getByText(fixture.programName!, { exact: true }).waitFor({ state: "visible" });
    await baseline.page.getByRole("heading", { name: fixture.exercises[0]!.snapshotExerciseName }).waitFor({ state: "visible" });
    await baseline.page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
    });
    const initiallyDisabled = await baseline.page.getByRole("button", { name: "Додати підхід" }).isDisabled();
    assert.equal(initiallyDisabled, true, "an incomplete set draft should not be submitted");

    for (const width of [360, 390, 768, 1280]) {
      await baseline.page.setViewportSize({ width, height: 900 });
      await baseline.page.waitForTimeout(1_200);
      const dimensions = await baseline.page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        activePaneWidth: document.querySelector('[data-testid="active-exercise-pane"]')?.getBoundingClientRect().width ?? 0,
      }));
      assert.ok(dimensions.documentWidth <= width, `Training UI overflows horizontally at ${width}px`);
      const beforeScreenshotDomState = await baseline.page.locator("body").innerText();
      const screenshot = await baseline.page.screenshot({ animations: "disabled", caret: "hide", style: SCREENSHOT_STYLE });
      const screenshotRepeat = await baseline.page.screenshot({ animations: "disabled", caret: "hide", style: SCREENSHOT_STYLE });
      const screenshotSha256 = sha256(screenshot);
      const repeatSha256 = sha256(screenshotRepeat);
      const afterScreenshotDomState = await baseline.page.locator("body").innerText();
      assert.equal(afterScreenshotDomState, beforeScreenshotDomState, `DOM text/state should remain unchanged across the ${width}px screenshot pair`);
      const rasterDiff = await compareScreenshotPixels(screenshot, screenshotRepeat);
      // Allow only up to eight one-channel, one-level rasterization edge deltas; any larger or darker/brighter change fails closed.
      assert.ok(rasterDiff.differentPixels <= 8 && rasterDiff.maxChannelDelta <= 1,
        `screenshot pixels changed beyond anti-aliasing noise at ${width}px: ${JSON.stringify(rasterDiff)}`);
      await writeFile(resolve(artifactDirectory, `debug-training-${width}-first.png`), screenshot);
      await writeFile(resolve(artifactDirectory, `debug-training-${width}-repeat.png`), screenshotRepeat);
      await writeFile(resolve(artifactDirectory, `training-session-${width}.png`), screenshot);
      viewportResults.push({ viewportWidth: width, ...dimensions, domStateSha256: sha256(beforeScreenshotDomState), screenshotSha256, repeatSha256, rasterDiff });
    }

    await baseline.page.setViewportSize({ width: 1280, height: 900 });
    const nextButton = baseline.page.getByRole("button", { name: /Наступна вправа/i }).first();
    await nextButton.focus();
    const nextButtonFocused = await nextButton.evaluate((element) => document.activeElement === element);
    assert.equal(nextButtonFocused, true, "exercise navigation control should be keyboard focusable");
    await nextButton.press("Enter");
    await baseline.page.getByRole("heading", { name: fixture.exercises[1]!.snapshotExerciseName }).waitFor({ state: "visible" });
    await baseline.page.keyboard.press("ArrowRight");
    await baseline.page.getByRole("heading", { name: fixture.exercises[2]!.snapshotExerciseName }).waitFor({ state: "visible" });
    await baseline.page.keyboard.press("ArrowLeft");
    await baseline.page.getByRole("heading", { name: fixture.exercises[1]!.snapshotExerciseName }).waitFor({ state: "visible" });
    const previousButton = baseline.page.getByRole("button", { name: /Попередня вправа/i }).first();
    await previousButton.focus();
    await previousButton.press("Enter");
    await baseline.page.getByRole("heading", { name: fixture.exercises[0]!.snapshotExerciseName }).waitFor({ state: "visible" });

    const weightField = activePane(baseline.page).getByLabel("Вага, кг");
    const repsField = activePane(baseline.page).getByLabel("Повтори");
    await weightField.fill("30");
    await repsField.fill("12");
    assert.equal(await baseline.page.getByRole("button", { name: "Додати підхід" }).isDisabled(), false);
    await writeFile(resolve(artifactDirectory, "training-set-create-payload.json"), JSON.stringify(baseline.api.setCalls, null, 2));
    const saveResponsePromise = waitForSetResponse(baseline.page);
    await baseline.page.getByRole("button", { name: "Додати підхід" }).click();
    const saveResponse = await saveResponsePromise;
    assert.equal(saveResponse.status(), 201);
    await baseline.page.getByText("30 кг × 12", { exact: false }).first().waitFor({ state: "visible" });
    assert.equal(baseline.api.setCalls.length, 1, "a single explicit add action should create one set request");
    assert.deepEqual(baseline.api.setCalls[0]?.payload, {
      reps: 12,
      weightKg: 30,
      bandNominalResistanceKg: null,
      rir: null,
      comment: null,
    });
    await writeFile(resolve(artifactDirectory, "training-set-create-payload.json"), JSON.stringify(baseline.api.setCalls, null, 2));

    await baseline.page.getByRole("button", { name: "Редагувати підхід 1" }).click();
    await activePane(baseline.page).getByLabel("RIR").fill("3");
    await baseline.page.getByRole("button", { name: "Скасувати", exact: true }).click();
    await baseline.page.getByRole("button", { name: "Редагувати підхід 1" }).waitFor({ state: "visible" });
    assert.equal(baseline.api.requests.some(({ method, path }) => method === "PATCH" && path.includes("/sets/")), false, "canceling an inline edit must not issue a mutation");
    interactionEvidence = {
      blankValidation: { addDisabled: initiallyDisabled },
      keyboardFocus: { nextButtonFocused, enterNext: true, arrowRight: true, arrowLeft: true, enterPrevious: true },
      setCreate: {
        status: saveResponse.status(),
        requestCount: baseline.api.setCalls.length,
        payload: baseline.api.setCalls[0]?.payload,
        idempotencyKey: baseline.api.setCalls[0]?.idempotencyKey,
      },
      editCancel: { canceled: true, patchCount: baseline.api.requests.filter(({ method, path }) => method === "PATCH" && path.includes("/sets/")).length },
      emptyHistoryAndSets: { historyResponse: { entries: [] }, initialSets: 0 },
    };
    apiTrace.push(...baseline.api.requests);
    assert.deepEqual(baseline.api.unexpected, [], "the Training baseline must not issue unlisted API calls");
    await writeFile(resolve(artifactDirectory, "training-interaction-trace.json"), JSON.stringify({ apiRequests: baseline.api.requests, interactionEvidence }, null, 2));
    await baseline.context.close();

    const retry = await createPage(browser, fixture, "retry");
    observeBrowserPage(retry.page, "explicit-retry", browserErrors);
    await retry.page.emulateMedia({ reducedMotion: "reduce" });
    await retry.page.goto(`${baseUrl}/training/sessions/${SESSION_ID}?returnTo=%2Ftraining`, { waitUntil: "domcontentloaded" });
    await retry.page.getByRole("heading", { name: fixture.exercises[0]!.snapshotExerciseName }).waitFor({ state: "visible" });
    await activePane(retry.page).getByLabel("Вага, кг").fill("30");
    await activePane(retry.page).getByLabel("Повтори").fill("12");
    const firstRetryResponsePromise = waitForSetResponse(retry.page);
    await retry.page.getByRole("button", { name: "Додати підхід" }).click();
    const firstRetryResponse = await firstRetryResponsePromise;
    assert.equal(firstRetryResponse.status(), 409);
    const createAgain = retry.page.getByRole("button", { name: "Створити знову" });
    await createAgain.waitFor({ state: "visible" });
    assert.equal(retry.api.setCalls.length, 1, "unknown conflict should not automatically repeat the create request");
    assert.ok(retry.api.setCalls[0]?.idempotencyKey);
    const retryResponsePromise = waitForSetResponse(retry.page);
    await createAgain.click();
    const retryResponse = await retryResponsePromise;
    assert.equal(retryResponse.status(), 201);
    await retry.page.getByText("30 кг × 12", { exact: false }).first().waitFor({ state: "visible" });
    assert.equal(retry.api.setCalls.length, 2);
    assert.notEqual(retry.api.setCalls[0]?.idempotencyKey, retry.api.setCalls[1]?.idempotencyKey, "explicit retry must create a new idempotency intent after a terminal conflict");
    assert.deepEqual(retry.api.unexpected, []);
    retryEvidence = {
      firstStatus: firstRetryResponse.status(),
      automaticRetries: 0,
      explicitAction: "Створити знову",
      secondStatus: retryResponse.status(),
      idempotencyKeys: retry.api.setCalls.map(({ idempotencyKey }) => idempotencyKey),
      keysDiffer: retry.api.setCalls[0]?.idempotencyKey !== retry.api.setCalls[1]?.idempotencyKey,
    };
    apiTrace.push(...retry.api.requests);
    await retry.context.close();

    const loading = await createPage(browser, fixture, "normal");
    observeBrowserPage(loading.page, "session-loading", browserErrors);
    let finishLoading!: () => void;
    let signalLoading!: () => void;
    const loadingStarted = new Promise<void>((resolveStarted) => { signalLoading = resolveStarted; });
    const continueLoad = new Promise<void>((resolveLoad) => { finishLoading = resolveLoad; });
    await loading.page.unrouteAll({ behavior: "wait" });
    await loading.page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/profile") return route.fulfill(jsonResponse(200, { profile: { locale: "uk" } }));
      if (url.pathname === `/api/v1/training/sessions/${SESSION_ID}`) {
        signalLoading();
        await continueLoad;
        return route.fulfill(jsonResponse(200, { session: fixture }));
      }
      if (url.pathname.endsWith("/history")) return route.fulfill(jsonResponse(200, { entries: [] }));
      if (url.pathname.endsWith("/match-candidates")) return route.fulfill(jsonResponse(200, { candidates: [] }));
      loading.api.unexpected.push({ method: route.request().method(), path: `${url.pathname}${url.search}` });
      return route.fulfill(jsonResponse(501, { error: "unexpected_qa_request" }));
    });
    await loading.page.goto(`${baseUrl}/training/sessions/${SESSION_ID}?returnTo=%2Ftraining`, { waitUntil: "domcontentloaded" });
    await loadingStarted;
    await loading.page.getByText("Завантаження…", { exact: true }).waitFor({ state: "visible" });
    await writeFile(resolve(artifactDirectory, "training-loading.png"), await loading.page.screenshot({ animations: "disabled", style: SCREENSHOT_STYLE }));
    finishLoading();
    await loading.page.getByRole("heading", { name: fixture.exercises[0]!.snapshotExerciseName }).waitFor({ state: "visible" });
    assert.deepEqual(loading.api.unexpected, [], "the loading state must not issue unlisted API calls");
    loadingEvidence = { observed: true, fixedClock: FIXED_TIME };
    await loading.context.close();

    const loadError = await createPage(browser, fixture, "load-error");
    observeBrowserPage(loadError.page, "session-load-error", browserErrors);
    await loadError.page.goto(`${baseUrl}/training/sessions/${SESSION_ID}?returnTo=%2Ftraining`, { waitUntil: "domcontentloaded" });
    await loadError.page.getByRole("alert").waitFor({ state: "visible" });
    await loadError.page.getByText("internal_error", { exact: true }).waitFor({ state: "visible" });
    const loadErrorText = await loadError.page.locator("body").innerText();
    await writeFile(resolve(artifactDirectory, "training-load-error.png"), await loadError.page.screenshot({ animations: "disabled", style: SCREENSHOT_STYLE }));
    assert.match(loadErrorText, /internal_error|Не вдалося завантажити сесію\./, "failed session load should present a visible error state");
    loadErrorEvidence = { status: 503, visibleBodyText: loadErrorText.trim(), retryControl: false };
    assert.deepEqual(loadError.api.unexpected, [], "the error state must not issue unlisted API calls");
    apiTrace.push(...loadError.api.requests);
    await loadError.context.close();

    const cancelled = await createPage(browser, fixture, "cancel");
    observeBrowserPage(cancelled.page, "workout-cancellation", browserErrors);
    await cancelled.page.goto(`${baseUrl}/training/sessions/${SESSION_ID}?returnTo=%2Ftraining`, { waitUntil: "domcontentloaded" });
    await cancelled.page.getByRole("heading", { name: fixture.exercises[0]!.snapshotExerciseName }).waitFor({ state: "visible" });
    await cancelled.page.setViewportSize({ width: 390, height: 844 });
    cancelled.page.on("dialog", async (dialog) => { await dialog.accept(); });
    await cancelled.page.getByRole("button", { name: "Меню сесії" }).click();
    await cancelled.page.getByRole("dialog", { name: "Дії" }).getByRole("button", { name: "Скасувати тренування" }).click();
    await cancelled.page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/cancel"));
    assert.equal(cancelled.api.cancelCalls, 1);
    assert.equal(cancelled.api.currentSession.status, SESSION_STATUS.CANCELLED);
    assert.deepEqual(cancelled.api.unexpected, [], "cancellation must not issue unlisted API calls");
    assert.deepEqual(cancelled.api.postFinishRequests, [], "cancellation must not issue post-terminal unknown requests");
    cancelEvidence = { postCount: cancelled.api.cancelCalls, resultingSessionState: cancelled.api.currentSession.status, browserConfirmationAccepted: true };
    apiTrace.push(...cancelled.api.requests);
    await cancelled.context.close();

    const completion = await createPage(browser, completionSession(), "finish");
    observeBrowserPage(completion.page, "workout-completion", browserErrors);
    await completion.page.goto(`${baseUrl}/training/sessions/${SESSION_ID}?returnTo=%2Ftraining`, { waitUntil: "domcontentloaded" });
    await completion.page.getByRole("heading", { name: "Віджимання від ручок" }).waitFor({ state: "visible" });
    await activePane(completion.page).getByLabel("Повтори").fill("12");
    const completionSetResponsePromise = waitForSetResponse(completion.page);
    await completion.page.getByRole("button", { name: "Додати підхід" }).click();
    const completionSetResponse = await completionSetResponsePromise;
    assert.equal(completionSetResponse.status(), 201);
    const finishOffer = completion.page.getByRole("dialog", { name: "Завершити тренування?" });
    await finishOffer.waitFor({ state: "visible" });
    await finishOffer.getByRole("button", { name: "Ще потренуюсь" }).click();
    await finishOffer.waitFor({ state: "detached" });
    await completion.page.setViewportSize({ width: 390, height: 844 });
    await completion.page.getByRole("button", { name: "Меню сесії" }).click();
    await completion.page.getByRole("dialog", { name: "Дії" }).getByRole("button", { name: "Завершити тренування" }).click();
    const confirmFinish = completion.page.getByRole("dialog", { name: "Завершити тренування?" });
    await confirmFinish.waitFor({ state: "visible" });
    const finishResponsePromise = completion.page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/finish"));
    await confirmFinish.getByRole("button", { name: "Завершити" }).click();
    const finishResponse = await finishResponsePromise;
    assert.equal(finishResponse.status(), 200);
    assert.equal(completion.api.finishCalls, 1);
    assert.equal(completion.api.currentSession.status, SESSION_STATUS.COMPLETED);
    assert.deepEqual(completion.api.unexpected, [], "completion must not issue unlisted API calls");
    assert.deepEqual(completion.api.postFinishRequests, [], "completion must not issue post-terminal unknown requests");
    finishEvidence = {
      completedSetCount: completion.api.currentSession.exercises[0]?.sets.length,
      finishOfferCanceled: true,
      finishConfirmationAccepted: true,
      finishRequestCount: completion.api.finishCalls,
      resultingSessionState: completion.api.currentSession.status,
      finishResponseSha256: sha256(await finishResponse.body()),
    };
    apiTrace.push(...completion.api.requests);
    await completion.context.close();

    assert.deepEqual(browserErrors.page, [], "all characterized Training pages should have no uncaught browser page errors");
    const expectedConsole = browserErrors.console.filter(({ page: pageName, message }) =>
      (pageName === "explicit-retry" && /status of 409 \(Conflict\)/.test(message))
      || (pageName === "session-load-error" && /status of 503 \(Service Unavailable\)/.test(message)),
    );
    const unexpectedConsole = browserErrors.console.filter((message) => !expectedConsole.includes(message));
    assert.deepEqual(unexpectedConsole, [], "all Training console errors must be explicitly classified by the induced API state");
    assert.deepEqual(browserErrors.request, [], "all characterized Training pages should have no failed network requests");
    assert.deepEqual(browserErrors.http, [], "all characterized Training pages should have no non-API HTTP errors");
    await writeFile(resolve(artifactDirectory, "training-session-profile-fixture.json"), JSON.stringify({ profile: { locale: "uk" } }));
    await writeFile(resolve(artifactDirectory, "training-session-completion-fixture.json"), JSON.stringify(completion.api.currentSession, null, 2));
    const runnerHash = sha256(await readFile(runnerPath));
    const appSourceHashes = {
      sessionClient: sha256(await readFile(sessionClientPath)),
      exerciseWorkspace: sha256(await readFile(workspacePath)),
      exercisePane: sha256(await readFile(panePath)),
    };
    const report = {
      status: "PASS",
      baseSha,
      runnerSha256: runnerHash,
      fixtureSource: "independent deterministic synthetic fixture embedded in this QA runner; not imported from a unit-test fixture",
      fixtureBuilder: "scripts/qa/training-session-viewer-v1.ts :: buildSession()",
      fixtureInputSha256: sha256(await readFile(resolve(artifactDirectory, "training-session-fixture.json"))),
      appSourceSha256: appSourceHashes,
      route: `${baseUrl}/training/sessions/${SESSION_ID}`,
      dataAccess: "all /api/** requests were intercepted; fixture responses are local only; no database, filesystem-backed mutation API, or production endpoint was accessed",
      runtime: { clock: FIXED_TIME, timezone: "UTC", locale: "uk-UA", uuidSequence: "deterministic per page context" },
      viewportResults,
      reducedMotion: true,
      screenshotExcludedNonProductOverlay: "Next development portal only; BodyCast UI content is unmasked.",
      interaction: interactionEvidence,
      retry: retryEvidence,
      loading: loadingEvidence,
      loadError: loadErrorEvidence,
      cancellation: cancelEvidence,
      completion: finishEvidence,
      apiRequests: apiTrace,
      browserErrors,
      expectedConsole,
      unexpectedConsole,
      postFinishRequests: completion.api.postFinishRequests,
      adjacentUiScope: {
        calendar: "No Calendar UI change is in the Stage 1B Training characterization scope; existing calendar-range unit characterization remains the gate before any later UI-affecting change.",
        forecast: "No Forecast UI change is in the Stage 1B Training characterization scope; existing forecast UI/client tests remain the gate before any later UI-affecting change.",
      },
      screenshots: ["training-session-360.png", "training-session-390.png", "training-session-768.png", "training-session-1280.png", "training-loading.png", "training-load-error.png"],
    };
    await writeFile(resolve(artifactDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, baseSha, viewportWidths: viewportResults.map(({ viewportWidth }) => viewportWidth), retry: retryEvidence, cancellation: cancelEvidence, completion: finishEvidence, browserErrors }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "unknown Training UI QA failure");
  process.exitCode = 1;
});

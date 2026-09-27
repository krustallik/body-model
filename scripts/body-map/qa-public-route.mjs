import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BODY_MAP_BASE_URL ?? "http://127.0.0.1:3191/body-map";
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDir = resolve(process.env.BODY_MAP_QA_OUTPUT ?? `artifacts/body-map-public-route-${stamp}`);
await mkdir(outputDir, { recursive: false });
const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
const result = { status: "running", baseUrl, browser: "Chromium", browserVersion: browser.version(), screenshots: [], errors: { page: [], console: [], requests: [], http: [] }, forbiddenRequests: [], checks: {} };
const capture = async (page, name) => {
  const path = resolve(outputDir, name);
  await page.screenshot({ path, fullPage: true });
  result.screenshots.push(path);
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.page.push(error.message));
  page.on("request", (request) => { if (/\/api\/v1\/(profile|dashboard|history|training)|\/api\/dev\/body-map-prototype\//.test(new URL(request.url()).pathname)) result.forbiddenRequests.push(request.url()); });
  page.on("console", (message) => { if (message.type() === "error") result.errors.console.push(message.text()); });
  page.on("requestfailed", (request) => result.errors.requests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) result.errors.http.push({ url: response.url(), status: response.status() }); });

  const route = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(route?.status(), 200, `Body Map route returned ${route?.status()}`);
  await page.getByText("TRAINING DATA NOT CONNECTED", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const viewport = document.querySelector('[data-testid="glb-viewport"]');
    const canvas = document.querySelector("canvas");
    return canvas && viewport?.getAttribute("data-renderer-available") === "true" && Number(viewport.getAttribute("data-scene-mesh-count")) > 0;
  }, undefined, { timeout: 90000 });
  const manifestResponse = await page.request.get(new URL("/body-map/bodyparts3d-v3/manifest.json", baseUrl).toString());
  assert.equal(manifestResponse.status(), 200, "public manifest did not return 200");
  const manifest = await manifestResponse.json();
  const assetResponse = await page.request.get(new URL(manifest.asset.url, baseUrl).toString());
  assert.equal(assetResponse.status(), 200, "public GLB did not return 200");
  assert.match(assetResponse.headers()["content-type"] ?? "", /model\/gltf-binary/i, "GLB MIME type is incorrect");
  const glbBytes = await assetResponse.body();
  assert.equal(glbBytes.byteLength, manifest.asset.byteLength, "GLB response size differs from manifest");
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");
  assert.equal(glbSha256, manifest.asset.sha256, "GLB response hash differs from manifest");
  assert.equal(manifest.bodyMapGroups.length, 20);
  assert.equal(manifest.anatomyCoverage.length, 75);
  const renderer = await page.locator("canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    if (!gl) return { webgl2: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl2: true,
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
      viewport: gl.getParameter(gl.VIEWPORT),
    };
  });
  assert.equal(renderer.webgl2, true, "WebGL2 is unavailable");
  result.checks.initialRoute = { status: route.status(), title: await page.title(), renderer, sceneMeshCount: await page.locator('[data-testid="glb-viewport"]').getAttribute("data-scene-mesh-count"), manifestStatus: manifestResponse.status(), glbStatus: assetResponse.status(), glbBytes: glbBytes.byteLength, glbSha256, glbContentType: assetResponse.headers()["content-type"] };
  const rootId = await page.locator('[data-testid="glb-viewport"]').getAttribute("data-scene-root-uuid");
  await page.waitForTimeout(350);
  await page.getByTestId("view-front").click();
  await page.waitForTimeout(650);
  await capture(page, "01-full-body-front.png");
  await page.getByTestId("view-back").click();
  await page.waitForTimeout(650);
  await capture(page, "02-full-body-back.png");
  await page.getByTestId("view-front").click();
  await page.waitForTimeout(500);

  const canvasBox = await page.locator("canvas").boundingBox();
  assert.ok(canvasBox, "WebGL canvas has no bounds");
  let chestHit = null;
  for (const y of [0.18, 0.22, 0.26, 0.30, 0.34, 0.38]) {
    for (const x of [0.36, 0.42, 0.46, 0.50, 0.54, 0.58, 0.64]) {
      const point = { x: canvasBox.x + canvasBox.width * x, y: canvasBox.y + canvasBox.height * y };
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(20);
      if (await page.locator('[data-testid="glb-viewport"]').getAttribute("data-hover-group-id") === "chest") { chestHit = point; break; }
    }
    if (chestHit) break;
  }
  assert.ok(chestHit, "raycast hover on the actual chest GLB surface did not resolve the chest group");
  await capture(page, "03-chest-hover.png");
  await page.mouse.click(chestHit.x, chestHit.y);
  await page.getByTestId("group-report").waitFor({ state: "visible", timeout: 15000 });
  assert.match(await page.getByTestId("group-report").innerText(), /unavailable/i);
  assert.doesNotMatch(await page.getByTestId("group-report").innerText(), /demo data|\b0 unique/i);
  await capture(page, "04-chest-selected.png");
  const rootAfterSelection = await page.locator('[data-testid="glb-viewport"]').getAttribute("data-scene-root-uuid");
  assert.equal(rootAfterSelection, rootId, "scene root changed during navigation");

  await page.getByRole("button", { name: /Body Map overview/ }).click();
  await page.getByTestId("group-select-core").click();
  await page.getByTestId("group-report").waitFor({ state: "visible" });
  await page.getByTestId("subregion-internal_oblique").click();
  await page.getByTestId("subregion-identity-card").waitFor({ state: "visible" });
  await page.waitForTimeout(650);
  await capture(page, "05-deep-muscle-selection.png");
  const groupIds = manifest.bodyMapGroups.map(({ groupId }) => groupId);
  const selectedGroups = [];
  await page.getByRole("button", { name: /Body Map overview/ }).click();
  for (const groupId of groupIds) {
    await page.getByTestId(`group-select-${groupId}`).click();
    await page.getByTestId("group-report").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator('[data-testid="glb-viewport"]').getAttribute("data-navigation-group"), groupId);
    selectedGroups.push(groupId);
    await page.getByRole("button", { name: /Body Map overview/ }).click();
  }
  const representativeSelections = [
    ["deltoids", "deltoid_anterior"], ["triceps", "triceps_long_head"], ["biceps", "brachialis"],
    ["forearms", "forearm_flexor_region"], ["back", "trapezius_upper"], ["back", "latissimus_dorsi"],
    ["core", "rectus_abdominis"], ["core", "internal_oblique"], ["core", "transversus_abdominis"],
    ["quadriceps", "vastus_lateralis"], ["hamstrings", "biceps_femoris_long_head"],
    ["gluteals", "gluteus_maximus"], ["calves", "gastrocnemius_medial_head"],
  ];
  const selectedSubregions = [];
  const bilateralChecks = [];
  for (const [groupId, anatomyId] of representativeSelections) {
    await page.getByTestId(`group-select-${groupId}`).click();
    await page.getByTestId("group-report").waitFor({ state: "visible", timeout: 15000 });
    await page.getByTestId(`subregion-${anatomyId}`).click();
    await page.getByTestId("subregion-identity-card").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator('[data-testid="glb-viewport"]').getAttribute("data-navigation-region"), anatomyId);
    assert.ok(new URL(page.url()).search.length > 0, `${anatomyId} selection was not reflected in the URL`);
    const highlight = await page.evaluate((id) => window.__bodycastBodyMapDebug?.getMaterialHighlights(id) ?? null, anatomyId);
    if (highlight) {
      assert.deepEqual(new Set(highlight.map((item) => item.side)), new Set(["left", "right"]), `${anatomyId} lost bilateral selection`);
      bilateralChecks.push(anatomyId);
    }
    selectedSubregions.push(anatomyId);
    if (anatomyId === "latissimus_dorsi") {
      await page.waitForTimeout(500);
      await capture(page, "07-latissimus-selection.png");
    }
    await page.getByRole("button", { name: /Body Map overview/ }).click();
  }
  result.checks.groups = { count: groupIds.length, selectedGroups, selectedChest: true, selectedDeepInternalOblique: true, selectedSubregions, bilateralSubregions: bilateralChecks, unavailableExposureRemainsNull: true, persistentSceneRoot: rootAfterSelection };
  result.checks.desktopViewports = [];
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("body *")].map((el) => ({ tag: el.tagName, cls: typeof el.className === "string" ? el.className : "", testid: el.getAttribute("data-testid"), right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) })).filter((el) => el.right > window.innerWidth + 1).slice(0, 10) }));
    assert.ok(dimensions.scrollWidth <= dimensions.viewport + 1, `horizontal overflow at ${width}px: ${dimensions.scrollWidth}px`);
    result.checks.desktopViewports.push(dimensions);
  }
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("pageerror", (error) => result.errors.page.push(`mobile: ${error.message}`));
  const mobileRoute = await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(mobileRoute?.status(), 200);
  await mobilePage.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-renderer-available") === "true", undefined, { timeout: 90000 });
  await mobilePage.getByTestId("group-select-chest").tap();
  await mobilePage.getByTestId("group-report").waitFor({ state: "visible", timeout: 15000 });
  await mobilePage.getByRole("button", { name: /Body Map overview/ }).tap();
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: resolve(outputDir, "06-mobile-overview.png"), fullPage: true });
  result.screenshots.push(resolve(outputDir, "06-mobile-overview.png"));
  result.checks.mobile = { emulatedTouch: true, routeStatus: mobileRoute.status(), webgl2: await mobilePage.locator("canvas").evaluate((canvas) => Boolean(canvas.getContext("webgl2"))), groupTapAndBack: true };
  await mobileContext.close();

  const devApiRequests = result.errors.http.filter(({ url }) => url.includes("/api/dev/body-map-prototype/"));
  assert.deepEqual(devApiRequests, [], "the production route requested a dev-only API");
  assert.deepEqual(result.forbiddenRequests, [], "the static Body Map route requested private or dev-only APIs");
  assert.deepEqual(result.errors.page, [], "browser runtime errors occurred");
  assert.deepEqual(result.errors.requests, [], "browser requests failed");
  assert.deepEqual(result.errors.http, [], "browser received HTTP errors");
  assert.equal(result.errors.console.length, 0, "browser console errors occurred");
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.failure = error instanceof Error ? error.stack : String(error);
} finally {
  await writeFile(resolve(outputDir, "qa-report.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
if (result.status !== "passed") process.exitCode = 1;
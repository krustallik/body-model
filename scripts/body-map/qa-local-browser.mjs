import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BODY_MAP_BASE_URL ?? "http://127.0.0.1:3187/dev/body-map";
const screenshotDir = resolve("3d-model/local-assets/browser-qa");
const browserPath = process.env.BODY_MAP_CHROME_PATH;
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(browserPath ? { executablePath: browserPath } : {}),
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const browserVersion = browser.version();
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const badResponses = [];
const viewerResponses = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (response.url().includes("/api/dev/body-map-prototype/") && response.status() >= 200 && response.status() < 400) {
      viewerResponses.push({ url: response.url(), status: response.status() });
    }
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
  });

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, `viewer route returned ${response?.status()}`);
  await page.waitForFunction(() => {
    const debug = window.__bodycastBodyMapDebug;
    return typeof debug?.getRendererInfo === "function" && document.querySelector("canvas");
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => window.__bodycastBodyMapDebug.getRendererInfo().renderedFrames > 0, undefined, { timeout: 30_000 });

  const runtime = await page.evaluate(() => {
    const debug = window.__bodycastBodyMapDebug;
    return {
      renderer: debug.getRendererInfo(),
      visiblePresentationCounts: debug.getVisiblePresentationCounts(),
      meshCounts: {
        total: debug.totalMeshCount,
        selectable: debug.selectableMeshCount,
        context: debug.contextMeshCount,
      },
      bounds: debug.getModelBounds(),
      title: document.title,
    };
  });
  assert.equal(runtime.renderer.webgl2, true, "Three.js did not create a WebGL2 context");
  assert.ok(runtime.meshCounts.selectable > 0, "no selectable scene meshes were loaded");
  assert.ok(runtime.renderer.renderedFrames > 0, "the scene did not render a frame");
  await page.waitForTimeout(400);
  await page.getByTestId("view-front").click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(screenshotDir, "overview-front.png"), fullPage: true });

  await page.getByTestId("view-back").click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(screenshotDir, "overview-back.png"), fullPage: true });
  await page.getByTestId("view-front").click();
  await page.waitForTimeout(900);

  const chestCandidates = await page.evaluate(() => window.__bodycastBodyMapDebug.getPickCandidates()
    .filter((candidate) => candidate.groupId === "chest"));
  assert.ok(chestCandidates.length > 0, "the loaded front-facing scene has no raycastable chest candidate");
  const chest = chestCandidates[0];
  await page.mouse.move(chest.x, chest.y);
  await page.waitForFunction(() => document.querySelector('[data-testid="glb-viewport"]')?.getAttribute("data-hover-group-id") === "chest");
  await page.screenshot({ path: resolve(screenshotDir, "hover-chest.png"), fullPage: true });
  await page.mouse.click(chest.x, chest.y);
  await page.getByTestId("group-report").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: resolve(screenshotDir, "selected-chest.png"), fullPage: true });

  const manifestResponse = await page.request.get(new URL("/api/dev/body-map-prototype/manifest", baseUrl).toString());
  assert.equal(manifestResponse.status(), 200, "local manifest route failed");
  const manifest = await manifestResponse.json();
  const deepSubregion = manifest.bodyMapGroups
    .flatMap((group) => group.subregions.map((subregion) => ({ group, subregion })))
    .find(({ subregion }) => subregion.representedMeshIds.some((meshId) =>
      manifest.visualIdentity.supportedRegions.some((region) => region.meshId === meshId && region.depthLayer === "deep")));
  assert.ok(deepSubregion, "the local manifest has no deep selectable subregion to exercise");
  await page.locator("aside button").filter({ hasText: "Back" }).last().click();
  await page.getByTestId("group-select-chest").waitFor({ state: "visible", timeout: 15_000 });
  if (deepSubregion.group.groupId !== "chest") {
    await page.getByTestId(`group-select-${deepSubregion.group.groupId}`).click();
    await page.getByTestId("group-report").waitFor({ state: "visible", timeout: 15_000 });
  }
  await page.getByTestId(`subregion-${deepSubregion.subregion.anatomyId}`).click();
  await page.getByTestId("subregion-identity-card").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: resolve(screenshotDir, "deep-selection.png"), fullPage: true });

  const returnToOverview = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await page.getByTestId("group-select-chest").isVisible().catch(() => false)) return;
      const backButton = page.locator("aside button").filter({ hasText: "← Back" }).last();
      await backButton.click();
    }
    await page.getByTestId("group-select-chest").waitFor({ state: "visible", timeout: 15_000 });
  };
  let exercisedGroups = 0;
  for (const { groupId } of manifest.bodyMapGroups) {
    await returnToOverview();
    await page.getByTestId(`group-select-${groupId}`).click();
    await page.getByTestId("group-report").waitFor({ state: "visible", timeout: 15_000 });
    exercisedGroups += 1;
  }

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("pageerror", (error) => pageErrors.push(`mobile: ${error.message}`));
  const mobileResponse = await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(mobileResponse?.status(), 200, `mobile viewer route returned ${mobileResponse?.status()}`);
  await mobilePage.waitForFunction(() => {
    const debug = window.__bodycastBodyMapDebug;
    return typeof debug?.getRendererInfo === "function" && debug.getRendererInfo().renderedFrames > 0;
  }, undefined, { timeout: 90_000 });
  const mobileRenderer = await mobilePage.evaluate(() => window.__bodycastBodyMapDebug.getRendererInfo());
  assert.equal(mobileRenderer.webgl2, true, "mobile viewport did not render with WebGL2");
  await mobilePage.getByTestId("view-front").click();
  await mobilePage.waitForTimeout(900);
  await mobilePage.screenshot({ path: resolve(screenshotDir, "mobile-overview.png"), fullPage: true });
  await mobilePage.getByTestId("group-select-chest").tap();
  await mobilePage.getByTestId("group-report").waitFor({ state: "visible", timeout: 15_000 });
  await mobileContext.close();
  await context.close();

  const criticalRequestFailures = failedRequests.filter(({ url }) =>
    (url.includes("/api/dev/body-map-prototype/") || /\.(glb|gltf)(\?|$)/i.test(url))
    && !viewerResponses.some((response) => response.url === url));
  assert.deepEqual(pageErrors, [], "browser runtime exceptions occurred");
  assert.deepEqual(criticalRequestFailures, [], "viewer or GLB requests failed");

  console.log(JSON.stringify({
    status: "passed",
    browser: "Chromium",
    browserVersion,
    pageUrl: baseUrl,
    runtime,
    mobileRenderer,
    exercisedGroupCount: exercisedGroups,
    screenshots: ["overview-front.png", "overview-back.png", "hover-chest.png", "selected-chest.png", "deep-selection.png", "mobile-overview.png"]
      .map((name) => resolve(screenshotDir, name)),
    consoleErrors,
    failedRequests,
    successfulViewerResponses: viewerResponses,
    badResponses,
    note: "Non-viewer API errors, if any, are reported above and do not count as GLB/WebGL success or failure.",
  }, null, 2));
} finally {
  await browser.close();
}

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";

const baseUrl = process.env.BODYCAST_PREVIEW_URL ?? "http://127.0.0.1:3001";
const outputDirectory = resolve("artifacts/ui-qa/fullsite-preview");
const viewports = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "mobile", width: 390, height: 844 },
] as const;

type ApiResult<T> = T & { error?: string };

async function getJson<T>(pathname: string): Promise<ApiResult<T>> {
  const response = await fetch(new URL(pathname, baseUrl));
  if (!response.ok) throw new Error(`GET ${pathname} returned ${response.status}`);
  return response.json() as Promise<ApiResult<T>>;
}

async function waitForStablePage(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function captureRoute(page: Page, route: { key: string; path: string }, viewportName: string, viewportWidth: number) {
  const browserErrors: string[] = [];
  const apiResponses: Array<{ path: string; status: number }> = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Download the React DevTools")) browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) {
      apiResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });

  await page.goto(new URL(route.path, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await waitForStablePage(page);

  if (route.key === "forecast") {
    await page.getByText("Прогноз готовий", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  }
  if (route.key === "goal") {
    const formState = await page.evaluate(() => Array.from(document.forms).map((form) => ({
      valid: form.checkValidity(),
      invalid: Array.from(form.querySelectorAll("input")).filter((input) => !input.checkValidity()).map((input) => ({ name: input.name, id: input.id, value: input.value, message: input.validationMessage })),
    })));
    const calculate = page.getByRole("button", { name: "Розрахувати сценарій" });
    if (await calculate.count() && await calculate.isEnabled()) {
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/goal") && response.request().method() === "POST", { timeout: 45_000 }).catch(() => null);
      await calculate.click();
      const response = await responsePromise;
      if (response) apiResponses.push({ path: "/api/goal", status: response.status() });
      await page.waitForTimeout(500);
    }
    (page as Page & { __goalFormState?: unknown }).__goalFormState = formState;
  }

  const viewportState = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    tableCount: document.querySelectorAll("table").length,
    bodyRowCount: document.querySelectorAll("table tbody tr").length,
    chartCount: document.querySelectorAll("svg").length,
    canvasCount: document.querySelectorAll("canvas").length,
    mainText: document.querySelector("main")?.innerText.slice(0, 260) ?? "",
  }));

  const screenshotPath = resolve(outputDirectory, viewportName, `${route.key}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });

  let hoverPath: string | null = null;
  if (viewportName === "desktop" && ["dashboard", "history", "forecast", "diagnostics"].includes(route.key)) {
    const target = page.locator("main article, main section, main table").first();
    if (await target.count()) {
      await target.hover({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(180);
      hoverPath = resolve(outputDirectory, viewportName, `${route.key}-hover.png`);
      await page.screenshot({ path: hoverPath, fullPage: false, animations: "disabled" });
    }
  }

  return {
    viewport: viewportName, width: viewportWidth, route: route.path,
    title: await page.title(), ...viewportState,
    hasHorizontalOverflow: viewportState.documentWidth > viewportWidth || viewportState.bodyWidth > viewportWidth,
    apiResponses: apiResponses.filter((entry, index, rows) => rows.findIndex((row) => row.path === entry.path && row.status === entry.status) === index),
    browserErrors,
    goalFormState: (page as Page & { __goalFormState?: unknown }).__goalFormState ?? null,
    screenshot: screenshotPath, hoverScreenshot: hoverPath,
  };
}

async function main() {
  await mkdir(resolve(outputDirectory, "desktop"), { recursive: true });
  await mkdir(resolve(outputDirectory, "mobile"), { recursive: true });

  const [recent, active, programs, stepper] = await Promise.all([
    getJson<{ sessions: Array<{ id: number; status: string }> }>("/api/v1/training/sessions/recent?limit=20"),
    getJson<{ session: { id: number; status: string } | null }>("/api/v1/training/sessions/active"),
    getJson<{ programs: Array<{ id: number }> }>("/api/v1/training/programs"),
    getJson<{ workouts: Array<{ id: number; type: string; startAt: string }> }>("/api/v1/training/stepper-workouts"),
  ]);
  const completedSession = recent.sessions.find((session) => session.status === "COMPLETED");
  const stepperWorkout = stepper.workouts.find((workout) => workout.type.toLowerCase().includes("stair")) ?? stepper.workouts[0];
  const routes = [
    { key: "dashboard", path: "/dashboard" },
    { key: "history", path: "/history" },
    { key: "training", path: "/training" },
    { key: "programs", path: programs.programs[0] ? `/training/programs/${programs.programs[0].id}` : "/training/programs/new" },
    { key: "active-session", path: active.session ? `/training/sessions/${active.session.id}` : "/training/session" },
    { key: "completed-session", path: completedSession ? `/training/sessions/${completedSession.id}` : "/training/backfill" },
    { key: "completed-session-edit", path: completedSession ? `/training/sessions/${completedSession.id}/edit` : "/training/backfill" },
    { key: "forecast", path: "/forecast" },
    { key: "goal", path: "/goal" },
    { key: "diagnostics", path: "/diagnostics" },
    { key: "profile", path: "/settings/profile" },
    { key: "body-map", path: "/body-map" },
    { key: "stepper-diagnostic", path: stepperWorkout ? `/training/workouts/${stepperWorkout.id}/stepper-diagnostic` : "/training" },
  ];
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const forecastHorizonResults: Array<{ horizon: string; visibleResult: boolean; apiResponses: Array<{ path: string; status: number }> }> = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.name === "mobile" ? 2 : 1, isMobile: viewport.name === "mobile", hasTouch: viewport.name === "mobile" });
    for (const route of routes) {
      results.push(await captureRoute(page, route, viewport.name, viewport.width));
    }
    if (viewport.name === "desktop") {
      await page.goto(new URL("/forecast", baseUrl).toString(), { waitUntil: "domcontentloaded" });
      await waitForStablePage(page);
      for (const [label, name] of [["7d", "7д"], ["90d", "90д"], ["365d", "1р"]] as const) {
        const responseRows: Array<{ path: string; status: number }> = [];
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/forecast" && response.request().method() === "POST", { timeout: 60_000 }).catch(() => null);
        await page.getByRole("button", { name, exact: true }).click();
        const response = await responsePromise;
        if (response) responseRows.push({ path: "/api/forecast", status: response.status() });
        await page.waitForTimeout(500);
        const result = response?.ok() ? await response.json() as { status?: string; horizonDays?: number; dates?: unknown[] } : null;
        const pageText = await page.locator("main").innerText();
        const visibleResult = result?.status === "ok"
          && result.horizonDays === Number(label.replace("d", ""))
          && Boolean(result.dates?.length)
          && /Медіанна оцінка|median estimate/i.test(pageText);
        forecastHorizonResults.push({ horizon: label, visibleResult, apiResponses: responseRows });
        if (label === "90d") {
          await page.screenshot({ path: resolve(outputDirectory, "desktop", "forecast-90d.png"), fullPage: true, animations: "disabled" });
        }
        if (label === "365d") {
          await page.screenshot({ path: resolve(outputDirectory, "desktop", "forecast-365d.png"), fullPage: true, animations: "disabled" });
        }
      }
    }
    await page.close();
  }
  await browser.close();

  const report = {
    baseUrl, capturedAt: new Date().toISOString(), routeCount: routes.length,
    viewportResults: results, forecastHorizonResults,
  };
  const reportPath = resolve(outputDirectory, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ reportPath, screenshotCount: results.length + (results.filter((result) => result.hoverScreenshot).length) + 2, routeCount: routes.length, forecastHorizonResults, overflowRoutes: results.filter((result) => result.hasHorizontalOverflow).map(({ viewport, route, documentWidth, bodyWidth, width }) => ({ viewport, route, documentWidth, bodyWidth, width })), browserErrors: results.flatMap((result) => result.browserErrors.map((error) => ({ viewport: result.viewport, route: result.route, error }))), apiFailures: results.flatMap((result) => result.apiResponses.filter((response) => response.status >= 400).map((response) => ({ viewport: result.viewport, route: result.route, ...response }))) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

"use client";

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useI18n } from "@/i18n/i18n-provider";
import { OrbitControls, useGLTF } from "@react-three/drei";
import {
  BODY_MAP_OVERVIEW_STATE_V2,
  transitionBodyMapNavigationV2,
} from "@/modules/training/body-map-navigation-contract-v2";
import { BODY_MAP_GROUP_CATALOG_V2, type AnatomyIdV2, type BodyMapGroupIdV2 } from "@/modules/training/body-map-catalog-v2";
import type { BodyMapNavigationStateV2 } from "@/modules/training/body-map-navigation-contract-v2";
import { normalizeStaticPublicBodyMapManifestV1, type StaticPublicBodyMapManifestV1 } from "@/modules/body-map/static-public-manifest-adapter-v1";
import {
  BODY_MAP_URL_OVERVIEW_V1,
  defaultBodyMapGroupViewV1,
  defaultBodyMapSubregionViewV1,
  parseBodyMapUrlStateV1,
  serializeBodyMapUrlStateV1,
  type BodyMapUrlModeV1,
  type BodyMapUrlStateV1,
  type BodyMapUrlViewV1,
} from "@/modules/training/body-map-url-state-v1";
import { BODY_MAP_OVERVIEW_PADDING_FACTOR_V1, CameraTransitionControllerV1, frameBoundsV1 } from "./camera-transition-v1";
import { BodyMapTrainingAnalyticsPanel } from "./body-map-training-analytics-panel";
import { bodyMapAnatomyLabel, bodyMapGroupLabel, bodyMapGroupNote } from "./body-map-localization";
import type { BodyMapAnalyticsMonthsV1, BodyMapTrainingAnalyticsResponseV1 } from "@/modules/training/body-map-training-analytics-v1";
import type { BodyMapGroupExposureV2 } from "@/modules/training/body-map-training-exposure-v2";
import styles from "./body-map-experience.module.css";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
const EMPTY_DEFAULT_HIDDEN_CONTEXT_MESH_IDS: string[] = [];

type ManifestRegion = {
  visualRegionId: string;
  meshId: string;
  gltfNodeName: string;
  anatomyId: AnatomyIdV2;
  anatomyIds: AnatomyIdV2[];
  bodyMapGroupIds: BodyMapGroupIdV2[];
  analyticsGroupIds: string[];
  primaryPickGroupId: BodyMapGroupIdV2;
  side: "left" | "right" | "midline" | "unspecified";
  depthLayer: "superficial" | "deep";
  sourceObjectName: string;
  assetId: string;
  selectable: true;
};

type AnalyticsLoadState =
  | { months: BodyMapAnalyticsMonthsV1; status: "loading" | "unauthorized" | "error" }
  | { months: BodyMapAnalyticsMonthsV1; status: "ready"; analytics: BodyMapTrainingAnalyticsResponseV1 };
type ManifestSubregion = {
  anatomyId: AnatomyIdV2;
  label: string;
  parentAnatomyId: AnatomyIdV2 | null;
  kind: string;
  intendedRepresentation: string;
  visualAvailability: string;
  sideMode: string;
  sides: Record<string, string[]>;
  meshIds: string[];
  representedMeshIds: string[];
  descendantAnatomyIds: AnatomyIdV2[];
  assetIds: string[];
  representation: string;
  limitations: string[];
};
type ManifestGroup = {
  groupId: BodyMapGroupIdV2;
  kind: string;
  label: string;
  note: string;
  fallbackAnchor: readonly [number, number];
  legacyAnalyticsGroupId: string | null;
  bodyMapGroupIds: BodyMapGroupIdV2[];
  analyticsGroupIds: string[];
  assetIds: string[];
  subregions: ManifestSubregion[];
  cameraBounds: { min: number[]; max: number[] };
  camera: { preferredDirection: readonly [number, number, number]; targetPolicy: string; framingPolicy: string; desktopTransitionMs: number; mobileTransitionMs: number; reducedMotionTransitionMs: number; near: number; far: number; paddingFactor: number };
};
type ExposureState = BodyMapGroupExposureV2;
type RuntimeAsset = {
  assetId: string;
  path: string;
  sha256: string;
  byteLength: number;
  meshNodeCount: number;
  selectableMeshCount: number;
  contextMeshCount: number;
  faceCount: number;
  triangleCount: number;
  vertexCount: number;
  materialSlots: number;
  compression: string;
};
type PrototypeManifest = {
  contract: string;
  contractVersion: string;
  catalog: { contract: string; version: string };
  taxonomyVersion: string;
  exerciseMappingVersion: string;
  trainingExposure: { contract: string; version: string; source: string; groups: ExposureState[] };
  navigationMembership: { contract: string; version: string; pairs: Array<{ anatomyId: AnatomyIdV2; groupId: BodyMapGroupIdV2 }>; primaryPickGroupByAnatomyId: Record<string, string> };
  bodyMapGroups: ManifestGroup[];
  anatomyCoverage: Array<{ anatomyId: AnatomyIdV2; parentId: AnatomyIdV2 | null; label: string; bodyMapGroupIds: BodyMapGroupIdV2[]; analyticsGroupIds: string[]; visualRegionIds: string[]; representedMeshIds: string[]; descendantAnatomyIds: AnatomyIdV2[]; visualAvailability: string; limitations: string[] }>;
  asset: { assetVersion: string; visualSelectionStatus: string; selectableRegionCount: number; totalRuntimeBytes: number; contextMeshCount: number };
  viewerAsset: { path: string; sha256: string; status: string; mayClaimMusclePicking: boolean; assetId: string; selectableMeshCount: number; contextMeshCount: number; triangleCount: number; byteLength: number };
  runtimeAssets: RuntimeAsset[];
  visualIdentity: { manifestVersion: string; supportedRegions: ManifestRegion[]; contextNodes: Array<{ meshId: string; gltfNodeName: string; sourceObjectName: string; contextLayer: string; contextPresentation: "supplemental-muscle" | "support-only" | "skeletal-context" | "cranial-context" | "body-silhouette-context"; selectable: false }>; contextVisibility?: { contract: string; version: string; defaultHiddenContextMeshIds: string[] }; groupAssetIds: Record<string, string[]> };
  demoData?: { label: string; groupExposureStates: ExposureState[]; groupUniqueSetCounts: Record<string, number | null>; note: string };
  dataNotice?: string;
  status: string;
};
type LayerSelection = "all" | "superficial" | "deep";
type CameraPresetV1 = "front" | "back" | "left" | "right" | "reset";
type FocusRequest =
  | { id: number; kind: "overview" | "preset"; preset: CameraPresetV1 }
  | { id: number; kind: "group"; groupId: BodyMapGroupIdV2; view: BodyMapUrlViewV1 }
  | { id: number; kind: "anatomy"; groupId: BodyMapGroupIdV2; anatomyId: AnatomyIdV2; view: BodyMapUrlViewV1 };
type FocusRequestInput =
  | { kind: "overview" | "preset"; preset: CameraPresetV1 }
  | { kind: "group"; groupId: BodyMapGroupIdV2; view: BodyMapUrlViewV1 }
  | { kind: "anatomy"; groupId: BodyMapGroupIdV2; anatomyId: AnatomyIdV2; view: BodyMapUrlViewV1 };
type RuntimePerformance = { drawCalls: number; triangles: number; geometries: number; textures: number; meanFrameMs: number; p95FrameMs: number };
type GraphicsQuality = "auto" | "high" | "balanced" | "low";
type BodyMapPageState = BodyMapUrlStateV1 & { navigation: BodyMapNavigationStateV2 };

function pageStateFromUrlState(state: BodyMapUrlStateV1): BodyMapPageState {
  return {
    ...state,
    navigation: state.groupId
      ? { level: state.anatomyId ? "SUBREGION_DETAIL" : "GROUP_DETAIL", groupId: state.groupId, anatomyId: state.anatomyId }
      : BODY_MAP_OVERVIEW_STATE_V2,
  };
}

function urlStateFromPageState(state: BodyMapPageState): BodyMapUrlStateV1 {
  return {
    groupId: state.navigation.groupId,
    anatomyId: state.navigation.anatomyId,
    view: state.view,
    mode: state.mode,
    deep: state.deep,
  };
}

const GROUP_HOVER_COLOR = new THREE.Color(0x63c7a2);
const GROUP_SELECTED_COLOR = new THREE.Color(0x4db890);
const SUBREGION_SELECTED_COLOR = new THREE.Color(0x7ad2b2);

function directionForView(view: BodyMapUrlViewV1) {
  if (view === "back") return new THREE.Vector3(0, 0, -1);
  if (view === "left") return new THREE.Vector3(-1, 0, 0);
  if (view === "right") return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(0, 0, 1);
}

function focusInputForPageState(state: BodyMapPageState): FocusRequestInput {
  if (!state.navigation.groupId) return { kind: "overview", preset: state.view === "default" ? "front" : state.view };
  if (state.navigation.anatomyId) return {
    kind: "anatomy", groupId: state.navigation.groupId, anatomyId: state.navigation.anatomyId, view: state.view,
  };
  return { kind: "group", groupId: state.navigation.groupId, view: state.view };
}

function preferredGraphicsQuality(gl: THREE.WebGLRenderer, devicePixelRatio: number): Exclude<GraphicsQuality, "auto"> {
  const context = gl.getContext();
  const maxTextureSize = Number(context.getParameter(context.MAX_TEXTURE_SIZE));
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0);
  const hardwareConcurrency = Number(navigator.hardwareConcurrency ?? 0);
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(context.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER));
  if (/swiftshader|software renderer|llvmpipe/i.test(renderer) || (deviceMemory > 0 && deviceMemory < 3) || (hardwareConcurrency > 0 && hardwareConcurrency <= 2) || maxTextureSize < 4096) return "low";
  if (devicePixelRatio <= 1.5 && deviceMemory >= 8 && hardwareConcurrency >= 8 && maxTextureSize >= 8192) return "high";
  return "balanced";
}

function isEffectivelyVisible(object: THREE.Object3D) {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function isMusclePickTarget(object: THREE.Object3D) { return isEffectivelyVisible(object) && object.userData.bodycastContextPresentation !== "body-silhouette-context"; }
export default function BodyMapExperience({ delivery = "development" }: { delivery?: "development" | "public" }) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const [manifest, setManifest] = useState<PrototypeManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [pageState, setPageState] = useState<BodyMapPageState>(() => pageStateFromUrlState(BODY_MAP_URL_OVERVIEW_V1));
  const [analyticsMonths, setAnalyticsMonths] = useState<BodyMapAnalyticsMonthsV1>(1);
  const [analyticsLoad, setAnalyticsLoad] = useState<AnalyticsLoadState>({ months: 1, status: "loading" });
  const isAnalyticsCurrent = analyticsLoad.months === analyticsMonths;
  const analytics = isAnalyticsCurrent && analyticsLoad.status === "ready" ? analyticsLoad.analytics : null;
  const analyticsRequestState = delivery === "development" ? "ready" : isAnalyticsCurrent ? analyticsLoad.status : "loading";
  const pageStateRef = useRef(pageState);
  const manifestRef = useRef<PrototypeManifest | null>(null);
  const navState = pageState.navigation;
  const [hoveredGroupId, setHoveredGroupId] = useState<BodyMapGroupIdV2 | null>(null);
  const showSurfaceSupport = pageState.mode === "fascia" || pageState.mode === "both-context";
  const showSkeletalContext = pageState.mode === "skeleton" || pageState.mode === "both-context";
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ id: 0, kind: "overview", preset: "front" });
  const [focusReady, setFocusReady] = useState(false);
  const [pickedMessage, setPickedMessage] = useState(uk ? "Завантаження анатомії…" : "Loading anatomy…");
  const [sceneRootUuid, setSceneRootUuid] = useState<string | null>(null);
  const [loadedMeshCount, setLoadedMeshCount] = useState(0);
  const [runtimePerformance, setRuntimePerformance] = useState<RuntimePerformance | null>(null);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [rendererAvailable, setRendererAvailable] = useState(false);
  const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQuality>("auto");
  const [automaticQuality, setAutomaticQuality] = useState<Exclude<GraphicsQuality, "auto">>("balanced");
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  const effectiveQuality = graphicsQuality === "auto" ? automaticQuality : graphicsQuality;
  const fallbackNavigation = assetError !== null || (fallbackActive && !rendererAvailable);
  const pixelRatioCap = effectiveQuality === "high" ? 1.5 : effectiveQuality === "low" ? 0.8 : 1.1;
  const renderDpr = Math.max(0.75, Math.min(devicePixelRatio, pixelRatioCap));
  const focusSequence = useRef(0);
  const currentFocusId = useRef(0);
  const pointerGesture = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressCanvasClickUntil = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const manifestUrl = delivery === "public"
      ? "/body-map/bodyparts3d-v3/manifest.json"
      : "/api/dev/body-map-prototype/manifest";
    fetch(manifestUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<PrototypeManifest | StaticPublicBodyMapManifestV1>;
      })
      .then((source) => {
        if (cancelled) return;
        const data = (delivery === "public"
          ? normalizeStaticPublicBodyMapManifestV1(source as StaticPublicBodyMapManifestV1)
          : source) as PrototypeManifest;
        if (!data.viewerAsset.assetId || data.runtimeAssets.length !== 1) throw new Error("A single full-body runtime asset is required.");
        if (data.bodyMapGroups.length !== BODY_MAP_GROUP_CATALOG_V2.length || data.visualIdentity.supportedRegions.length !== data.viewerAsset.selectableMeshCount) throw new Error("Runtime anatomy manifest failed catalog or mesh identity checks.");
        setManifest(data);
      })
      .catch((error: unknown) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [delivery]);

  useEffect(() => {
    if (delivery !== "public") {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/v1/training/body-map/analytics?months=${analyticsMonths}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return { kind: "unauthorized" as const };
        if (!response.ok) throw new Error("analytics_unavailable");
        return { kind: "ready" as const, body: await response.json() as { analytics: BodyMapTrainingAnalyticsResponseV1 } };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind === "unauthorized") {
          setAnalyticsLoad({ months: analyticsMonths, status: "unauthorized" });
          return;
        }
        setAnalyticsLoad({ months: analyticsMonths, status: "ready", analytics: result.body.analytics });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnalyticsLoad({ months: analyticsMonths, status: "error" });
      });
    return () => controller.abort();
  }, [analyticsMonths, delivery]);

  const selectedGroup = useMemo(() => manifest?.bodyMapGroups.find(({ groupId }) =>
    groupId === navState.groupId,
  ) ?? null, [manifest, navState.groupId]);
  const selectedGroupLabel = selectedGroup ? bodyMapGroupLabel(selectedGroup.groupId, selectedGroup.label, locale) : null;
  const selectedSubregion = selectedGroup?.subregions.find(({ anatomyId }) => anatomyId === navState.anatomyId) ?? null;
  const selectedSubregionLabel = selectedSubregion ? bodyMapAnatomyLabel(selectedSubregion.anatomyId, selectedSubregion.label, locale) : null;
  const selectedDepthKinds = selectedSubregion && manifest
    ? new Set(manifest.visualIdentity.supportedRegions.filter(({ meshId }) => selectedSubregion.representedMeshIds.includes(meshId)).map(({ depthLayer }) => depthLayer))
    : new Set<string>();
  const deepDetailAnatomyId = pageState.deep && selectedSubregion && selectedDepthKinds.has("deep") && !selectedDepthKinds.has("superficial")
    ? selectedSubregion.anatomyId
    : null;
  const layer: LayerSelection = pageState.deep && deepDetailAnatomyId === null ? "deep" : "all";
  const asset = manifest?.runtimeAssets[0] ?? null;
  const assetUrl = asset ? delivery === "public"
    ? asset.path
    : `/api/dev/body-map-prototype/asset?assetId=${encodeURIComponent(asset.assetId)}` : null;

  const requestFocus = useCallback((next: FocusRequestInput) => {
    const id = ++focusSequence.current;
    currentFocusId.current = id;
    setFocusReady(false);
    setFocusRequest({ ...next, id } as FocusRequest);
  }, []);
  const finishFocus = useCallback((id: number) => {
    if (currentFocusId.current === id) {
      setFocusReady(true);
      setPickedMessage("");
    }
  }, []);

  const commitPageState = useCallback((nextInput: BodyMapPageState, historyMode: "push" | "replace" | "none" = "push") => {
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const requested = urlStateFromPageState(nextInput);
    const href = serializeBodyMapUrlStateV1(window.location.href, requested);
    const nextUrl = new URL(href, window.location.href);
    const deepAnatomyIds = manifest
      ? new Set(manifest.visualIdentity.supportedRegions.filter(({ depthLayer }) => depthLayer === "deep").flatMap(({ anatomyIds }) => anatomyIds))
      : undefined;
    const normalizedUrlState = parseBodyMapUrlStateV1(nextUrl, { deepAnatomyIds });
    const next = pageStateFromUrlState(normalizedUrlState);
    const normalizedHref = serializeBodyMapUrlStateV1(nextUrl, normalizedUrlState);
    if (historyMode !== "none" && normalizedHref !== currentHref) {
      const method = historyMode === "push" ? "pushState" : "replaceState";
      window.history[method](window.history.state, "", normalizedHref);
    }
    pageStateRef.current = next;
    setPageState(next);
    return next;
  }, [manifest]);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    const synchronize = () => {
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const currentManifest = manifestRef.current;
      const deepAnatomyIds = currentManifest
        ? new Set(currentManifest.visualIdentity.supportedRegions.filter(({ depthLayer }) => depthLayer === "deep").flatMap(({ anatomyIds }) => anatomyIds))
        : undefined;
      const parsed = parseBodyMapUrlStateV1(window.location.href, { deepAnatomyIds });
      const canonicalHref = serializeBodyMapUrlStateV1(window.location.href, parsed);
      if (canonicalHref !== currentHref) window.history.replaceState(window.history.state, "", canonicalHref);
      const next = pageStateFromUrlState(parsed);
      pageStateRef.current = next;
      setPageState(next);
      setHoveredGroupId(null);
      setFocusReady(false);
      setPickedMessage(next.navigation.groupId ? uk ? "Відновлення вигляду анатомії…" : "Restoring anatomy view…" : "");
      requestFocus(focusInputForPageState(next));
    };
    synchronize();
    window.addEventListener("popstate", synchronize);
    return () => window.removeEventListener("popstate", synchronize);
  }, [requestFocus, uk]);

  useEffect(() => {
    if (!manifest) return;
    const deepAnatomyIds = new Set(manifest.visualIdentity.supportedRegions
      .filter(({ depthLayer }) => depthLayer === "deep")
      .flatMap(({ anatomyIds }) => anatomyIds));
    const parsed = parseBodyMapUrlStateV1(window.location.href, { deepAnatomyIds });
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const canonicalHref = serializeBodyMapUrlStateV1(window.location.href, parsed);
    if (canonicalHref !== currentHref) window.history.replaceState(window.history.state, "", canonicalHref);
    if (pageStateRef.current.deep !== parsed.deep) {
      const next = { ...pageStateRef.current, deep: parsed.deep };
      pageStateRef.current = next;
      setPageState(next);
    }
  }, [manifest]);

  useEffect(() => {
    const updateDpr = () => setDevicePixelRatio(window.devicePixelRatio || 1);
    updateDpr();
    window.addEventListener("resize", updateDpr, { passive: true });
    return () => window.removeEventListener("resize", updateDpr);
  }, []);
  const setOverview = useCallback(() => {
    const next = commitPageState(pageStateFromUrlState(BODY_MAP_URL_OVERVIEW_V1));
    setHoveredGroupId(null);
    setPickedMessage(uk ? "Повернення до вигляду всього тіла…" : "Returning to the full-body view…");
    requestFocus(focusInputForPageState(next));
    if (fallbackNavigation) { setFocusReady(true); setPickedMessage(""); }
  }, [commitPageState, fallbackNavigation, requestFocus, uk]);
  const selectGroup = useCallback((groupId: BodyMapGroupIdV2) => {
    if (!manifest?.bodyMapGroups.some((group) => group.groupId === groupId)) {
      setPickedMessage(uk ? "Не вдалося відкрити цю групу." : `Unknown Body Map group: ${groupId}`);
      return;
    }
    const current = pageStateRef.current;
    const navigation = transitionBodyMapNavigationV2(current.navigation, { type: "SELECT_GROUP", groupId });
    const next = commitPageState({
      ...current, navigation, view: defaultBodyMapGroupViewV1(groupId), mode: "muscle", deep: false,
    });
    setHoveredGroupId(null);
    const label = manifest.bodyMapGroups.find((group) => group.groupId === groupId)?.label ?? (uk ? "групи м’язів" : "muscle group");
    setPickedMessage(uk ? `Перехід до ${bodyMapGroupLabel(groupId, label, locale)}…` : `Moving to ${label}…`);
    requestFocus(focusInputForPageState(next));
    if (fallbackNavigation) { setFocusReady(true); setPickedMessage(""); }
  }, [commitPageState, fallbackNavigation, locale, manifest, requestFocus, uk]);
  const selectSubregion = useCallback((anatomyId: AnatomyIdV2) => {
    if (!selectedGroup) return;
    try {
      const current = pageStateRef.current;
      const navigation = transitionBodyMapNavigationV2(current.navigation, { type: "SELECT_SUBREGION", anatomyId });
      const subregion = selectedGroup.subregions.find(({ anatomyId: id }) => id === anatomyId);
      const representedMeshIds = subregion?.representedMeshIds ?? [];
      const rows = manifest?.visualIdentity.supportedRegions.filter(({ meshId }) => representedMeshIds.includes(meshId)) ?? [];
      const depthKinds = new Set(rows.map(({ depthLayer }) => depthLayer));
      const deep = depthKinds.has("deep") && !depthKinds.has("superficial");
      const regionView = selectedGroup.groupId === "hip_adductors"
        ? defaultBodyMapSubregionViewV1(selectedGroup.groupId)
        : current.view;
      const next = commitPageState({ ...current, navigation, view: regionView, deep });
      const label = subregion ? bodyMapAnatomyLabel(subregion.anatomyId, subregion.label, locale) : uk ? "м’яза" : "muscle";
      setPickedMessage(uk ? `Перехід до ${label}…` : `Moving to ${label}…`);
      requestFocus(focusInputForPageState(next));
      if (fallbackNavigation) { setFocusReady(true); setPickedMessage(""); }
    } catch (error) {
      setPickedMessage(uk ? "Не вдалося відкрити цю анатомічну частину." : error instanceof Error ? error.message : String(error));
    }
  }, [commitPageState, fallbackNavigation, locale, manifest, requestFocus, selectedGroup, uk]);
  const back = useCallback(() => {
    const current = pageStateRef.current;
    const navigation = transitionBodyMapNavigationV2(current.navigation, { type: "BACK" });
    const next = commitPageState({
      ...current, navigation, view: navigation.groupId ? defaultBodyMapGroupViewV1(navigation.groupId) : "front", mode: "muscle", deep: false,
    });
    setHoveredGroupId(null);
    if (next.navigation.level === "OVERVIEW") {
      setPickedMessage(uk ? "Повернення до вигляду всього тіла…" : "Returning to the full-body view…");
      requestFocus(focusInputForPageState(next));
      if (fallbackNavigation) { setFocusReady(true); setPickedMessage(""); }
    } else if (next.navigation.groupId) {
      const label = selectedGroup ? bodyMapGroupLabel(selectedGroup.groupId, selectedGroup.label, locale) : uk ? "групи м’язів" : "muscle group";
      setPickedMessage(uk ? `Повернення до ${label}…` : `Returning to ${label}…`);
      requestFocus(focusInputForPageState(next));
      if (fallbackNavigation) setFocusReady(true);
    }
  }, [commitPageState, fallbackNavigation, locale, requestFocus, selectedGroup, uk]);
  const selectCameraPreset = useCallback((preset: CameraPresetV1) => {
    const current = pageStateRef.current;
    const view: BodyMapUrlViewV1 = preset === "reset" ? current.navigation.groupId ? "default" : "front" : preset;
    const next = commitPageState({ ...current, view });
    setPickedMessage(current.navigation.groupId ? uk ? "Зміна ракурсу…" : "Adjusting view…" : uk ? "Зміна ракурсу всього тіла…" : "Adjusting full-body view…");
    requestFocus(focusInputForPageState(next));
    if (fallbackNavigation) { setFocusReady(true); setPickedMessage(""); }
  }, [commitPageState, fallbackNavigation, requestFocus, uk]);

  const selectDisplayMode = useCallback((mode: BodyMapUrlModeV1) => {
    commitPageState({ ...pageStateRef.current, mode });
  }, [commitPageState]);
  const toggleDeepMode = useCallback(() => {
    commitPageState({ ...pageStateRef.current, deep: !pageStateRef.current.deep });
  }, [commitPageState]);
  const onOverviewMeshPicked = useCallback((region: ManifestRegion | null, hitName: string) => {
    if (!region) {
      setPickedMessage(uk ? "Це допоміжна геометрія; вибирати можна лише перевірені м’язові групи." : `${hitName} is context geometry; only validated analytics-group surfaces are selectable.`);
      return;
    }
    const selectedGroupId = selectedGroup?.groupId;
    const groupId = selectedGroupId && region.bodyMapGroupIds.includes(selectedGroupId) ? selectedGroupId : region.primaryPickGroupId;
    if (!region.bodyMapGroupIds.includes(groupId)) {
      setPickedMessage(uk ? "Цю ділянку не зіставлено з групою для вибору." : `Mesh ${region.meshId} has no valid primary group-pick binding.`);
      return;
    }
    const validPair = manifest?.navigationMembership.pairs.some(({ anatomyId, groupId: memberGroupId }) =>
      memberGroupId === groupId && region.anatomyIds.includes(anatomyId),
    );
    if (!validPair) {
      setPickedMessage(uk ? "Ця ділянка не має підтвердженого анатомічного зіставлення." : `Mesh ${region.meshId} has no taxonomy membership for ${groupId}.`);
      return;
    }
    setPickedMessage(uk ? `Вибрано: ${bodyMapGroupLabel(groupId, groupId, locale)}` : `${region.sourceObjectName} · selected ${groupId} group`);
    selectGroup(groupId);
  }, [locale, manifest, selectGroup, selectedGroup, uk]);
  const selectedVisualRegionIds = useMemo(() => {
    if (!manifest || !selectedGroup || navState.level !== "SUBREGION_DETAIL" || !navState.anatomyId) return [];
    const ids = new Set(selectedSubregionMeshIds(selectedGroup, navState.anatomyId));
    return manifest.visualIdentity.supportedRegions
      .filter((region) => ids.has(region.meshId))
      .map(({ visualRegionId }) => visualRegionId);
  }, [manifest, navState.anatomyId, navState.level, selectedGroup]);
  const analyticsGroup = selectedGroup ? analytics?.groups.find(({ groupId }) => groupId === selectedGroup.groupId) ?? null : null;
  const exposureStates: readonly ExposureState[] = delivery === "public" && analytics
    ? analytics.groups
    : manifest?.trainingExposure.groups ?? [];
  const activeExposure = selectedGroup
    ? (delivery === "public" ? (analyticsGroup ?? exposureStates.find(({ groupId }) => groupId === selectedGroup.groupId)) : exposureStates.find(({ groupId }) => groupId === selectedGroup.groupId)) ?? null
    : null;
  const selectedAnatomy = analyticsGroup?.anatomy.find(({ anatomyId }) => anatomyId === selectedSubregion?.anatomyId) ?? null;
  const selectedAnatomyCoverage = selectedSubregion && manifest
    ? manifest.anatomyCoverage.find(({ anatomyId }) => anatomyId === selectedSubregion.anatomyId)
    : null;

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 7) gesture.moved = true;
  };
  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.moved) suppressCanvasClickUntil.current = performance.now() + 400;
    pointerGesture.current = null;
  };
  const ignoreCanvasClick = useCallback(() => performance.now() < suppressCanvasClickUntil.current, []);
  const onSceneLoaded = useCallback((meshCount: number, regionCount: number, rootUuid: string, loadMs: number | null) => {
    setRendererAvailable(true);
    setFallbackActive(false);
    setFocusReady(false);
    setSceneRootUuid(rootUuid);
    setLoadedMeshCount(meshCount);
    void regionCount;
    void loadMs;
    setPickedMessage("");
  }, []);
  const onFallbackVisible = useCallback(() => {
    setFallbackActive(true);
    setFocusReady(true);
  }, []);
  const onSceneMetrics = useCallback((metrics: RuntimePerformance) => setRuntimePerformance(metrics), []);
  const dataBadge = delivery === "development"
    ? uk ? "ДЕМОНСТРАЦІЙНІ ДАНІ" : "DEMO DATA"
    : analyticsRequestState === "loading" ? uk ? "ЗАВАНТАЖЕННЯ ЖУРНАЛУ" : "LOADING DIARY"
      : analyticsRequestState === "unauthorized" ? uk ? "ПОТРІБЕН ВХІД" : "SIGN IN REQUIRED"
        : analyticsRequestState === "error" ? uk ? "АНАЛІТИКА НЕДОСТУПНА" : "ANALYTICS UNAVAILABLE"
          : analytics?.coverage.mapping === "partial" ? uk ? "ЧАСТКОВІ ДАНІ ЖУРНАЛУ" : "PARTIAL DIARY DATA"
            : analytics?.coverage.mapping === "complete-for-input" ? uk ? "ДАНІ З ЖУРНАЛУ" : "DIARY DATA"
              : uk ? "ЗАПИСІВ НЕМАЄ" : "NO DIARY RECORDS";

  if (loadError || !manifest || !assetUrl) {
    return (
      <main className={styles.page} data-testid="body-map-prototype">
        <header className={styles.header}><div><h1>{uk ? "Карта тіла" : "Body Map"}</h1></div><span className={styles.demoBadge}>{dataBadge}</span></header>
        {loadError ? <p className={styles.viewerError} role="alert">{uk ? "Карта тіла недоступна." : "Body Map is unavailable."}</p> : <p className={styles.loading}>{uk ? "Завантаження анатомії…" : "Loading anatomy…"}</p>}
      </main>
    );
  }

  return (
    <main className={styles.page} data-testid="body-map-prototype">
      <header className={styles.header}>
        <div><h1>{uk ? "Карта тіла" : "Body Map"}</h1></div>
        <div className={styles.badges}>
          <span className={styles.demoBadge} data-testid="body-map-data-status">{dataBadge}</span>
        </div>
      </header>

      <nav className={styles.breadcrumbs} aria-label={uk ? "Навігація картою тіла" : "Body Map breadcrumb"}>
        <button onClick={setOverview} aria-current={navState.level === "OVERVIEW" ? "page" : undefined}>{uk ? "Карта тіла" : "Body Map"}</button>
        {selectedGroup && <><span>›</span><button onClick={() => selectGroup(selectedGroup.groupId)} aria-current={navState.level === "GROUP_DETAIL" ? "page" : undefined}>{selectedGroupLabel}</button></>}
        {selectedSubregion && <><span>›</span><span aria-current="page">{selectedSubregionLabel}</span></>}
      </nav>

      <section className={styles.layout}>
        <div className={styles.viewerColumn}>
          <div
            className={`${styles.viewer} ${hoveredGroupId ? styles.viewerInteractive : ""}`}
            data-testid="glb-viewport"
            data-scene-root-uuid={sceneRootUuid ?? "loading"}
            data-scene-mesh-count={loadedMeshCount}
            data-hover-group-id={hoveredGroupId ?? ""}
            data-fallback-active={fallbackActive ? "true" : "false"}
            data-renderer-available={rendererAvailable ? "true" : "false"}
            data-focus-ready={focusReady ? "true" : "false"}
            data-navigation-level={navState.level}
            data-navigation-group={navState.groupId ?? ""}
            data-navigation-region={navState.anatomyId ?? ""}
            data-navigation-view={pageState.view}
            data-navigation-mode={pageState.mode}
            data-navigation-deep={pageState.deep ? "true" : "false"}
            data-focus-request-id={focusRequest.id}
            data-focus-request-kind={focusRequest.kind}
            data-focus-request-group={focusRequest.kind === "group" || focusRequest.kind === "anatomy" ? focusRequest.groupId : ""}
            data-focus-request-view={focusRequest.kind === "group" || focusRequest.kind === "anatomy" ? focusRequest.view : focusRequest.kind === "preset" ? focusRequest.preset : ""}
            data-render-quality={effectiveQuality}
            data-render-dpr={renderDpr.toFixed(2)}
            onPointerDownCapture={onCanvasPointerDown}
            onPointerMoveCapture={onCanvasPointerMove}
            onPointerUpCapture={onCanvasPointerUp}
            onPointerCancelCapture={onCanvasPointerUp}
          >
            {assetError ? <TwoDimensionalFallback groups={manifest.bodyMapGroups} locale={locale} onSelectGroup={selectGroup} onReady={onFallbackVisible} /> : <SceneErrorBoundary fallback={<TwoDimensionalFallback groups={manifest.bodyMapGroups} locale={locale} onSelectGroup={selectGroup} onReady={onFallbackVisible} />}>
              <Canvas
                frameloop="demand"
                camera={{ fov: 35, near: 0.01, far: 100, position: [0, 0, 4.5] }}
                dpr={renderDpr}
                gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
                aria-label={uk ? "Анатомічна сцена всього тіла. Перетягніть для обертання, прокрутіть для масштабування, натисніть на м’язову групу." : "BodyParts3D full-body anatomy scene. Drag to orbit, scroll to zoom, click a highlighted muscle group."}
                fallback={<TwoDimensionalFallback groups={manifest.bodyMapGroups} locale={locale} onSelectGroup={selectGroup} onReady={onFallbackVisible} />}
                onCreated={({ gl }) => {
                  setRendererAvailable(true);
                  gl.outputColorSpace = THREE.SRGBColorSpace;
                  gl.toneMapping = THREE.ACESFilmicToneMapping;
                  gl.toneMappingExposure = 1.12;
                  setAutomaticQuality(preferredGraphicsQuality(gl, window.devicePixelRatio || 1));
                }}
              >
                <color attach="background" args={["#07090a"]} />
                <hemisphereLight args={[0xffffff, 0x384640, 2.1]} />
                <directionalLight color={0xfff2df} intensity={2.2} position={[-2.5, 3.5, 4]} />
                <directionalLight color={0xe7f2ec} intensity={effectiveQuality === "low" ? 0 : 1.3} position={[3, 1.3, -3]} />
                <OrbitControls enableDamping dampingFactor={0.08} enablePan={false} minDistance={0.2} maxDistance={12} minPolarAngle={0.04} maxPolarAngle={Math.PI - 0.04} makeDefault />
                <Suspense fallback={null}>
                  <FullBodyScene
                    manifest={manifest}
                    assetUrl={assetUrl}
                    selectedGroupId={selectedGroup?.groupId ?? null}
                    hoveredGroupId={hoveredGroupId}
                    selectedVisualRegionIds={selectedVisualRegionIds}
                    layer={layer}
                    deepDetailAnatomyId={deepDetailAnatomyId}
                    showSurfaceSupport={showSurfaceSupport}
                    showSkeletalContext={showSkeletalContext}
                    graphicsQuality={effectiveQuality}
                    focusRequest={focusRequest}
                    ignoreCanvasClick={ignoreCanvasClick}
                    onHoverGroup={setHoveredGroupId}
                    onGroupPicked={onOverviewMeshPicked}
                    onFocusComplete={finishFocus}
                    onLoaded={onSceneLoaded}
                    onMetrics={onSceneMetrics}
                    onAssetError={setAssetError}
                  />
                </Suspense>
              </Canvas>
            </SceneErrorBoundary>}
            {pickedMessage && <div className={styles.viewerMessage} aria-live="polite">{pickedMessage}</div>}
            {assetError && <div role="alert" className={styles.assetError}>{uk ? "3D-модель недоступна або не пройшла перевірку. Показано спрощену карту." : "The 3D model is unavailable or failed validation. A simplified map is shown."}</div>}
          </div>
          <div className={styles.viewerControls}>
            <button data-testid="view-front" onClick={() => selectCameraPreset("front")}>{uk ? "Спереду" : "Front"}</button>
            <button data-testid="view-back" onClick={() => selectCameraPreset("back")}>{uk ? "Ззаду" : "Back"}</button>
            <button data-testid="view-left" onClick={() => selectCameraPreset("left")}>{uk ? "Ліворуч" : "Left"}</button>
            <button data-testid="view-right" onClick={() => selectCameraPreset("right")}>{uk ? "Праворуч" : "Right"}</button>
            <button data-testid="view-reset" onClick={() => selectCameraPreset("reset")}>{uk ? "Скинути ракурс" : "Reset camera"}</button>
            {navState.level !== "OVERVIEW" && <>
              <span className={styles.controlDivider} />
              <button aria-pressed={pageState.mode === "muscle" && !pageState.deep} onClick={() => commitPageState({ ...pageStateRef.current, mode: "muscle", deep: false })}>{uk ? "М’язи" : "Muscle view"}</button>
              <button aria-pressed={showSurfaceSupport} onClick={() => selectDisplayMode(showSurfaceSupport ? showSkeletalContext ? "skeleton" : "muscle" : showSkeletalContext ? "both-context" : "fascia")}>{uk ? "Фасції та сухожилля" : "Fascia/tendon context"}</button>
              <button aria-pressed={showSkeletalContext} onClick={() => selectDisplayMode(showSkeletalContext ? showSurfaceSupport ? "fascia" : "muscle" : showSurfaceSupport ? "both-context" : "skeleton")}>{uk ? "Скелет" : "Skeleton context"}</button>
              <button aria-pressed={pageState.deep} onClick={toggleDeepMode}>{uk ? "Глибокі м’язи" : "Deep muscles"}</button>
              <button onClick={() => navState.level === "SUBREGION_DETAIL" ? back() : commitPageState({ ...pageStateRef.current, mode: "muscle", deep: false })}>{uk ? "Повернути вигляд групи" : "Restore group view"}</button>
            </>}
          </div>
          <output className={styles.performance} data-testid="runtime-performance" hidden aria-hidden="true">
            {runtimePerformance ? JSON.stringify(runtimePerformance) : "pending"}
          </output>
          <div className={styles.viewerControls}>
            <label className={styles.qualityControl}>{uk ? "Якість зображення" : "Visual quality"}
              <select data-testid="graphics-quality" value={graphicsQuality} onChange={(event) => setGraphicsQuality(event.currentTarget.value as GraphicsQuality)}>
                <option value="auto">{uk ? "Авто" : "Auto"}</option><option value="high">{uk ? "Висока" : "High"}</option><option value="balanced">{uk ? "Збалансована" : "Balanced"}</option><option value="low">{uk ? "Низька" : "Low"}</option>
              </select>
            </label>
          </div>
        </div>

        <aside className={styles.panel}>
          {navState.level === "OVERVIEW" && <>
            <div className={styles.panelHeading}><p className={styles.kicker}>{uk ? "ОГЛЯД" : "OVERVIEW"}</p><h2>{uk ? "Групи м’язів" : "Muscle groups"}</h2></div>
            <p className={styles.muted}>{uk ? "Оберни тіло та вибери групу або натисни її у списку." : "Rotate the body, then choose a group or select it from the list."}</p>
            {delivery === "public" && <BodyMapTrainingAnalyticsPanel key="overview" level="OVERVIEW" months={analyticsMonths} onMonthsChange={setAnalyticsMonths} analytics={analytics} requestState={analyticsRequestState} groupLabel={null} anatomyId={null} anatomyLabel={null} groupReport={null} />}
            <GroupList groups={manifest.bodyMapGroups} exposureStates={exposureStates} hoveredGroupId={hoveredGroupId} onHover={setHoveredGroupId} onSelect={selectGroup} locale={locale} />
          </>}

          {navState.level !== "OVERVIEW" && !focusReady && selectedGroup && <div className={styles.transitionCard} data-testid="focus-transition-status" aria-live="polite">
            <span className={styles.kicker}>{uk ? "ПЕРЕХІД КАМЕРИ" : "CAMERA TRANSITION"}</span><strong>{uk ? "Перехід до" : "Moving to"} {selectedSubregionLabel ?? selectedGroupLabel}</strong><small>{uk ? "Звіт відкриється після завершення переходу." : "The report opens when the camera settles."}</small>
          </div>}

          {navState.level === "GROUP_DETAIL" && selectedGroup && focusReady && <>
            <div className={styles.panelHeading}><p className={styles.kicker}>{uk ? "ГРУПА М’ЯЗІВ" : "MUSCLE GROUP"}</p><h2>{selectedGroupLabel}</h2></div>
            {delivery === "public" && <BodyMapTrainingAnalyticsPanel key={`group:${selectedGroup.groupId}`} level="GROUP_DETAIL" months={analyticsMonths} onMonthsChange={setAnalyticsMonths} analytics={analytics} requestState={analyticsRequestState} groupLabel={selectedGroupLabel} anatomyId={null} anatomyLabel={null} groupReport={analyticsGroup} />}
            {delivery === "development" && <div className={styles.metricCard} data-testid="group-report"><span>{uk ? "Демонстраційна експозиція" : "Demo exposure"}</span><strong>{exposureLabel(activeExposure, uk)}</strong><small>{uk ? "Фіктивні демодані; це не історія тренувань." : "Fixture data only; this is not training history."}</small></div>}
            <h3>{uk ? "М’язи та частини" : "Muscles and regions"}</h3>
            <SubregionList group={selectedGroup} manifest={manifest} locale={locale} onSelect={selectSubregion} />
            <p className={styles.coverageNotice}>{uk ? "Підхід потрапляє до частини м’яза лише тоді, коли це підтримує збережений мапінг вправи. Дані про групу не розподіляються довільно між її частинами." : "Sets are assigned to a muscle part only when the stored exercise mapping supports it. Group totals are not arbitrarily split across child regions."}</p>
            <details className={styles.otherGroups}><summary>{uk ? "Усі групи м’язів" : "All muscle groups"}</summary><GroupList groups={manifest.bodyMapGroups} exposureStates={exposureStates} hoveredGroupId={hoveredGroupId} onHover={setHoveredGroupId} onSelect={selectGroup} compact locale={locale} /></details>
          </>}

          {navState.level === "SUBREGION_DETAIL" && selectedGroup && selectedSubregion && focusReady && <>
            <div className={styles.panelHeading}><p className={styles.kicker}>{uk ? "ЧАСТИНА М’ЯЗА" : "MUSCLE DETAIL"}</p><h2>{selectedSubregionLabel}</h2></div>
            <div className={styles.identityCard} data-testid="subregion-identity-card">
              <span>{selectedGroupLabel}</span>
            </div>
            {[...new Set(manifest.visualIdentity.supportedRegions.filter(({ meshId }) => selectedSubregion.representedMeshIds.includes(meshId)).map(({ depthLayer }) => depthLayer))].includes("deep")
              && ![...new Set(manifest.visualIdentity.supportedRegions.filter(({ meshId }) => selectedSubregion.representedMeshIds.includes(meshId)).map(({ depthLayer }) => depthLayer))].includes("superficial")
              && deepDetailAnatomyId === selectedSubregion.anatomyId
              ? <p className={styles.coverageNotice} data-testid="deep-context-status">{uk ? "Показано вибрану глибоку структуру. Поверхневі м’язи цієї групи тимчасово приглушені; решта тіла залишається видимою." : "The selected deep structure is shown in place. Superficial muscles in this group are temporarily muted; the rest of the body remains visible."}</p>
              : null}
            {selectedAnatomyCoverage?.visualAvailability === "unavailable" ? <p className={styles.coverageNotice} data-testid="source-geometry-unavailable">{uk ? "У BodyParts3D немає відповідної геометрії для цієї структури. Штучну модель не показуємо." : "No matching BodyParts3D geometry is available for this structure. No synthetic mesh is shown."}</p> : null}{selectedAnatomyCoverage?.visualAvailability === "partial" ? <p className={styles.coverageNotice} data-testid="source-geometry-partial">{uk ? "Геометрія цієї структури в BodyParts3D неповна." : "This structure has partial geometry in BodyParts3D."}</p> : null}
            {delivery === "public" && <BodyMapTrainingAnalyticsPanel key={`subregion:${selectedGroup.groupId}:${selectedSubregion.anatomyId}`} level="SUBREGION_DETAIL" months={analyticsMonths} onMonthsChange={setAnalyticsMonths} analytics={analytics} requestState={analyticsRequestState} groupLabel={selectedGroupLabel} anatomyId={selectedSubregion.anatomyId} anatomyLabel={selectedSubregionLabel} groupReport={analyticsGroup} />}
            {delivery === "development" && <div className={styles.metricCard}><span>{uk ? "Дані про цю частину" : "Subregion exposure"}</span><strong>{uk ? "Недоступно в деморежимі" : "Unavailable in demo mode"}</strong><small>{uk ? "Демодані не підміняють ваш журнал." : "Demo fixtures never replace your diary."}</small></div>}
            {selectedAnatomy?.mappingCoverage === "partial" && <p className={styles.coverageNotice}>{uk ? "Підрахунок частковий: мапінг вправи не охоплює всі відповідні анатомічні дані." : "The count is partial because exercise mappings do not cover all relevant anatomy."}</p>}
          </>}

          <footer className={styles.footer}>
            {navState.level !== "OVERVIEW" && <button className={styles.backButton} onClick={back}>← {uk ? "Назад" : "Back"}</button>}
            {navState.level !== "OVERVIEW" && <button className={styles.textButton} onClick={setOverview}>{uk ? "Огляд карти тіла" : "Body Map overview"}</button>}
            <small>{uk ? "Підрахунок показує зіставлені підходи з журналу, а не вимір активації чи росту м’язів." : "Counts show mapped diary sets, not measured muscle activation or growth."}</small>
          </footer>
        </aside>
      </section>
      <details className={styles.footnote}><summary>{uk ? "Модель та ліцензії" : "Assets & licenses"}</summary><p>{uk ? <>Версійна анатомічна модель BodyParts3D 4.0. <a href="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html" target="_blank" rel="noreferrer">Офіційний опис</a> зазначає ліцензію CC BY 4.0 та умови атрибуції. У заголовках архівних OBJ також залишилися старіші згадки CC BY-SA 2.1 Japan; цю розбіжність описано в повідомленні до моделі. Чотири відсутні об’єми м’язів є навчальними наближеннями BodyCast і потребують анатомічної перевірки.</> : <>Versioned BodyParts3D 4.0 anatomy. The <a href="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html" target="_blank" rel="noreferrer">official documentation</a> states CC BY 4.0 and attribution terms. Archived OBJ headers also retain older CC BY-SA 2.1 Japan notices; this discrepancy is disclosed in the bundled notice. Four missing muscle volumes are BodyCast educational approximations and need anatomy review.</>}</p></details>
    </main>
  );
}

function exposureLabel(exposure: ExposureState | null | undefined, uk: boolean) {
  if (!exposure) return uk ? "Недоступно" : "Unavailable";
  if (exposure.status === "recorded-direct") return `${uk ? "Прямі записані підходи" : "Recorded direct exposure"}${exposure.mappingCoverage === "partial" ? ` · ${uk ? "мапінг частковий" : "partial mapping"}` : exposure.mappingCoverage === "unknown" ? ` · ${uk ? "охоплення невідоме" : "coverage unknown"}` : ""}`;
  if (exposure.status === "recorded-indirect") return `${uk ? "Допоміжні записані підходи" : "Recorded indirect exposure"}${exposure.mappingCoverage === "partial" ? ` · ${uk ? "мапінг частковий" : "partial mapping"}` : exposure.mappingCoverage === "unknown" ? ` · ${uk ? "охоплення невідоме" : "coverage unknown"}` : ""}`;
  if (exposure.status === "partial-mapping") return uk ? "Частковий мапінг" : "Partial mapping";
  if (exposure.status === "unavailable") return uk ? "Недоступно" : "Unavailable";
  return uk ? "Немає зіставлених записів" : "No recorded mapped exposure";
}

function selectedSubregionMeshIds(group: ManifestGroup, anatomyId: AnatomyIdV2): string[] {
  return group.subregions.find((subregion) => subregion.anatomyId === anatomyId)?.representedMeshIds ?? [];
}

function GroupList({ groups, exposureStates, hoveredGroupId, onHover, onSelect, locale, compact = false }: {
  groups: readonly ManifestGroup[];
  exposureStates: readonly ExposureState[];
  hoveredGroupId: BodyMapGroupIdV2 | null;
  onHover: (groupId: BodyMapGroupIdV2 | null) => void;
  onSelect: (groupId: BodyMapGroupIdV2) => void;
  locale: "uk" | "en";
  compact?: boolean;
}) {
  const uk = locale === "uk";
  const stateByGroup = new Map(exposureStates.map((state) => [state.groupId, state]));
  const recorded = groups.filter((group) => ["recorded-direct", "recorded-indirect"].includes(stateByGroup.get(group.groupId)?.status ?? ""))
    .sort((left, right) => Number(stateByGroup.get(left.groupId)?.status !== "recorded-direct") - Number(stateByGroup.get(right.groupId)?.status !== "recorded-direct"));
  const uncertain = groups.filter((group) => ["partial-mapping", "unavailable"].includes(stateByGroup.get(group.groupId)?.status ?? ""));
  const withoutRecorded = groups.filter((group) => stateByGroup.get(group.groupId)?.status === "no-recorded-mapped-exposure");
  const renderGroup = (group: ManifestGroup, muted = false) => {
    const exposure = stateByGroup.get(group.groupId);
    const count = exposure?.totalUniqueSetCount;
    return <button
      className={`${styles.groupButton} ${hoveredGroupId === group.groupId ? styles.groupButtonHovered : ""} ${muted ? styles.groupButtonUnrecorded : ""}`}
      data-testid={`group-select-${group.groupId}`}
      data-exposure-status={exposure?.status ?? "unavailable"}
      key={group.groupId}
      title={bodyMapGroupNote(group.groupId, group.note, locale)}
      onMouseEnter={() => onHover(group.groupId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(group.groupId)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(group.groupId)}
    >
      <span>{bodyMapGroupLabel(group.groupId, group.label, locale)}</span><small>{exposureLabel(exposure, uk)}{count === null || count === undefined ? "" : ` · ${count} ${uk ? "підх." : "sets"}`}</small><b>›</b>
    </button>;
  };
  return <div className={`${styles.groupList} ${compact ? styles.groupListCompact : ""}`}>
    {recorded.length > 0 && <section className={styles.exposureSection}><h3>{uk ? "Записані підходи" : "Recorded exposure"}</h3>{recorded.map((group) => renderGroup(group))}</section>}
    {uncertain.length > 0 && <section className={styles.exposureSection}><h3>{uk ? "Частково або недоступно" : "Partial or unavailable"}</h3>{uncertain.map((group) => renderGroup(group))}</section>}
    {withoutRecorded.length > 0 && <section className={styles.exposureSection}><h3>{uk ? "Немає зіставлених записів" : "No recorded mapped exposure"}</h3>{withoutRecorded.map((group) => renderGroup(group, true))}<p className={styles.muted}>{uk ? "Це означає лише, що в доступному журналі немає зіставлених підходів для цих груп; це не доводить відсутність тренувань." : "The supplied diary has no mapped sets for these groups; this does not establish inactivity."}</p></section>}
    {groups.filter((group) => !stateByGroup.has(group.groupId)).map((group) => renderGroup(group, true))}
  </div>;
}

function SubregionList({ group, manifest, locale, onSelect }: { group: ManifestGroup; manifest: PrototypeManifest; locale: "uk" | "en"; onSelect: (anatomyId: AnatomyIdV2) => void }) {
  const uk = locale === "uk";
  return <div className={styles.subregionList}>
    {group.subregions.map((subregion) => {
      const representedMeshIds = subregion.representedMeshIds;
      const regionRows = manifest.visualIdentity.supportedRegions.filter(({ meshId }) => representedMeshIds.includes(meshId));
      const hasDeepGeometry = regionRows.some(({ depthLayer }) => depthLayer === "deep");
      const availability = subregion.visualAvailability === "unavailable" ? uk ? "Немає в моделі джерела" : "Not represented in source model" : subregion.visualAvailability === "partial" ? uk ? "Часткове покриття джерела" : "Partial source coverage" : hasDeepGeometry ? uk ? "Містить глибокий м’яз" : "Includes deep muscle" : uk ? "Деталізація м’яза" : "Muscle detail";
      return <button key={subregion.anatomyId} data-testid={`subregion-${subregion.anatomyId}`} onClick={() => onSelect(subregion.anatomyId)}>
        <span>{bodyMapAnatomyLabel(subregion.anatomyId, subregion.label, locale)}</span><small>{availability}</small>
      </button>;
    })}
  </div>;
}

function FullBodyScene({
  manifest, assetUrl, selectedGroupId, hoveredGroupId, selectedVisualRegionIds, layer, deepDetailAnatomyId, showSurfaceSupport, showSkeletalContext,
  graphicsQuality,
  focusRequest, ignoreCanvasClick, onHoverGroup, onGroupPicked, onFocusComplete, onLoaded, onMetrics, onAssetError,
}: {
  manifest: PrototypeManifest;
  assetUrl: string;
  selectedGroupId: BodyMapGroupIdV2 | null;
  hoveredGroupId: BodyMapGroupIdV2 | null;
  selectedVisualRegionIds: readonly string[];
  layer: LayerSelection;
  deepDetailAnatomyId: AnatomyIdV2 | null;
  showSurfaceSupport: boolean;
  showSkeletalContext: boolean;
  graphicsQuality: Exclude<GraphicsQuality, "auto">;
  focusRequest: FocusRequest;
  ignoreCanvasClick: () => boolean;
  onHoverGroup: (groupId: BodyMapGroupIdV2 | null) => void;
  onGroupPicked: (region: ManifestRegion | null, hitName: string) => void;
  onFocusComplete: (id: number) => void;
  onLoaded: (meshCount: number, regionCount: number, rootUuid: string, loadMs: number | null) => void;
  onMetrics: (metrics: RuntimePerformance) => void;
  onAssetError: (message: string) => void;
}) {
  const gltf = useGLTF(assetUrl, true, true);
  const defaultHiddenContextMeshIds = manifest.visualIdentity.contextVisibility?.defaultHiddenContextMeshIds ?? EMPTY_DEFAULT_HIDDEN_CONTEXT_MESH_IDS;
  const camera = useThree(({ camera }) => camera);
  const gl = useThree(({ gl }) => gl);
  const invalidate = useThree(({ invalidate }) => invalidate);
  const controls = useThree(({ controls }) => controls as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (type: string, listener: () => void) => void; removeEventListener: (type: string, listener: () => void) => void } | null);
  const controller = useRef(new CameraTransitionControllerV1());
  const animationRunId = useRef(0);
  const priorFocusRef = useRef("");
  /* eslint-disable react-hooks/purity -- QA records the synchronous BVH build duration; the metric does not drive UI state. */
  const model = useMemo(() => {
    const bvhStartedAt = performance.now();
    const clone = gltf.scene.clone(true);
    const regionByMeshId = new Map(manifest.visualIdentity.supportedRegions.map((region) => [region.meshId, region]));
    const nodeByMeshId = new Map<string, THREE.Object3D>();
    const acceleratedGeometries = new Set<THREE.BufferGeometry>();
    clone.traverse((object) => {
      const meshId = object.userData.bodycastMeshId;
      if (typeof meshId === "string") nodeByMeshId.set(meshId, object);
      if (object instanceof THREE.Mesh) {
        object.raycast = acceleratedRaycast;
        if (!acceleratedGeometries.has(object.geometry)) {
          if (!object.geometry.boundsTree) object.geometry.computeBoundsTree({ indirect: true });
          acceleratedGeometries.add(object.geometry);
        }
      }
    });
    for (const [meshId, node] of nodeByMeshId) {
      const region = regionByMeshId.get(meshId);
      if (region) node.userData.bodyMapRegion = region;
    }
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      let identityNode: THREE.Object3D | null = object;
      while (identityNode && typeof identityNode.userData.bodycastMeshId !== "string") identityNode = identityNode.parent;
      if (!identityNode) return;
      const meshId = identityNode.userData.bodycastMeshId;
      if (typeof meshId !== "string") return;
      const identity = identityNode.userData;
      const region = regionByMeshId.get(meshId);
      const isDefaultHiddenContext = defaultHiddenContextMeshIds.includes(meshId);
      const isBodySilhouette = identity.bodycastContextPresentation === "body-silhouette-context";
      object.visible = !isDefaultHiddenContext && !isBodySilhouette;
      object.userData.bodycastDefaultHiddenContext = isDefaultHiddenContext || isBodySilhouette;
      object.userData.bodycastMeshId = meshId;
      object.userData.bodycastSelectable = identity.bodycastSelectable === true;
      object.userData.bodycastRole = identity.bodycastRole;
      object.userData.bodycastContextLayer = identity.bodycastContextLayer;
      object.userData.bodycastContextPresentation = identity.bodycastContextPresentation;
      object.userData.bodycastSourceObjectName = identity.bodycastSourceObjectName;
      const isVisibleSupplementalMuscle = identity.bodycastContextPresentation === "supplemental-muscle";
      if (!region && !isVisibleSupplementalMuscle && !isBodySilhouette) return;
      if (region) object.userData.bodyMapRegion = region;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const clones = sourceMaterials.map((source) => {
        const material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.multiply(new THREE.Color(0xdfc9b8));
          material.emissive.set(0x000000);
          material.emissiveIntensity = 0;
          material.roughness = Math.max(material.roughness, 0.6);
          material.metalness = 0;
          if (isBodySilhouette && material.userData.bodycastOpaqueFaceClosure === true) {
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.roughness = 1;
          } else if (isBodySilhouette) {
            material.transparent = true;
            material.opacity = Math.min(material.opacity, 0.14);
            material.depthWrite = false;
            material.roughness = 1;
          }
          material.userData.bodyMapTinted = true;
          if (region) {
            material.userData.bodyMapBaseColor = material.color.clone();
            material.userData.bodyMapBaseEmissive = material.emissive.clone();
            material.userData.bodyMapBaseEmissiveIntensity = material.emissiveIntensity;
          }
        }
        return material;
      });
      object.material = Array.isArray(object.material) ? clones : clones[0];
    });
    clone.userData.bodycastBvhInitializationMs = performance.now() - bvhStartedAt;
    return clone;
  }, [defaultHiddenContextMeshIds, gltf.scene, manifest.visualIdentity.supportedRegions]);
  /* eslint-enable react-hooks/purity */
  const selectableMeshes = useMemo(() => {
    const meshes = new Map<string, THREE.Mesh[]>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || typeof object.userData.bodycastMeshId !== "string") return;
      const existing = meshes.get(object.userData.bodycastMeshId) ?? [];
      existing.push(object);
      meshes.set(object.userData.bodycastMeshId, existing);
    });
    return meshes;
  }, [model]);
  const sceneMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    model.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    return meshes;
  }, [model]);
  const regionIds = useMemo(() => new Set(manifest.visualIdentity.supportedRegions.map(({ meshId }) => meshId)), [manifest.visualIdentity.supportedRegions]);
  const visibleMeshesRef = useRef<THREE.Mesh[]>([]);
  const cameraBounds = useMemo(() => {
    model.updateWorldMatrix(true, true);
    const all = new THREE.Box3();
    const meshBounds = new Map<string, THREE.Box3>();
    for (const mesh of sceneMeshes) {
      all.expandByObject(mesh);
      const meshId = mesh.userData.bodycastMeshId;
      if (typeof meshId !== "string") continue;
      const bounds = meshBounds.get(meshId) ?? new THREE.Box3();
      bounds.expandByObject(mesh);
      meshBounds.set(meshId, bounds);
    }
    const groups = new Map<BodyMapGroupIdV2, THREE.Box3>();
    const anatomy = new Map<string, THREE.Box3>();
    const include = (target: THREE.Box3, meshIds: readonly string[]) => {
      for (const meshId of meshIds) {
        const bounds = meshBounds.get(meshId);
        if (bounds) target.union(bounds);
      }
    };
    for (const group of manifest.bodyMapGroups) {
      const groupBox = new THREE.Box3();
      include(groupBox, manifest.visualIdentity.supportedRegions
        .filter((region) => region.bodyMapGroupIds.includes(group.groupId))
        .map(({ meshId }) => meshId));
      groups.set(group.groupId, groupBox);
      for (const subregion of group.subregions) {
        const box = new THREE.Box3();
        include(box, subregion.representedMeshIds);
        anatomy.set(`${group.groupId}:${subregion.anatomyId}`, box);
      }
    }
    return { all, groups, anatomy };
  }, [manifest.bodyMapGroups, manifest.visualIdentity.supportedRegions, model, sceneMeshes]);

  useEffect(() => {
    const mappedIds = new Set([...selectableMeshes.keys()].filter((meshId) => regionIds.has(meshId)));
    if (mappedIds.size !== manifest.viewerAsset.selectableMeshCount || manifest.visualIdentity.supportedRegions.some(({ meshId }) => !mappedIds.has(meshId))) {
      onAssetError(`Full-body GLB identity mismatch: found ${mappedIds.size} of ${manifest.viewerAsset.selectableMeshCount} mapped meshes.`);
      return;
    }
    const totalMeshes = selectableMeshes.size;
    const regions = manifest.visualIdentity.supportedRegions.length;
    const started = performance.getEntriesByType("resource").find((entry) => entry.name.includes(assetUrl));
    onLoaded(totalMeshes, regions, model.uuid, started?.duration ?? null);
    return () => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material.userData.bodyMapTinted === true) material.dispose();
        });
      });
    };
  }, [assetUrl, manifest.viewerAsset.assetId, manifest.viewerAsset.selectableMeshCount, manifest.visualIdentity.supportedRegions, model, onAssetError, onLoaded, regionIds, selectableMeshes]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const debugWindow = window as Window & { __bodycastBodyMapDebug?: Record<string, unknown> };
    const getPickCandidates = () => {
      camera.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
      const rect = gl.domElement.getBoundingClientRect();
      const raycaster = new THREE.Raycaster();
      raycaster.firstHitOnly = true;
      const ndc = new THREE.Vector2();
      const visibleMeshes = sceneMeshes.filter(isMusclePickTarget);
      const candidateByPoint = new Map<string, { groupId: BodyMapGroupIdV2; meshId: string; x: number; y: number; hitMeshId: string; role: string; side: string }>();
      for (const mesh of [...selectableMeshes.values()].flat()) {
        const region = mesh.userData.bodyMapRegion as ManifestRegion | undefined;
        if (!region || !isEffectivelyVisible(mesh) || [...candidateByPoint.values()].some((candidate) => candidate.meshId === region.meshId)) continue;
        const geometry = mesh.geometry;
        const positions = geometry.getAttribute("position");
        const index = geometry.index;
        if (!positions) continue;
        const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
        const step = Math.max(1, Math.floor(triangleCount / 70));
        let hitPointsForMesh = 0;
        for (let triangle = 0; triangle < triangleCount; triangle += step) {
          const vertexIndices = index
            ? [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)]
            : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
          const point = new THREE.Vector3();
          for (const vertexIndex of vertexIndices) point.add(new THREE.Vector3().fromBufferAttribute(positions, vertexIndex));
          point.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld).project(camera);
          if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 0.96 || Math.abs(point.y) > 0.96) continue;
          ndc.set(point.x, point.y);
          raycaster.setFromCamera(ndc, camera);
          const firstHit = raycaster.intersectObjects(visibleMeshes, false)[0]?.object;
          if (firstHit !== mesh) continue;
          const groupId = selectedGroupId && region.bodyMapGroupIds.includes(selectedGroupId) ? selectedGroupId : region.primaryPickGroupId;
          candidateByPoint.set(`${region.meshId}:${hitPointsForMesh}`, {
            groupId,
            meshId: region.meshId,
            x: rect.left + (point.x + 1) * rect.width / 2,
            y: rect.top + (1 - point.y) * rect.height / 2,
            hitMeshId: String(firstHit.userData.bodycastMeshId ?? firstHit.name),
            role: String(firstHit.userData.bodycastRole ?? "unknown"),
            side: region.side,
          });
          hitPointsForMesh += 1;
          if (hitPointsForMesh >= 2) break;
        }
      }
      return [...candidateByPoint.values()];
    };
    const getContextPickCandidates = (contextPresentation: string) => {
      camera.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      const visibleMeshes = sceneMeshes.filter(isMusclePickTarget);
      const raycaster = new THREE.Raycaster();
      raycaster.firstHitOnly = true;
      const candidates: Array<{ meshId: string; sourceObjectName: string; contextPresentation: string; x: number; y: number; groupId: null; role: "context-only" }> = [];
      for (const mesh of visibleMeshes) {
        if (mesh.userData.bodycastSelectable !== false || mesh.userData.bodycastContextPresentation !== contextPresentation) continue;
        const positions = mesh.geometry.getAttribute("position");
        const index = mesh.geometry.index;
        if (!positions) continue;
        const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
        const step = Math.max(1, Math.floor(triangleCount / 40));
        for (let triangle = 0; triangle < triangleCount; triangle += step) {
          const vertexIndices = index
            ? [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)]
            : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
          const point = new THREE.Vector3();
          for (const vertexIndex of vertexIndices) point.add(new THREE.Vector3().fromBufferAttribute(positions, vertexIndex));
          point.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld).project(camera);
          if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 0.96 || Math.abs(point.y) > 0.96) continue;
          raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), camera);
          if (raycaster.intersectObjects(visibleMeshes, false)[0]?.object !== mesh) continue;
          candidates.push({
            meshId: String(mesh.userData.bodycastMeshId ?? mesh.name),
            sourceObjectName: String(mesh.userData.bodycastSourceObjectName ?? mesh.name),
            contextPresentation,
            x: rect.left + (point.x + 1) * rect.width / 2,
            y: rect.top + (1 - point.y) * rect.height / 2,
            groupId: null,
            role: "context-only",
          });
          break;
        }
        if (candidates.length >= 8) break;
      }
      return candidates;
    };
    const getPickAtClient = (x: number, y: number) => {
      camera.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      const pointer = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.firstHitOnly = true;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(sceneMeshes.filter(isMusclePickTarget), false)[0]?.object as (THREE.Object3D & { userData: { bodycastMeshId?: string; bodycastSelectable?: boolean; bodycastSourceObjectName?: string; bodycastRole?: string; bodycastContextPresentation?: string; bodyMapRegion?: ManifestRegion } }) | undefined;
      if (!hit) return null;
      return {
        groupId: hit.userData.bodycastSelectable === false ? null : (selectedGroupId && hit.userData.bodyMapRegion?.bodyMapGroupIds.includes(selectedGroupId) ? selectedGroupId : hit.userData.bodyMapRegion?.primaryPickGroupId ?? null),
        meshId: hit.userData.bodycastMeshId ?? null,
        sourceObjectName: hit.userData.bodycastSourceObjectName ?? hit.name,
        role: hit.userData.bodycastRole ?? null,
        contextPresentation: hit.userData.bodycastContextPresentation ?? null,
      };
    };
    const debugApi = {
      sceneRootUuid: model.uuid,
      getFocusRequest: () => focusRequest,
      totalMeshCount: selectableMeshes.size,
      selectableMeshCount: manifest.visualIdentity.supportedRegions.length,
      contextMeshCount: manifest.visualIdentity.contextNodes.length,
      getVisiblePresentationCounts: () => {
        const counts: Record<string, number> = {};
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.visible) return;
          const presentation = object.userData.bodycastSelectable === true
            ? "mapped-muscle"
            : String(object.userData.bodycastContextPresentation ?? "unclassified");
          counts[presentation] = (counts[presentation] ?? 0) + 1;
        });
        return counts;
      },
      getPickCandidates,
      getContextPickCandidates,
      getPickAtClient,
      getModelBounds: () => {
        model.updateWorldMatrix(true, true);
        const all = new THREE.Box3();
        const visible = new THREE.Box3();
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          all.expandByObject(object);
          if (isEffectivelyVisible(object)) visible.expandByObject(object);
        });
        return {
          allMin: all.min.toArray(),
          allMax: all.max.toArray(),
          visibleMin: visible.min.toArray(),
          visibleMax: visible.max.toArray(),
          lastFocus: model.userData.bodycastLastFocusBounds ?? null,
          lastDestination: model.userData.bodycastLastCameraDestination ?? null,
          lastCameraResult: model.userData.bodycastLastCameraResult ?? null,
        };
      },
      getCameraPosition: () => camera.position.toArray(),
      getCameraTarget: () => controls?.target.toArray() ?? [],
      getRendererInfo: () => {
        const context = gl.getContext();
        const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
        const drawingBufferSize = gl.getDrawingBufferSize(new THREE.Vector2());
        return {
          webgl2: gl.capabilities.isWebGL2,
          renderer: debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
          vendor: debugInfo ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : context.getParameter(context.VENDOR),
          bvhInitializationMs: model.userData.bodycastBvhInitializationMs,
          graphicsQuality,
          pixelRatio: gl.getPixelRatio(),
          drawingBuffer: drawingBufferSize.toArray(),
          renderedFrames: gl.info.render.frame,
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
        };
      },
      getMaterialHighlights: (anatomyId: string) => {
        const highlights: Array<{ meshId: string; side: string; color: string; emissive: string; emissiveIntensity: number; visible: boolean }> = [];
        for (const meshes of selectableMeshes.values()) {
          for (const mesh of meshes) {
            const region = mesh.userData.bodyMapRegion as ManifestRegion | undefined;
            if (!region?.anatomyIds.includes(anatomyId as AnatomyIdV2)) continue;
            const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            if (!(material instanceof THREE.MeshStandardMaterial)) continue;
            highlights.push({ meshId: region.meshId, side: region.side, color: material.color.getHexString(), emissive: material.emissive.getHexString(), emissiveIntensity: material.emissiveIntensity, visible: mesh.visible });
          }
        }
        return highlights;
      },
      setMeshVisibility: (meshId: string, visible: boolean) => {
        const nodes = selectableMeshes.get(meshId) ?? [];
        for (const node of nodes) node.visible = visible;
        invalidate();
        return nodes.length;
      },
    };
    debugWindow.__bodycastBodyMapDebug = debugApi;
    return () => {
      if (debugWindow.__bodycastBodyMapDebug === debugApi) delete debugWindow.__bodycastBodyMapDebug;
    };
  }, [camera, controls, focusRequest, gl, graphicsQuality, invalidate, manifest.visualIdentity.contextNodes.length, manifest.visualIdentity.supportedRegions.length, model, sceneMeshes, selectableMeshes, selectedGroupId]);

  useEffect(() => {
    const selected = new Set(selectedVisualRegionIds);
    for (const mesh of [...selectableMeshes.values()].flat()) {
      const region = mesh.userData.bodyMapRegion as ManifestRegion | undefined;
      if (!region) continue;
      const selectedChild = selected.has(region.visualRegionId);
      const matchingDepth = layer === "all" || region.depthLayer === layer;
      const localDeepOccluder = deepDetailAnatomyId !== null
        && selectedGroupId !== null
        && region.bodyMapGroupIds.includes(selectedGroupId)
        && region.depthLayer === "superficial";
      mesh.visible = matchingDepth && !localDeepOccluder;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        const baseColor = material.userData.bodyMapBaseColor;
        const baseEmissive = material.userData.bodyMapBaseEmissive;
        if (baseColor instanceof THREE.Color) material.color.copy(baseColor);
        if (baseEmissive instanceof THREE.Color) material.emissive.copy(baseEmissive);
        material.emissiveIntensity = material.userData.bodyMapBaseEmissiveIntensity ?? 0;
        const groupHovered = hoveredGroupId !== null && region.bodyMapGroupIds.includes(hoveredGroupId);
        const groupSelected = selectedGroupId !== null && region.bodyMapGroupIds.includes(selectedGroupId);
        if (groupHovered && !groupSelected) {
          material.color.lerp(GROUP_HOVER_COLOR, 0.74);
          material.emissive.set(0x1b7354);
          material.emissiveIntensity = 0.34;
        }
        if (groupSelected) {
          material.color.lerp(GROUP_SELECTED_COLOR, 0.8);
          material.emissive.set(0x16583f);
          material.emissiveIntensity = 0.48;
        }
        if (selectedChild) {
          material.color.copy(baseColor instanceof THREE.Color ? baseColor : material.color);
          material.color.lerp(SUBREGION_SELECTED_COLOR, 0.9);
          material.emissive.set(0x23694d);
          material.emissiveIntensity = 0.72;
        }
      });
    }
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.bodyMapRegion) return;
      const presentation = object.userData.bodycastContextPresentation;
      object.visible = object.userData.bodycastDefaultHiddenContext !== true && presentation !== "body-silhouette-context" && (presentation === "supplemental-muscle"
        || (presentation === "support-only" && showSurfaceSupport)
        || presentation === "cranial-context"
        || (presentation === "skeletal-context" && showSkeletalContext));
    });
    visibleMeshesRef.current = sceneMeshes.filter(isMusclePickTarget);
    invalidate();
  }, [deepDetailAnatomyId, hoveredGroupId, invalidate, layer, model, sceneMeshes, selectedGroupId, selectedVisualRegionIds, showSkeletalContext, showSurfaceSupport, selectableMeshes]);

  useEffect(() => {
    if (!controls) return;
    const onUserOrbitStart = () => controller.current.cancel();
    controls.addEventListener("start", onUserOrbitStart);
    return () => controls.removeEventListener("start", onUserOrbitStart);
  }, [controls]);

  // eslint-disable-next-line react-hooks/immutability -- Three.js cameras are mutable renderer objects; animation is confined to this effect.
  useEffect(() => {
    if (!controls) return;
    const requestKey = JSON.stringify(focusRequest);
    if (priorFocusRef.current === requestKey) return;
    priorFocusRef.current = requestKey;
    const runId = ++animationRunId.current;
    model.updateWorldMatrix(true, true);
    let focusBounds = cameraBounds.all.clone();
    let direction = new THREE.Vector3(0, 0, 1);
    if (focusRequest.kind === "group" || focusRequest.kind === "anatomy") {
      focusBounds = cameraBounds.groups.get(focusRequest.groupId)?.clone() ?? new THREE.Box3();
      if (focusRequest.kind === "anatomy") {
        const subregionBounds = cameraBounds.anatomy.get(`${focusRequest.groupId}:${focusRequest.anatomyId}`);
        if (subregionBounds && !subregionBounds.isEmpty()) focusBounds = subregionBounds.clone();
      }
      if (focusRequest.view !== "default") {
        direction = directionForView(focusRequest.view);
      } else {
        const directionContract = manifest.bodyMapGroups.find(({ groupId }) => groupId === focusRequest.groupId)?.camera.preferredDirection;
        const dir = directionContract ?? [0, 0, 1] as const;
        direction = new THREE.Vector3(dir[0], dir[1], dir[2]);
      }
    } else if (focusRequest.kind === "preset" || focusRequest.kind === "overview") {
      direction = directionForView(focusRequest.preset === "reset" ? "front" : focusRequest.preset);
    }
    if (focusBounds.isEmpty() && focusRequest.kind === "anatomy") {
      focusBounds = cameraBounds.groups.get(focusRequest.groupId)?.clone() ?? focusBounds;
    }
    if (focusBounds.isEmpty()) focusBounds = cameraBounds.all.clone();
    /* eslint-disable react-hooks/immutability -- Dev-only camera diagnostics mirror the existing imperative Three.js runtime state. */
    model.userData.bodycastLastFocusBounds = {
      min: focusBounds.min.toArray(),
      max: focusBounds.max.toArray(),
      requestKind: focusRequest.kind,
      requestPreset: focusRequest.kind === "preset" ? focusRequest.preset : null,
    };
    /* eslint-enable react-hooks/immutability */
    const activeGroupCamera = focusRequest.kind === "group" || focusRequest.kind === "anatomy"
      ? manifest.bodyMapGroups.find(({ groupId }) => groupId === focusRequest.groupId)?.camera
      : null;
    const destination = frameBoundsV1(focusBounds, direction, camera instanceof THREE.PerspectiveCamera ? camera.fov : 35, gl.domElement.clientWidth / Math.max(gl.domElement.clientHeight, 1), focusRequest.kind === "overview" ? BODY_MAP_OVERVIEW_PADDING_FACTOR_V1 : activeGroupCamera?.paddingFactor ?? BODY_MAP_OVERVIEW_PADDING_FACTOR_V1);
    model.userData.bodycastLastCameraDestination = { position: destination.position.toArray(), target: destination.target.toArray() };
    /* eslint-disable react-hooks/immutability -- Configure the imperative Three.js camera projection for this focused view. */
    camera.near = activeGroupCamera?.near ?? 0.01;
    camera.far = activeGroupCamera?.far ?? 100;
    camera.updateProjectionMatrix();
    /* eslint-enable react-hooks/immutability */
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionMs = activeGroupCamera
      ? window.innerWidth <= 720 ? activeGroupCamera.mobileTransitionMs : activeGroupCamera.desktopTransitionMs
      : 680;
    void controller.current.animate(camera, controls, destination, reducedMotion ? 0 : transitionMs, invalidate).then((result) => {
      model.userData.bodycastLastCameraResult = result;
      if (animationRunId.current !== runId) return;
      if (result === "completed" || result === "cancelled") onFocusComplete(focusRequest.id);
    });
  }, [camera, cameraBounds, controls, focusRequest, gl, invalidate, manifest.bodyMapGroups, model, onFocusComplete]);

  const pointerDownRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const pointer = new THREE.Vector2();
    const getFirstHit = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(visibleMeshesRef.current, false)[0]?.object as (THREE.Object3D & { userData: { bodyMapRegion?: ManifestRegion; bodycastSourceObjectName?: string; bodycastSelectable?: boolean } }) | undefined;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerDownRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      const press = pointerDownRef.current;
      if (press?.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 7) press.moved = true;
      if (event.pointerType !== "mouse" || event.buttons !== 0 || ignoreCanvasClick()) return;
      const hit = getFirstHit(event);
      const region = hit?.userData.bodyMapRegion;
      const hoverGroupId = selectedGroupId && region?.bodyMapGroupIds.includes(selectedGroupId) ? selectedGroupId : region?.primaryPickGroupId;
      onHoverGroup(hit?.userData.bodycastSelectable !== false && region?.selectable && hoverGroupId ? hoverGroupId : null);
    };
    const onPointerUp = (event: PointerEvent) => {
      const press = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!press || press.pointerId !== event.pointerId || press.moved || event.button !== 0 || ignoreCanvasClick()) return;
      const hit = getFirstHit(event);
      if (!hit) return;
      onGroupPicked(hit.userData.bodycastSelectable === false ? null : hit.userData.bodyMapRegion ?? null, hit.userData.bodycastSourceObjectName ?? hit.name);
    };
    const onPointerLeave = () => { if (!pointerDownRef.current) onHoverGroup(null); };
    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove, true);
    canvas.addEventListener("pointerup", onPointerUp, true);
    canvas.addEventListener("pointercancel", onPointerLeave, true);
    canvas.addEventListener("pointerleave", onPointerLeave, true);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, true);
      canvas.removeEventListener("pointermove", onPointerMove, true);
      canvas.removeEventListener("pointerup", onPointerUp, true);
      canvas.removeEventListener("pointercancel", onPointerLeave, true);
      canvas.removeEventListener("pointerleave", onPointerLeave, true);
    };
  }, [camera, gl, ignoreCanvasClick, model, onGroupPicked, onHoverGroup, selectedGroupId]);

  useFrame(({ gl: renderer, clock }, delta) => {
    const performanceState = frameSamples;
    performanceState.samples.push(delta * 1000);
    if (performanceState.samples.length > 45) performanceState.samples.shift();
    if (clock.elapsedTime - performanceState.lastReport < 0.55) return;
    performanceState.lastReport = clock.elapsedTime;
    const meanFrameMs = performanceState.samples.reduce((sum, item) => sum + item, 0) / Math.max(performanceState.samples.length, 1);
    const sortedFrameTimes = [...performanceState.samples].sort((left, right) => left - right);
    const p95FrameMs = sortedFrameTimes[Math.max(0, Math.ceil(sortedFrameTimes.length * 0.95) - 1)] ?? 0;
    onMetrics({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      meanFrameMs,
      p95FrameMs,
    });
  });

  return <primitive object={model} dispose={null} />;
}

const frameSamples = { samples: [] as number[], lastReport: -1 };

function TwoDimensionalFallback({ groups, locale, onSelectGroup, onReady }: {
  groups: readonly ManifestGroup[];
  locale: "uk" | "en";
  onSelectGroup: (groupId: BodyMapGroupIdV2) => void;
  onReady: () => void;
}) {
  const uk = locale === "uk";
  useEffect(() => { onReady(); }, [onReady]);
  return <div className={styles.fallback2d} data-testid="body-map-2d-fallback">
    <div className={styles.fallbackHeading}><p className={styles.kicker}>{uk ? "РЕЗЕРВНА 2D КАРТА ТІЛА" : "2D BODY MAP FALLBACK"}</p><strong>{uk ? "Вибери групу" : "Choose a group"}</strong><span>{uk ? "Спільна таксономія · WebGL недоступний" : "Shared taxonomy IDs · WebGL unavailable"}</span></div>
    <div className={styles.fallbackBody} role="group" aria-label={uk ? "Схематичний вибір групи м’язів" : "Schematic anatomy group picker"}>
      <svg viewBox="0 0 300 700" aria-hidden="true" className={styles.bodySilhouette}>
        <circle cx="150" cy="56" r="35" /><path d="M132 91h36v29h-36zM117 119q33-20 66 0l24 22-10 123q-39 25-94 0l-10-123zM114 127 76 145 50 252l20 8 45-92M186 127l38 18 26 107-20 8-45-92M104 264q46 23 92 0l17 42-31 24h-64l-31-24zM118 326h27l-9 142-25 130-23-3 10-153zM155 326h27l20 116 9 153-23 3-25-130z" />
      </svg>
      {groups.map((group) => <button key={group.groupId} className={styles.fallbackHotspot} style={{ left: `${group.fallbackAnchor[0]}%`, top: `${group.fallbackAnchor[1]}%` } as CSSProperties} aria-label={`${uk ? "Вибрати" : "Select"} ${bodyMapGroupLabel(group.groupId, group.label, locale)}`} data-testid={`fallback-group-${group.groupId}`} onClick={() => onSelectGroup(group.groupId)}><span>{bodyMapGroupLabel(group.groupId, group.label, locale)}</span></button>)}
    </div>
    <div className={styles.fallbackGroupList} role="group" aria-label={uk ? "Список груп для вибору" : "Selectable muscle groups"}>
      {groups.map((group) => <button key={group.groupId} type="button" className={styles.fallbackGroupOption} data-testid={`fallback-list-${group.groupId}`} onClick={() => onSelectGroup(group.groupId)}>{bodyMapGroupLabel(group.groupId, group.label, locale)}</button>)}
    </div>
    <p className={styles.fallbackNote}>{uk ? "Схематичні ділянки слугують для навігації, а не для анатомічної сегментації. Список груп і деталізація використовують ту саму версійну таксономію, що й 3D-сцена." : "Schematic regions are navigation aids, not anatomical segmentation. The group list and subregion detail use the same versioned taxonomy as the 3D scene."}</p>
  </div>;
}

type SceneErrorBoundaryProps = { children: ReactNode; fallback: ReactNode };
type SceneErrorBoundaryState = { hasError: boolean };
class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(): SceneErrorBoundaryState { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BODY_MAP_GROUP_CAMERA_DIRECTIONS_V1,
  CameraTransitionControllerV1,
  easeInOutCubicV1,
  frameBoundsV1,
} from "@/app/dev/body-map/camera-transition-v1";

describe("Body Map camera transitions v1", () => {
  it("defines a focused viewing direction for each of the eight analytics groups", () => {
    expect(Object.keys(BODY_MAP_GROUP_CAMERA_DIRECTIONS_V1)).toEqual([
      "chest", "deltoids", "triceps", "back", "biceps", "forearms", "spinal_extensors", "hip_extensors",
    ]);
  });

  it("frames selected geometry from real bounds and adapts distance to aspect ratio", () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-0.2, -0.15, -0.12), new THREE.Vector3(0.2, 0.15, 0.12));
    const landscape = frameBoundsV1(bounds, new THREE.Vector3(0, 0, 1), 35, 1.7);
    const portrait = frameBoundsV1(bounds, new THREE.Vector3(0, 0, 1), 35, 0.62);
    expect(landscape.target.toArray()).toEqual([0, 0, 0]);
    expect(portrait.position.distanceTo(portrait.target)).toBeGreaterThan(landscape.position.distanceTo(landscape.target));
    expect(() => frameBoundsV1(new THREE.Box3(), new THREE.Vector3(0, 0, 1), 35, 1)).toThrow(/empty/);
  });

  it("uses a smooth ease-in/ease-out curve", () => {
    expect(easeInOutCubicV1(0)).toBe(0);
    expect(easeInOutCubicV1(0.5)).toBe(0.5);
    expect(easeInOutCubicV1(1)).toBe(1);
    expect(easeInOutCubicV1(0.25)).toBeLessThan(0.25);
  });

  it("completes and cancels transitions without moving the scene geometry", async () => {
    let now = 0;
    let nextId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const driver = {
      requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++nextId; callbacks.set(id, callback); return id; },
      cancelAnimationFrame: (id: number) => { callbacks.delete(id); },
      now: () => now,
    };
    const controller = new CameraTransitionControllerV1(driver);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 0, 5);
    const controls = { target: new THREE.Vector3(), update: () => undefined };
    let invalidatedFrames = 0;
    const first = controller.animate(camera, controls, { position: new THREE.Vector3(0, 0, 2), target: new THREE.Vector3(0, 0, 1) }, 100, () => { invalidatedFrames += 1; });
    const initialFrame = [...callbacks.values()][0];
    callbacks.clear();
    now = 50;
    initialFrame(now);
    expect(camera.position.z).toBeLessThan(5);
    expect(invalidatedFrames).toBe(1);
    const second = controller.animate(camera, controls, { position: new THREE.Vector3(1, 0, 1), target: new THREE.Vector3(1, 0, 0) }, 100);
    await expect(first).resolves.toBe("cancelled");
    controller.cancel();
    await expect(second).resolves.toBe("cancelled");
    expect(camera.position.z).toBeLessThan(5);
  });
});

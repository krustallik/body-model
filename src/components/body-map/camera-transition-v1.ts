import * as THREE from "three";
export { BODY_MAP_CAMERA_CONTRACT_V1, BODY_MAP_CAMERA_VERSION_V1, BODY_MAP_GROUP_CAMERA_DIRECTIONS_V1, BODY_MAP_OVERVIEW_PADDING_FACTOR_V1 } from "./body-map-camera-contract-v1";

export type CameraDestinationV1 = { position: THREE.Vector3; target: THREE.Vector3 };
export type CameraTransitionResultV1 = "completed" | "cancelled";
export type OrbitControlTargetV1 = {
  target: THREE.Vector3;
  update: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export function easeInOutCubicV1(progress: number): number {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Camera framing only: bounds are computed from the selected real mesh geometry. */
export function frameBoundsV1(
  bounds: THREE.Box3,
  direction: THREE.Vector3,
  fovDegrees: number,
  aspect: number,
  padding = 1.45,
): CameraDestinationV1 {
  if (bounds.isEmpty()) throw new Error("Cannot frame an empty anatomy selection");
  const target = bounds.getCenter(new THREE.Vector3());
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const verticalFov = THREE.MathUtils.degToRad(fovDegrees);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(aspect, 0.1));
  const limitingFov = Math.max(0.01, Math.min(verticalFov, horizontalFov));
  const distance = Math.max((sphere.radius * padding) / Math.sin(limitingFov / 2), 0.2);
  const offset = direction.clone().normalize().multiplyScalar(distance);
  return { position: target.clone().add(offset), target };
}

type FrameDriverV1 = {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  now: () => number;
};

const browserFrameDriver: FrameDriverV1 = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** A single cancellable camera tween; a newer focus request replaces an older one. */
export class CameraTransitionControllerV1 {
  private frameId: number | null = null;
  private resolveActive: ((result: CameraTransitionResultV1) => void) | null = null;
  private readonly driver: FrameDriverV1;

  constructor(driver: FrameDriverV1 = browserFrameDriver) {
    this.driver = driver;
  }

  animate(
    camera: THREE.Camera,
    controls: OrbitControlTargetV1,
    destination: CameraDestinationV1,
    durationMs: number,
    onFrame?: () => void,
  ): Promise<CameraTransitionResultV1> {
    this.cancel();
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = this.driver.now();
    const duration = Math.max(0, durationMs);

    return new Promise((resolve) => {
      this.resolveActive = resolve;
      const finish = (result: CameraTransitionResultV1) => {
        if (this.frameId !== null) this.driver.cancelAnimationFrame(this.frameId);
        this.frameId = null;
        this.resolveActive = null;
        resolve(result);
      };
      const step = (timestamp: number) => {
        const progress = duration === 0 ? 1 : THREE.MathUtils.clamp((timestamp - startTime) / duration, 0, 1);
        const eased = easeInOutCubicV1(progress);
        camera.position.lerpVectors(startPosition, destination.position, eased);
        controls.target.lerpVectors(startTarget, destination.target, eased);
        camera.lookAt(controls.target);
        controls.update();
        onFrame?.();
        if (progress >= 1) {
          camera.position.copy(destination.position);
          controls.target.copy(destination.target);
          camera.lookAt(controls.target);
          controls.update();
          finish("completed");
          return;
        }
        this.frameId = this.driver.requestAnimationFrame(step);
      };
      if (duration === 0) step(startTime);
      else this.frameId = this.driver.requestAnimationFrame(step);
    });
  }

  cancel(): void {
    if (!this.resolveActive) return;
    if (this.frameId !== null) this.driver.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    const resolve = this.resolveActive;
    this.resolveActive = null;
    resolve("cancelled");
  }
}

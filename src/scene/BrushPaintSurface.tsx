import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import throttle from 'lodash.throttle';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import { MIN_HEIGHT } from '../hooks/useDecay';
import { useWorldStore } from '../state/worldStore';

/**
 * Hard ceiling on how often the brush is allowed to push state into the
 * global zustand store while a stroke is in flight. The hot painting path
 * only mutates `Float32Array` refs (no React re-renders), but anything that
 * mirrors brush data into the store goes through {@link syncBrushToStore}
 * so a 60Hz pointermove can never cascade into a 60Hz re-render storm.
 *
 * On `onPointerUp` we flush unconditionally so the final stamp is always
 * reflected in the store regardless of throttle state.
 */
const BRUSH_STORE_SYNC_THROTTLE_MS = 100;

/**
 * Hard cap on how often `onPointerMove` is allowed to dispatch a brush stamp.
 * 60ms ≈ 16Hz — well above the human "feel" threshold for paint cursors but
 * dramatically below the raw 60–240Hz pointer-event cadence on modern
 * devices. This is the "React State Lag" fix: previously, every pointermove
 * walked the full target list synchronously, and on dense grids that loop
 * could starve React's commit phase enough to freeze the Leva drawer mid-
 * stroke. Throttling the *paint dispatch* leaves cursor smoothing on the
 * hot path (so the brush ring still tracks the mouse 1:1) while sediment
 * stamps land at a steady 16Hz.
 */
const POINTERMOVE_PAINT_THROTTLE_MS = 60;

/**
 * Placeholder zustand mirror for any future "brush-touched cells" feed.
 * Today, every brush mutation already lives in `Float32Array` refs, so the
 * store sync is intentionally a no-op `setAtmosphere({})`. The throttle
 * wiring around it is the contract we want to lock in: any new store write
 * added here is guaranteed to fire at most once per 100ms during a stroke.
 */
function syncBrushToStore(): void {
  useWorldStore.getState().setAtmosphere({});
}

export interface BrushTarget {
  x: number;
  z: number;
  initialHeight: number;
}

const GROUND_PLANE = /* @__PURE__ */ new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _scratch = new THREE.Vector3();

/** Bumped while the brush affects cells; consumed by `BuildingBrushFeedback`. */
export interface BrushPaintFeedbackRef {
  impulse: number;
  cx: number;
  cz: number;
  r: number;
  /** Primary button held during an active paint stroke. */
  isPainting: boolean;
}

function installInfiniteGroundRaycast(mesh: THREE.Mesh) {
  mesh.raycast = (raycaster, intersects) => {
    const hit = raycaster.ray.intersectPlane(GROUND_PLANE, _scratch);
    if (hit === null) return;
    const point = _scratch.clone();
    const distance = raycaster.ray.origin.distanceTo(point);
    intersects.push({
      distance,
      point,
      object: mesh,
    });
  };
}

/**
 * Imperative “setGrid” pass: circular brush in world XZ, modes from Leva
 * (`brushSize`, `brushStrength`, `brushMode`). `stepScale` is 1 for a discrete
 * pointer step, or ~`delta * 60` while the button is held for frame-based painting.
 */
function paintGridAt(
  x: number,
  z: number,
  stepScale: number,
  gaeaRef: GaeaParamsRef,
  targets: BrushTarget[],
  heights: Float32Array,
  sand: Float32Array,
  moss: Float32Array,
  distortion: Float32Array,
  baseElevation: Float32Array,
  floraDensity: Float32Array,
  groupsRef: Array<THREE.Group | null>,
  paintFeedbackRef: React.MutableRefObject<BrushPaintFeedbackRef>,
  dtHint: number,
) {
  const { brushSize, brushStrength, brushMode } = gaeaRef.current;
  const fb = paintFeedbackRef.current;
  fb.cx = x;
  fb.cz = z;
  fb.r = brushSize;

  const inc = brushStrength * stepScale;
  let anyInBrush = false;

  for (let k = 0; k < targets.length; k++) {
    const cell = targets[k];
    const distance = Math.hypot(cell.x - x, cell.z - z);
    if (distance >= brushSize) continue;
    anyInBrush = true;

    const falloff = 1 - distance / brushSize;

    const initH = cell.initialHeight;
    const group = groupsRef[k];
    const minIntegrity = MIN_HEIGHT / initH;

    switch (brushMode) {
      case 'ERODE': {
        let integrity = heights[k] / initH;
        const prevIntegrity = integrity;
        integrity = Math.max(minIntegrity, integrity - inc);
        const lost = prevIntegrity - integrity;
        heights[k] = integrity * initH;
        if (group) group.scale.y = Math.max(0.01, integrity);
        const meltInc =
          (lost * 5.5 + inc * 0.35) * (0.3 + 0.7 * falloff);
        distortion[k] = Math.min(2.6, distortion[k] + meltInc);
        break;
      }
      case 'PAINT_MOSS':
        moss[k] = Math.min(1, moss[k] + inc);
        break;
      case 'PAINT_SAND':
        sand[k] = Math.min(1, sand[k] + inc);
        break;
      case 'RESTORE':
        heights[k] = initH;
        moss[k] = 0;
        sand[k] = 0;
        distortion[k] = 0;
        baseElevation[k] = 0;
        floraDensity[k] = 0;
        if (group) group.scale.y = Math.max(0.01, 1);
        break;
      case 'RAISE_TERRAIN':
      case 'BASE_ELEVATION': {
        // Tectonic mantle-push: writes the per-cell yOffset that the
        // ErosionMaterial vertex shader adds in world-space, producing the
        // formula  P_final = P_base + yOffset + (height × integrity).
        // Distance-falloff biases the centre of the stroke so adjacent cells
        // smear into a continuous plateau.
        const raise = inc * (0.5 + 0.5 * falloff) * 2.4;
        baseElevation[k] = Math.min(6, baseElevation[k] + raise);
        break;
      }
      case 'SOW_FLORA':
        floraDensity[k] = Math.min(1, floraDensity[k] + inc * (0.6 + 0.4 * falloff));
        break;
    }
  }

  if (anyInBrush) {
    fb.impulse = Math.min(1, fb.impulse + 0.42 * Math.min(1, dtHint * 18));
  }
}

/**
 * Invisible hit surface for map painting. Mirrors the City/Map pattern:
 * `isPainting` + pointer move → world hit → circular brush → per-cell mode updates.
 */
export default function BrushPaintSurface({
  targets,
  heightsRef,
  sandRef,
  mossRef,
  distortionRef,
  baseElevationRef,
  floraDensityRef,
  groupRefsArr,
  gaeaRef,
  cursorRef,
  visibleRef,
  paintFeedbackRef,
  onBrushEnd,
}: {
  targets: BrushTarget[];
  heightsRef: React.MutableRefObject<Float32Array>;
  sandRef: React.MutableRefObject<Float32Array>;
  mossRef: React.MutableRefObject<Float32Array>;
  distortionRef: React.MutableRefObject<Float32Array>;
  baseElevationRef: React.MutableRefObject<Float32Array>;
  floraDensityRef: React.MutableRefObject<Float32Array>;
  groupRefsArr: Array<THREE.Group | null>;
  gaeaRef: GaeaParamsRef;
  cursorRef: React.MutableRefObject<THREE.Vector3>;
  visibleRef: React.MutableRefObject<boolean>;
  paintFeedbackRef: React.MutableRefObject<BrushPaintFeedbackRef>;
  onBrushEnd?: () => void;
}) {
  const [isPainting, setIsPainting] = useState(false);
  /** Same flag as `isPainting`, updated synchronously so the next `pointermove` sees it. */
  const isPaintingRef = useRef(false);

  const meshRef = useRef<THREE.Mesh>(null!);
  const smoothedCursorRef = useRef(new THREE.Vector3());
  const lastEventTsRef = useRef(0);
  const lastWallMsRef = useRef(0);
  /** wall-clock ms of the last `syncBrushToStore` call — gates the 100ms throttle. */
  const lastStoreSyncMsRef = useRef(0);
  const groupsRef = useRef(groupRefsArr);
  groupsRef.current = groupRefsArr;

  const controls = useThree(s => s.controls);

  const setControlsEnabled = useCallback(
    (enabled: boolean) => {
      const c = controls as { enabled?: boolean } | null | undefined;
      if (c && typeof c.enabled === 'boolean') c.enabled = enabled;
    },
    [controls],
  );

  const runPaintAt = useCallback(
    (x: number, z: number, stepScale: number, dtHint: number) => {
      paintGridAt(
        x,
        z,
        stepScale,
        gaeaRef,
        targets,
        heightsRef.current,
        sandRef.current,
        mossRef.current,
        distortionRef.current,
        baseElevationRef.current,
        floraDensityRef.current,
        groupsRef.current,
        paintFeedbackRef,
        dtHint,
      );

      // Throttle any global-state mirror to at most once per 100ms during a
      // stroke. The hot loop above only touches Float32Array refs, so this
      // gate exists purely to keep future store writers from triggering a
      // 60Hz React cascade and freezing the Leva panel.
      const now = performance.now();
      if (now - lastStoreSyncMsRef.current >= BRUSH_STORE_SYNC_THROTTLE_MS) {
        lastStoreSyncMsRef.current = now;
        syncBrushToStore();
      }
    },
    [
      baseElevationRef,
      distortionRef,
      floraDensityRef,
      gaeaRef,
      heightsRef,
      mossRef,
      paintFeedbackRef,
      sandRef,
      targets,
    ],
  );

  // Keep the latest `runPaintAt` reachable from the throttled wrapper. Because
  // `runPaintAt` is recreated whenever its inputs change but `lodash.throttle`
  // captures its callee by reference, we indirect through this ref so the
  // throttled scheduler always invokes the freshest closure without having to
  // be torn down and rebuilt (which would lose its internal timer state).
  const runPaintRef = useRef(runPaintAt);
  runPaintRef.current = runPaintAt;

  /**
   * 60ms-throttled pointermove paint dispatch. `leading: true` makes the very
   * first move after pointerdown stamp immediately (no perceived input lag);
   * `trailing: true` guarantees the final position the pointer rested on
   * before the throttle window closed still gets painted, so a fast flick
   * never leaves an under-baked tail.
   */
  const throttledPaint = useMemo(
    () =>
      throttle(
        (x: number, z: number, stepScale: number, dtHint: number) => {
          runPaintRef.current(x, z, stepScale, dtHint);
        },
        POINTERMOVE_PAINT_THROTTLE_MS,
        { leading: true, trailing: true },
      ),
    [],
  );

  useEffect(() => () => throttledPaint.cancel(), [throttledPaint]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    installInfiniteGroundRaycast(mesh);
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5e5);
  }, []);

  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-delta * 22);
    smoothedCursorRef.current.lerp(cursorRef.current, alpha);
    cursorRef.current.copy(smoothedCursorRef.current);

    if (!paintFeedbackRef.current.isPainting) return;
    const idleMs = performance.now() - lastWallMsRef.current;
    if (idleMs < 22) return;
    const c = cursorRef.current;
    runPaintAt(c.x, c.z, delta * 58, delta);
  });

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      visibleRef.current = true;

      const strength = gaeaRef.current.brushStrength;
      const t = e.nativeEvent.timeStamp * 0.001;
      const prevT = lastEventTsRef.current;
      lastEventTsRef.current = t;
      const moveDt =
        prevT > 0 ? Math.min(0.1, Math.max(1 / 500, t - prevT)) : 1 / 60;

      const alpha = 1 - Math.exp(-moveDt * 22);
      smoothedCursorRef.current.lerp(e.point, alpha);
      cursorRef.current.copy(smoothedCursorRef.current);

      if (!isPaintingRef.current) return;

      const stepScale = moveDt * (0.35 + 0.65 * strength);
      const { x, z } = cursorRef.current;
      // Route through the 60ms throttle — the cursor smoothing above still
      // runs on every event so the brush ring tracks 1:1, but the actual
      // paint stamp only lands at ~16Hz.
      throttledPaint(x, z, stepScale, moveDt);
      lastWallMsRef.current = performance.now();
    },
    [cursorRef, gaeaRef, throttledPaint, visibleRef],
  );

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return;
      if (gaeaRef.current.droneMode) return;

      e.stopPropagation();
      isPaintingRef.current = true;
      setIsPainting(true);
      paintFeedbackRef.current.isPainting = true;
      setControlsEnabled(false);

      smoothedCursorRef.current.copy(e.point);
      cursorRef.current.copy(e.point);
      visibleRef.current = true;
      lastWallMsRef.current = performance.now();
      lastEventTsRef.current = e.nativeEvent.timeStamp * 0.001;
      runPaintAt(e.point.x, e.point.z, 1, 1 / 60);
    },
    [cursorRef, paintFeedbackRef, runPaintAt, setControlsEnabled, visibleRef],
  );

  const endPaint = useCallback(() => {
    if (!isPaintingRef.current) return;
    const wasEroding = gaeaRef.current.brushMode === 'ERODE';
    isPaintingRef.current = false;
    setIsPainting(false);
    paintFeedbackRef.current.isPainting = false;
    setControlsEnabled(true);
    // Force any trailing throttled paint to land synchronously so the final
    // pointer position is committed regardless of where the 60ms window sat
    // when the user released the mouse.
    throttledPaint.flush();
    // Unconditional flush on pointer-up so the final stroke state is always
    // reflected in the store, regardless of where the throttle window landed.
    lastStoreSyncMsRef.current = performance.now();
    syncBrushToStore();
    if (wasEroding) onBrushEnd?.();
  }, [gaeaRef, onBrushEnd, paintFeedbackRef, setControlsEnabled, throttledPaint]);

  const handlePointerUp = useCallback(() => {
    endPaint();
  }, [endPaint]);

  const handlePointerLeave = useCallback(() => {
    visibleRef.current = false;
  }, [visibleRef]);

  useEffect(() => {
    const onWindowUp = () => {
      endPaint();
    };
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    return () => {
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
    };
  }, [endPaint]);

  return (
    <mesh
      ref={meshRef}
      name={isPainting ? 'brush-surface-painting' : 'brush-surface'}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.005, 0]}
      renderOrder={-1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

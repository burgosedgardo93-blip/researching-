import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { extend, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ErosionMaterial } from './ErosionMaterial';
import type { BrushMode, GaeaParamsRef } from '../gaea/gaeaParams';
import type { BrushPaintFeedbackRef } from './BrushPaintSurface';

extend({ ErosionMaterial });

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as React.MutableRefObject<T | null>).current = value;
}

export interface RelicEnvBindings {
  sand: React.MutableRefObject<Float32Array>;
  moss: React.MutableRefObject<Float32Array>;
  /** Per-cell melt from ERODE brush — drives {@link ErosionMaterial} `uDistortion`. */
  distortion: React.MutableRefObject<Float32Array>;
  /** Per-cell pedestal lift from RAISE_TERRAIN brush — drives `uBaseElevation`. */
  baseElevation: React.MutableRefObject<Float32Array>;
  index: number;
}

interface RelicBoxProps {
  position: [number, number, number];
  height?: number;
  /** 0..1 — wind accumulation / shelter (drives shader each frame). */
  sand?: number;
  /** 0..1 — moisture moss on tops (drives shader each frame). */
  moss?: number;
  /** When set, `sand` / `moss` props are overridden each frame from the sim buffers. */
  envBindings?: RelicEnvBindings;
  /** Gaea controls (e.g. sand storm) read imperatively each frame. */
  gaeaRef?: GaeaParamsRef;
  /** When set with {@link cursorRef}, ERODE brush drives live vertex “sanding” on this relic. */
  paintFeedbackRef?: React.MutableRefObject<BrushPaintFeedbackRef>;
  cursorRef?: React.MutableRefObject<THREE.Vector3>;
  groupRef?: React.Ref<THREE.Group>;
  materialRef?: React.Ref<InstanceType<typeof ErosionMaterial>>;
  meshRef?: (mesh: THREE.Mesh | null) => void;
}

const perfLambertMat = /* @__PURE__ */ new THREE.MeshLambertMaterial({
  color: '#3a3a3a',
});

/** Shared unlit fill used during Draft Mode strokes — avoids per-instance allocations. */
const draftBasicMat = /* @__PURE__ */ new THREE.MeshBasicMaterial({
  color: '#3a3a3a',
});

/**
 * Studio MatCap material: shared across every relic for crisp geometric
 * read-out during sculpting. Procedural matcap (no texture asset) lit from a
 * fixed studio key — bright top, deep bottom — so every face change is
 * immediately legible. `uBrushGlow` is driven per-mesh from the brush impulse
 * so the area of influence is 100% clear.
 */
const studioMatCapVS = /* glsl */ `
  uniform float uBaseElevation;
  varying vec3 vViewNormal;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    // Tectonic lift: P_final = P_base + yOffset + (height × integrity).
    // height × integrity is folded into the modelMatrix via the group's Y-scale,
    // and yOffset is added in world-space here to match ErosionMaterial.
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    worldPos.y += uBaseElevation;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const studioMatCapFS = /* glsl */ `
  precision highp float;
  uniform vec3 uGlowColor;
  uniform float uGlow;
  varying vec3 vViewNormal;

  // MeshNormalMaterial-style: faces are coloured by their view-space normal
  // mapped into [0,1] RGB. Gives every edge razor-sharp contrast for the
  // sculpting pass. The brush emissive is added on top so the area of
  // influence stays legible without losing the normal-as-RGB read.
  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 base = N * 0.5 + 0.5;
    gl_FragColor = vec4(base + uGlowColor * uGlow, 1.0);
  }
`;

interface StudioMatCapHandle {
  mat: THREE.ShaderMaterial;
  uGlow: { value: number };
  uGlowColor: { value: THREE.Color };
  uBaseElevation: { value: number };
}

function makeStudioMatCapMaterial(): StudioMatCapHandle {
  const uGlow = { value: 0 };
  const uGlowColor = { value: new THREE.Color('#ff6b1a') };
  const uBaseElevation = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uGlowColor,
      uGlow,
      uBaseElevation,
    },
    vertexShader: studioMatCapVS,
    fragmentShader: studioMatCapFS,
  });
  mat.toneMapped = false;
  return { mat, uGlow, uGlowColor, uBaseElevation };
}

const BRUSH_GLOW_ORANGE = /* @__PURE__ */ new THREE.Color('#ff6b1a');
const BRUSH_GLOW_GREEN  = /* @__PURE__ */ new THREE.Color('#4a8f5a');

function brushGlowColor(mode: BrushMode): THREE.Color {
  return mode === 'PAINT_MOSS' || mode === 'RESTORE' || mode === 'SOW_FLORA'
    ? BRUSH_GLOW_GREEN
    : BRUSH_GLOW_ORANGE;
}

function clamp01(v: number): number {
  return THREE.MathUtils.clamp(v, 0, 1);
}

/**
 * Data View: R = low integrity (eroded), B = high moss, R+G = sand (yellow when both high).
 */
function setDataViewBasicColor(
  mat: THREE.MeshBasicMaterial,
  integrity: number,
  sand: number,
  moss: number,
): void {
  const lowInt = clamp01(1 - integrity);
  const s = clamp01(sand);
  const m = clamp01(moss);
  mat.color.setRGB(
    THREE.MathUtils.clamp(0.06 + lowInt * 0.9 + s * 0.7, 0, 1),
    THREE.MathUtils.clamp(0.06 + s * 0.88 + lowInt * 0.05, 0, 1),
    THREE.MathUtils.clamp(0.08 + m * 0.9, 0, 1),
  );
}

/**
 * Subdivided concrete volume with procedural erosion shading.
 *
 * Wrapped in a <group> so useDecay can scale Y imperatively while keeping
 * the base at y = 0. Sand/moss uniforms follow props or live env bindings.
 */
export default function RelicBox({
  position,
  height = 1,
  sand = 0,
  moss = 0,
  envBindings,
  gaeaRef,
  paintFeedbackRef,
  cursorRef,
  groupRef,
  materialRef,
  meshRef,
}: RelicBoxProps) {
  const w = 0.88;
  const d = 0.88;

  const erosionRef = useRef<InstanceType<typeof ErosionMaterial> | null>(null);
  const rootGroupRef = useRef<THREE.Group | null>(null);
  const innerMeshRef = useRef<THREE.Mesh | null>(null);
  const vertexSandingSmoothedRef = useRef(0);
  const brushGlowSmoothedRef = useRef(0);

  const dataViewMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
      }),
    [],
  );

  const studioMat = useMemo(makeStudioMatCapMaterial, []);

  useEffect(() => {
    return () => {
      dataViewMat.dispose();
      studioMat.mat.dispose();
    };
  }, [dataViewMat, studioMat]);

  const setGroupRef = useCallback(
    (node: THREE.Group | null) => {
      rootGroupRef.current = node;
      assignRef(groupRef, node);
    },
    [groupRef],
  );

  useFrame((state, delta) => {
    const m = erosionRef.current;
    const mesh = innerMeshRef.current;
    const dataView = gaeaRef?.current.dataView ?? false;

    const idx = envBindings?.index;
    const s =
      envBindings && idx !== undefined
        ? clamp01(envBindings.sand.current[idx])
        : clamp01(sand);
    const ms =
      envBindings && idx !== undefined
        ? clamp01(envBindings.moss.current[idx])
        : clamp01(moss);

    const sy = rootGroupRef.current?.scale.y ?? 1;
    const integrity = THREE.MathUtils.clamp(sy, 0, 1);

    if (dataView && mesh) {
      setDataViewBasicColor(dataViewMat, integrity, s, ms);
      if (mesh.material !== dataViewMat) mesh.material = dataViewMat;
      return;
    }

    const studioView = gaeaRef?.current.viewMode === 'STUDIO';
    if (studioView && mesh) {
      // Compute brush proximity glow here so the matcap can emit it without
      // touching the heavy ErosionMaterial path. Boosted vs the Cinema glow so
      // the brush footprint reads as razor-clear.
      let glowTarget = 0;
      if (gaeaRef && paintFeedbackRef && cursorRef) {
        const fb = paintFeedbackRef.current;
        const pulse = fb.isPainting ? Math.max(fb.impulse, 0.12) : fb.impulse;
        if (pulse > 0.004) {
          const cx = fb.isPainting ? cursorRef.current.x : fb.cx;
          const cz = fb.isPainting ? cursorRef.current.z : fb.cz;
          const r = Math.max(gaeaRef.current.brushSize, 1e-4);
          const dx = position[0] - cx;
          const dz = position[2] - cz;
          const d2 = Math.hypot(dx, dz);
          if (d2 < r) {
            // 2.4× the cinema glow — Studio's job is "where am I painting?".
            glowTarget = pulse * (1 - d2 / r) * 2.4;
          }
        }
      }
      brushGlowSmoothedRef.current = THREE.MathUtils.lerp(
        brushGlowSmoothedRef.current,
        glowTarget,
        Math.min(1, delta * 18),
      );
      studioMat.uGlow.value = brushGlowSmoothedRef.current;
      studioMat.uBaseElevation.value =
        envBindings && idx !== undefined
          ? envBindings.baseElevation.current[idx]
          : 0;
      if (gaeaRef) {
        studioMat.uGlowColor.value.copy(brushGlowColor(gaeaRef.current.brushMode));
      }
      if (mesh.material !== studioMat.mat) mesh.material = studioMat.mat;
      return;
    }

    const perfMode = gaeaRef?.current.performanceMode ?? false;
    const draftMode = gaeaRef?.current.draftMode ?? false;
    const painting = paintFeedbackRef?.current.isPainting ?? false;

    // Draft takes precedence: unlit basic during strokes, skipping fragment-heavy erosion shading.
    if (draftMode && painting && mesh) {
      if (mesh.material !== draftBasicMat) mesh.material = draftBasicMat;
      return;
    }

    if (perfMode && painting && mesh) {
      if (mesh.material !== perfLambertMat) mesh.material = perfLambertMat;
      return;
    }

    if (mesh && m && mesh.material !== m) {
      mesh.material = m;
    }

    if (!m) return;

    const storm = gaeaRef
      ? Math.max(0, gaeaRef.current.sandStormIntensity)
      : 1;

    m.uTime = state.clock.elapsedTime;

    const u = m.uniforms;
    if (u.uSandStorm) u.uSandStorm.value = storm;
    if (u.uSandAccum) u.uSandAccum.value = s;
    if (u.uSandAmount) u.uSandAmount.value = s;
    if (u.uMossAmount) u.uMossAmount.value = ms;
    if (u.uMoisture) u.uMoisture.value = ms;

    if (u.uIntegrity) u.uIntegrity.value = integrity;
    if (u.uBoxHalf?.value instanceof THREE.Vector3) {
      u.uBoxHalf.value.set(w * 0.5, height * 0.5, d * 0.5);
    }

    const baseY = position[1];
    const topY = position[1] + height * sy;
    if (u.uSandBounds?.value instanceof THREE.Vector2) {
      u.uSandBounds.value.set(baseY, topY);
    }

    const dist =
      envBindings && idx !== undefined
        ? THREE.MathUtils.clamp(envBindings.distortion.current[idx], 0, 2.8)
        : 0;
    if (u.uDistortion) u.uDistortion.value = dist;

    const pedestal =
      envBindings && idx !== undefined
        ? envBindings.baseElevation.current[idx]
        : 0;
    if (u.uBaseElevation) u.uBaseElevation.value = pedestal;

    let targetVertexSanding = 0;
    if (
      gaeaRef &&
      paintFeedbackRef &&
      cursorRef &&
      envBindings &&
      idx !== undefined &&
      gaeaRef.current.brushMode === 'ERODE'
    ) {
      const fb = paintFeedbackRef.current;
      const pulse = fb.isPainting ? Math.max(fb.impulse, 0.1) : fb.impulse;
      if (pulse > 0.004) {
        const cx = fb.isPainting ? cursorRef.current.x : fb.cx;
        const cz = fb.isPainting ? cursorRef.current.z : fb.cz;
        const r = Math.max(gaeaRef.current.brushSize, 1e-4);
        const bx = position[0];
        const bz = position[2];
        const dist = Math.hypot(bx - cx, bz - cz);
        if (dist < r) {
          const falloff = 1 - dist / r;
          const strength = gaeaRef.current.brushStrength;
          targetVertexSanding =
            pulse *
            falloff *
            (0.95 + 0.55 * strength) *
            (fb.isPainting ? 1.15 : 0.72);
        }
      }
    }

    const vs = vertexSandingSmoothedRef.current;
    vertexSandingSmoothedRef.current = THREE.MathUtils.lerp(
      vs,
      targetVertexSanding,
      Math.min(1, delta * 18),
    );
    if (u.uVertexSanding) u.uVertexSanding.value = vertexSandingSmoothedRef.current;

    let targetBrushGlow = 0;
    if (gaeaRef && paintFeedbackRef && cursorRef) {
      const fb = paintFeedbackRef.current;
      const pulse = fb.isPainting ? Math.max(fb.impulse, 0.1) : fb.impulse;
      if (pulse > 0.004) {
        const cx = fb.isPainting ? cursorRef.current.x : fb.cx;
        const cz = fb.isPainting ? cursorRef.current.z : fb.cz;
        const r = Math.max(gaeaRef.current.brushSize, 1e-4);
        const bx = position[0];
        const bz = position[2];
        const d2 = Math.hypot(bx - cx, bz - cz);
        if (d2 < r) {
          targetBrushGlow = pulse * (1 - d2 / r);
        }
      }
    }
    brushGlowSmoothedRef.current = THREE.MathUtils.lerp(
      brushGlowSmoothedRef.current,
      targetBrushGlow,
      Math.min(1, delta * 18),
    );
    if (u.uBrushActive) u.uBrushActive.value = brushGlowSmoothedRef.current;
    if (u.uBrushColor && gaeaRef) {
      u.uBrushColor.value.copy(brushGlowColor(gaeaRef.current.brushMode));
    }
  });

  const setErosionRef = useCallback(
    (el: InstanceType<typeof ErosionMaterial> | null) => {
      erosionRef.current = el;
      assignRef(materialRef, el);
    },
    [materialRef],
  );

  const combinedMeshRef = useCallback(
    (el: THREE.Mesh | null) => {
      innerMeshRef.current = el;
      if (el) {
        const geom = el.geometry;
        if (!geom.getAttribute('color')) {
          const count = geom.getAttribute('position')!.count;
          const colors = new Float32Array(count * 3).fill(1);
          geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
      }
      meshRef?.(el);
    },
    [meshRef],
  );

  return (
    <group ref={setGroupRef} position={position}>
      <mesh
        ref={combinedMeshRef}
        position={[0, height / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[w, height, d, 32, 32, 32]} />
        <erosionMaterial
          ref={setErosionRef}
          uStoneColor="#121212"
          uMossColor="#1b2e1b"
          uSandColor="#c2a382"
        />
      </mesh>
    </group>
  );
}

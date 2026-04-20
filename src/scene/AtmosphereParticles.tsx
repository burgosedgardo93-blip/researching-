import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { windDirection } from '../environment/windDirection';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import type { ResolvedWeatherRef } from '../gaea/weatherParams';
import { srgbColor } from '../utils/srgbColor';

/**
 * Unified airborne particle field — replaces the separate `DustParticles` (embers)
 * and `SandstormWindParticles` (streaks). One `THREE.Points`, one draw call, all motion
 * driven by `uTime` on the GPU: the CPU never mutates the position buffer.
 *
 * Each particle carries a stable rest origin plus seed attributes; the vertex shader
 * advects it along {@link windDirection}, wraps within the city bounding box, and lets
 * `aKind` blend between dust (ember twinkle) and streak (sandstorm) reads in the fragment.
 */

/** Total GPU capacity; `drawRange` scales active count via Leva flags. */
const COUNT = 1500;
const COUNT_PERF = 150;
const COUNT_DRAFT = 200;

/** Slightly wider than the grid footprint so streaks fade in from beyond the city. */
const CITY_HALF_XZ = 4.5 * 1.2 + 2.8;
const Y_MIN = 0.15;
const Y_MAX = 12;

const X_MIN = -CITY_HALF_XZ;
const X_MAX = CITY_HALF_XZ;
const Z_MIN = -CITY_HALF_XZ;
const Z_MAX = CITY_HALF_XZ;

const VS = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uBaseSize;
  uniform float uSandStorm;
  uniform float uWindTurbulence;
  uniform float uHorizontality;
  uniform vec2  uWindDir;
  uniform vec3  uBoundsMin;
  uniform vec3  uBoundsMax;

  attribute float aSeed;
  attribute float aTone;
  attribute float aKind;

  varying float vSeed;
  varying float vTone;
  varying float vKind;
  varying float vTwinkle;

  // Periodic wrap so advection stays within the city bounding box.
  float wrap(float v, float lo, float hi) {
    float span = hi - lo;
    return lo + mod(v - lo, span);
  }

  void main() {
    vSeed = aSeed;
    vTone = aTone;
    vKind = aKind;

    float ph = aSeed * 6.2831853;

    float W = max(0.2, uWindTurbulence);
    // Sandstorm preset accelerates everything horizontally and crushes the
    // vertical bob so dust reads as fast horizontal grit.
    float gust = 1.0 + uHorizontality * (1.4 + 1.4 * uSandStorm);
    float streakSpeed = 2.8 * uSandStorm * W * gust;
    float dustSpeed   = 1.15 * W * mix(1.0, 2.6, uHorizontality);
    float speed = mix(dustSpeed, streakSpeed, aKind);

    vec3 drift = vec3(uWindDir.x, 0.0, uWindDir.y) * (uTime * speed);
    // Gentle vertical bob for dust only — squashed to near-zero in sandstorms.
    float bob = (1.0 - aKind) * sin(uTime * 0.9 + ph) * 0.18 * W * (1.0 - 0.92 * uHorizontality);

    vec3 world = position + drift;
    world.y += bob;

    world.x = wrap(world.x, uBoundsMin.x, uBoundsMax.x);
    world.y = wrap(world.y, uBoundsMin.y, uBoundsMax.y);
    world.z = wrap(world.z, uBoundsMin.z, uBoundsMax.z);

    vTwinkle =
        0.5 + 0.5 * sin(uTime * 2.4 + ph)
      + 0.22 * sin(uTime * 6.8 + ph * 3.1)
      + 0.12 * sin(uTime * 11.3 + ph * 7.0);
    vTwinkle = clamp(vTwinkle, 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
    float dist = max(-mvPosition.z, 0.45);

    // Streaks a touch smaller than embers; pixel-ratio compensation for DPR > 1.
    float sizeMul = mix(1.0, 0.7, aKind);
    gl_PointSize = uBaseSize * uPixelRatio * sizeMul * (220.0 / dist);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FS = /* glsl */ `
  uniform float uTime;
  uniform float uGlobalOpacity;
  uniform float uSandStorm;
  uniform vec3  uDark;
  uniform vec3  uSand;
  uniform vec3  uGlint;
  uniform vec3  uStreak;

  varying float vSeed;
  varying float vTone;
  varying float vKind;
  varying float vTwinkle;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float r2 = dot(p, p);
    if (r2 > 0.25) discard;
    float falloff = 1.0 - smoothstep(0.02, 0.5, r2 * 4.0);

    float ph = vSeed * 40.0;
    float grain = 0.18 * sin(uTime * 3.4 + ph);
    float mixT = clamp(vTone * 0.55 + vTwinkle * 0.32 + grain, 0.0, 1.0);

    float glint = pow(max(0.0, sin(uTime * 15.5 + vSeed * 62.0)), 14.0) * (1.2 + vTone);

    vec3 dustCol = mix(uDark, uSand, mixT * mixT);
    dustCol = mix(dustCol, uGlint, glint * 0.85);
    dustCol += uGlint * glint * 0.35 * vTwinkle;

    float dustAlpha = uGlobalOpacity * falloff * (0.42 + 0.58 * vTwinkle + glint * 0.55);
    float streakAlpha = falloff * clamp(0.08 + 0.42 * uSandStorm, 0.06, 0.72);

    vec3  col = mix(dustCol, uStreak, vKind);
    float a   = mix(dustAlpha, streakAlpha, vKind);

    gl_FragColor = vec4(col, a);
  }
`;

/** Deterministic pseudo-random from an index. */
function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233 + salt) * 43758.5453;
  return x - Math.floor(x);
}

export default function AtmosphereParticles({
  gaeaRef,
  resolvedWeatherRef,
}: {
  gaeaRef: GaeaParamsRef;
  resolvedWeatherRef: ResolvedWeatherRef;
}) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const aSeed = new Float32Array(COUNT);
    const aTone = new Float32Array(COUNT);
    const aKind = new Float32Array(COUNT);

    const spanX = X_MAX - X_MIN;
    const spanY = Y_MAX - Y_MIN;
    const spanZ = Z_MAX - Z_MIN;

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = X_MIN + rnd(i, 0) * spanX;
      positions[i * 3 + 1] = Y_MIN + rnd(i, 1) * spanY;
      positions[i * 3 + 2] = Z_MIN + rnd(i, 2) * spanZ;
      aSeed[i] = rnd(i, 3);
      aTone[i] = rnd(i, 4);
      // ~66% dust, ~33% streak — matches the prior 1000 + 500 split.
      aKind[i] = rnd(i, 5) < 0.33 ? 1 : 0;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    geom.setAttribute('aTone', new THREE.BufferAttribute(aTone, 1));
    geom.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: {
          value: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
        },
        uBaseSize: { value: 2.85 },
        uGlobalOpacity: { value: 0.09 },
        uSandStorm: { value: 1 },
        uWindTurbulence: { value: 1 },
        uHorizontality: { value: 0 },
        uWindDir: { value: new THREE.Vector2(windDirection.x, windDirection.y) },
        uBoundsMin: { value: new THREE.Vector3(X_MIN, Y_MIN, Z_MIN) },
        uBoundsMax: { value: new THREE.Vector3(X_MAX, Y_MAX, Z_MAX) },
        uDark: { value: srgbColor('#0a0806') },
        uSand: { value: srgbColor('#c9a070') },
        uGlint: { value: srgbColor('#ffd4a8') },
        uStreak: { value: srgbColor('#d8c8a8') },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    return { geometry: geom, material: mat };
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    const pts = pointsRef.current;
    if (!pts) return;
    const mat = pts.material as THREE.ShaderMaterial;
    const u = mat.uniforms;

    u.uTime.value = state.clock.elapsedTime;
    u.uPixelRatio.value = state.viewport.dpr;
    u.uSandStorm.value = Math.max(0, gaeaRef.current.sandStormIntensity);
    u.uWindTurbulence.value = Math.max(0.15, resolvedWeatherRef.current.windTurbulence);
    u.uHorizontality.value = THREE.MathUtils.clamp(
      resolvedWeatherRef.current.particleHorizontality,
      0,
      1,
    );

    // Studio Mode: zero particles for a clean sculpting view (highest priority).
    // Draft overrides performance: hard 200-particle cap for a guaranteed 60fps.
    const studio = gaeaRef.current.viewMode === 'STUDIO';
    const active = studio
      ? 0
      : gaeaRef.current.draftMode
        ? COUNT_DRAFT
        : gaeaRef.current.performanceMode
          ? COUNT_PERF
          : COUNT;
    pts.geometry.setDrawRange(0, active);
    pts.visible = active > 0;
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}

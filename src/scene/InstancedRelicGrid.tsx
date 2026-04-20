import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GaeaParamsRef, BrushMode } from '../gaea/gaeaParams';
import type { BrushPaintFeedbackRef } from './BrushPaintSurface';
import { useWorldStore } from '../state/worldStore';
import { windDirection } from '../environment/windDirection';
import { loadPublicMatcapTexture } from '../utils/loadPublicTexture';

const STUDIO_MATCAP_PATH = '/textures/matcap_grit.jpg';

/**
 * One mesh, one draw call, one shader for every relic in the grid.
 *
 * Replaces the per-cell `<RelicBox>` map plus the `<BuildingBrushFeedback>`
 * sibling. Per-cell state (sand, moss, integrity, distortion, base
 * elevation, vertex sanding, brush glow) is uploaded as instanced buffer
 * attributes; per-cell positions, scales, and brush-wobble offsets are
 * baked into the per-frame `instanceMatrix`.
 *
 * The shader handles all three view modes (Cinema erosion shading, Studio
 * normal-as-RGB matcap, Data View RGB diagnostic) via `uViewMode`, so we
 * never swap materials per instance — that lets the entire grid render in
 * a single GPU command.
 */

const BOX_W = 0.88;
const BOX_D = 0.88;
const BOX_SEGMENTS = 32;
const MIN_INSTANCE_SCALE_Y = 0.01;

const BRUSH_GLOW_ORANGE = /* @__PURE__ */ new THREE.Color('#ff6b1a');
const BRUSH_GLOW_GREEN = /* @__PURE__ */ new THREE.Color('#4a8f5a');

function brushGlowColor(mode: BrushMode): THREE.Color {
  return mode === 'PAINT_MOSS' || mode === 'RESTORE' || mode === 'SOW_FLORA'
    ? BRUSH_GLOW_GREEN
    : BRUSH_GLOW_ORANGE;
}

export interface InstancedRelicCell {
  x: number;
  z: number;
  initialHeight: number;
}

interface InstancedRelicGridProps {
  cells: InstancedRelicCell[];
  heightsRef: React.MutableRefObject<Float32Array>;
  sandRef: React.MutableRefObject<Float32Array>;
  mossRef: React.MutableRefObject<Float32Array>;
  distortionRef: React.MutableRefObject<Float32Array>;
  baseElevationRef: React.MutableRefObject<Float32Array>;
  gaeaRef: GaeaParamsRef;
  paintFeedbackRef: React.MutableRefObject<BrushPaintFeedbackRef>;
  cursorRef: React.MutableRefObject<THREE.Vector3>;
}

const VS = /* glsl */ `
  // Three injects 'instanceMatrix' automatically for InstancedMesh; we read
  // its scale to keep displacement magnitudes in world units regardless of
  // the per-instance height stretch.
  attribute float aInitH;
  attribute float aIntegrity;
  attribute float aDistortion;
  attribute float aBaseElev;
  attribute float aVertexSanding;
  attribute float aBrushActive;
  attribute float aSand;
  attribute float aMoss;

  uniform float uTime;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vIntegrity;
  varying float vSand;
  varying float vMoss;
  varying float vBrushActive;
  varying float vSandTopY;
  varying float vSandBaseY;

  // 3D simplex noise (Ian McEwan, Ashima Arts) — MIT.
  vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289_4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute4(vec4 x) { return mod289_4(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289_3(i);
    vec4 p = permute4(permute4(permute4(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  void main() {
    // Geometry is a unit box (1x1x1) centered at the origin; instanceMatrix
    // does the per-cell scale + position so a single shared geometry can
    // drive the whole grid. position is in [-0.5, 0.5] in each axis.
    vec3 localPos = position;

    // Recover per-instance world-space scale so all crumble/jitter
    // displacements stay in absolute units regardless of relic height.
    vec3 instScale = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vec3 invScale = 1.0 / max(instScale, vec3(1e-4));

    // Edge / corner weight on the unit cube — high on edges, highest at
    // corners (Manhattan sum of normalized box-half coordinates).
    vec3 bn = abs(localPos) * 2.0;
    float edgeCorner = smoothstep(1.25, 2.75, bn.x + bn.y + bn.z);

    float damage = clamp(1.0 - aIntegrity, 0.0, 1.0);
    vec3 noisePos = localPos * 5.2 + vec3(11.7, 3.1, 19.4) + vec3(uTime * 0.03);
    float n = snoise(noisePos) * 0.62
            + snoise(noisePos * 2.37 + vec3(40.0, 20.0, 8.0)) * 0.38;
    n = 0.5 + 0.5 * n;

    float crumble = damage * edgeCorner * (0.14 + 0.22 * n);
    vec3 inwardLocal = length(localPos) > 1e-5 ? -normalize(localPos) : vec3(0.0, -1.0, 0.0);
    vec3 displaced = localPos + inwardLocal * crumble * invScale;

    // Grit jitter on weathered edges.
    float gritEdge = pow(edgeCorner, 1.4);
    float integritySeed = aIntegrity * 17.13 + 5.7;
    vec3 jSeed = localPos * 18.8
      + vec3(integritySeed, integritySeed * 1.31, integritySeed * 0.83);
    vec3 jitter = vec3(
      snoise(jSeed),
      snoise(jSeed + vec3(13.7, 4.1, 9.3)),
      snoise(jSeed + vec3(2.6, 21.5, 7.2))
    );
    float gritAmp = damage * gritEdge * 0.075;
    displaced += jitter * gritAmp * invScale;
    displaced += inwardLocal * (damage * pow(edgeCorner, 3.0) * 0.04) * invScale;

    // Tectonic / Erode "melt" from the brush.
    float D = clamp(aDistortion, 0.0, 2.8);
    if (D > 1e-4) {
      float cornerMelt = edgeCorner * edgeCorner;
      float roofCorner = cornerMelt * smoothstep(0.2, 1.0, bn.y);

      vec3 meltSeed = localPos * 5.4 + vec3(6.2, 1.1, 4.8);
      float sagN =
          snoise(meltSeed + vec3(uTime * 0.31, uTime * 0.21, uTime * 0.26)) * 0.55
        + snoise(meltSeed * 1.85 + vec3(19.0, 33.0, 7.0) + vec3(0.0, uTime * 0.18, 0.0)) * 0.45;
      sagN = 0.5 + 0.5 * sagN;
      float sag = D * roofCorner * (0.12 + 0.2 * sagN) * 0.5;
      displaced.y -= sag * invScale.y;

      vec3 wobbleSeed = localPos * 6.7 + vec3(uTime * 1.85, uTime * 2.05, uTime * 1.55);
      vec3 wob = vec3(
        snoise(wobbleSeed),
        snoise(wobbleSeed + vec3(31.0, 17.0, 24.0)),
        snoise(wobbleSeed + vec3(11.0, 43.0, 19.0))
      );
      displaced += wob * (D * cornerMelt * 0.11) * invScale;

      float drip = D * cornerMelt * (0.06 + 0.07 * sin(uTime * 2.4
                  + dot(localPos, vec3(2.1, 4.0, 1.7))));
      displaced += inwardLocal * drip * 0.5 * invScale;
    }

    // Live ERODE-brush "vertex sanding" — high-frequency jitter on edges.
    float sandV = clamp(aVertexSanding, 0.0, 3.0);
    if (sandV > 1e-4) {
      float edgeBoost = 0.28 + 0.72 * edgeCorner;
      vec3 nHi = localPos * 34.0 + vec3(uTime * 16.0, uTime * 21.0, uTime * 13.0);
      float j1 = snoise(nHi);
      float j2 = snoise(nHi * 2.4 + vec3(41.0, 17.0, 53.0));
      float j3 = snoise(nHi * 4.2 + vec3(9.0, 60.0, 22.0));
      vec3 chip = vec3(j1, j2, j3) * (0.022 * sandV * edgeBoost);

      float osc = sin(uTime * 56.0 + dot(localPos, vec3(9.1, 14.0, 6.3)))
        * cos(uTime * 43.0 + localPos.y * 11.0);
      float collapseLive = sandV * (0.042 + 0.038 * osc) * edgeBoost;

      vec3 nrmN = length(normal) > 1e-5 ? normalize(normal) : vec3(0.0, 1.0, 0.0);
      displaced += (chip + nrmN * (0.012 * sandV * osc * edgeBoost)
                    + inwardLocal * collapseLive) * invScale;
    }

    vNormal = normalize(normalMatrix * normal);

    // Lift to world after the instanceMatrix; baseElevation lives in world
    // units so the tectonic pedestal doesn't get scaled by integrity.
    vec4 instPos = instanceMatrix * vec4(displaced, 1.0);
    vec4 worldPos = modelMatrix * instPos;
    worldPos.y += aBaseElev;

    vWorldPosition = worldPos.xyz;
    vIntegrity = aIntegrity;
    vSand = aSand;
    vMoss = aMoss;
    vBrushActive = aBrushActive;
    // World-space sand fill bounds: from base (with pedestal) to top of
    // the scaled, pedestal-lifted box.
    float baseY = (instanceMatrix * vec4(0.0, -0.5, 0.0, 1.0)).y + aBaseElev;
    float topY  = (instanceMatrix * vec4(0.0,  0.5, 0.0, 1.0)).y + aBaseElev;
    vSandBaseY = baseY;
    vSandTopY = topY;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FS = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uSandStorm;
  uniform vec3  uSandColor;
  uniform vec3  uMossColor;
  uniform vec3  uStoneColor;
  uniform vec2  uWindDir;
  uniform vec3  uBrushColor;
  uniform sampler2D uStudioMatcap;
  uniform int uStudioMatcapOk;

  // 0 = Cinema (full erosion shader), 1 = Studio (normal-as-RGB matcap),
  // 2 = Data View (integrity/sand/moss diagnostic).
  uniform int uViewMode;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vIntegrity;
  varying float vSand;
  varying float vMoss;
  varying float vBrushActive;
  varying float vSandTopY;
  varying float vSandBaseY;

  // ── Studio matcap: optional matcap texture (see STUDIO_MATCAP_PATH) in
  //    view-normal UV space; otherwise normal * 0.5 + 0.5 procedural read. ──
  vec3 studioShade() {
    if (uStudioMatcapOk == 1) {
      vec3 nv = normalize(vNormal);
      vec2 muv = nv.xy * 0.5 + 0.5;
      vec3 mc = texture2D(uStudioMatcap, muv).rgb;
      return mc + uBrushColor * vBrushActive * 1.0;
    }
    vec3 base = vNormal * 0.5 + 0.5;
    return base + uBrushColor * vBrushActive * 1.0;
  }

  // ── Data View: R = damage, G = sand mix, B = moss density. Matches the
  //    legacy setDataViewBasicColor JS color formula. ──
  vec3 dataViewShade() {
    float lowInt = clamp(1.0 - vIntegrity, 0.0, 1.0);
    float s = clamp(vSand, 0.0, 1.0);
    float m = clamp(vMoss, 0.0, 1.0);
    return vec3(
      clamp(0.06 + lowInt * 0.9 + s * 0.7, 0.0, 1.0),
      clamp(0.06 + s * 0.88 + lowInt * 0.05, 0.0, 1.0),
      clamp(0.08 + m * 0.9, 0.0, 1.0)
    );
  }

  // ── Cinema: full erosion shader (sand fill + drift, moss tops, crevices,
  //    grain, brush rim). Lifted from ErosionMaterial.tsx and adapted to
  //    pull per-cell uniforms from instance varyings. ──
  vec3 cinemaShade() {
    float hSpan = max(vSandTopY - vSandBaseY, 0.001);
    float hNorm = clamp((vWorldPosition.y - vSandBaseY) / hSpan, 0.0, 1.0);

    float fill = clamp(vSand, 0.0, 1.0);
    float fillEdge = fill * 1.02;
    float baseClimb = 1.0 - smoothstep(fillEdge - 0.14, fillEdge + 0.06, hNorm);
    baseClimb = pow(max(baseClimb, 0.0), 0.82);
    float sandGradient = baseClimb * (
      0.88 + 0.12 * sin(vWorldPosition.x * 6.2 + vWorldPosition.z * 4.0 + uTime * 0.22)
    );
    sandGradient = clamp(sandGradient, 0.0, 1.0);

    vec3  windDir3    = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
    float leewardFace = max(0.0, dot(vNormal, windDir3));
    float driftFace   = smoothstep(0.15, 0.85, leewardFace) * vSand;
    float driftBase   = (1.0 - hNorm) * vSand * 0.62;
    float driftMask   = clamp(driftFace + driftBase, 0.0, 1.0);

    float sandMix = clamp(
      sandGradient * fill * (0.42 + 0.58 * uSandStorm)
      + driftMask * 0.42 * (0.35 + 0.65 * uSandStorm),
      0.0, 1.0
    );

    // Drifting sand specks on the layer.
    vec2 wXZ = vec2(uWindDir.x, uWindDir.y);
    float wLen = length(wXZ);
    vec2 wNorm = wLen > 1e-4 ? wXZ / wLen : vec2(1.0, 0.0);
    vec2 wPerp = vec2(-wNorm.y, wNorm.x);
    vec2 driftA = wNorm * uTime * 1.85 + wPerp * uTime * 0.42;
    vec2 driftB = wNorm * uTime * 2.6 + wPerp * uTime * -0.55;
    vec2 wp = vWorldPosition.xz;
    vec2 sp1 = wp * 22.0 + driftA;
    vec2 sp2 = wp * 31.0 + driftB * 0.72 + vec2(17.3, 9.1);
    vec2 cell1 = floor(sp1);
    vec2 f1 = fract(sp1) - 0.5;
    float id1 = fract(sin(dot(cell1, vec2(12.9898, 78.233))) * 43758.5453);
    vec2 off1 = (vec2(id1, fract(id1 * 37.17)) - 0.5) * 0.62;
    float speck1 = smoothstep(0.38, 0.05, length(f1 - off1 * 0.28));

    vec2 cell2 = floor(sp2);
    vec2 f2 = fract(sp2) - 0.5;
    float id2 = fract(sin(dot(cell2 + 3.7, vec2(58.189, 98.131))) * 24634.634);
    vec2 off2 = (vec2(id2, fract(id2 * 19.4)) - 0.5) * 0.58;
    float speck2 = smoothstep(0.35, 0.06, length(f2 - off2 * 0.32));

    float coarse = sin(dot(wp, vec2(5.2, 3.8)) + uTime * 2.85) * 0.5 + 0.5;
    float particles = clamp(
      (speck1 * 0.62 + speck2 * 0.48) * (0.45 + 0.55 * coarse) * sandGradient * fill,
      0.0, 1.0
    );
    vec3 sandBright = uSandColor * vec3(1.18, 1.12, 1.05);
    vec3 sandLayer = mix(uSandColor, sandBright, particles * (0.35 + 0.45 * uSandStorm));

    // Moss on flat tops.
    float slope      = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float slopeNoise = sin(vWorldPosition.x * 10.0 + uTime) * 0.1;
    float topMask    = smoothstep(0.7, 0.9, slope + slopeNoise);
    float mossAmt    = clamp(vMoss, 0.0, 1.0);
    float mossMixRaw = topMask * mossAmt * (0.3 + 0.7 * mossAmt);

    // Wet base crevices.
    float upAbs = abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float wallish = smoothstep(0.22, 0.92, 1.0 - upAbs);
    float nearBase = pow(max(0.0, 1.0 - smoothstep(0.0, 0.28, hNorm)), 1.35);
    float creviceNoise = 0.5 + 0.5 * sin(
      vWorldPosition.x * 7.4 + vWorldPosition.z * 5.9
      + vWorldPosition.y * 3.1 + uTime * 0.35
    );
    float creviceMask = nearBase * wallish * creviceNoise;
    float creviceMoss = creviceMask * mossAmt * (0.38 + 0.62 * mossAmt);
    vec3 mossWetDark = uMossColor * vec3(0.18, 0.24, 0.22);
    vec3 mossTopTint = mix(uMossColor, mossWetDark, 0.22 * mossAmt * topMask);

    float sandWash = clamp(vSand * sandGradient, 0.0, 1.0);
    float mossMix  = clamp(mossMixRaw * (1.0 - sandWash * 0.94), 0.0, 1.0);

    vec3 finalColor = uStoneColor;
    finalColor = mix(finalColor, mossTopTint, mossMix);
    finalColor = mix(finalColor, mossWetDark, creviceMoss * (1.0 - sandMix * 0.55));
    finalColor = mix(finalColor, sandLayer, sandMix);

    float topSoak = topMask * mossAmt;
    vec3 dampShadow = finalColor * vec3(0.32, 0.38, 0.34);
    finalColor = mix(finalColor, dampShadow, clamp(topSoak * 0.82, 0.0, 1.0));

    // Stone grain.
    float cover = max(sandMix, mossMix);
    float stoneW = 1.0 - smoothstep(0.12, 0.78, cover);
    vec3 gp = vWorldPosition * 19.3 + vNormal * 7.1;
    float h0 = fract(sin(dot(gp.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float h1 = fract(sin(dot(gp.yz + gp.z, vec2(39.346, 11.135))) * 24634.634);
    float grain = 0.5 + 0.5 * (h0 * 0.62 + h1 * 0.38);
    finalColor *= mix(1.0, 0.94 + 0.12 * grain, stoneW * 0.88);

    float rim = pow(1.0 - max(0.0, dot(normalize(vNormal), vec3(0.0, 1.0, 0.0))), 2.0);
    finalColor += uBrushColor * vBrushActive * (0.35 + 0.65 * rim);

    return finalColor;
  }

  void main() {
    vec3 col;
    if (uViewMode == 1) {
      col = studioShade();
    } else if (uViewMode == 2) {
      col = dataViewShade();
    } else {
      col = cinemaShade();
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _dummy = /* @__PURE__ */ new THREE.Object3D();
const _basePosition = /* @__PURE__ */ new THREE.Vector3();
const _baseScale = /* @__PURE__ */ new THREE.Vector3();
const _identityQuat = /* @__PURE__ */ new THREE.Quaternion();

export default function InstancedRelicGrid({
  cells,
  heightsRef,
  sandRef,
  mossRef,
  distortionRef,
  baseElevationRef,
  gaeaRef,
  paintFeedbackRef,
  cursorRef,
}: InstancedRelicGridProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const N = cells.length;

  // Subscribe so a Studio↔Cinema flip rebinds the uniform reactively
  // (the per-frame writer below also keeps it in sync).
  const viewMode = useWorldStore(s => s.viewMode);

  /** When the matcap asset is missing (e.g. bad deploy path), Studio uses MeshNormalMaterial. */
  const [studioMatcapFailed, setStudioMatcapFailed] = useState(false);

  const { geometry, material, attrs, placeholderMatcapTex } = useMemo(() => {
    const geom = new THREE.BoxGeometry(
      1,
      1,
      1,
      BOX_SEGMENTS,
      BOX_SEGMENTS,
      BOX_SEGMENTS,
    );

    const make = (size = 1) =>
      new THREE.InstancedBufferAttribute(new Float32Array(N * size), size).setUsage(
        THREE.DynamicDrawUsage,
      );

    const aInitH = make(1);
    const aIntegrity = make(1);
    const aDistortion = make(1);
    const aBaseElev = make(1);
    const aVertexSanding = make(1);
    const aBrushActive = make(1);
    const aSand = make(1);
    const aMoss = make(1);

    for (let k = 0; k < N; k++) {
      aInitH.array[k] = cells[k].initialHeight;
      aIntegrity.array[k] = 1;
    }
    aInitH.needsUpdate = true;
    aIntegrity.needsUpdate = true;

    geom.setAttribute('aInitH', aInitH);
    geom.setAttribute('aIntegrity', aIntegrity);
    geom.setAttribute('aDistortion', aDistortion);
    geom.setAttribute('aBaseElev', aBaseElev);
    geom.setAttribute('aVertexSanding', aVertexSanding);
    geom.setAttribute('aBrushActive', aBrushActive);
    geom.setAttribute('aSand', aSand);
    geom.setAttribute('aMoss', aMoss);

    const px = new Uint8Array([128, 128, 128, 255]);
    const placeholderMatcapTex = new THREE.DataTexture(px, 1, 1, THREE.RGBAFormat);
    placeholderMatcapTex.needsUpdate = true;
    placeholderMatcapTex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSandStorm: { value: 1 },
        uSandColor: { value: new THREE.Color('#c2a382') },
        uMossColor: { value: new THREE.Color('#1b2e1b') },
        uStoneColor: { value: new THREE.Color('#121212') },
        uWindDir: { value: new THREE.Vector2(windDirection.x, windDirection.y) },
        uBrushColor: { value: new THREE.Color('#ff6b1a') },
        uViewMode: { value: 0 },
        uStudioMatcap: { value: placeholderMatcapTex },
        uStudioMatcapOk: { value: 0 },
      },
      vertexShader: VS,
      fragmentShader: FS,
    });

    return {
      geometry: geom,
      material: mat,
      placeholderMatcapTex,
      attrs: {
        aInitH,
        aIntegrity,
        aDistortion,
        aBaseElev,
        aVertexSanding,
        aBrushActive,
        aSand,
        aMoss,
      },
    };
  }, [N, cells]);

  const normalFallbackMat = useMemo(
    () =>
      new THREE.MeshNormalMaterial({
        flatShading: false,
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let loadedTex: THREE.Texture | null = null;
    let placeholderDisposed = false;
    const mat = material;
    loadPublicMatcapTexture(
      STUDIO_MATCAP_PATH,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        loadedTex = tex;
        if (!(mat instanceof THREE.ShaderMaterial)) return;
        const prev = mat.uniforms.uStudioMatcap?.value as THREE.Texture | undefined;
        mat.uniforms.uStudioMatcap.value = tex;
        mat.uniforms.uStudioMatcapOk.value = 1;
        if (prev && prev !== tex) {
          prev.dispose();
          placeholderDisposed = true;
        }
      },
      () => {
        if (!cancelled) setStudioMatcapFailed(true);
      },
    );
    return () => {
      cancelled = true;
      loadedTex?.dispose();
      if (!placeholderDisposed) placeholderMatcapTex.dispose();
    };
  }, [material, placeholderMatcapTex]);

  // Smoothed per-cell glow + sanding so brush impulses feel inertial instead
  // of strobing on/off as the mouse moves through a cell.
  const glowSmoothedRef = useRef(new Float32Array(N));
  const sandingSmoothedRef = useRef(new Float32Array(N));

  // Reset matrix once on mount so the depth/shadow pass gets a sane bounding
  // sphere even before the first frame ticks the per-frame writer.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let k = 0; k < N; k++) {
      const c = cells[k];
      const h = Math.max(MIN_INSTANCE_SCALE_Y, c.initialHeight);
      _baseScale.set(BOX_W, h, BOX_D);
      _basePosition.set(c.x, h * 0.5, c.z);
      _dummy.position.copy(_basePosition);
      _dummy.scale.copy(_baseScale);
      _dummy.quaternion.copy(_identityQuat);
      _dummy.updateMatrix();
      mesh.setMatrixAt(k, _dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }, [cells, N]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      normalFallbackMat.dispose();
    };
  }, [geometry, material, normalFallbackMat]);

  // Keep the view-mode uniform reactive too. Per-frame loop also writes it,
  // so this is just defensive against the first frame after toggle.
  useEffect(() => {
    const u = material.uniforms;
    u.uViewMode.value = viewMode === 'STUDIO' ? 1 : 0;
  }, [material, viewMode]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const wantNormalFallback =
      studioMatcapFailed &&
      viewMode === 'STUDIO' &&
      !gaeaRef.current.dataView;

    if (wantNormalFallback) {
      if (mesh.material !== normalFallbackMat) mesh.material = normalFallbackMat;
    } else if (mesh.material !== material) {
      mesh.material = material;
    }

    const H = heightsRef.current;
    const S = sandRef.current;
    const M = mossRef.current;
    const D = distortionRef.current;
    const BE = baseElevationRef.current;

    const u = material.uniforms;
    if (mesh.material === material) {
      u.uTime.value = state.clock.elapsedTime;
      u.uSandStorm.value = Math.max(0, gaeaRef.current.sandStormIntensity);

      const dataView = gaeaRef.current.dataView;
      const studio = gaeaRef.current.viewMode === 'STUDIO';
      u.uViewMode.value = dataView ? 2 : studio ? 1 : 0;
      (u.uBrushColor.value as THREE.Color).copy(brushGlowColor(gaeaRef.current.brushMode));
    }

    // ── Brush wobble + glow + vertex-sanding pre-compute ────────────────────
    const fb = paintFeedbackRef.current;
    const painting = fb.isPainting;
    const pulse = painting ? Math.max(fb.impulse, 0.1) : fb.impulse;
    const cx = painting ? cursorRef.current.x : fb.cx;
    const cz = painting ? cursorRef.current.z : fb.cz;
    const r = painting
      ? Math.max(gaeaRef.current.brushSize, 1e-4)
      : Math.max(fb.r, 1e-4);
    const brushMode = gaeaRef.current.brushMode;
    const brushStrength = gaeaRef.current.brushStrength;
    const brushActive = pulse > 0.004;
    const t = state.clock.elapsedTime;
    const wobbleFreq = painting ? 28 : 24;
    const studio = gaeaRef.current.viewMode === 'STUDIO';
    const studioGlowGain = studio ? 2.4 : 1.0;

    const glow = glowSmoothedRef.current;
    const sanding = sandingSmoothedRef.current;
    const lerpA = Math.min(1, delta * 18);

    const aIntArr = attrs.aIntegrity.array as Float32Array;
    const aDistArr = attrs.aDistortion.array as Float32Array;
    const aBaseArr = attrs.aBaseElev.array as Float32Array;
    const aSandArr = attrs.aSand.array as Float32Array;
    const aMossArr = attrs.aMoss.array as Float32Array;
    const aVSArr = attrs.aVertexSanding.array as Float32Array;
    const aGlowArr = attrs.aBrushActive.array as Float32Array;

    const shaderPath = mesh.material === material;

    for (let k = 0; k < N; k++) {
      const c = cells[k];
      const initH = c.initialHeight > 1e-6 ? c.initialHeight : 1;
      const h = Math.max(MIN_INSTANCE_SCALE_Y, H[k]);
      const integrity = THREE.MathUtils.clamp(h / initH, 0, 1);

      if (shaderPath) {
        aIntArr[k] = integrity;
        aDistArr[k] = D[k];
        aBaseArr[k] = BE[k];
        aSandArr[k] = S[k];
        aMossArr[k] = M[k];

        // Brush proximity: drives glow + ERODE-mode vertex sanding.
        let glowTarget = 0;
        let sandingTarget = 0;
        let wobbleX = 0;
        let wobbleY = 0;
        let wobbleZ = 0;
        if (brushActive) {
          const dx = c.x - cx;
          const dz = c.z - cz;
          const dist = Math.hypot(dx, dz);
          if (dist < r) {
            const falloff = 1 - dist / r;
            glowTarget = pulse * falloff * studioGlowGain;
            if (brushMode === 'ERODE') {
              sandingTarget =
                pulse *
                falloff *
                (0.95 + 0.55 * brushStrength) *
                (painting ? 1.15 : 0.72);
            }
            const w = pulse * falloff;
            const amp = 0.017 * w * (painting ? 1.35 : 1);
            wobbleX = Math.sin(t * wobbleFreq) * amp;
            wobbleY = Math.sin(t * wobbleFreq * 2.2) * amp * 0.75;
            wobbleZ = Math.cos(t * wobbleFreq * 0.9) * amp;
          }
        }

        glow[k] = THREE.MathUtils.lerp(glow[k], glowTarget, lerpA);
        sanding[k] = THREE.MathUtils.lerp(sanding[k], sandingTarget, lerpA);

        aGlowArr[k] = glow[k];
        aVSArr[k] = sanding[k];

        _basePosition.set(c.x + wobbleX, h * 0.5 + wobbleY, c.z + wobbleZ);
      } else {
        _basePosition.set(c.x, h * 0.5, c.z);
      }

      // Per-cell instance transform: scale = (w, currentHeight, d), position
      // sets the centred unit box's base on the ground (+ wobble).
      _baseScale.set(BOX_W, h, BOX_D);
      _dummy.position.copy(_basePosition);
      _dummy.scale.copy(_baseScale);
      _dummy.quaternion.copy(_identityQuat);
      _dummy.updateMatrix();
      mesh.setMatrixAt(k, _dummy.matrix);
    }

    if (shaderPath) {
      attrs.aIntegrity.needsUpdate = true;
      attrs.aDistortion.needsUpdate = true;
      attrs.aBaseElev.needsUpdate = true;
      attrs.aSand.needsUpdate = true;
      attrs.aMoss.needsUpdate = true;
      attrs.aBrushActive.needsUpdate = true;
      attrs.aVertexSanding.needsUpdate = true;
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, N]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}

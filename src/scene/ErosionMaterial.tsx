import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';
import { windDirection } from '../environment/windDirection';

const ErosionMaterial = shaderMaterial(
  {
    uTime: 0,
    /** 0 = ruined, 1 = full height — drives inward crumble in the vertex shader. */
    uIntegrity: 1,
    /** Half-extents of the local box (width/2, height/2, depth/2) for edge/corner weighting. */
    uBoxHalf: new THREE.Vector3(0.44, 0.5, 0.44),
    uMoisture: 0,
    /** Scales how strongly `uSandColor` is mixed in (Leva: Sand Storm Intensity). */
    uSandStorm: 1,
    uSandColor: new THREE.Color('#d2b48c'), // Dune Sand
    uMossColor: new THREE.Color('#2d3c2d'), // Death Stranding Moss
    uStoneColor: new THREE.Color('#1a1a1a'), // Dark Brutalist Concrete
    /** 0..1 — wind-shadow sand accumulation ({@link useEnvironmentalGrid}) */
    uSandAccum:  0,
    /** 0..1 — vertical sand layer strength; high values bury moss (dusty ruin) */
    uSandAmount: 0,
    /** 0..1 — moss on flat tops ({@link useEnvironmentalGrid}) */
    uMossAmount: 0,
    /** Wind direction in world XZ (normalised) — same as {@link windDirection}. */
    uWindDir:    new THREE.Vector2(windDirection.x, windDirection.y),
    /** World-space Y: building base (x) and roof (y) for sand “climb” along height. */
    uSandBounds: new THREE.Vector2(0, 2.5),
    /** Live ERODE-brush sanding: high-frequency jitter + extra inward collapse (RelicBox). */
    uVertexSanding: 0,
    /** Cumulative ERODE melt (0..~2.5): corner sag + snoise wobble — scales vertex displacement. */
    uDistortion: 0,
    /** 0..1 — brush influence glow driven by RelicBox when cursor is over this relic. */
    uBrushActive: 0,
    /** Thermal glow color: orange for sand/erode, green for moss/restore. */
    uBrushColor: new THREE.Color('#ff6b1a'),
    /** World-space pedestal lift from the RAISE_TERRAIN brush — applied after local displacement. */
    uBaseElevation: 0,
  },
  // Vertex Shader
  /* glsl */ `
  uniform float uTime;
  uniform float uIntegrity;
  uniform float uVertexSanding;
  uniform float uDistortion;
  uniform float uBaseElevation;
  uniform vec3 uBoxHalf;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  // ── 3D simplex noise (Ian McEwan, Ashima Arts) — MIT / common WebGL snippet ──
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
    vec3 halfSafe = max(uBoxHalf, vec3(1e-4));
    vec3 bn = abs(position) / halfSafe;
    // High on edges and especially corners (Manhattan sum in normalized box space).
    float edgeCorner = smoothstep(1.25, 2.75, bn.x + bn.y + bn.z);

    float damage = clamp(1.0 - uIntegrity, 0.0, 1.0);
    vec3 noisePos = position * 2.6 + vec3(11.7, 3.1, 19.4) + vec3(uTime * 0.03);
    float n = snoise(noisePos) * 0.62 + snoise(noisePos * 2.37 + vec3(40.0, 20.0, 8.0)) * 0.38;
    n = 0.5 + 0.5 * n;

    float crumble = damage * edgeCorner * (0.14 + 0.22 * n);
    float len = length(position);
    vec3 inward = len > 1e-5 ? -position / len : vec3(0.0, -1.0, 0.0);
    vec3 displaced = position + inward * crumble;

    // ── “Grit Pass”: integrity-seeded jitter on edges/corners. Buildings with
    //    low integrity look weathered + jagged, not just shorter.
    float gritEdge = pow(edgeCorner, 1.4);
    float integritySeed = uIntegrity * 17.13 + 5.7;
    vec3 jSeed = position * 9.4
      + vec3(integritySeed, integritySeed * 1.31, integritySeed * 0.83);
    vec3 jitter = vec3(
      snoise(jSeed),
      snoise(jSeed + vec3(13.7, 4.1, 9.3)),
      snoise(jSeed + vec3(2.6, 21.5, 7.2))
    );
    float gritAmp = damage * gritEdge * 0.075;
    displaced += jitter * gritAmp;
    // A touch of extra inward pull at the very corners for a bitten look.
    displaced += inward * (damage * pow(edgeCorner, 3.0) * 0.04);

    float D = clamp(uDistortion, 0.0, 2.8);
    if (D > 1e-4) {
      float cornerMelt = edgeCorner * edgeCorner;
      float roofCorner = cornerMelt * smoothstep(0.2, 1.0, bn.y);

      vec3 meltSeed = position * 2.7 + vec3(6.2, 1.1, 4.8);
      float sagN =
        snoise(meltSeed + vec3(uTime * 0.31, uTime * 0.21, uTime * 0.26)) * 0.55
        + snoise(meltSeed * 1.85 + vec3(19.0, 33.0, 7.0) + vec3(0.0, uTime * 0.18, 0.0)) * 0.45;
      sagN = 0.5 + 0.5 * sagN;
      float sag = D * roofCorner * (0.12 + 0.2 * sagN) * halfSafe.y;
      displaced.y -= sag;

      vec3 wobbleSeed = position * 3.35 + vec3(uTime * 1.85, uTime * 2.05, uTime * 1.55);
      vec3 wob = vec3(
        snoise(wobbleSeed),
        snoise(wobbleSeed + vec3(31.0, 17.0, 24.0)),
        snoise(wobbleSeed + vec3(11.0, 43.0, 19.0))
      );
      displaced += wob * (D * cornerMelt * 0.11);

      float drip = D * cornerMelt * (0.06 + 0.07 * sin(uTime * 2.4 + dot(position, vec3(2.1, 4.0, 1.7))));
      displaced += inward * drip * halfSafe.x;
    }

    float sand = clamp(uVertexSanding, 0.0, 3.0);
    if (sand > 1e-4) {
      float edgeBoost = 0.28 + 0.72 * edgeCorner;
      vec3 nHi = position * 17.0 + vec3(uTime * 16.0, uTime * 21.0, uTime * 13.0);
      float j1 = snoise(nHi);
      float j2 = snoise(nHi * 2.4 + vec3(41.0, 17.0, 53.0));
      float j3 = snoise(nHi * 4.2 + vec3(9.0, 60.0, 22.0));
      vec3 chip = vec3(j1, j2, j3) * (0.022 * sand * edgeBoost);

      float osc = sin(uTime * 56.0 + dot(position, vec3(9.1, 14.0, 6.3)))
        * cos(uTime * 43.0 + position.y * 11.0);
      float collapseLive = sand * (0.042 + 0.038 * osc) * edgeBoost;

      vec3 nrm = normal;
      float nl = length(nrm);
      vec3 nrmN = nl > 1e-5 ? nrm / nl : vec3(0.0, 1.0, 0.0);
      displaced += chip + nrmN * (0.012 * sand * osc * edgeBoost) + inward * collapseLive;
    }

    vNormal = normalize(normalMatrix * normal);
    // Pedestal: lift the world-space vertex after the model matrix so the group's Y-scale
    // does not multiply the elevation (the brush already writes into a per-cell buffer).
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    worldPos.y += uBaseElevation;
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
  `,
  // Fragment Shader
  `
  uniform float uTime;
  uniform float uMoisture;
  uniform float uSandStorm;
  uniform vec3  uSandColor;
  uniform vec3  uMossColor;
  uniform vec3  uStoneColor;
  uniform float uSandAccum;
  uniform float uSandAmount;
  uniform float uMossAmount;
  uniform vec2  uWindDir;
  uniform vec2  uSandBounds;
  uniform float uBrushActive;
  uniform vec3  uBrushColor;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    float hSpan = max(uSandBounds.y - uSandBounds.x, 0.001);
    float hNorm = clamp((vWorldPosition.y - uSandBounds.x) / hSpan, 0.0, 1.0);

    // Sand “fills” from the base upward as uSandAmount grows (0 = base, 1 = roof)
    float fill = clamp(uSandAmount, 0.0, 1.0);
    float fillEdge = fill * 1.02;
    float baseClimb = 1.0 - smoothstep(fillEdge - 0.14, fillEdge + 0.06, hNorm);
    baseClimb = pow(max(baseClimb, 0.0), 0.82);
    float sandGradient = baseClimb * (
      0.88 + 0.12 * sin(vWorldPosition.x * 6.2 + vWorldPosition.z * 4.0 + uTime * 0.22)
    );
    sandGradient = clamp(sandGradient, 0.0, 1.0);

    // Leeward drift (uSandAccum): extra dust on sheltered faces / base
    vec3  windDir3    = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
    float leewardFace = max(0.0, dot(vNormal, windDir3));
    float driftFace   = smoothstep(0.15, 0.85, leewardFace) * uSandAccum;
    float driftBase   = (1.0 - hNorm) * uSandAccum * 0.62;
    float driftMask   = clamp(driftFace + driftBase, 0.0, 1.0);

    float sandMix = clamp(
      sandGradient * fill * (0.42 + 0.58 * uSandStorm)
      + driftMask * 0.42 * (0.35 + 0.65 * uSandStorm),
      0.0,
      1.0
    );

    // ── Drifting sand “particles” (uWindDir + uTime) on the sand layer ─────
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
    float d1 = length(f1 - off1 * 0.28);
    float speck1 = smoothstep(0.38, 0.05, d1);

    vec2 cell2 = floor(sp2);
    vec2 f2 = fract(sp2) - 0.5;
    float id2 = fract(sin(dot(cell2 + 3.7, vec2(58.189, 98.131))) * 24634.634);
    vec2 off2 = (vec2(id2, fract(id2 * 19.4)) - 0.5) * 0.58;
    float d2 = length(f2 - off2 * 0.32);
    float speck2 = smoothstep(0.35, 0.06, d2);

    float coarse = sin(dot(wp, vec2(5.2, 3.8)) + uTime * 2.85) * 0.5 + 0.5;
    float particles = clamp(
      (speck1 * 0.62 + speck2 * 0.48) * (0.45 + 0.55 * coarse) * sandGradient * fill,
      0.0,
      1.0
    );
    vec3 sandBright = uSandColor * vec3(1.18, 1.12, 1.05);
    vec3 sandLayer = mix(uSandColor, sandBright, particles * (0.35 + 0.45 * uSandStorm));

    // ── Flat tops: moss from uMossAmount (+ moisture) ─────────────────────
    float slope      = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float slopeNoise = sin(vWorldPosition.x * 10.0 + uTime) * 0.1;
    float topMask    = smoothstep(0.7, 0.9, slope + slopeNoise);
    float wet        = clamp(uMoisture, 0.0, 1.0);
    float mossAmt    = clamp(uMossAmount, 0.0, 1.0);
    float mossMixRaw = topMask * mossAmt * (0.3 + 0.7 * wet);

    // Ground-line “crevices”: vertical / outward faces near base stay wet/dark
    float upAbs = abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float wallish = smoothstep(0.22, 0.92, 1.0 - upAbs);
    float nearBase = pow(max(0.0, 1.0 - smoothstep(0.0, 0.28, hNorm)), 1.35);
    float creviceNoise = 0.5 + 0.5 * sin(
      vWorldPosition.x * 7.4 + vWorldPosition.z * 5.9 + vWorldPosition.y * 3.1 + uTime * 0.35
    );
    float creviceMask = nearBase * wallish * creviceNoise;
    float creviceMoss = creviceMask * mossAmt * (0.38 + 0.62 * wet);
    vec3 mossWetDark = uMossColor * vec3(0.18, 0.24, 0.22);
    vec3 mossTopTint = mix(uMossColor, mossWetDark, 0.22 * wet * topMask);

    float sandWash = clamp(uSandAmount * sandGradient, 0.0, 1.0);
    float mossMix  = clamp(mossMixRaw * (1.0 - sandWash * 0.94), 0.0, 1.0);

    vec3 finalColor = uStoneColor;
    finalColor = mix(finalColor, mossTopTint, mossMix);
    finalColor = mix(finalColor, mossWetDark, creviceMoss * (1.0 - sandMix * 0.55));
    finalColor = mix(finalColor, sandLayer, sandMix);

    // Damp, waterlogged tops — moss deepens on horizontal caps
    float topSoak = topMask * mossAmt * (0.2 + 0.8 * wet);
    vec3 dampShadow = finalColor * vec3(0.32, 0.38, 0.34);
    finalColor = mix(finalColor, dampShadow, clamp(topSoak * 0.82, 0.0, 1.0));

    // Procedural surface grain on stone-heavy areas (worn concrete / oxidized metal).
    float cover = max(sandMix, mossMix);
    float stoneW = 1.0 - smoothstep(0.12, 0.78, cover);
    vec3 gp = vWorldPosition * 19.3 + vNormal * 7.1;
    float h0 = fract(sin(dot(gp.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float h1 = fract(sin(dot(gp.yz + gp.z, vec2(39.346, 11.135))) * 24634.634);
    float grain = 0.5 + 0.5 * (h0 * 0.62 + h1 * 0.38);
    finalColor *= mix(1.0, 0.94 + 0.12 * grain, stoneW * 0.88);

    float rim = pow(1.0 - max(0.0, dot(normalize(vNormal), vec3(0.0, 1.0, 0.0))), 2.0);
    finalColor += uBrushColor * uBrushActive * (0.35 + 0.65 * rim);

    gl_FragColor = vec4(finalColor, 1.0);
  }
  `,
);

extend({ ErosionMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    erosionMaterial: ThreeElements['shaderMaterial'] & {
      uStoneColor?: string | THREE.Color;
      uMossColor?: string | THREE.Color;
      uSandColor?: string | THREE.Color;
    };
  }
}

export { ErosionMaterial };

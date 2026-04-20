import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedWeatherRef } from '../gaea/weatherParams';
import { useWorldStore } from '../state/worldStore';
import { srgbColor } from '../utils/srgbColor';

/**
 * Instanced alien grass — Death Stranding–style low-contrast moss blades.
 *
 * Matrices are rebuilt per frame against a fixed per-cell layout, gated on the
 * Flora Seed System thresholds:
 *   moss > 0.6  &&  integrity > 0.2
 *
 * The grass subtree mounts only in CINEMA view; STUDIO mode skips the matrix
 * loop entirely so brush sessions stay GPU-cheap.
 *
 * Blade count per cell scales with `floraDensity`. All wind sway is computed in the
 * vertex shader from `uTime` + a per-instance phase attribute so the CPU only writes
 * transforms and a single uniform.
 */

/** Budget per cell (× ~100 cells = ~1600 instances max on the default 10×10 grid). */
const MAX_PER_CELL = 16;
const BLADE_HEIGHT = 0.34;
const BLADE_WIDTH = 0.07;

export interface FloraBuilding {
  x: number;
  z: number;
  initialHeight: number;
}

interface AlienGrassProps {
  buildings: FloraBuilding[];
  /** Relic heights (0..initialHeight); integrity = `heights/initialHeight`. */
  heightsRef: React.MutableRefObject<Float32Array>;
  mossRef: React.MutableRefObject<Float32Array>;
  /** Per-cell brushed flora density 0..1 (from SOW_FLORA brush). */
  floraDensityRef: React.MutableRefObject<Float32Array>;
  /** World-space ground lift from RAISE_TERRAIN — grass sits on top of the pedestal. */
  baseElevationRef: React.MutableRefObject<Float32Array>;
  /** Cell footprint on each axis (matches `TileMap` STEP). */
  step: number;
  resolvedWeatherRef: ResolvedWeatherRef;
}

const VS = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uWindTurbulence;

  varying float vY;

  void main() {
    vec3 p = position;
    // Weight sway by normalised blade height (0 at base, 1 at tip).
    float bend = clamp(p.y / ${BLADE_HEIGHT.toFixed(3)}, 0.0, 1.0);
    float b2   = bend * bend;
    float W = max(0.15, uWindTurbulence);

    p.x += sin(uTime * 1.6 + aPhase)           * 0.09 * b2 * W;
    p.z += cos(uTime * 1.3 + aPhase * 0.83)    * 0.06 * b2 * W;
    float wExtra = max(0.0, W - 1.0);
    p.x += sin(uTime * 2.9 + aPhase * 1.3)     * 0.022 * b2 * wExtra;
    p.z += cos(uTime * 3.1 + aPhase * 0.9)    * 0.018 * b2 * wExtra;

    vY = bend;

    vec4 local = instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * local;
  }
`;

const FS = /* glsl */ `
  precision mediump float;

  uniform vec3 uTip;
  uniform vec3 uBase;

  varying float vY;

  void main() {
    vec3 col = mix(uBase, uTip, vY);
    // Subtle darken at the very tip for depth; keeps the read Death-Stranding-soft.
    col *= 0.9 + 0.1 * (1.0 - vY);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function seededRand(a: number, b: number, c = 0): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

export default function AlienGrassInstanced({
  buildings,
  heightsRef,
  mossRef,
  floraDensityRef,
  baseElevationRef,
  step,
  resolvedWeatherRef,
}: AlienGrassProps) {
  // Reactive: flipping View Mode unmounts the entire instanced mesh in STUDIO
  // so we save the per-frame layout pass + GPU draw call entirely.
  const isCinema = useWorldStore(s => s.viewMode === 'CINEMA');
  const maxCount = buildings.length * MAX_PER_CELL;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, material, layout } = useMemo(() => {
    const geom = new THREE.PlaneGeometry(BLADE_WIDTH, BLADE_HEIGHT, 1, 3);
    // Base at y=0, tip at y=BLADE_HEIGHT so sway bends around the root.
    geom.translate(0, BLADE_HEIGHT / 2, 0);

    const phases = new Float32Array(maxCount);
    for (let i = 0; i < maxCount; i++) {
      phases[i] = seededRand(i, 0.31) * Math.PI * 2;
    }
    geom.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindTurbulence: { value: 1 },
        uBase: { value: srgbColor('#22341f') },
        uTip: { value: srgbColor('#9dbf88') },
      },
      vertexShader: VS,
      fragmentShader: FS,
      side: THREE.DoubleSide,
    });

    // Stable per-cell layout: offsets, rotation, scale — picked once, reused every frame.
    const margin = step * 0.45;
    const layout = buildings.map((b, k) => {
      const slots = [] as Array<{
        dx: number;
        dz: number;
        rot: number;
        scale: number;
      }>;
      for (let s = 0; s < MAX_PER_CELL; s++) {
        slots.push({
          dx: (seededRand(k, s, 1.1) - 0.5) * 2 * margin,
          dz: (seededRand(k, s, 2.7) - 0.5) * 2 * margin,
          rot: seededRand(k, s, 3.9) * Math.PI * 2,
          scale: 0.7 + seededRand(k, s, 5.3) * 0.65,
        });
      }
      return { b, slots };
    });

    return { geometry: geom, material: mat, layout };
  }, [buildings, maxCount, step]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    (material.uniforms.uTime as { value: number }).value = state.clock.elapsedTime;
    (material.uniforms.uWindTurbulence as { value: number }).value =
      resolvedWeatherRef.current.windTurbulence;

    const H = heightsRef.current;
    const M = mossRef.current;
    const F = floraDensityRef.current;
    const BE = baseElevationRef.current;

    let write = 0;
    for (let k = 0; k < layout.length; k++) {
      const item = layout[k];
      const initH = item.b.initialHeight;
      if (initH <= 1e-6) continue;

      const integrity = H[k] / initH;
      const moss = M[k];
      // Strict density-map gate from the Flora Seed System plan: grass only
      // where the moss has thoroughly taken hold AND the relic footprint is
      // still substantially intact.
      if (moss <= 0.6 || integrity <= 0.2) continue;

      const density = F[k];
      if (density <= 0.02) continue;

      const n = Math.min(MAX_PER_CELL, Math.floor(density * MAX_PER_CELL + 0.5));
      const y = BE[k];

      for (let s = 0; s < n; s++) {
        const slot = item.slots[s];
        dummy.position.set(item.b.x + slot.dx, y, item.b.z + slot.dz);
        dummy.rotation.set(0, slot.rot, 0);
        dummy.scale.setScalar(slot.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(write++, dummy.matrix);
      }
    }

    mesh.count = write;
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!isCinema) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxCount]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow={false}
    />
  );
}

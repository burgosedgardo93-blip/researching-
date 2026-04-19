import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BuildingData } from './useDecay';

// ── Tuning knobs ──────────────────────────────────────────────────────────────
const TICK_INTERVAL        = 4;      // seconds between exposure recalc
const WIND_THRESHOLD       = 0.48;   // exposure above this → wind erosion begins
const WIND_GROW_RATE       = 0.05;   // wind erosion gain per second
const WIND_FADE_RATE       = 0.018;  // wind erosion loss per second
const MAX_WIND_DISP        = 0.055;  // peak vertex displacement (world units)

// ── Smooth lattice noise ──────────────────────────────────────────────────────

function hash3(a: number, b: number, c: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);

  const n000 = hash3(ix, iy, iz),     n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz), n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1), n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1), n111 = hash3(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + sx * (n100 - n000);
  const nx10 = n010 + sx * (n110 - n010);
  const nx01 = n001 + sx * (n101 - n001);
  const nx11 = n011 + sx * (n111 - n011);
  const nxy0 = nx00 + sy * (nx10 - nx00);
  const nxy1 = nx01 + sy * (nx11 - nx01);
  return (nxy0 + sz * (nxy1 - nxy0)) * 2 - 1;
}

function fbm(x: number, y: number, z: number): number {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 3; i++) {
    v += amp * smoothNoise(x * freq, y * freq, z * freq);
    amp *= 0.5;
    freq *= 2.17;
  }
  return v;
}

// ── Cached original geometry data per building ────────────────────────────────

interface OrigSnap {
  positions: Float32Array;
  normals: Float32Array;
}

/**
 * Timefall — wind exposure on tall, open buildings (vertex displacement).
 * Valley moisture and moss shading are handled by {@link useEnvironmentalGrid}.
 */
export function useTimefall(
  buildings: BuildingData[],
  meshRefsArr: Array<THREE.Mesh | null>,
  heightsArr: Float32Array,
  gridSize: number,
) {
  const n = buildings.length;

  const exposure  = useRef(new Float32Array(n));
  const windLevel = useRef(new Float32Array(n));
  const origSnaps = useRef<Array<OrigSnap | null>>(new Array(n).fill(null));
  const timer     = useRef(TICK_INTERVAL);
  const elapsed   = useRef(0);

  const meshesRef = useRef(meshRefsArr);
  meshesRef.current = meshRefsArr;

  useFrame((_, delta) => {
    elapsed.current += delta;
    timer.current += delta;

    let maxH = 0;
    for (let k = 0; k < n; k++) if (heightsArr[k] > maxH) maxH = heightsArr[k];
    if (maxH < 0.01) return;

    if (timer.current >= TICK_INTERVAL) {
      timer.current -= TICK_INTERVAL;

      for (let k = 0; k < n; k++) {
        const { i, j } = buildings[k];
        const h = heightsArr[k];
        let taller = 0, count = 0;

        if (i > 0)            { count++; if (heightsArr[(i - 1) * gridSize + j] > h + 0.1) taller++; }
        if (i < gridSize - 1) { count++; if (heightsArr[(i + 1) * gridSize + j] > h + 0.1) taller++; }
        if (j > 0)            { count++; if (heightsArr[i * gridSize + (j - 1)] > h + 0.1) taller++; }
        if (j < gridSize - 1) { count++; if (heightsArr[i * gridSize + (j + 1)] > h + 0.1) taller++; }

        const hRatio  = h / maxH;
        exposure.current[k] = hRatio * 0.55 + (count > 0 ? 1 - taller / count : 1) * 0.45;
      }
    }

    const t = elapsed.current;

    for (let k = 0; k < n; k++) {
      const mesh = meshesRef.current[k];
      if (!mesh) continue;

      const geom     = mesh.geometry;
      const posAttr  = geom.getAttribute('position') as THREE.BufferAttribute | null;
      const normAttr = geom.getAttribute('normal')   as THREE.BufferAttribute | null;
      if (!posAttr || !normAttr) continue;

      if (!origSnaps.current[k]) {
        origSnaps.current[k] = {
          positions: new Float32Array(posAttr.array),
          normals:   new Float32Array(normAttr.array),
        };
      }
      const snap = origSnaps.current[k]!;

      windLevel.current[k] = exposure.current[k] > WIND_THRESHOLD
        ? Math.min(1, windLevel.current[k] + WIND_GROW_RATE * delta)
        : Math.max(0, windLevel.current[k] - WIND_FADE_RATE * delta);

      const wLvl = windLevel.current[k];
      if (wLvl < 0.001) continue;

      const vCount = posAttr.count;
      const h     = buildings[k].initialHeight;
      const halfW = 0.44;
      const halfD = 0.44;
      const halfH = h / 2;
      const disp  = MAX_WIND_DISP * wLvl;

      for (let v = 0; v < vCount; v++) {
        const ox = snap.positions[v * 3];
        const oy = snap.positions[v * 3 + 1];
        const oz = snap.positions[v * 3 + 2];

        const edgeFactor = Math.max(Math.abs(ox) / halfW, Math.abs(oz) / halfD);
        const topFactor  = Math.max(0, (oy + halfH) / h);
        const weight     = edgeFactor * topFactor * topFactor;

        if (weight > 0.25) {
          const nv  = fbm(ox * 7 + t * 0.08, oy * 7, oz * 7 + t * 0.04);
          const onx = snap.normals[v * 3];
          const onz = snap.normals[v * 3 + 2];
          const amt = nv * disp * weight;

          posAttr.setX(v, ox + onx * amt);
          posAttr.setZ(v, oz + onz * amt);

          if (topFactor > 0.65) {
            const yErode = Math.abs(nv) * disp * 0.4 * ((topFactor - 0.65) / 0.35);
            posAttr.setY(v, oy - yErode);
          } else {
            posAttr.setY(v, oy);
          }
        } else {
          posAttr.setXYZ(v, ox, oy, oz);
        }
      }

      posAttr.needsUpdate = true;
      geom.computeVertexNormals();
    }
  });
}

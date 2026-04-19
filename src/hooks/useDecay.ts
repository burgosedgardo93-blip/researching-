import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GaeaParamsRef } from '../gaea/gaeaParams';

/** Seconds between stress map recalculations */
const STRESS_INTERVAL = 4;
/** Excess height above neighbor average (units) that triggers high stress */
const STRESS_THRESHOLD = 0.45;
/** Height lost per second while under high stress */
const ERODE_SPEED = 0.12;
/** Floor height a building will never erode below */
export const MIN_HEIGHT = 0.2;

const COLOR_HEALTHY  = new THREE.Color('#c4b69c');  // sand-blasted concrete (match RelicBox)
const COLOR_ERODED   = new THREE.Color('#8a7356');  // weathered sandstone
const COLOR_BLACK    = new THREE.Color(0, 0, 0);
const COLOR_EMISSIVE = new THREE.Color('#5c4020');  // warm dust glow

export interface BuildingData {
  i: number;
  j: number;
  initialHeight: number;
}

/**
 * Decay / erosion simulation.
 *
 * Every STRESS_INTERVAL seconds a stress map is computed: buildings whose
 * height exceeds the average of their four cardinal neighbours by more than
 * STRESS_THRESHOLD are marked high-stress and will begin losing height.
 * Each frame the eroding buildings are imperatively updated — no React
 * re-renders are triggered, so the animation is smooth.
 */
export function useDecay(
  buildings: BuildingData[],
  groupRefsArr: Array<THREE.Group | null>,
  materialRefsArr: Array<THREE.Material | null>,
  gridSize: number,
  gaeaRef: GaeaParamsRef,
) {
  const n = buildings.length;

  // Live heights (mutated in-place by the erode step)
  const heights      = useRef(new Float32Array(buildings.map(b => b.initialHeight)));
  // Heights buildings are eroding toward (avg of neighbours at last stress tick)
  const targetHeights = useRef(new Float32Array(buildings.map(b => b.initialHeight)));
  // Excess above neighbour average (0 = no stress)
  const stressLevels = useRef(new Float32Array(n));
  // Start at the interval so the first frame fires a stress recalc immediately
  const timer = useRef(STRESS_INTERVAL);

  // Keep stable refs to the mutable arrays so stale closures don't bite us
  const groupsRef = useRef(groupRefsArr);
  const matsRef   = useRef(materialRefsArr);
  groupsRef.current = groupRefsArr;
  matsRef.current   = materialRefsArr;

  useFrame((_, delta) => {
    timer.current += delta;

    // ── Stress map recalculation ──────────────────────────────────────────
    if (timer.current >= STRESS_INTERVAL) {
      timer.current -= STRESS_INTERVAL;

      const hs = heights.current;
      for (let k = 0; k < n; k++) {
        const { i, j } = buildings[k];
        let sum = 0, count = 0;
        if (i > 0)              { sum += hs[(i - 1) * gridSize + j]; count++; }
        if (i < gridSize - 1)   { sum += hs[(i + 1) * gridSize + j]; count++; }
        if (j > 0)              { sum += hs[i * gridSize + (j - 1)]; count++; }
        if (j < gridSize - 1)   { sum += hs[i * gridSize + (j + 1)]; count++; }

        const avgNeighbour = count > 0 ? sum / count : hs[k];
        stressLevels.current[k]  = Math.max(0, hs[k] - avgNeighbour);
        targetHeights.current[k] = Math.max(MIN_HEIGHT, avgNeighbour);
      }
    }

    // ── Per-frame erosion ────────────────────────────────────────────────
    for (let k = 0; k < n; k++) {
      const stress = stressLevels.current[k];
      if (stress < STRESS_THRESHOLD) continue;

      const group = groupsRef.current[k];
      const mat   = matsRef.current[k];
      if (!group || !mat) continue;

      const currentH = heights.current[k];
      const targetH  = targetHeights.current[k];
      if (currentH <= targetH + 0.005) continue;

      // Erode toward target height (rate scaled by Leva Erosion Strength)
      const erode =
        ERODE_SPEED * Math.max(0, gaeaRef.current.erosionStrength);
      const newH = Math.max(targetH, currentH - erode * delta);
      heights.current[k] = newH;

      // Scale the group along Y.
      // The mesh sits at localY = initialHeight / 2, so scaling the group
      // keeps its bottom flush with the ground plane.
      group.scale.y = newH / buildings[k].initialHeight;

      if (mat instanceof THREE.MeshStandardMaterial) {
        const wearFactor   = 1 - newH / buildings[k].initialHeight;   // 0..1
        const stressFactor = Math.min(1, (stress - STRESS_THRESHOLD)); // 0..1
        mat.color.lerpColors(COLOR_HEALTHY, COLOR_ERODED, Math.min(1, wearFactor * 1.6));
        mat.emissive.lerpColors(COLOR_BLACK, COLOR_EMISSIVE, stressFactor * 0.6);
        mat.roughness = 0.97 + wearFactor * 0.03;
      }
    }
  });

  return heights;
}

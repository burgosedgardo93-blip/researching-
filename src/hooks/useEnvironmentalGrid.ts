import { useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import type { ResolvedWeatherRef } from '../gaea/weatherParams';
import { MIN_HEIGHT, type BuildingData } from './useDecay';
import { WIND_DIR_I, WIND_DIR_J } from '../environment/windDirectionCore';

export interface EnvironmentalGridRefs {
  sandRef: MutableRefObject<Float32Array>;
  mossRef: MutableRefObject<Float32Array>;
}

/**
 * Unified environmental state (wind shadow sand + altitude moss) when
 * {@link GaeaParams.simulate} is on. Sand/moss arrays feed RelicBox props;
 * heights share the same buffer as {@link useDecay}.
 */
export function useEnvironmentalGrid(
  buildings: BuildingData[],
  groupRefsArr: Array<THREE.Group | null>,
  heightsRef: { current: Float32Array },
  gridSize: number,
  gaeaRef: GaeaParamsRef,
  resolvedWeatherRef?: ResolvedWeatherRef,
): EnvironmentalGridRefs {
  const n = buildings.length;

  const sand = useRef(new Float32Array(n));
  const moss = useRef(new Float32Array(n));

  const groupsRef = useRef(groupRefsArr);
  groupsRef.current = groupRefsArr;

  useFrame((_, delta) => {
    if (!gaeaRef.current.simulate) return;

    const H = heightsRef.current;
    const S = sand.current;
    const M = moss.current;

    let maxCityHeight = 1e-4;
    for (let k = 0; k < n; k++) {
      if (H[k] > maxCityHeight) maxCityHeight = H[k];
    }
    const invMaxH = 1 / maxCityHeight;

    for (let k = 0; k < n; k++) {
      const { i, j } = buildings[k];
      const cellH = H[k];

      const ui = i - WIND_DIR_I;
      const uj = j - WIND_DIR_J;
      let isProtected = false;
      if (ui >= 0 && ui < gridSize && uj >= 0 && uj < gridSize) {
        const upwindIdx = ui * gridSize + uj;
        isProtected = H[upwindIdx] > cellH;
      }

      const sandGrowth = isProtected ? 0.05 * delta : 0.01 * delta;
      const newSand = Math.min(S[k] + sandGrowth, 1);

      const heightFactor = 1 - cellH * invMaxH;
      const mossMul = resolvedWeatherRef?.current.mossGrowthMultiplier ?? 1;
      const moistureGrowth = heightFactor * 0.02 * delta * mossMul;
      const newMoss = Math.min(M[k] + moistureGrowth, 1);

      const settledH = Math.max(MIN_HEIGHT, cellH - newSand * 0.001);

      S[k] = newSand;
      M[k] = newMoss;
      H[k] = settledH;

      const group = groupsRef.current[k];
      if (group) {
        group.scale.y = settledH / buildings[k].initialHeight;
      }
    }
  }, -1);

  return { sandRef: sand, mossRef: moss };
}

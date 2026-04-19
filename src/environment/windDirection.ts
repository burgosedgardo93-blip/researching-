import * as THREE from 'three';
import { WIND_DIR_I, WIND_DIR_J } from './windDirectionCore';

export { WIND_DIR_I, WIND_DIR_J } from './windDirectionCore';

const _len = Math.hypot(WIND_DIR_I, WIND_DIR_J) || 1;

/**
 * Normalised horizontal wind in world XZ — same convention as `ErosionMaterial` `uWindDir`
 * (x → world X, y → world Z).
 */
export const windDirection = new THREE.Vector2(
  WIND_DIR_I / _len,
  WIND_DIR_J / _len,
);

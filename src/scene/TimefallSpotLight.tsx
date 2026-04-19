import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import type { ResolvedWeatherRef } from '../gaea/weatherParams';

const BASE_INTENSITY = 0.38;
/** Desaturated cold blue — reads against warm sand / sun. */
const COLD_BLUE = '#8a9aa8';

/**
 * Cool, desaturated fill like distant storm light — very subtle intensity wobble.
 */
export default function TimefallSpotLight({
  gaeaRef,
  resolvedWeatherRef,
}: {
  gaeaRef: GaeaParamsRef;
  resolvedWeatherRef: ResolvedWeatherRef;
}) {
  const lightRef = useRef<THREE.SpotLight>(null);

  useFrame(({ clock }) => {
    const L = lightRef.current;
    if (!L) return;
    const t = clock.elapsedTime;
    const storm = Math.max(0, gaeaRef.current.sandStormIntensity);
    const flicker =
      0.88
      + 0.06 * Math.sin(t * 3.1 + 0.7)
      + 0.04 * Math.sin(t * 7.4 + 2.1)
      + 0.02 * Math.sin(t * 13.2);
    const stormAmb = resolvedWeatherRef.current.stormBlend;
    L.intensity =
      BASE_INTENSITY *
      flicker *
      (0.55 + 0.45 * Math.min(storm, 1.5)) *
      (1.0 - 0.42 * stormAmb);
  });

  return (
    <spotLight
      ref={lightRef}
      position={[-10, 14, 6]}
      angle={0.42}
      penumbra={0.92}
      decay={1.85}
      distance={52}
      color={COLD_BLUE}
      castShadow={false}
    >
      <object3D position={[0, 0.35, 0]} attach="target" />
    </spotLight>
  );
}

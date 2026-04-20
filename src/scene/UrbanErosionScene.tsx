import { useLayoutEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import TileMap from './TileMap';
import AtmosphereParticles from './AtmosphereParticles';
import TimefallSpotLight from './TimefallSpotLight';
import DroneController from './DroneController';
import BakeFlashCue, { type BakeFlashHandle } from './BakeFlashCue';
import PostFXStack from './PostFXStack';
import WeatherLighting from './WeatherLighting';
import type { GaeaParamsRef, ArchitectureParams } from '../gaea/gaeaParams';
import { DEFAULT_ARCHITECTURE } from '../gaea/gaeaParams';
import type { WeatherParamsRef, ResolvedWeatherRef } from '../gaea/weatherParams';
import type { StudioProjectBridge } from '../studio/relicProject';
import { useWorldStore } from '../state/worldStore';

function StudioViewportCamera({ controlsRef }: { controlsRef: RefObject<any> }) {
  const camera = useThree(s => s.camera);
  useLayoutEffect(() => {
    camera.position.set(50, 50, 50);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = 0.1;
      camera.far = Math.max(2000, camera.far);
      camera.updateProjectionMatrix();
    }
    const c = controlsRef.current;
    if (c?.target) {
      c.target.set(0, 0, 0);
      c.update?.();
    }
  }, [camera, controlsRef]);
  return null;
}

interface UrbanErosionSceneProps {
  gaeaRef: GaeaParamsRef;
  weatherRef: WeatherParamsRef;
  weatherLevaSetterRef: MutableRefObject<null | ((patch: Record<string, unknown>) => void)>;
  sandstormRequestRef: MutableRefObject<number>;
  resolvedWeatherRef: ResolvedWeatherRef;
  bakeEnvironmentRef: MutableRefObject<(() => void) | null>;
  processErosionEnvironmentRef: MutableRefObject<(() => void) | null>;
  studioBridgeRef: MutableRefObject<StudioProjectBridge | null>;
  architecture?: ArchitectureParams;
}

export default function UrbanErosionScene({
  gaeaRef,
  weatherRef,
  weatherLevaSetterRef,
  sandstormRequestRef,
  resolvedWeatherRef,
  bakeEnvironmentRef,
  processErosionEnvironmentRef,
  studioBridgeRef,
  architecture = DEFAULT_ARCHITECTURE,
}: UrbanErosionSceneProps) {
  const bakeFlashRef = useRef<BakeFlashHandle>(null);
  const bloomRef = useRef<any>(null);
  // Studio = sculpting workhorse view: render the floor grid + axis triad so
  // the user always has spatial context, even when a relic has been fully
  // eroded down to MIN_HEIGHT and momentarily disappears under the brush.
  // Cinema strips both helpers — they would shred the beauty pass.
  const isStudio = useWorldStore(s => s.viewMode === 'STUDIO');
  const orbitRef = useRef<any>(null);

  return (
    <>
      <PerspectiveCamera makeDefault position={[50, 50, 50]} near={0.1} far={2000} />
      <OrbitControls ref={orbitRef} enableDamping target={[0, 0, 0]} />
      <StudioViewportCamera controlsRef={orbitRef} />
      <DroneController gaeaRef={gaeaRef} />

      <WeatherLighting
        weatherRef={weatherRef}
        weatherLevaSetterRef={weatherLevaSetterRef}
        sandstormRequestRef={sandstormRequestRef}
        resolvedWeatherRef={resolvedWeatherRef}
      />

      <ambientLight intensity={0.22} color="#8a8a90" />
      <TimefallSpotLight gaeaRef={gaeaRef} resolvedWeatherRef={resolvedWeatherRef} />

      {isStudio ? (
        <>
          <gridHelper
            args={[40, 40, '#4a4c52', '#323336']}
            position={[0, -0.01, 0]}
          />
          <axesHelper args={[6]} position={[0, 0.005, 0]} />
        </>
      ) : null}

      <TileMap
        gaeaRef={gaeaRef}
        resolvedWeatherRef={resolvedWeatherRef}
        bakeEnvironmentRef={bakeEnvironmentRef}
        processErosionEnvironmentRef={processErosionEnvironmentRef}
        studioBridgeRef={studioBridgeRef}
        bakeFlashRef={bakeFlashRef}
        gridSize={architecture.gridSize}
        baseHeightScale={architecture.baseHeight}
        seed={architecture.seed}
      />

      <AtmosphereParticles gaeaRef={gaeaRef} resolvedWeatherRef={resolvedWeatherRef} />

      <BakeFlashCue ref={bakeFlashRef} bloomRef={bloomRef} />
      <PostFXStack ref={bloomRef} gaeaRef={gaeaRef} />

      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.55}
        scale={28}
        blur={2.8}
        far={12}
        resolution={512}
        color="#0a0a0b"
      />
    </>
  );
}

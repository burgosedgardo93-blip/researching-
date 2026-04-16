import React from 'react';
import {
  ContactShadows,
  OrbitControls,
  PerspectiveCamera,
} from '@react-three/drei';
import TileMap from './TileMap';

const CHARCOAL = '#121214';
const FOG_COLOR = '#161618';

export default function UrbanErosionScene() {
  return (
    <>
      <color attach="background" args={[CHARCOAL]} />
      <PerspectiveCamera makeDefault position={[12, 10, 12]} />
      <OrbitControls enableDamping />

      <fog attach="fog" args={[FOG_COLOR, 14, 52]} />

      <ambientLight intensity={0.22} color="#8a8a90" />
      <directionalLight
        position={[8, 14, 6]}
        intensity={0.85}
        color="#d4d2ce"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={40}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.00025}
      />

      {/* Industrial floor grid — muted steel tones */}
      <gridHelper
        args={[40, 40, '#4a4c52', '#323336']}
        position={[0, -0.01, 0]}
      />

      <TileMap />

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

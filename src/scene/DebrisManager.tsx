import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import { srgbColor } from '../utils/srgbColor';

const STONE_COLOR = srgbColor('#121212');
const SAND_COLOR = srgbColor('#c2a382');
const SCATTER_RADIUS = 1.5;
const INTEGRITY_THRESHOLD = 0.6;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();
const _euler = new THREE.Euler();

function seededRand(a: number, b: number, salt: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7 + salt * 73.13) * 43758.5453;
  return n - Math.floor(n);
}

export interface DebrisManagerHandle {
  regenerate: () => void;
}

interface BuildingInfo {
  x: number;
  z: number;
  initialHeight: number;
}

interface DebrisManagerProps {
  buildings: BuildingInfo[];
  heightsRef: React.MutableRefObject<Float32Array>;
  sandRef: React.MutableRefObject<Float32Array>;
  gaeaRef: GaeaParamsRef;
}

const DebrisManager = forwardRef<DebrisManagerHandle, DebrisManagerProps>(
  function DebrisManager({ buildings, heightsRef, sandRef, gaeaRef }, ref) {
    const maxCount = buildings.length * 6;
    const meshRef = useRef<THREE.InstancedMesh>(null!);

    const geometry = useMemo(
      () => new THREE.TetrahedronGeometry(0.06, 0),
      [],
    );

    const material = useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          roughness: 0.95,
          metalness: 0,
        }),
      [],
    );

    const regenerate = React.useCallback(() => {
      const mesh = meshRef.current;
      if (!mesh) return;

      const H = heightsRef.current;
      const S = sandRef.current;
      let idx = 0;

      for (let k = 0; k < buildings.length; k++) {
        const b = buildings[k];
        const integrity = b.initialHeight > 1e-6 ? H[k] / b.initialHeight : 1;
        if (integrity >= INTEGRITY_THRESHOLD) continue;

        const pieceCount = 4 + Math.floor(seededRand(b.x, b.z, k) * 3);
        const sandAmt = THREE.MathUtils.clamp(S[k], 0, 1);

        for (let p = 0; p < pieceCount; p++) {
          if (idx >= maxCount) break;

          const angle = seededRand(k, p, 1.0) * Math.PI * 2;
          const radius = seededRand(k, p, 2.0) * SCATTER_RADIUS;
          const px = b.x + Math.cos(angle) * radius;
          const pz = b.z + Math.sin(angle) * radius;

          _pos.set(px, 0.03, pz);
          _euler.set(
            seededRand(k, p, 3.0) * Math.PI,
            seededRand(k, p, 4.0) * Math.PI,
            seededRand(k, p, 5.0) * Math.PI,
          );
          _quat.setFromEuler(_euler);
          const s = 0.6 + seededRand(k, p, 6.0) * 0.8;
          _scale.set(s, s, s);
          _matrix.compose(_pos, _quat, _scale);
          mesh.setMatrixAt(idx, _matrix);

          _color.copy(STONE_COLOR).lerp(SAND_COLOR, sandAmt);
          mesh.setColorAt(idx, _color);

          idx++;
        }
        if (idx >= maxCount) break;
      }

      mesh.count = idx;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [buildings, heightsRef, sandRef, maxCount]);

    useImperativeHandle(ref, () => ({ regenerate }), [regenerate]);

    useFrame(() => {
      const mesh = meshRef.current;
      if (!mesh) return;
      // Studio drafting view: hide all debris alongside particles so the
      // sculpting silhouette stays clean. Data View also hides debris so the
      // RGB diagnostic on the relic faces is unobstructed.
      mesh.visible =
        !gaeaRef.current.dataView && gaeaRef.current.viewMode !== 'STUDIO';
    });

    return (
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, maxCount]}
        frustumCulled={false}
        castShadow
        receiveShadow
      />
    );
  },
);

export default DebrisManager;

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** World ground (y = 0); same plane the brush paint surface uses for hits. */
const GROUND_PLANE = /* @__PURE__ */ new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

/** Unit ring with a very narrow band (inner almost equals outer). */
const RING_INNER = 0.985;
const RING_OUTER = 1;

const VISUAL_RADIUS = 0.14;

/**
 * Thin bright ring that follows the pointer by raycasting onto the ground each frame.
 */
export default function BrushCircle({
  visibleRef,
}: {
  visibleRef: React.MutableRefObject<boolean>;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame(({ raycaster, pointer, camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (!visibleRef.current) {
      mesh.visible = false;
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    const dirY = raycaster.ray.direction.y;
    if (Math.abs(dirY) < 1e-5) {
      mesh.visible = false;
      return;
    }

    const p = raycaster.ray.intersectPlane(GROUND_PLANE, _hit);
    if (p === null) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    mesh.position.set(p.x, 0.05, p.z);
  });

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[VISUAL_RADIUS, VISUAL_RADIUS, 1]}
      visible={false}
    >
      <ringGeometry args={[RING_INNER, RING_OUTER, 64]} />
      <meshBasicMaterial
        color="#ff4d00"
        transparent
        opacity={1}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

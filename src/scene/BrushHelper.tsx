import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BrushMode, GaeaParamsRef } from '../gaea/gaeaParams';

const RING_COLORS: Record<BrushMode, THREE.Color> = {
  PAINT_SAND: /* @__PURE__ */ new THREE.Color('#e8c896'),
  PAINT_MOSS: /* @__PURE__ */ new THREE.Color('#4a8f5a'),
  ERODE: /* @__PURE__ */ new THREE.Color('#ff6b1a'),
  RESTORE: /* @__PURE__ */ new THREE.Color('#6ec8e8'),
  RAISE_TERRAIN: /* @__PURE__ */ new THREE.Color('#b1775a'),
  BASE_ELEVATION: /* @__PURE__ */ new THREE.Color('#a36848'),
  SOW_FLORA: /* @__PURE__ */ new THREE.Color('#9dbf88'),
};

/** Unit ring (outer = 1); scaled in `useFrame` by {@link GaeaParams.brushSize}. */
const INNER = 0.9;
const OUTER = 1;

/**
 * Flat ring on the ground that follows the brush cursor and scales with
 * {@link GaeaParams.brushSize}.
 */
export default function BrushHelper({
  cursorRef,
  visibleRef,
  gaeaRef,
}: {
  cursorRef: React.MutableRefObject<THREE.Vector3>;
  visibleRef: React.MutableRefObject<boolean>;
  gaeaRef: GaeaParamsRef;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    const mode = gaeaRef.current.brushMode;
    const show = visibleRef.current;
    mesh.visible = show;
    if (!show) return;

    const radius = gaeaRef.current.brushSize;
    mesh.position.set(cursorRef.current.x, 0.02, cursorRef.current.z);
    mesh.scale.set(radius, radius, 1);

    mat.color.copy(RING_COLORS[mode]);
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[INNER, OUTER, 64]} />
      <meshBasicMaterial
        ref={matRef}
        color="#ff6b1a"
        transparent
        opacity={0.92}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

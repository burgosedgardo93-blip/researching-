import React from 'react';
import type { Group, Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';
import type { BrushPaintFeedbackRef } from './BrushPaintSurface';
import type { GaeaParamsRef } from '../gaea/gaeaParams';

interface Cell {
  x: number;
  z: number;
}

/**
 * Haptic-style micro-wobble on relic groups under the brush: follows the live
 * cursor while a stroke is held, then eases out as impulse decays.
 */
export default function BuildingBrushFeedback({
  cells,
  groupRefsArr,
  paintFeedbackRef,
  cursorRef,
  gaeaRef,
}: {
  cells: Cell[];
  groupRefsArr: Array<Group | null>;
  paintFeedbackRef: React.MutableRefObject<BrushPaintFeedbackRef>;
  cursorRef: React.MutableRefObject<Vector3>;
  gaeaRef: GaeaParamsRef;
}) {
  useFrame((state, delta) => {
    const fb = paintFeedbackRef.current;
    const painting = fb.isPainting;
    const decayK = painting ? 3.2 : 13;
    fb.impulse *= Math.exp(-delta * decayK);

    const cur = cursorRef.current;
    const cx = painting ? cur.x : fb.cx;
    const cz = painting ? cur.z : fb.cz;
    const r = painting
      ? Math.max(gaeaRef.current.brushSize, 1e-4)
      : Math.max(fb.r, 1e-4);

    const t = state.clock.elapsedTime;
    const pulse = painting ? Math.max(fb.impulse, 0.08) : fb.impulse;

    for (let k = 0; k < cells.length; k++) {
      const g = groupRefsArr[k];
      if (!g) continue;

      const b = cells[k];
      const dx = b.x - cx;
      const dz = b.z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const inDisk = dist < r && pulse > 0.004;

      if (inDisk) {
        const w = pulse * (1 - dist / r);
        const f = painting ? 28 : 24;
        const amp = 0.017 * w * (painting ? 1.35 : 1);
        g.position.set(
          b.x + Math.sin(t * f) * amp,
          Math.sin(t * f * 2.2) * amp * 0.75,
          b.z + Math.cos(t * f * 0.9) * amp,
        );
      } else {
        g.position.set(b.x, 0, b.z);
      }
    }
  }, 1);

  return null;
}

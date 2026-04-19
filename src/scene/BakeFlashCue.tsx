import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const PEAK_EXPOSURE = 2.0;
const PEAK_BLOOM = 10.0;
const FADE_SEC = 0.6;

export type BakeFlashHandle = {
  runWithFlash: (bake: () => void) => void;
};

const BakeFlashCue = forwardRef<
  BakeFlashHandle,
  { bloomRef?: React.RefObject<any> }
>(function BakeFlashCue({ bloomRef }, ref) {
  const gl = useThree(s => s.gl);
  const baseExposure = useRef(gl.toneMappingExposure);
  const baseBloom = useRef(0.32);
  const fading = useRef(false);
  const fadeU = useRef(0);

  useEffect(() => {
    baseExposure.current = gl.toneMappingExposure;
    return () => {
      gl.toneMappingExposure = baseExposure.current;
    };
  }, [gl]);

  useImperativeHandle(
    ref,
    () => ({
      runWithFlash(bake: () => void) {
        baseExposure.current = gl.toneMappingExposure;

        const bloom = bloomRef?.current;
        if (bloom && typeof bloom.intensity === 'number') {
          baseBloom.current = bloom.intensity;
          bloom.intensity = PEAK_BLOOM;
        }

        gl.toneMappingExposure = PEAK_EXPOSURE;
        fading.current = false;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bake();
            fading.current = true;
            fadeU.current = 0;
          });
        });
      },
    }),
    [gl, bloomRef],
  );

  useFrame((_, delta) => {
    if (!fading.current) return;
    fadeU.current += delta / FADE_SEC;
    if (fadeU.current >= 1) {
      gl.toneMappingExposure = baseExposure.current;
      const bloom = bloomRef?.current;
      if (bloom && typeof bloom.intensity === 'number') {
        bloom.intensity = baseBloom.current;
      }
      fading.current = false;
      return;
    }
    const t = fadeU.current;
    const ease = 1 - (1 - t) * (1 - t);
    gl.toneMappingExposure = THREE.MathUtils.lerp(
      PEAK_EXPOSURE,
      baseExposure.current,
      ease,
    );
    const bloom = bloomRef?.current;
    if (bloom && typeof bloom.intensity === 'number') {
      bloom.intensity = THREE.MathUtils.lerp(
        PEAK_BLOOM,
        baseBloom.current,
        ease,
      );
    }
  });

  return null;
});

export default BakeFlashCue;

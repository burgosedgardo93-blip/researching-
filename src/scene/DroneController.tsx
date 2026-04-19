import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import type { GaeaParamsRef } from '../gaea/gaeaParams';

const ACCEL = 8;
const DAMPING = 0.92;
const MIN_Y = 0.5;

export default function DroneController({
  gaeaRef,
}: {
  gaeaRef: GaeaParamsRef;
}) {
  const controlsRef = useRef<any>(null);
  const velocity = useRef(new THREE.Vector3());
  const keys = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });
  const camera = useThree(s => s.camera);
  const orbitControls = useThree(s => s.controls) as any;

  const prevDrone = useRef(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in keys.current) (keys.current as any)[k] = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in keys.current) (keys.current as any)[k] = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useFrame((_, delta) => {
    const active = gaeaRef.current.droneMode;
    const ctrl = controlsRef.current;

    if (active && !prevDrone.current) {
      if (orbitControls && 'enabled' in orbitControls) orbitControls.enabled = false;
      if (ctrl) ctrl.lock();
      velocity.current.set(0, 0, 0);
    }
    if (!active && prevDrone.current) {
      if (ctrl) ctrl.unlock();
      if (orbitControls && 'enabled' in orbitControls) orbitControls.enabled = true;
    }
    prevDrone.current = active;

    if (!active) return;

    const { w, a, s, d, q, e } = keys.current;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

    const accel = new THREE.Vector3();
    if (w) accel.add(forward);
    if (s) accel.sub(forward);
    if (d) accel.add(right);
    if (a) accel.sub(right);
    if (e) accel.y += 1;
    if (q) accel.y -= 1;

    if (accel.lengthSq() > 0) {
      accel.normalize().multiplyScalar(ACCEL * delta);
      velocity.current.add(accel);
    }

    velocity.current.multiplyScalar(DAMPING);

    camera.position.addScaledVector(velocity.current, delta);
    camera.position.y = Math.max(MIN_Y, camera.position.y);
  });

  return <PointerLockControls ref={controlsRef} />;
}

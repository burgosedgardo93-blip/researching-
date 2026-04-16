import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { extend, type ThreeElements } from '@react-three/fiber';

const ErosionMaterial = shaderMaterial(
  {
    uTime: 0,
    uSandColor: new THREE.Color('#d2b48c'), // Dune Sand
    uMossColor: new THREE.Color('#2d3c2d'), // Death Stranding Moss
    uStoneColor: new THREE.Color('#1a1a1a'), // Dark Brutalist Concrete
  },
  // Vertex Shader
  `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  `,
  // Fragment Shader
  `
  uniform float uTime;
  uniform vec3 uSandColor;
  uniform vec3 uMossColor;
  uniform vec3 uStoneColor;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    // 1. Create a Slope Mask (1.0 = Flat Top, 0.0 = Vertical Wall)
    float slope = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.0)));
    
    // 2. Add some "Procedural Noise" to the mask so it's not a perfect line
    float noise = sin(vWorldPosition.x * 10.0 + uTime) * 0.1;
    float mossMask = smoothstep(0.7, 0.9, slope + noise);
    
    // 3. Altitude Mask (Sand builds up at the bottom)
    float sandMask = smoothstep(2.0, 0.0, vWorldPosition.y);

    // 4. Mix the layers
    vec3 finalColor = uStoneColor;
    finalColor = mix(finalColor, uSandColor, sandMask); // Apply Sand
    finalColor = mix(finalColor, uMossColor, mossMask); // Apply Moss on tops

    gl_FragColor = vec4(finalColor, 1.0);
  }
  `,
);

extend({ ErosionMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    erosionMaterial: ThreeElements['shaderMaterial'];
  }
}

export { ErosionMaterial };

import * as THREE from 'three';

const relicVertexShader = `
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vPosition = position;
    vNormal = normal;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const relicFragmentShader = `
  uniform float uTime;
  uniform vec3 uEdgeColor;
  uniform float uEdgeWidth;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vec3 baseColor = vec3(0.08, 0.08, 0.10);

    // Edge glow: brighten near UV edges
    float edgeX = smoothstep(0.0, uEdgeWidth, vUv.x) * smoothstep(0.0, uEdgeWidth, 1.0 - vUv.x);
    float edgeY = smoothstep(0.0, uEdgeWidth, vUv.y) * smoothstep(0.0, uEdgeWidth, 1.0 - vUv.y);
    float edgeFactor = 1.0 - edgeX * edgeY;

    // Pulse the edge glow subtly
    float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + vPosition.x * 2.0 + vPosition.z * 2.0);
    vec3 glow = uEdgeColor * edgeFactor * pulse * 2.0;

    // Subtle noise-like variation across surface
    float grain = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    baseColor += grain * 0.015;

    vec3 finalColor = baseColor + glow;
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function createRelicMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEdgeColor: { value: new THREE.Color(0.8, 0.1, 0.9) },
      uEdgeWidth: { value: 0.08 },
    },
    vertexShader: relicVertexShader,
    fragmentShader: relicFragmentShader,
  });
}

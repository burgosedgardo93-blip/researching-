import * as THREE from 'three';

/**
 * Three.js r160+ SRGB tagging helpers.
 *
 * With `THREE.ColorManagement.enabled = true`, any `THREE.Color` created
 * from a hex string is interpreted in its tagged working space before the
 * renderer linearises it for shading and re-encodes on output. Custom
 * `ShaderMaterial` uniforms bypass the built-in material pipeline, so we
 * tag them explicitly here — otherwise authored sRGB hex values are
 * silently treated as linear and the final framebuffer comes back washed
 * out (worst in production where ACES + SRGB output combine).
 *
 * The cast-and-duck-type dance here exists because `@types/three@0.183`
 * hasn't caught up with the runtime — `Color.colorSpace` ships in r152+
 * but the typings still omit it.
 */
type ColorWithSpace = THREE.Color & { colorSpace?: string };
const SRGB = (THREE as unknown as { SRGBColorSpace: string }).SRGBColorSpace;

export function srgbColor(hex: string | number): THREE.Color {
  const c = new THREE.Color(hex) as ColorWithSpace;
  if ('SRGBColorSpace' in THREE && 'colorSpace' in c) c.colorSpace = SRGB;
  return c;
}

export function tagSrgb(color: THREE.Color): THREE.Color {
  const c = color as ColorWithSpace;
  if ('SRGBColorSpace' in THREE && 'colorSpace' in c) c.colorSpace = SRGB;
  return color;
}

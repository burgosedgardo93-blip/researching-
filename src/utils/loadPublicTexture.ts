import * as THREE from 'three';

/**
 * Loads a texture from an absolute site-root path (e.g. `/textures/foo.jpg`
 * served from `public/textures/foo.jpg`). Invokes `onError` on failure so the
 * caller can fall back to a non-textured material and keep the canvas visible.
 */
export function loadPublicMatcapTexture(
  path: string,
  onLoad: (texture: THREE.Texture) => void,
  onError: (err: unknown) => void,
): void {
  const loader = new THREE.TextureLoader();
  loader.load(
    path,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      onLoad(tex);
    },
    undefined,
    (err) => {
      console.warn('[UrbanErosion] texture load failed:', path, err);
      onError(err);
    },
  );
}

import type { MutableRefObject } from 'react';

export type BrushMode =
  | 'PAINT_SAND'
  | 'PAINT_MOSS'
  | 'ERODE'
  | 'RESTORE'
  | 'RAISE_TERRAIN'
  | 'BASE_ELEVATION'
  | 'SOW_FLORA';

/**
 * Studio: razor-sharp geometric debug view — no post FX, no particles, MatCap
 * relics, amplified brush emissive glow. Cinema: full erosion shading + bloom +
 * SSAO + atmospheric particles + alien grass. Default is Studio for ~2× FPS
 * during sculpting sessions; flip to Cinema to capture the final beauty pass.
 */
export type ViewMode = 'STUDIO' | 'CINEMA';

export interface GaeaParams {
  erosionStrength: number;
  sandStormIntensity: number;
  timefallActive: boolean;
  /** When false, wind-shadow sand / moss growth and settling pause. */
  simulate: boolean;
  /** History epoch — scrubbing this fast-forwards updateEnvironment steps. */
  time: number;
  brushMode: BrushMode;
  /** World radius of the brush stamp (Leva “Environment Logic → Brush Size”). */
  brushSize: number;
  /** Scales per-stamp paint / erode / restore amounts; nominal baseline is `0.1`. */
  brushStrength: number;
  /**
   * Multiplier applied to the Deposition Pass during a Bake. Higher values pool
   * more sand/moss into low-elevation cells (alleys, streets between buildings).
   */
  sedimentStrength: number;
  /**
   * When true, relics use `MeshBasicMaterial` with RGB diagnostic:
   * red = low integrity, blue = high moss, yellow channel mix = high sand.
   */
  dataView: boolean;
  /** When true, PointerLockControls + WASD drone flight replaces OrbitControls. */
  droneMode: boolean;
  /** Reduces particles by 90%, disables AO, downgrades bloom, swaps to lambert during strokes. */
  performanceMode: boolean;
  /**
   * Hard 60fps preset: caps atmosphere particles at 200, bypasses post-processing entirely,
   * and swaps relics to `MeshBasicMaterial` while a brush stroke is active.
   */
  draftMode: boolean;
  /**
   * Top-level render preset. STUDIO (default) is a high-FPS sculpting view: no
   * post-processing, hidden particles + flora, MatCap building shading, and a
   * boosted brush emissive glow. CINEMA enables the full beauty stack.
   */
  viewMode: ViewMode;
}

export const DEFAULT_GAEA_PARAMS: GaeaParams = {
  erosionStrength: 1,
  sandStormIntensity: 1,
  timefallActive: true,
  simulate: true,
  time: 0,
  brushMode: 'PAINT_SAND',
  brushSize: 2,
  brushStrength: 0.1,
  sedimentStrength: 0.6,
  dataView: false,
  droneMode: false,
  performanceMode: false,
  draftMode: false,
  viewMode: 'STUDIO',
};

export type GaeaParamsRef = MutableRefObject<GaeaParams>;

/**
 * City layout knobs (Leva folder “Architecture”). Changing any of these
 * forces TileMap to rebuild via React key, so we keep the surface tiny.
 */
export interface ArchitectureParams {
  /** Square grid edge length — 5..14, integer. Total relics = gridSize². */
  gridSize: number;
  /** Multiplier on the procedural dune-noise base height per tile. */
  baseHeight: number;
  /** Random seed feeding `seededRandom` and `duneNoise`. Integer. */
  seed: number;
}

/** Boot seed for the dune skyline; kept in sync with Leva Architecture defaults. */
export const DEFAULT_VISIBLE_PROJECT_SEED = 42;

export const DEFAULT_ARCHITECTURE: ArchitectureParams = {
  gridSize: 10,
  baseHeight: 1,
  seed: DEFAULT_VISIBLE_PROJECT_SEED,
};

export type ArchitectureParamsRef = MutableRefObject<ArchitectureParams>;

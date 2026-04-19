/**
 * Pure grid simulation: wind shadow (sand), moisture-style moss spread, and
 * slow height loss when covered. Intended to stay independent of Three/React.
 */

import { WIND_DIR_I, WIND_DIR_J } from './environment/windDirectionCore';

/** Row-major square grid: index = i * gridSize + j */
export interface UrbanCell {
  height: number;
  sand: number;
  moss: number;
  /** Optional fixed grid coords; otherwise inferred from row-major index */
  i?: number;
  j?: number;
  /** Ground elevation before any buildings — reserved for tectonic simulation pass. */
  baseElevation?: number;
}

export interface SimulationSettings {
  /** Scales how fast sheltered cells accumulate sand */
  sandStorm: number;
  /** Applied to the moss update each step (damp / accelerate timefall) */
  timefallRate: number;
  /** Row length of the square grid; defaults to √N when N is a perfect square */
  gridSize?: number;
}

function inferGridSize(length: number, explicit?: number): number {
  if (explicit !== undefined && explicit > 0) return Math.floor(explicit);
  const s = Math.round(Math.sqrt(length));
  return s * s === length ? s : Math.max(1, s);
}

function coordsForIndex(
  index: number,
  gridSize: number,
  cell: UrbanCell,
): { i: number; j: number } {
  if (cell.i !== undefined && cell.j !== undefined) {
    return { i: cell.i, j: cell.j };
  }
  return { i: Math.floor(index / gridSize), j: index % gridSize };
}

const CARDINAL_OFFSETS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function neighborHeightAverage(
  grid: UrbanCell[],
  gridSize: number,
  i: number,
  j: number,
): { avg: number; count: number } {
  let sumH = 0;
  let count = 0;
  for (const [di, dj] of CARDINAL_OFFSETS) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || ni >= gridSize || nj < 0 || nj >= gridSize) continue;
    sumH += grid[ni * gridSize + nj].height;
    count++;
  }
  return { avg: count > 0 ? sumH / count : 0, count };
}

function neighborMoistureAverage(
  grid: UrbanCell[],
  gridSize: number,
  i: number,
  j: number,
  cell: UrbanCell,
): number {
  let sum = 0;
  let count = 0;
  for (const [di, dj] of CARDINAL_OFFSETS) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || ni >= gridSize || nj < 0 || nj >= gridSize) continue;
    const n = grid[ni * gridSize + nj];
    const hDiff = Math.abs(n.height - cell.height);
    // Prefer coupling in “valleys”: similar heights share moisture / moss
    if (hDiff < 0.5) {
      sum += n.moss;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

// The Simulation Core
export const updateEnvironment = (
  grid: UrbanCell[],
  settings: SimulationSettings,
): UrbanCell[] => {
  const gridSize = inferGridSize(grid.length, settings.gridSize);

  return grid.map((cell, index) => {
    const { i, j } = coordsForIndex(index, gridSize, cell);

    // 1. WIND SHADOW (Dune Sand)
    const ui = i - WIND_DIR_I;
    const uj = j - WIND_DIR_J;
    const upwindNeighbor =
      ui >= 0 && ui < gridSize && uj >= 0 && uj < gridSize
        ? grid[ui * gridSize + uj]
        : undefined;
    const isProtected =
      upwindNeighbor !== undefined && upwindNeighbor.height > cell.height;
    const newSand = isProtected
      ? cell.sand + 0.01 * settings.sandStorm
      : cell.sand;

    // 2. MOISTURE SPREAD (Death Stranding Moss)
    const neighborMoisture = neighborMoistureAverage(grid, gridSize, i, j, cell);
    const newMoss =
      (cell.moss + neighborMoisture * 0.1) * settings.timefallRate;

    return {
      ...cell,
      sand: Math.min(newSand, 1.0),
      moss: Math.min(newMoss, 1.0),
      // Buildings slowly "sink" or "erode" if they are covered in too much sand/moss
      height: cell.height - (newSand + newMoss) * 0.001,
    };
  });
};

/**
 * Fake hydraulic pooling: cells lower than the average of their cardinal neighbors
 * get sand and moss scaled by 1.5× (clamped). Run only after discrete bake/process steps,
 * not per frame.
 *
 * @deprecated Prefer {@link applyNeighborSedimentDeposition} which uses an additive
 *   ΔH-proportional model. Kept temporarily for tests / external callers.
 */
export function applyValleySedimentPooling(
  grid: UrbanCell[],
  explicitGridSize?: number,
): UrbanCell[] {
  const gridSize = inferGridSize(grid.length, explicitGridSize);
  return grid.map((cell, index) => {
    const { i, j } = coordsForIndex(index, gridSize, cell);
    const { avg, count } = neighborHeightAverage(grid, gridSize, i, j);
    if (count === 0) return { ...cell };
    if (cell.height >= avg) return { ...cell };
    return {
      ...cell,
      sand: Math.min(1, cell.sand * 1.5),
      moss: Math.min(1, cell.moss * 1.5),
    };
  });
}

/**
 * Neighbor-Based Sediment Flow — the “Pit” Logic.
 *
 *   ΔH = average(4 cardinal neighbor heights) − cell.height
 *   if ΔH > 0 (the cell sits in a depression), then
 *     sand += ΔH × sedimentStrength   (alleys and street corners trap dust)
 *     moss += ΔH × sedimentStrength × 0.55  (moss prefers damp lows but settles slower)
 *
 * Run **only** during a Bake / Process pass — never per frame — to keep the
 * simulation deterministic and the runtime cheap.
 */
export function applyNeighborSedimentDeposition(
  grid: UrbanCell[],
  sedimentStrength: number,
  explicitGridSize?: number,
): UrbanCell[] {
  const gridSize = inferGridSize(grid.length, explicitGridSize);
  const strength = Math.max(0, sedimentStrength);
  return grid.map((cell, index) => {
    const { i, j } = coordsForIndex(index, gridSize, cell);
    const { avg, count } = neighborHeightAverage(grid, gridSize, i, j);
    if (count === 0) return { ...cell };
    const deltaH = avg - cell.height;
    if (deltaH <= 0) return { ...cell };
    const sandGain = deltaH * strength;
    const mossGain = deltaH * strength * 0.55;
    return {
      ...cell,
      sand: Math.min(1, cell.sand + sandGain),
      moss: Math.min(1, cell.moss + mossGain),
    };
  });
}

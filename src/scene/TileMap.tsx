import React, { useLayoutEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useDecay, BuildingData, MIN_HEIGHT } from '../hooks/useDecay';
import { useEnvironmentalGrid } from '../hooks/useEnvironmentalGrid';
import {
  applyNeighborSedimentDeposition,
  updateEnvironment,
  type UrbanCell,
  type SimulationSettings,
} from '../SimulationEngine';
import BrushPaintSurface, { type BrushPaintFeedbackRef } from './BrushPaintSurface';
import BrushHelper from './BrushHelper';
import BrushCircle from './BrushCircle';
import AlienGrassInstanced from './AlienGrassInstanced';
import InstancedRelicGrid from './InstancedRelicGrid';
import type { BakeFlashHandle } from './BakeFlashCue';
import DebrisManager, { type DebrisManagerHandle } from './DebrisManager';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import { DEFAULT_VISIBLE_PROJECT_SEED } from '../gaea/gaeaParams';
import type { ResolvedWeatherRef } from '../gaea/weatherParams';
import {
  parseRelicProjectV1,
  RELIC_EXPORT_FILENAME,
  RELIC_PROJECT_VERSION,
  triggerJsonDownload,
  type StudioProjectBridge,
} from '../studio/relicProject';

function seededRandom(a: number, b: number, seed: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7 + seed * 53.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Simple 2D value-noise for dune-like terrain envelope. */
function duneNoise(x: number, z: number, seed: number): number {
  const freq1 = 0.18, freq2 = 0.4;
  const phase = seed * 0.17;
  const o1 = Math.sin(x * freq1 + 1.3 + phase) * Math.cos(z * freq1 + 0.7 + phase);
  const o2 =
    Math.sin(x * freq2 + 4.1 + phase * 1.3) *
    Math.cos(z * freq2 + 2.9 + phase * 0.7) *
    0.35;
  return (o1 + o2 + 1) * 0.5;          // range ≈ 0..1
}

const STEP = 1.2;
const MAX_STEPS_PER_FRAME = 80;
const BAKE_ENVIRONMENT_STEPS = 50;
const PROCESS_EROSION_STEPS = 50;

/** Default project seed used whenever the app boots without a saved project. */
const DEFAULT_PROJECT_SEED = DEFAULT_VISIBLE_PROJECT_SEED;

interface Building extends BuildingData {
  key: string;
  x: number;
  z: number;
  baseElevation: number;
}

/**
 * Single-pass dune-randomization that hydrates the grid the moment the app
 * mounts. Without this, every relic would start at an identical extruded
 * height — a flat field of cubes — and the user would have to bake or paint
 * before they saw any silhouette. Running it once at construction guarantees
 * an immediate "Dune-like" skyline from the very first frame.
 *
 * The function is deterministic in `seed`, so saved projects can re-derive
 * the same baseline before applying their per-cell deltas.
 */
export function generateDefaultState(
  gridSize: number,
  baseHeightScale: number,
  seed: number = DEFAULT_PROJECT_SEED,
): Building[] {
  const items: Building[] = [];
  const G = Math.max(1, Math.floor(gridSize));
  const center = (G - 1) / 2;
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const x = (i - center) * STEP;
      const z = (j - center) * STEP;

      const dune   = duneNoise(x, z, seed);
      const detail = seededRandom(i, j, seed);
      const h = (0.15 + dune * 2.0 + detail * 0.8) * baseHeightScale;

      items.push({
        key: `${i}-${j}`,
        i,
        j,
        x,
        z,
        initialHeight: h,
        baseElevation: 0,
      });
    }
  }
  return items;
}

// ── Floating HUD label for the tallest relic ────────────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  background: 'rgba(10, 8, 6, 0.75)',
  color: '#e8d0b0',
  padding: '4px 10px',
  borderRadius: '3px',
  fontSize: '11px',
  fontFamily: "'Courier New', monospace",
  whiteSpace: 'nowrap',
  border: '1px solid rgba(194, 163, 130, 0.25)',
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  pointerEvents: 'none',
};

function BuildingLabel({
  building,
  index,
  heightsRef,
  mossRef,
}: {
  building: Building;
  index: number;
  heightsRef: React.MutableRefObject<Float32Array>;
  mossRef: React.MutableRefObject<Float32Array>;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const textRef = useRef<HTMLDivElement>(null!);

  useFrame(() => {
    const el = textRef.current;
    if (!el) return;

    const h = heightsRef.current[index];
    const integrity = Math.max(0, Math.min(100, (h / building.initialHeight) * 100));
    const moisture = Math.max(0, Math.min(100, mossRef.current[index] * 100));

    el.textContent = `INT ${integrity.toFixed(0)}%  ·  MST ${moisture.toFixed(0)}%`;

    if (groupRef.current) {
      groupRef.current.position.y = h + 0.4;
    }
  });

  return (
    <group
      ref={groupRef}
      position={[building.x, building.initialHeight + 0.4, building.z]}
    >
      <Html center distanceFactor={12}>
        <div ref={textRef} style={LABEL_STYLE} />
      </Html>
    </group>
  );
}

export default function TileMap({
  gaeaRef,
  resolvedWeatherRef,
  bakeEnvironmentRef,
  processErosionEnvironmentRef,
  studioBridgeRef,
  bakeFlashRef,
  gridSize: GRID = 10,
  baseHeightScale = 1,
  seed = 1,
}: {
  gaeaRef: GaeaParamsRef;
  resolvedWeatherRef: ResolvedWeatherRef;
  bakeEnvironmentRef: MutableRefObject<(() => void) | null>;
  processErosionEnvironmentRef: MutableRefObject<(() => void) | null>;
  studioBridgeRef: MutableRefObject<StudioProjectBridge | null>;
  bakeFlashRef: React.MutableRefObject<BakeFlashHandle | null>;
  gridSize?: number;
  baseHeightScale?: number;
  seed?: number;
}) {
  const buildings = useMemo<Building[]>(
    // Hydrate immediately with the dune-noise seed so the boot frame already
    // shows a varied silhouette — no flat grid of identical cubes.
    () => generateDefaultState(GRID, baseHeightScale, seed),
    [GRID, baseHeightScale, seed],
  );

  // The instanced grid replaces the previous per-cell `<RelicBox>` map and
  // the `<BuildingBrushFeedback>` sibling, so the hooks below no longer have
  // per-cell `THREE.Group` / `THREE.Material` / `THREE.Mesh` handles to write
  // back into. The hooks already null-check their entries; passing empty
  // arrays leaves their state arrays (`heightsRef`, `sandRef`, `mossRef`)
  // intact while the InstancedRelicGrid reads those arrays each frame and
  // pushes the values into instance attributes for the unified shader.
  const NULL_GROUPS = useMemo<Array<THREE.Group | null>>(
    () => new Array(buildings.length).fill(null),
    [buildings.length],
  );
  const NULL_MATS = useMemo<Array<THREE.Material | null>>(
    () => new Array(buildings.length).fill(null),
    [buildings.length],
  );

  const heightsRef = useDecay(
    buildings,
    NULL_GROUPS,
    NULL_MATS,
    GRID,
    gaeaRef,
  );

  const { sandRef, mossRef } = useEnvironmentalGrid(
    buildings,
    NULL_GROUPS,
    heightsRef,
    GRID,
    gaeaRef,
    resolvedWeatherRef,
  );

  const distortionRef = useRef(new Float32Array(buildings.length).fill(0));
  /** Per-cell pedestal lift (world units) written by the RAISE_TERRAIN brush. */
  const baseElevationRef = useRef(new Float32Array(buildings.length).fill(0));
  /** Per-cell flora density (0..1) written by the SOW_FLORA brush. */
  const floraDensityRef = useRef(new Float32Array(buildings.length).fill(0));
  const debrisRef = useRef<DebrisManagerHandle>(null);

  // ── Brush painting (R3F surface + setGrid-style stamp logic) ────────────
  const cursorRef = useRef(new THREE.Vector3());
  const visibleRef = useRef(false);
  const paintFeedbackRef = useRef<BrushPaintFeedbackRef>({
    impulse: 0,
    cx: 0,
    cz: 0,
    r: 2,
    isPainting: false,
  });

  const mapShakeRef = useRef<THREE.Group>(null);
  useFrame(state => {
    const g = mapShakeRef.current;
    if (!g) return;
    const fb = paintFeedbackRef.current;
    const w = Math.min(1, fb.impulse);
    if (w < 0.028) {
      g.position.set(0, 0, 0);
      return;
    }
    const t = state.clock.elapsedTime;
    const a = 0.0025 * w * (fb.isPainting ? 1.15 : 0.9);
    g.position.set(
      Math.sin(t * 43) * a,
      Math.sin(t * 37) * a * 0.55,
      Math.cos(t * 35) * a,
    );
  }, 0);

  // ── History time-scrubbing ──────────────────────────────────────────────
  const initialGrid = useMemo<UrbanCell[]>(
    () =>
      buildings.map(b => ({
        height: b.initialHeight,
        sand: 0,
        moss: 0,
        i: b.i,
        j: b.j,
        baseElevation: 0,
      })),
    [buildings],
  );

  const cachedGrid = useRef<UrbanCell[]>(initialGrid.map(c => ({ ...c })));
  const appliedTime = useRef(0);

  useLayoutEffect(() => {
    const runEnvironmentSteps = (stepCount: number) => () => {
      const startT = Math.round(gaeaRef.current.time);
      const settings: SimulationSettings = {
        sandStorm: gaeaRef.current.sandStormIntensity,
        timefallRate: gaeaRef.current.timefallActive ? 1 : 0,
        gridSize: GRID,
      };

      let grid: UrbanCell[] = buildings.map((b, k) => ({
        height: heightsRef.current[k],
        sand: sandRef.current[k],
        moss: mossRef.current[k],
        i: b.i,
        j: b.j,
        baseElevation: baseElevationRef.current[k],
      }));

      for (let s = 0; s < stepCount; s++) {
        grid = updateEnvironment(grid, settings);
      }

      // ── Deposition Pass: Neighbor-Based Sediment Flow (the “Pit” logic) ──
      // ΔH > 0 cells (alleys, street corners, depressions between relics) collect
      // extra sand + moss proportional to how deep the pit is. Bake-only.
      grid = applyNeighborSedimentDeposition(
        grid,
        gaeaRef.current.sedimentStrength,
        settings.gridSize,
      );

      cachedGrid.current = grid;
      appliedTime.current = startT + stepCount;

      const H = heightsRef.current;
      const S = sandRef.current;
      const M = mossRef.current;
      const BE = baseElevationRef.current;
      for (let k = 0; k < buildings.length; k++) {
        H[k] = grid[k].height;
        S[k] = grid[k].sand;
        M[k] = grid[k].moss;
        BE[k] = grid[k].baseElevation ?? BE[k];
        // No per-cell group.scale.y write: the instanced grid recomposes
        // every cell's instanceMatrix from heightsRef each frame.
      }
    };

    const runBakeProcess = runEnvironmentSteps(BAKE_ENVIRONMENT_STEPS);
    bakeEnvironmentRef.current = () => {
      const bakeAndScatter = () => {
        runBakeProcess();
        debrisRef.current?.regenerate();
      };
      const flash = bakeFlashRef.current;
      if (flash) {
        flash.runWithFlash(bakeAndScatter);
      } else {
        bakeAndScatter();
      }
    };
    processErosionEnvironmentRef.current = runEnvironmentSteps(PROCESS_EROSION_STEPS);
    return () => {
      bakeEnvironmentRef.current = null;
      processErosionEnvironmentRef.current = null;
    };
  }, [
    bakeEnvironmentRef,
    bakeFlashRef,
    buildings,
    gaeaRef,
    heightsRef,
    mossRef,
    processErosionEnvironmentRef,
    sandRef,
  ]);

  useLayoutEffect(() => {
    const bridge: StudioProjectBridge = {
      exportUrbanRelicProject: () => {
        const H = heightsRef.current;
        const S = sandRef.current;
        const M = mossRef.current;
        const BE = baseElevationRef.current;
        const FD = floraDensityRef.current;
        const cells = buildings.map((b, k) => {
          const h = H[k];
          const initH = b.initialHeight;
          const integrity =
            initH > 1e-6 ? THREE.MathUtils.clamp(h / initH, 0, 1) : 0;
          return {
            i: b.i,
            j: b.j,
            initialHeight: initH,
            height: h,
            integrity,
            moss: M[k],
            sand: S[k],
            baseElevation: BE[k],
            floraDensity: FD[k],
          };
        });
        const payload = {
          version: RELIC_PROJECT_VERSION,
          gridSize: GRID,
          cells,
        };
        triggerJsonDownload(
          RELIC_EXPORT_FILENAME,
          JSON.stringify(payload, null, 2),
        );
      },
      loadUrbanRelicProjectJson: jsonText => {
        let raw: unknown;
        try {
          raw = JSON.parse(jsonText) as unknown;
        } catch {
          return 'Could not read file as JSON.';
        }
        const parsed = parseRelicProjectV1(raw);
        if (!parsed || parsed.gridSize !== GRID) {
          return 'Invalid urban relic project (wrong version or grid size).';
        }
        const cellAt = new Map<string, (typeof parsed.cells)[number]>();
        for (const c of parsed.cells) {
          cellAt.set(`${c.i},${c.j}`, c);
        }
        const H = heightsRef.current;
        const S = sandRef.current;
        const M = mossRef.current;
        const Dm = distortionRef.current;
        const BE = baseElevationRef.current;
        const FD = floraDensityRef.current;
        for (let k = 0; k < buildings.length; k++) {
          const b = buildings[k];
          const c = cellAt.get(`${b.i},${b.j}`);
          if (!c) {
            return `Project is missing cell (${b.i},${b.j}).`;
          }
          const initH = b.initialHeight;
          const h = THREE.MathUtils.clamp(c.height, MIN_HEIGHT, initH);
          H[k] = h;
          S[k] = THREE.MathUtils.clamp(c.sand, 0, 1);
          M[k] = THREE.MathUtils.clamp(c.moss, 0, 1);
          Dm[k] = 0;
          BE[k] = Number.isFinite(c.baseElevation) ? c.baseElevation : 0;
          FD[k] = Number.isFinite(c.floraDensity)
            ? THREE.MathUtils.clamp(c.floraDensity, 0, 1)
            : 0;
          // Instanced grid picks up the new heights on the next frame.
        }
        cachedGrid.current = buildings.map((b, k) => ({
          height: H[k],
          sand: S[k],
          moss: M[k],
          i: b.i,
          j: b.j,
          baseElevation: BE[k],
        }));
        appliedTime.current = Math.round(gaeaRef.current.time);
        return null;
      },
    };
    studioBridgeRef.current = bridge;
    return () => {
      studioBridgeRef.current = null;
    };
  }, [buildings, distortionRef, gaeaRef, heightsRef, mossRef, sandRef, studioBridgeRef]);

  // Bake / processErosion only run from Leva button handlers (refs above). This
  // loop applies updateEnvironment when the History time slider moves — not
  // the heavy bake / deposition passes.
  useFrame(() => {
    const target = Math.round(gaeaRef.current.time);
    if (target === appliedTime.current) return;

    const forward = target > appliedTime.current;
    let grid: UrbanCell[];
    let steps: number;

    if (forward) {
      grid = cachedGrid.current.map(c => ({ ...c }));
      steps = target - appliedTime.current;
    } else {
      grid = initialGrid.map(c => ({ ...c }));
      steps = target;
    }

    const settings: SimulationSettings = {
      sandStorm: gaeaRef.current.sandStormIntensity,
      timefallRate: gaeaRef.current.timefallActive ? 1 : 0,
      gridSize: GRID,
    };

    const run = Math.min(steps, MAX_STEPS_PER_FRAME);
    for (let s = 0; s < run; s++) {
      grid = updateEnvironment(grid, settings);
    }

    cachedGrid.current = grid;
    appliedTime.current = forward
      ? appliedTime.current + run
      : run;

    const H = heightsRef.current;
    const S = sandRef.current;
    const M = mossRef.current;
    const BE = baseElevationRef.current;
    for (let k = 0; k < buildings.length; k++) {
      H[k] = grid[k].height;
      S[k] = grid[k].sand;
      M[k] = grid[k].moss;
      BE[k] = grid[k].baseElevation ?? BE[k];
    }
  }, 10);

  // ── Tallest building for the node label ─────────────────────────────────
  const tallestIdx = useMemo(() => {
    let maxH = 0;
    let idx = 0;
    for (let k = 0; k < buildings.length; k++) {
      if (buildings[k].initialHeight > maxH) {
        maxH = buildings[k].initialHeight;
        idx = k;
      }
    }
    return idx;
  }, [buildings]);

  return (
    <group>
      <BrushPaintSurface
        targets={buildings}
        heightsRef={heightsRef}
        sandRef={sandRef}
        mossRef={mossRef}
        distortionRef={distortionRef}
        baseElevationRef={baseElevationRef}
        floraDensityRef={floraDensityRef}
        groupRefsArr={NULL_GROUPS}
        gaeaRef={gaeaRef}
        cursorRef={cursorRef}
        visibleRef={visibleRef}
        paintFeedbackRef={paintFeedbackRef}
        onBrushEnd={() => debrisRef.current?.regenerate()}
      />
      {/*
        Single instanced mesh = single draw call. Per-cell brush wobble that
        previously lived in <BuildingBrushFeedback> is baked into the
        per-frame instanceMatrix here, and the unified shader handles
        STUDIO/CINEMA/DATA_VIEW so we never swap materials.
      */}
      <group ref={mapShakeRef}>
        {buildings.length > 0 ? (
          <InstancedRelicGrid
            cells={buildings}
            heightsRef={heightsRef}
            sandRef={sandRef}
            mossRef={mossRef}
            distortionRef={distortionRef}
            baseElevationRef={baseElevationRef}
            gaeaRef={gaeaRef}
            paintFeedbackRef={paintFeedbackRef}
            cursorRef={cursorRef}
          />
        ) : null}
      </group>
      {buildings.length > 0 ? (
        <BuildingLabel
          building={buildings[tallestIdx]}
          index={tallestIdx}
          heightsRef={heightsRef}
          mossRef={mossRef}
        />
      ) : null}
      <BrushHelper
        cursorRef={cursorRef}
        visibleRef={visibleRef}
        gaeaRef={gaeaRef}
      />
      <BrushCircle visibleRef={visibleRef} />
      <DebrisManager
        ref={debrisRef}
        buildings={buildings}
        heightsRef={heightsRef}
        sandRef={sandRef}
        gaeaRef={gaeaRef}
      />
      <AlienGrassInstanced
        buildings={buildings}
        heightsRef={heightsRef}
        mossRef={mossRef}
        floraDensityRef={floraDensityRef}
        baseElevationRef={baseElevationRef}
        step={STEP}
        resolvedWeatherRef={resolvedWeatherRef}
      />
    </group>
  );
}

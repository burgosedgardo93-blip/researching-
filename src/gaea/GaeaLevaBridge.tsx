import { useEffect } from 'react';
import { useControls, button, folder } from 'leva';
import type { MutableRefObject } from 'react';
import type {
  GaeaParamsRef,
  ArchitectureParams,
  BrushMode,
  ViewMode,
} from './gaeaParams';
import { useWorldStore } from '../state/worldStore';

const BAKE_STEPS = 50;
const PROCESS_EROSION_STEPS = 50;
const TIME_MAX = 10_000;

export interface ArchitectureChange {
  gridSize: number;
  baseHeight: number;
  seed: number;
}

/**
 * Binds the Architecture / Environment Logic / Systems Leva folders into a stable
 * ref read imperatively by simulation hooks and the painting system.
 *
 * Architecture changes are surfaced via {@link onArchitectureChange} so the
 * parent can re-key TileMap (full geometry rebuild).
 */
export default function GaeaLevaBridge({
  gaeaRef,
  bakeEnvironmentRef,
  processErosionEnvironmentRef,
  onArchitectureChange,
  onExportProject,
  onLoadProject,
}: {
  gaeaRef: GaeaParamsRef;
  bakeEnvironmentRef: MutableRefObject<(() => void) | null>;
  processErosionEnvironmentRef: MutableRefObject<(() => void) | null>;
  onArchitectureChange: (next: ArchitectureParams) => void;
  onExportProject: () => void;
  onLoadProject: () => void;
}) {
  // ── Architecture: building count, base heights, randomization seed ────────
  const arch = useControls(
    'Architecture',
    {
      gridSize: {
        value: 10,
        min: 5,
        max: 14,
        step: 1,
        label: 'Building Count (n×n)',
      },
      baseHeight: {
        value: 1,
        min: 0.4,
        max: 2.2,
        step: 0.05,
        label: 'Base Height',
      },
      seed: {
        value: 1,
        min: 0,
        max: 999,
        step: 1,
        label: 'Seed',
      },
    },
    { collapsed: false },
  );

  useEffect(() => {
    onArchitectureChange({
      gridSize: arch.gridSize,
      baseHeight: arch.baseHeight,
      seed: arch.seed,
    });
  }, [arch.gridSize, arch.baseHeight, arch.seed, onArchitectureChange]);

  // ── Environment Logic: brush, simulation knobs, Bake button ───────────────
  const [sim, setSim] = useControls(
    'Environment Logic',
    () => ({
      Brush: folder(
        {
          brushMode: {
            value: 'PAINT_SAND' as BrushMode,
            options: [
              'PAINT_SAND',
              'PAINT_MOSS',
              'ERODE',
              'RESTORE',
              'RAISE_TERRAIN',
              'BASE_ELEVATION',
              'SOW_FLORA',
            ] as BrushMode[],
            label: 'Brush Mode',
          },
          brushSize: {
            value: 2,
            min: 0.5,
            max: 10,
            step: 0.1,
            label: 'Brush Size',
          },
          brushStrength: {
            value: 0.1,
            min: 0.01,
            max: 0.5,
            step: 0.01,
            label: 'Brush Strength',
          },
        },
        { collapsed: false },
      ),
      erosionStrength: {
        value: 1,
        min: 0,
        max: 3,
        step: 0.02,
        label: 'Erosion Strength',
      },
      sandStormIntensity: {
        value: 1,
        min: 0,
        max: 2,
        step: 0.02,
        label: 'Sand Storm Intensity',
      },
      sedimentStrength: {
        value: 0.6,
        min: 0,
        max: 2,
        step: 0.02,
        label: 'Sediment Strength',
      },
      timefallActive: {
        value: true,
        label: 'Timefall Active',
      },
      simulate: {
        value: true,
        label: 'Simulate',
      },
      time: {
        value: 0,
        min: 0,
        max: TIME_MAX,
        step: 1,
        label: 'Time',
      },
      bake: button(get => {
        bakeEnvironmentRef.current?.();
        const raw = get('Environment Logic.time');
        const cur = typeof raw === 'number' ? raw : Number(raw);
        const base = Number.isFinite(cur) ? cur : 0;
        setSim({ time: Math.min(TIME_MAX, base + BAKE_STEPS) });
      }),
      processErosion: button(get => {
        processErosionEnvironmentRef.current?.();
        const raw = get('Environment Logic.time');
        const cur = typeof raw === 'number' ? raw : Number(raw);
        const base = Number.isFinite(cur) ? cur : 0;
        setSim({ time: Math.min(TIME_MAX, base + PROCESS_EROSION_STEPS) });
      }),
    }),
    { collapsed: false },
  );

  // ── View: render preset (Studio = high FPS sculpting, Cinema = full beauty)
  const view = useControls(
    'View',
    {
      viewMode: {
        value: 'STUDIO' as ViewMode,
        options: ['STUDIO', 'CINEMA'] as ViewMode[],
        label: 'View Mode',
      },
    },
    { collapsed: false },
  );

  // Mirror into the world store so React subtrees (PostFX, Particles, Flora)
  // can mount/unmount reactively. Per-frame readers continue to use the ref.
  useEffect(() => {
    useWorldStore.getState().setViewMode(view.viewMode as ViewMode);
  }, [view.viewMode]);

  // ── Systems: drone / performance / data view / project IO ─────────────────
  const sys = useControls(
    'Systems',
    {
      droneMode: {
        value: false,
        label: 'Drone Mode',
      },
      performanceMode: {
        value: false,
        label: 'Performance Mode',
      },
      draftMode: {
        value: false,
        label: 'Draft Mode',
      },
      dataView: {
        value: false,
        label: 'Data View',
      },
      exportProject: button(() => onExportProject()),
      loadProject: button(() => onLoadProject()),
    },
    { collapsed: false },
  );

  gaeaRef.current = {
    erosionStrength: sim.erosionStrength,
    sandStormIntensity: sim.sandStormIntensity,
    timefallActive: sim.timefallActive,
    simulate: sim.simulate,
    time: sim.time,
    brushMode: sim.brushMode as BrushMode,
    brushSize: sim.brushSize,
    brushStrength: sim.brushStrength,
    sedimentStrength: sim.sedimentStrength,
    dataView: sys.dataView,
    droneMode: sys.droneMode,
    performanceMode: sys.performanceMode,
    draftMode: sys.draftMode,
    viewMode: view.viewMode as ViewMode,
  };
  return null;
}

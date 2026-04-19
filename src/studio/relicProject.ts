export const RELIC_PROJECT_VERSION = 1 as const;
export const RELIC_EXPORT_FILENAME = 'urban-relic-export.json';

export interface RelicProjectCellV1 {
  i: number;
  j: number;
  initialHeight: number;
  height: number;
  /** Height / initialHeight (0..1), same signal as shader `uIntegrity`. */
  integrity: number;
  moss: number;
  sand: number;
  /** Ground elevation — reserved for tectonic simulation. Defaults to 0. */
  baseElevation: number;
  /** Per-cell flora density 0..1 from the SOW_FLORA brush. Defaults to 0 for legacy files. */
  floraDensity: number;
}

export interface RelicProjectFileV1 {
  version: typeof RELIC_PROJECT_VERSION;
  gridSize: number;
  cells: RelicProjectCellV1[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseRelicProjectV1(raw: unknown): RelicProjectFileV1 | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== RELIC_PROJECT_VERSION) return null;
  const gridSize = num(raw.gridSize);
  if (gridSize === null || gridSize < 1) return null;
  const cells = raw.cells;
  if (!Array.isArray(cells) || cells.length !== gridSize * gridSize) return null;

  const out: RelicProjectCellV1[] = [];
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    if (!isRecord(c)) return null;
    const i = num(c.i);
    const j = num(c.j);
    const initialHeight = num(c.initialHeight);
    const height = num(c.height);
    const integrity = num(c.integrity);
    const moss = num(c.moss);
    const sand = num(c.sand);
    const baseElevation = num(c.baseElevation) ?? 0;
    const floraDensity = num(c.floraDensity) ?? 0;
    if (
      i === null ||
      j === null ||
      initialHeight === null ||
      height === null ||
      integrity === null ||
      moss === null ||
      sand === null
    ) {
      return null;
    }
    out.push({
      i: Math.floor(i),
      j: Math.floor(j),
      initialHeight,
      height,
      integrity,
      moss,
      sand,
      baseElevation,
      floraDensity,
    });
  }

  return { version: RELIC_PROJECT_VERSION, gridSize, cells: out };
}

export interface StudioProjectBridge {
  exportUrbanRelicProject: () => void;
  /** Returns an error message on failure, or `null` on success. */
  loadUrbanRelicProjectJson: (jsonText: string) => string | null;
}

export function triggerJsonDownload(filename: string, jsonText: string) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

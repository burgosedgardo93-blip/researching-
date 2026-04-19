import { create } from 'zustand';
import type { WeatherSettings } from '../gaea/weatherParams';
import { DEFAULT_WEATHER } from '../gaea/weatherParams';
import type { ViewMode } from '../gaea/gaeaParams';

export interface Atmosphere {
  /** Kept for optional tooling; scene fog is Exp2 via Weather. */
  fogColor: string;
  background: string;
}

export interface FoliageEntry {
  kind: 'grass' | 'shrub' | 'moss';
  density: number;
}

export interface WorldState {
  atmosphere: Atmosphere;
  weather: WeatherSettings;
  foliageMap: Map<string, FoliageEntry>;
  /** Reactive mirror of `GaeaParams.viewMode` so post-FX / particle / flora
   *  React subtrees can mount/unmount when the user flips the View toggle. */
  viewMode: ViewMode;
  setAtmosphere: (patch: Partial<Atmosphere>) => void;
  setWeather: (patch: Partial<WeatherSettings>) => void;
  setViewMode: (mode: ViewMode) => void;
  clearFoliage: () => void;
}

export const useWorldStore = create<WorldState>((set) => ({
  atmosphere: {
    fogColor: '#161618',
    background: '#121214',
  },
  weather: { ...DEFAULT_WEATHER },
  foliageMap: new Map(),
  viewMode: 'STUDIO',
  setAtmosphere: (patch) =>
    set((s) => ({ atmosphere: { ...s.atmosphere, ...patch } })),
  setWeather: (patch) =>
    set((s) => ({ weather: { ...s.weather, ...patch } })),
  setViewMode: (mode) => set({ viewMode: mode }),
  clearFoliage: () => set({ foliageMap: new Map() }),
}));

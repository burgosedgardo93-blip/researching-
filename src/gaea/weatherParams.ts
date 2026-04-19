import type { MutableRefObject } from 'react';

export type WeatherPreset = 'Default' | 'Sandstorm' | 'Timefall';

export const WEATHER_PRESETS: WeatherPreset[] = ['Default', 'Sandstorm', 'Timefall'];

export interface WeatherSettings {
  /** 0 = warm low sun, 1 = cold / high sun */
  timeOfDay: number;
  /** THREE.FogExp2 density */
  fogDensity: number;
  /** Multiplier for particle drift and flora sway */
  windTurbulence: number;
  /** Active state-machine preset (lerps lighting/fog/particles over 2s when changed). */
  currentWeather: WeatherPreset;
}

export const DEFAULT_WEATHER: WeatherSettings = {
  timeOfDay: 0.32,
  fogDensity: 0.036,
  windTurbulence: 1,
  currentWeather: 'Default',
};

/** Values written to Leva at the end of a manually triggered “Sandstorm” burst (3s). */
export const SANDSTORM_LEVA_ENDPOINT = {
  timeOfDay: 0.14,
  fogDensity: 0.092,
  windTurbulence: 2.55,
};

export type WeatherParamsRef = MutableRefObject<WeatherSettings>;

/** Latest resolved visuals (lerped during weather transitions); read in useFrame from GPU components. */
export interface ResolvedWeatherFrame {
  timeOfDay: number;
  fogDensity: number;
  windTurbulence: number;
  fogColor: string;
  background: string;
  sunIntensity: number;
  sunColor: string;
  /** Normalised direction * distance for directional light position */
  sunX: number;
  sunY: number;
  sunZ: number;
  /** 0 = clear weather, 1 = full sandstorm preset (for secondary lights / particles). */
  stormBlend: number;
  /** Multiplier applied to per-frame moss accumulation (Timefall preset boosts to ~2.5×). */
  mossGrowthMultiplier: number;
  /** Bias particle motion toward horizontal streaks (1 = sandstorm gusts, 0 = ambient drift). */
  particleHorizontality: number;
}

export const DEFAULT_RESOLVED_WEATHER: ResolvedWeatherFrame = {
  timeOfDay: DEFAULT_WEATHER.timeOfDay,
  fogDensity: DEFAULT_WEATHER.fogDensity,
  windTurbulence: DEFAULT_WEATHER.windTurbulence,
  fogColor: '#1a1a22',
  background: '#121214',
  sunIntensity: 0.85,
  sunColor: '#d4d2ce',
  sunX: 8,
  sunY: 14,
  sunZ: 6,
  stormBlend: 0,
  mossGrowthMultiplier: 1,
  particleHorizontality: 0,
};

export type ResolvedWeatherRef = MutableRefObject<ResolvedWeatherFrame>;

/**
 * Per-preset slider targets — written into the live Weather Leva folder
 * (timeOfDay / fogDensity / windTurbulence) when the user picks a preset,
 * so the UI sliders stay in sync with what the state machine is driving.
 */
export const WEATHER_PRESET_SLIDER_TARGETS: Record<WeatherPreset, {
  timeOfDay: number;
  fogDensity: number;
  windTurbulence: number;
}> = {
  Default: {
    timeOfDay: 0.32,
    fogDensity: 0.01,
    windTurbulence: 1,
  },
  Sandstorm: {
    timeOfDay: 0.14,
    fogDensity: 0.13,
    windTurbulence: 2.6,
  },
  Timefall: {
    timeOfDay: 0.62,
    fogDensity: 0.085,
    windTurbulence: 0.55,
  },
};

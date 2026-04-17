import type { MutableRefObject } from 'react';

export interface WeatherSettings {
  /** 0 = warm low sun, 1 = cold / high sun */
  timeOfDay: number;
  /** THREE.FogExp2 density */
  fogDensity: number;
  /** Multiplier for particle drift and flora sway */
  windTurbulence: number;
}

export const DEFAULT_WEATHER: WeatherSettings = {
  timeOfDay: 0.32,
  fogDensity: 0.036,
  windTurbulence: 1,
};

/** Values written to Leva at the end of “Trigger Sandstorm” (3s). */
export const SANDSTORM_LEVA_ENDPOINT: WeatherSettings = {
  timeOfDay: 0.14,
  fogDensity: 0.092,
  windTurbulence: 2.55,
};

export type WeatherParamsRef = MutableRefObject<WeatherSettings>;

/** Latest resolved visuals (lerped during sandstorm); read in useFrame from GPU components. */
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
};

export type ResolvedWeatherRef = MutableRefObject<ResolvedWeatherFrame>;

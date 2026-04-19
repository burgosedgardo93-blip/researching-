import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { button, useControls } from 'leva';
import { useWorldStore } from '../state/worldStore';
import type { WeatherParamsRef, WeatherPreset } from './weatherParams';
import {
  DEFAULT_WEATHER,
  WEATHER_PRESETS,
  WEATHER_PRESET_SLIDER_TARGETS,
} from './weatherParams';

/**
 * Leva folder "Weather & Lighting" → stable ref (imperative reads in R3F) + zustand mirror.
 *
 * The preset dropdown writes back into the slider values so the user can see
 * what the state machine is converging to.
 */
export default function WeatherLevaBridge({
  weatherRef,
  weatherLevaSetterRef,
  sandstormRequestRef,
}: {
  weatherRef: WeatherParamsRef;
  weatherLevaSetterRef: MutableRefObject<null | ((patch: Record<string, unknown>) => void)>;
  sandstormRequestRef: MutableRefObject<number>;
}) {
  const lastPresetRef = useRef<WeatherPreset>(DEFAULT_WEATHER.currentWeather);

  const [weatherLeva, setWeatherLeva] = useControls(
    'Weather & Lighting',
    () => ({
      currentWeather: {
        value: DEFAULT_WEATHER.currentWeather as WeatherPreset,
        options: WEATHER_PRESETS as WeatherPreset[],
        label: 'Weather Preset',
      },
      timeOfDay: {
        value: DEFAULT_WEATHER.timeOfDay,
        min: 0,
        max: 1,
        step: 0.005,
        label: 'Time of Day',
      },
      fogDensity: {
        value: DEFAULT_WEATHER.fogDensity,
        min: 0.001,
        max: 0.18,
        step: 0.001,
        label: 'Fog Density',
      },
      windTurbulence: {
        value: DEFAULT_WEATHER.windTurbulence,
        min: 0.25,
        max: 3,
        step: 0.05,
        label: 'Wind Turbulence',
      },
      triggerSandstorm: button(() => {
        sandstormRequestRef.current += 1;
      }),
    }),
    { collapsed: false },
  );

  useLayoutEffect(() => {
    weatherLevaSetterRef.current = setWeatherLeva as (patch: Record<string, unknown>) => void;
    return () => {
      weatherLevaSetterRef.current = null;
    };
  }, [setWeatherLeva, weatherLevaSetterRef]);

  // When the user picks a new preset, snap the slider mirrors to that preset's
  // target so the UI reflects the state machine's destination.
  useEffect(() => {
    const next = weatherLeva.currentWeather as WeatherPreset;
    if (next === lastPresetRef.current) return;
    lastPresetRef.current = next;
    const t = WEATHER_PRESET_SLIDER_TARGETS[next];
    if (!t) return;
    setWeatherLeva({
      timeOfDay: t.timeOfDay,
      fogDensity: t.fogDensity,
      windTurbulence: t.windTurbulence,
    });
  }, [weatherLeva.currentWeather, setWeatherLeva]);

  useEffect(() => {
    const next = {
      timeOfDay: weatherLeva.timeOfDay,
      fogDensity: weatherLeva.fogDensity,
      windTurbulence: weatherLeva.windTurbulence,
      currentWeather: weatherLeva.currentWeather as WeatherPreset,
    };
    weatherRef.current = next;
    useWorldStore.getState().setWeather(next);
  }, [
    weatherRef,
    weatherLeva.timeOfDay,
    weatherLeva.fogDensity,
    weatherLeva.windTurbulence,
    weatherLeva.currentWeather,
  ]);

  return null;
}

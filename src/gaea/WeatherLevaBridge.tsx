import React, { useEffect, useLayoutEffect } from 'react';
import type { MutableRefObject } from 'react';
import { button, useControls } from 'leva';
import { useWorldStore } from '../state/worldStore';
import type { WeatherParamsRef } from './weatherParams';
import { DEFAULT_WEATHER } from './weatherParams';

/**
 * Leva folder "Weather" → stable ref (imperative reads in R3F) + zustand mirror.
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
  const [weatherLeva, setWeatherLeva] = useControls(
    'Weather',
    () => ({
      timeOfDay: {
        value: DEFAULT_WEATHER.timeOfDay,
        min: 0,
        max: 1,
        step: 0.005,
        label: 'Time of Day',
      },
      fogDensity: {
        value: DEFAULT_WEATHER.fogDensity,
        min: 0.006,
        max: 0.14,
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

  useEffect(() => {
    const next = {
      timeOfDay: weatherLeva.timeOfDay,
      fogDensity: weatherLeva.fogDensity,
      windTurbulence: weatherLeva.windTurbulence,
    };
    weatherRef.current = next;
    useWorldStore.getState().setWeather(next);
  }, [weatherRef, weatherLeva.timeOfDay, weatherLeva.fogDensity, weatherLeva.windTurbulence]);

  return null;
}

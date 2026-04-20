import { useLayoutEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  WeatherParamsRef,
  ResolvedWeatherFrame,
  ResolvedWeatherRef,
  WeatherPreset,
} from '../gaea/weatherParams';
import { SANDSTORM_LEVA_ENDPOINT } from '../gaea/weatherParams';
import { useWorldStore } from '../state/worldStore';

/** State-machine transition length when `currentWeather` flips. */
const PRESET_LERP_DURATION = 2.0;
/** Manual “Trigger Sandstorm” burst length (legacy one-shot). */
const SANDSTORM_DURATION = 3;

const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _cOut = new THREE.Color();

function easeInOut(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Tag a Color as living in sRGB so r160+ tone-mapping treats it correctly. */
function srgb(color: THREE.Color): THREE.Color {
  if ('SRGBColorSpace' in THREE && 'colorSpace' in color) {
    (color as THREE.Color & { colorSpace?: string }).colorSpace =
      (THREE as unknown as { SRGBColorSpace: string }).SRGBColorSpace;
  }
  return color;
}

function lerpColorHex(a: string, b: string, t: number): string {
  _cA.set(a);
  _cB.set(b);
  _cOut.lerpColors(_cA, _cB, t);
  return `#${_cOut.getHexString()}`;
}

/**
 * Day-night sun based on raw `timeOfDay` slider — used when the active preset
 * is "Default" and there is no preset transition in flight.
 */
function baseResolvedFromWeather(w: {
  timeOfDay: number;
  fogDensity: number;
  windTurbulence: number;
}): ResolvedWeatherFrame {
  const t = THREE.MathUtils.clamp(w.timeOfDay, 0, 1);
  const warmSun = '#ff9340';
  const coldSun = '#b8c8f0';
  const warmFog = '#242228';
  const coldFog = '#1a2230';
  const warmBg = '#151018';
  const coldBg = '#0e1218';

  const az = THREE.MathUtils.lerp(0.22, 0.62, t) * Math.PI * 2;
  const el = THREE.MathUtils.lerp(0.26, 0.62, t);
  const dist = 20;
  const sunX = Math.cos(az) * Math.cos(el) * dist;
  const sunY = Math.sin(el) * dist;
  const sunZ = Math.sin(az) * Math.cos(el) * dist;

  const sunIntensity = THREE.MathUtils.lerp(0.95, 0.68, t);
  const sunColor = lerpColorHex(warmSun, coldSun, t);
  const fogColor = lerpColorHex(warmFog, coldFog, t);
  const background = lerpColorHex(warmBg, coldBg, t);

  return {
    timeOfDay: w.timeOfDay,
    fogDensity: w.fogDensity,
    windTurbulence: w.windTurbulence,
    fogColor,
    background,
    sunIntensity,
    sunColor,
    sunX,
    sunY,
    sunZ,
    stormBlend: 0,
    mossGrowthMultiplier: 1,
    particleHorizontality: 0,
  };
}

/**
 * Preset target snapshots used by the state machine. Each describes a steady
 * “held” weather; the machine lerps between them over {@link PRESET_LERP_DURATION}.
 *
 * Sandstorm: deep orange light, near-zero visibility, fast horizontal grit.
 * Timefall:  desaturated teal/grey, heavy vertical fog, faster moss growth.
 */
function resolvedForPreset(
  preset: WeatherPreset,
  w: { timeOfDay: number; fogDensity: number; windTurbulence: number },
  baseSun: { sunX: number; sunY: number; sunZ: number },
): ResolvedWeatherFrame {
  switch (preset) {
    case 'Sandstorm':
      return {
        timeOfDay: w.timeOfDay,
        fogDensity: Math.max(w.fogDensity, 0.13),
        windTurbulence: Math.max(w.windTurbulence, 2.6),
        fogColor: '#c87038',
        background: '#26180f',
        sunIntensity: 0.28,
        sunColor: '#e89860',
        sunX: baseSun.sunX * 0.55 + 6,
        sunY: Math.max(5.5, baseSun.sunY * 0.42),
        sunZ: baseSun.sunZ * 0.55 + 2,
        stormBlend: 1,
        mossGrowthMultiplier: 0.15,
        particleHorizontality: 1,
      };
    case 'Timefall':
      return {
        timeOfDay: w.timeOfDay,
        fogDensity: Math.max(w.fogDensity, 0.085),
        windTurbulence: Math.max(0.5, Math.min(w.windTurbulence, 0.85)),
        fogColor: '#3a4a52',
        background: '#101418',
        sunIntensity: 0.42,
        sunColor: '#8aa6ae',
        sunX: baseSun.sunX * 0.7,
        sunY: Math.max(8, baseSun.sunY * 0.85),
        sunZ: baseSun.sunZ * 0.7,
        stormBlend: 0.25,
        mossGrowthMultiplier: 2.5,
        particleHorizontality: 0,
      };
    case 'Default':
    default:
      return baseResolvedFromWeather(w);
  }
}

function lerpResolved(
  a: ResolvedWeatherFrame,
  b: ResolvedWeatherFrame,
  u: number,
): ResolvedWeatherFrame {
  const t = easeInOut(u);
  return {
    timeOfDay: THREE.MathUtils.lerp(a.timeOfDay, b.timeOfDay, t),
    fogDensity: THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, t),
    windTurbulence: THREE.MathUtils.lerp(a.windTurbulence, b.windTurbulence, t),
    fogColor: lerpColorHex(a.fogColor, b.fogColor, t),
    background: lerpColorHex(a.background, b.background, t),
    sunIntensity: THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t),
    sunColor: lerpColorHex(a.sunColor, b.sunColor, t),
    sunX: THREE.MathUtils.lerp(a.sunX, b.sunX, t),
    sunY: THREE.MathUtils.lerp(a.sunY, b.sunY, t),
    sunZ: THREE.MathUtils.lerp(a.sunZ, b.sunZ, t),
    stormBlend: THREE.MathUtils.lerp(a.stormBlend, b.stormBlend, t),
    mossGrowthMultiplier: THREE.MathUtils.lerp(a.mossGrowthMultiplier, b.mossGrowthMultiplier, t),
    particleHorizontality: THREE.MathUtils.lerp(a.particleHorizontality, b.particleHorizontality, t),
  };
}

function weatherFrozenEquals(
  a: { timeOfDay: number; fogDensity: number; windTurbulence: number },
  b: { timeOfDay: number; fogDensity: number; windTurbulence: number },
): boolean {
  return (
    Math.abs(a.timeOfDay - b.timeOfDay) < 1e-5 &&
    Math.abs(a.fogDensity - b.fogDensity) < 1e-5 &&
    Math.abs(a.windTurbulence - b.windTurbulence) < 1e-5
  );
}

type StormAnim = {
  requestId: number;
  t0: number;
  from: ResolvedWeatherFrame;
  to: ResolvedWeatherFrame;
  freeze: { timeOfDay: number; fogDensity: number; windTurbulence: number };
};

type PresetAnim = {
  preset: WeatherPreset;
  t0: number;
  from: ResolvedWeatherFrame;
};

/**
 * Drives FogExp2, directional sun, and clear color from {@link weatherRef}.
 * Hosts the Weather State Machine: when `currentWeather` changes, lerps the
 * resolved frame from its previous value to the new preset's target over
 * {@link PRESET_LERP_DURATION} seconds. Manual "Trigger Sandstorm" still works
 * as a 3-second one-shot independent of the preset.
 */
export default function WeatherLighting({
  weatherRef,
  weatherLevaSetterRef,
  sandstormRequestRef,
  resolvedWeatherRef,
}: {
  weatherRef: WeatherParamsRef;
  weatherLevaSetterRef: MutableRefObject<null | ((patch: Record<string, unknown>) => void)>;
  sandstormRequestRef: MutableRefObject<number>;
  resolvedWeatherRef: ResolvedWeatherRef;
}) {
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const fog = useMemo(() => {
    const f = new THREE.FogExp2('#121214', 0.036);
    srgb(f.color);
    return f;
  }, []);
  const { gl, scene } = useThree();
  // Studio mode strips fog entirely so the sculpting view stays razor-sharp;
  // we still update the FogExp2 instance below (cheap), but skip attaching it
  // to the scene so the colour pass never samples it.
  const studio = useWorldStore(s => s.viewMode === 'STUDIO');

  useLayoutEffect(() => {
    if (studio) {
      scene.fog = null;
    } else {
      // Imperatively reattach after STUDIO cleared fog so CINEMA never relies
      // solely on primitive mount timing for the same frame as the toggle.
      scene.fog = fog;
    }
  }, [fog, scene, studio]);

  const stormAnim = useRef<StormAnim | null>(null);
  const lastSeenStormRequest = useRef(0);

  const presetAnim = useRef<PresetAnim | null>(null);
  const lastPreset = useRef<WeatherPreset>(weatherRef.current.currentWeather);

  useFrame(({ clock }) => {
    const w = weatherRef.current;
    const rid = sandstormRequestRef.current;

    // ── Manual sandstorm one-shot trigger ─────────────────────────────────
    if (rid > 0 && rid !== lastSeenStormRequest.current) {
      lastSeenStormRequest.current = rid;
      stormAnim.current = {
        requestId: rid,
        t0: clock.elapsedTime,
        from: { ...resolvedWeatherRef.current },
        to: resolvedForPreset('Sandstorm', w, resolvedWeatherRef.current),
        freeze: {
          timeOfDay: w.timeOfDay,
          fogDensity: w.fogDensity,
          windTurbulence: w.windTurbulence,
        },
      };
    }

    // ── State machine: detect preset change, kick off 2s lerp ─────────────
    if (w.currentWeather !== lastPreset.current) {
      presetAnim.current = {
        preset: w.currentWeather,
        t0: clock.elapsedTime,
        from: { ...resolvedWeatherRef.current },
      };
      lastPreset.current = w.currentWeather;
    }

    // Steady-state target for the active preset, recomputed every frame
    // so manual slider tweaks (Default preset) keep flowing through.
    const baseSunForPresets = baseResolvedFromWeather({
      timeOfDay: w.timeOfDay,
      fogDensity: w.fogDensity,
      windTurbulence: w.windTurbulence,
    });
    const presetTarget = resolvedForPreset(
      w.currentWeather,
      { timeOfDay: w.timeOfDay, fogDensity: w.fogDensity, windTurbulence: w.windTurbulence },
      { sunX: baseSunForPresets.sunX, sunY: baseSunForPresets.sunY, sunZ: baseSunForPresets.sunZ },
    );

    let next = presetTarget;

    const pAnim = presetAnim.current;
    if (pAnim) {
      const u = (clock.elapsedTime - pAnim.t0) / PRESET_LERP_DURATION;
      if (u >= 1) {
        next = presetTarget;
        presetAnim.current = null;
      } else {
        next = lerpResolved(pAnim.from, presetTarget, u);
      }
    }

    // ── Manual sandstorm burst overrides preset evolution while active ────
    const anim = stormAnim.current;
    if (anim) {
      if (
        !weatherFrozenEquals(
          { timeOfDay: w.timeOfDay, fogDensity: w.fogDensity, windTurbulence: w.windTurbulence },
          anim.freeze,
        )
      ) {
        stormAnim.current = null;
      } else {
        const u = (clock.elapsedTime - anim.t0) / SANDSTORM_DURATION;
        if (u >= 1) {
          next = anim.to;
          stormAnim.current = null;
          weatherLevaSetterRef.current?.({
            timeOfDay: SANDSTORM_LEVA_ENDPOINT.timeOfDay,
            fogDensity: SANDSTORM_LEVA_ENDPOINT.fogDensity,
            windTurbulence: SANDSTORM_LEVA_ENDPOINT.windTurbulence,
          });
          useWorldStore.getState().setWeather({ ...SANDSTORM_LEVA_ENDPOINT });
        } else {
          next = lerpResolved(anim.from, anim.to, u);
        }
      }
    }

    resolvedWeatherRef.current = next;

    fog.color.set(next.fogColor);
    srgb(fog.color);
    fog.density = next.fogDensity;

    gl.setClearColor(next.background, 1);

    const dir = dirRef.current;
    if (dir) {
      dir.position.set(next.sunX, next.sunY, next.sunZ);
      dir.color.set(next.sunColor);
      srgb(dir.color);
      dir.intensity = next.sunIntensity;
    }
  });

  return (
    <>
      {studio ? null : <primitive object={fog} attach="fog" />}
      <directionalLight
        ref={dirRef}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={40}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.00025}
      />
    </>
  );
}

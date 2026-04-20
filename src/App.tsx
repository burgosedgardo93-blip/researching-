import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Leva } from 'leva';
import UrbanErosionScene from './scene/UrbanErosionScene';
import GaeaLevaBridge from './gaea/GaeaLevaBridge';
import WeatherLevaBridge from './gaea/WeatherLevaBridge';
import {
  DEFAULT_GAEA_PARAMS,
  DEFAULT_ARCHITECTURE,
  type GaeaParams,
  type ArchitectureParams,
} from './gaea/gaeaParams';
import {
  DEFAULT_WEATHER,
  DEFAULT_RESOLVED_WEATHER,
  type WeatherParamsRef,
  type ResolvedWeatherRef,
} from './gaea/weatherParams';
import type { StudioProjectBridge } from './studio/relicProject';
import './App.css';

/**
 * Mirrors the currently-active default camera (set inside the scene by
 * `<PerspectiveCamera makeDefault />`) into the App-level ref so the
 * explicit ResizeObserver can drive `aspect` updates against the right
 * camera even after R3F swaps it.
 */
/** Visible placeholder so a suspended route never shows an empty WebGL rect on Vercel. */
function CanvasLoadingFallback() {
  return (
    <>
      <color attach="background" args={['#141416']} />
      <ambientLight intensity={0.4} />
      <PerspectiveCamera makeDefault position={[50, 50, 50]} near={0.1} far={2000} />
      <mesh>
        <boxGeometry args={[2, 2, 2]} />
        <meshBasicMaterial color="#5a5d66" wireframe />
      </mesh>
    </>
  );
}

function CaptureActiveCamera({
  cameraRef,
}: {
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
}) {
  const camera = useThree(s => s.camera);
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      cameraRef.current = camera;
    }
  }, [camera, cameraRef]);
  return null;
}

function App() {
  const gaeaRef = useRef<GaeaParams>({ ...DEFAULT_GAEA_PARAMS });
  const weatherRef = useRef({ ...DEFAULT_WEATHER }) as WeatherParamsRef;
  const weatherLevaSetterRef = useRef<null | ((patch: Record<string, unknown>) => void)>(null);
  const sandstormRequestRef = useRef(0);
  const resolvedWeatherRef = useRef({ ...DEFAULT_RESOLVED_WEATHER }) as ResolvedWeatherRef;
  const bakeEnvironmentRef = useRef<(() => void) | null>(null);
  const processErosionEnvironmentRef = useRef<(() => void) | null>(null);
  const studioBridgeRef = useRef<StudioProjectBridge | null>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  // Captured in `Canvas.onCreated` so the explicit ResizeObserver below can
  // drive a deterministic single-pass resize when the Leva drawer changes
  // width. Without these, R3F's internal observer can race with the layout
  // and briefly shift the rendered world.
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [studioNote, setStudioNote] = useState<string | null>(null);
  const [architecture, setArchitecture] = useState<ArchitectureParams>({
    ...DEFAULT_ARCHITECTURE,
  });

  const onArchitectureChange = useCallback((next: ArchitectureParams) => {
    setArchitecture(prev =>
      prev.gridSize === next.gridSize &&
      prev.baseHeight === next.baseHeight &&
      prev.seed === next.seed
        ? prev
        : next,
    );
  }, []);

  const onExportStudioProject = useCallback(() => {
    setStudioNote(null);
    studioBridgeRef.current?.exportUrbanRelicProject();
  }, []);

  const onLoadPickClick = useCallback(() => {
    setStudioNote(null);
    loadInputRef.current?.click();
  }, []);

  const onLoadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const err = studioBridgeRef.current?.loadUrbanRelicProjectJson(text);
      setStudioNote(err ?? 'Project loaded.');
      window.setTimeout(() => setStudioNote(null), 4500);
    };
    reader.onerror = () => {
      setStudioNote('Could not read file.');
      window.setTimeout(() => setStudioNote(null), 4500);
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  // Re-key TileMap whenever Architecture changes so all Float32Array buffers
  // and ref arrays inside the scene rebuild from scratch.
  const tileMapKey = `${architecture.gridSize}:${architecture.baseHeight}:${architecture.seed}`;

  // Explicit ResizeObserver on the canvas host. R3F already wires its own
  // observer (react-use-measure), but Leva opening/closing can introduce a
  // 1-frame layout flicker; pinning the resize to the host element with
  // `position: absolute; inset: 0` decouples the canvas from any reflow on
  // `.App`, and re-issuing `setSize` + `aspect` here guarantees the world
  // never disappears or shifts when the panel is toggled.
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const gl = rendererRef.current;
      const camera = cameraRef.current;
      if (gl) {
        gl.setSize(width, height, false);
      }
      if (camera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="App">
      {studioNote ? (
        <div className="studio-project-bar" aria-label="Studio project IO">
          <div className="studio-project-bar__note" role="status">
            {studioNote}
          </div>
        </div>
      ) : null}
      <input
        ref={loadInputRef}
        type="file"
        accept="application/json,.json"
        className="studio-project-bar__file"
        onChange={onLoadFile}
      />
      <Leva titleBar={{ title: 'Urban Erosion Studio', drag: true, filter: false }} />
      <GaeaLevaBridge
        gaeaRef={gaeaRef}
        bakeEnvironmentRef={bakeEnvironmentRef}
        processErosionEnvironmentRef={processErosionEnvironmentRef}
        onArchitectureChange={onArchitectureChange}
        onExportProject={onExportStudioProject}
        onLoadProject={onLoadPickClick}
      />
      <WeatherLevaBridge
        weatherRef={weatherRef}
        weatherLevaSetterRef={weatherLevaSetterRef}
        sandstormRequestRef={sandstormRequestRef}
      />
      <div ref={canvasHostRef} className="canvas-host">
        <Canvas
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            // ── Three r160+ compliance ──────────────────────────────────────
            // ColorManagement is enabled by default in modern three; we assert
            // it explicitly so any future host bundling can't silently disable
            // it. outputColorSpace must be SRGB so the linear working-space
            // pipeline tone-maps correctly into the sRGB framebuffer; all
            // physically-correct light intensities (post r155 useLegacyLights
            // removal) are calibrated against this.
            THREE.ColorManagement.enabled = true;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.0;
            gl.setClearColor(DEFAULT_RESOLVED_WEATHER.background, 1);
            rendererRef.current = gl;
          }}
          shadows
        >
          <CaptureActiveCamera cameraRef={cameraRef} />
          <Suspense fallback={<CanvasLoadingFallback />}>
            <UrbanErosionScene
              key={tileMapKey}
              gaeaRef={gaeaRef}
              weatherRef={weatherRef}
              weatherLevaSetterRef={weatherLevaSetterRef}
              sandstormRequestRef={sandstormRequestRef}
              resolvedWeatherRef={resolvedWeatherRef}
              bakeEnvironmentRef={bakeEnvironmentRef}
              processErosionEnvironmentRef={processErosionEnvironmentRef}
              studioBridgeRef={studioBridgeRef}
              architecture={architecture}
            />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

export default App;

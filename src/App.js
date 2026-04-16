import React from 'react';
import { Canvas } from '@react-three/fiber';
import Scene from './components/Scene';
import './App.css';

function App() {
  return (
    <div className="App">
      <Canvas
        camera={{ position: [10, 8, 10], fov: 55, near: 0.1, far: 100 }}
        gl={{ antialias: true, toneMapping: 3 }}
        shadows
      >
        <Scene />
      </Canvas>
      <div className="overlay">
        <h1>URBAN EROSION ENGINE</h1>
      </div>
    </div>
  );
}

export default App;

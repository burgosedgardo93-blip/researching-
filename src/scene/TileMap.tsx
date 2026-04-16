import React, { useMemo } from 'react';
import RelicBox from './RelicBox';

function seededRandom(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

const GRID = 10;
const STEP = 1.2;

export default function TileMap() {
  const boxes = useMemo(() => {
    const items: { key: string; position: [number, number, number]; height: number }[] = [];

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = (i - 4.5) * STEP;
        const z = (j - 4.5) * STEP;
        const h = 0.3 + seededRandom(i, j) * 2.2;
        items.push({
          key: `${i}-${j}`,
          position: [x, h / 2, z],
          height: h,
        });
      }
    }

    return items;
  }, []);

  return (
    <group>
      {boxes.map((b) => (
        <RelicBox key={b.key} position={b.position} height={b.height} />
      ))}
    </group>
  );
}

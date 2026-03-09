import type { PosEpoch } from './types';

/**
 * Generate mock position data simulating a kinematic GNSS survey.
 * Used as fallback in development mode when no real .pos file is available.
 */
export function generateMockPosData(epochCount: number = 1000): PosEpoch[] {
  const startTime = new Date('2024-01-15T00:00:00Z');
  const startLat = 35.6812; // Tokyo area
  const startLon = 139.7671;
  const epochs: PosEpoch[] = [];

  for (let i = 0; i < epochCount; i++) {
    const t = new Date(startTime.getTime() + i * 1000); // 1Hz
    const progress = i / epochCount;

    // Simulate a walk/drive path with small movements
    const lat = startLat + progress * 0.005 + Math.sin(i * 0.02) * 0.0002;
    const lon = startLon + progress * 0.008 + Math.cos(i * 0.015) * 0.0003;
    const height = 45.0 + Math.sin(i * 0.01) * 2.0;

    // Q flag distribution: mostly fix, some float, rare single
    let Q: number;
    if (i % 100 < 3) Q = 5; // 3% single
    else if (i % 50 < 5) Q = 2; // 10% float
    else Q = 1; // 87% fix

    epochs.push({
      time: t,
      timeUnix: t.getTime() / 1000,
      lat,
      lon,
      height,
      Q,
      ns: Q === 1 ? 15 + Math.floor(Math.random() * 5) : 8 + Math.floor(Math.random() * 4),
      sdn: Q === 1 ? 0.001 + Math.random() * 0.002 : 0.05 + Math.random() * 0.1,
      sde: Q === 1 ? 0.001 + Math.random() * 0.002 : 0.05 + Math.random() * 0.1,
      sdu: Q === 1 ? 0.002 + Math.random() * 0.004 : 0.1 + Math.random() * 0.2,
      age: 0.0,
      ratio: Q === 1 ? 5.0 + Math.random() * 50 : 1.0 + Math.random() * 2,
    });
  }
  return epochs;
}

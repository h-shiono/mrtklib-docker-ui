import type { PosEpoch, ReferencePosition, ENUEpoch } from './types';

// WGS84 constants
const WGS84_A = 6378137.0; // semi-major axis (m)
const WGS84_F = 1 / 298.257223563; // flattening
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F; // first eccentricity squared

const DEG2RAD = Math.PI / 180;

/**
 * Convert geodetic LLH to local ENU coordinates relative to a reference point.
 * Uses the curvature-based formula accurate for local GNSS survey areas.
 */
export function llhToEnu(
  lat: number,
  lon: number,
  h: number,
  ref: ReferencePosition,
): { e: number; n: number; u: number } {
  const refLatRad = ref.lat * DEG2RAD;
  const sinRefLat = Math.sin(refLatRad);

  // Radius of curvature in prime vertical
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinRefLat * sinRefLat);
  // Radius of curvature in meridian
  const M =
    (WGS84_A * (1 - WGS84_E2)) /
    Math.pow(1 - WGS84_E2 * sinRefLat * sinRefLat, 1.5);

  const dLat = (lat - ref.lat) * DEG2RAD;
  const dLon = (lon - ref.lon) * DEG2RAD;

  return {
    e: dLon * (N + ref.height) * Math.cos(refLatRad),
    n: dLat * (M + ref.height),
    u: h - ref.height,
  };
}

/**
 * Convert ECEF XYZ to geodetic LLH (WGS84).
 * Uses Bowring's iterative method.
 */
export function xyzToLlh(x: number, y: number, z: number): ReferencePosition {
  const lon = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);

  // Initial estimate
  let lat = Math.atan2(z, p * (1 - WGS84_E2));

  for (let i = 0; i < 10; i++) {
    const sinLat = Math.sin(lat);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(z + WGS84_E2 * N * sinLat, p);
  }

  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const height = p / Math.cos(lat) - N;

  return {
    lat: lat / DEG2RAD,
    lon: lon / DEG2RAD,
    height,
  };
}

/** Compute the mean of an array of numbers */
function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Compute the median of an array of numbers */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Compute a reference position from epochs using mean */
export function computeMeanReference(epochs: PosEpoch[]): ReferencePosition {
  return {
    lat: mean(epochs.map((e) => e.lat)),
    lon: mean(epochs.map((e) => e.lon)),
    height: mean(epochs.map((e) => e.height)),
  };
}

/** Compute a reference position from epochs using median */
export function computeMedianReference(epochs: PosEpoch[]): ReferencePosition {
  return {
    lat: median(epochs.map((e) => e.lat)),
    lon: median(epochs.map((e) => e.lon)),
    height: median(epochs.map((e) => e.height)),
  };
}

/** Convert PosEpoch[] to ENUEpoch[] given a reference position */
export function convertToENU(
  epochs: PosEpoch[],
  ref: ReferencePosition,
): ENUEpoch[] {
  return epochs.map((epoch) => {
    const { e, n, u } = llhToEnu(epoch.lat, epoch.lon, epoch.height, ref);
    return {
      time: epoch.time,
      timeUnix: epoch.timeUnix,
      e,
      n,
      u,
      Q: epoch.Q,
      ns: epoch.ns,
      ratio: epoch.ratio,
    };
  });
}

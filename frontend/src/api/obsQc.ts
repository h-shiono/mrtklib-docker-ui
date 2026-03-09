/**
 * API client for observation data QC endpoints
 */

const API_BASE = '/api/obs-qc';

export interface ObsHeaderInfo {
  rinex_version: string;
  receiver: string;
  antenna: string;
  approx_position: number[];
  interval: number;
  start_time: string;
  end_time: string;
  num_epochs: number;
  num_satellites: number;
}

export interface SatVisSegment {
  sat_id: string;
  constellation: string;
  start: number; // Unix timestamp
  end: number;
}

export interface ObsQcResponse {
  header: ObsHeaderInfo;
  visibility: SatVisSegment[];
  snr: number[][]; // [[time, sat_idx, snr, el, az], ...]
  satellites: string[];
  signals: string[];
  decimation_factor: number;
  has_elevation: boolean;
}

export interface ObsQcRequest {
  obs_file: string;
  nav_file?: string;
  signal?: string;
  decimation?: number;
}

export async function analyzeObs(request: ObsQcRequest): Promise<ObsQcResponse> {
  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    const message =
      typeof error.detail === 'string'
        ? error.detail
        : Array.isArray(error.detail)
          ? error.detail.map((e: { msg?: string }) => e.msg || String(e)).join('; ')
          : 'Analysis failed';
    throw new Error(message);
  }
  return response.json();
}

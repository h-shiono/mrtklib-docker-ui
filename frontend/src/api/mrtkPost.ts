/**
 * API client for mrtk post endpoints
 */

import type { MrtkPostConfig, MrtkPostInputFiles, MrtkPostTimeRange } from '../types/mrtkPostConfig';

const API_BASE = '/api/mrtk-post';

export interface MrtkPostJobResponse {
  job_id: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  return_code?: number;
  error_message?: string;
  output_file?: string;
}

export interface MrtkPostExecuteRequest {
  input_files: MrtkPostInputFiles;
  config: MrtkPostConfig;
  time_range?: MrtkPostTimeRange;
  job_id?: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    // FastAPI validation errors return detail as an array of objects
    let message = 'API request failed';
    if (typeof error.detail === 'string') {
      message = error.detail;
    } else if (Array.isArray(error.detail)) {
      message = error.detail
        .map((e: { msg?: string; loc?: string[] }) =>
          e.loc ? `${e.loc.join('.')}: ${e.msg}` : e.msg || String(e)
        )
        .join('; ');
    }
    throw new Error(message);
  }
  return response.json();
}

/**
 * Execute mrtk post post-processing
 */
export async function executeMrtkPost(request: MrtkPostExecuteRequest): Promise<MrtkPostJobResponse> {
  const response = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse<MrtkPostJobResponse>(response);
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<MrtkPostJobResponse> {
  const response = await fetch(`${API_BASE}/status/${jobId}`);
  return handleResponse<MrtkPostJobResponse>(response);
}

/**
 * List all active jobs
 */
export async function listJobs(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/jobs`);
  return handleResponse<string[]>(response);
}

/**
 * Export configuration as .conf file download
 */
export async function exportConf(config: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${API_BASE}/export-conf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to export conf');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rnx2rtkp.toml';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * API client for str2str endpoints
 */

const API_BASE = '/api/str2str';

export interface ProcessStatus {
  id: string;
  command: string;
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  pid: number | null;
  return_code: number | null;
  started_at: string | null;
  stopped_at: string | null;
  error_message: string | null;
}

export interface StartRequest {
  args?: string[];
  process_id?: string;
}

export interface StopRequest {
  process_id: string;
  timeout?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || 'API request failed');
  }
  return response.json();
}

/**
 * Start str2str process
 */
export async function startStr2Str(request: StartRequest = {}): Promise<ProcessStatus> {
  const response = await fetch(`${API_BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse<ProcessStatus>(response);
}

/**
 * Stop str2str process
 */
export async function stopStr2Str(request: StopRequest): Promise<ProcessStatus> {
  const response = await fetch(`${API_BASE}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse<ProcessStatus>(response);
}

/**
 * Get process status
 */
export async function getStr2StrStatus(processId: string): Promise<ProcessStatus> {
  const response = await fetch(`${API_BASE}/status/${processId}`);
  return handleResponse<ProcessStatus>(response);
}

/**
 * List all processes
 */
export async function listProcesses(): Promise<ProcessStatus[]> {
  const response = await fetch(`${API_BASE}/processes`);
  return handleResponse<ProcessStatus[]>(response);
}

/**
 * Run test (str2str with no args)
 */
export async function testStr2Str(): Promise<ProcessStatus> {
  const response = await fetch(`${API_BASE}/test`, { method: 'POST' });
  return handleResponse<ProcessStatus>(response);
}

/**
 * API client for the CLAS pipeline (mrtk relay + mrtk cssr2rtcm3).
 */

const API_BASE = '/api/clas-pipeline';

export interface ReceiverPreset {
  id: string;
  vendor: string;
  model: string;
  label: string;
  relay_input_format: string;
  default_input_baud: number;
  notes: string;
}

export interface SerialPort {
  path: string;
  label: string;
}

export interface PipelineStatus {
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  relay_state: string;
  cssr_state: string;
  started_at: string | null;
  error_message: string | null;
  bridge_port: number | null;
  /** Further relay outputs, as written (a file output may be numbered). */
  outputs?: string[];
}

export interface PipelineStartRequest {
  receiver_id: string;
  input_device: string;
  input_baud: number;
  bridge_port?: number;
  /** Further relay outputs after the bridge, as mrtk relay stream arguments. */
  outputs?: string[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API request failed');
  }
  return res.json();
}

export async function listReceivers(): Promise<ReceiverPreset[]> {
  return handle(await fetch(`${API_BASE}/receivers`));
}

export async function listSerialPorts(): Promise<SerialPort[]> {
  return handle(await fetch(`${API_BASE}/serial-ports`));
}

export async function startPipeline(req: PipelineStartRequest): Promise<PipelineStatus> {
  return handle(
    await fetch(`${API_BASE}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
}

export async function stopPipeline(): Promise<PipelineStatus> {
  return handle(await fetch(`${API_BASE}/stop`, { method: 'POST' }));
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  return handle(await fetch(`${API_BASE}/status`));
}

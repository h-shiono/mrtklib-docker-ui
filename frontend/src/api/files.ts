/**
 * API client for file browser endpoints
 */

const API_BASE = '/api/files';

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
}

export interface DirectoryListing {
  path: string;
  items: FileInfo[];
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || 'API request failed');
  }
  return response.json();
}

/**
 * Browse directory contents in /workspace
 */
export async function browseDirectory(path: string = '/'): Promise<DirectoryListing> {
  const response = await fetch(`${API_BASE}/browse?path=${encodeURIComponent(path)}`);
  return handleResponse<DirectoryListing>(response);
}

export interface FileReadResponse {
  path: string;
  content: string;
  total_lines: number;
  returned_lines: number;
  truncated: boolean;
  file_size: number;
}

/**
 * Read text contents of a file in /workspace
 */
export async function readFile(
  path: string,
  maxLines: number = 5000,
): Promise<FileReadResponse> {
  const params = new URLSearchParams({
    path,
    max_lines: String(maxLines),
  });
  const response = await fetch(`${API_BASE}/read?${params}`);
  return handleResponse<FileReadResponse>(response);
}

/**
 * Stream configuration types for str2str
 */

export type StreamType = 'serial' | 'tcpcli' | 'tcpsvr' | 'ntripcli' | 'file';

export interface SerialParams {
  port: string;
  baudrate: number;
  bytesize?: 8 | 7;
  parity?: 'N' | 'E' | 'O';
  stopbits?: 1 | 2;
}

export interface TcpClientParams {
  host: string;
  port: number;
}

export interface TcpServerParams {
  port: number;
}

export interface NtripClientParams {
  host: string;
  port: number;
  mountpoint: string;
  username?: string;
  password?: string;
}

export interface FileParams {
  path: string;
  swapInterval?: number; // Swap interval in hours (0.25, 0.5, 1, 2, 3, 6, 12, 24)
  timetag?: boolean; // Timetag on/off
}

export type StreamParams =
  | SerialParams
  | TcpClientParams
  | TcpServerParams
  | NtripClientParams
  | FileParams;

export interface StreamConfig {
  id: string;
  type: StreamType;
  params: StreamParams;
}

export interface InputStream extends StreamConfig {
  // Input stream specific fields if any
}

export interface OutputStream extends StreamConfig {
  // Output stream specific fields if any
}

export interface BuilderConfig {
  input: InputStream;
  outputs: OutputStream[];
}

export interface ProfileConfig {
  name?: string;
  description?: string;
  builder: BuilderConfig;
  raw: string;
  mode: 'builder' | 'raw';
}

/**
 * RTKLIB file naming convention keywords
 */
export interface FileNamingKeyword {
  keyword: string;
  description: string;
  example: string;
}

export const FILE_NAMING_KEYWORDS: FileNamingKeyword[] = [
  { keyword: '%Y', description: 'Year (yyyy)', example: '2026' },
  { keyword: '%y', description: 'Year (yy)', example: '26' },
  { keyword: '%m', description: 'Month (mm)', example: '01-12' },
  { keyword: '%d', description: 'Day of Month (dd)', example: '01-31' },
  { keyword: '%n', description: 'Day of Year (ddd)', example: '001-366' },
  { keyword: '%W', description: 'GPS Week No (wwww)', example: '2345' },
  { keyword: '%D', description: 'Day of Week (0-6)', example: '0-6' },
  { keyword: '%h', description: 'Hour (00-23)', example: '00-23' },
  { keyword: '%M', description: 'Minute (00-59)', example: '00-59' },
  { keyword: '%S', description: 'Second (00-59)', example: '00-59' },
  { keyword: '%H', description: 'Hour Code (a, b, ..., x)', example: 'a-x' },
  { keyword: '%ha', description: '3H Hour (00, 03, ..., 21)', example: '00, 03, 06...' },
  { keyword: '%hb', description: '6H Hour (00, 06, 12, 18)', example: '00, 06, 12, 18' },
  { keyword: '%hc', description: '12H Hour (00, 12)', example: '00, 12' },
];

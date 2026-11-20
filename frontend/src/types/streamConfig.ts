/**
 * Stream configuration types for str2str / mrtk relay
 */

/** `browser`: an input only, a serial port the page opens with Web Serial;
 *  its path is the baud rate (#136). */
export type StreamType = 'serial' | 'tcpcli' | 'tcpsvr' | 'ntripcli' | 'file' | 'browser';

export interface StreamConfig {
  id: string;
  type: StreamType;
  path: string;
}

export type InputStream = StreamConfig;

export type OutputStream = StreamConfig;

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

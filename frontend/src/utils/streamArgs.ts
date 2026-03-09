import type {
  BuilderConfig,
  StreamConfig,
  SerialParams,
  TcpClientParams,
  TcpServerParams,
  NtripClientParams,
  FileParams,
} from '../types/streamConfig';

/**
 * Generate str2str argument string from a stream configuration
 */
function generateStreamArg(stream: StreamConfig): string {
  switch (stream.type) {
    case 'serial': {
      const params = stream.params as SerialParams;
      let arg = `serial://${params.port}:${params.baudrate}`;
      if (params.bytesize) arg += `:${params.bytesize}`;
      if (params.parity) arg += `:${params.parity}`;
      if (params.stopbits) arg += `:${params.stopbits}`;
      return arg;
    }
    case 'tcpcli': {
      const params = stream.params as TcpClientParams;
      return `tcpcli://${params.host}:${params.port}`;
    }
    case 'tcpsvr': {
      const params = stream.params as TcpServerParams;
      return `tcpsvr://:${params.port}`;
    }
    case 'ntripcli': {
      const params = stream.params as NtripClientParams;
      const auth =
        params.username && params.password
          ? `${params.username}:${params.password}@`
          : '';
      return `ntrip://${auth}${params.host}:${params.port}/${params.mountpoint}`;
    }
    case 'file': {
      const params = stream.params as FileParams;
      let arg = `file://${params.path}`;

      // Add swap interval option if specified
      if (params.swapInterval !== undefined) {
        arg += `::S=${params.swapInterval}`;
      }

      // Add timetag option if specified
      if (params.timetag === true) {
        arg += `::T=on`;
      } else if (params.timetag === false) {
        arg += `::T=off`;
      }

      return arg;
    }
    default:
      return '';
  }
}

/**
 * Generate full str2str arguments array from builder configuration
 */
export function generateStr2StrArgs(config: BuilderConfig): string[] {
  const args: string[] = [];

  // Input stream
  if (config.input) {
    args.push('-in');
    args.push(generateStreamArg(config.input));
  }

  // Output streams
  config.outputs.forEach((output) => {
    args.push('-out');
    args.push(generateStreamArg(output));
  });

  return args;
}

/**
 * Generate command string for display
 */
export function generateCommandString(config: BuilderConfig): string {
  const args = generateStr2StrArgs(config);
  return `str2str ${args.join(' ')}`;
}

/**
 * Parse command string to builder config (best effort)
 */
export function parseCommandString(commandStr: string): Partial<BuilderConfig> | null {
  try {
    // Remove 'str2str' prefix if present
    const cleaned = commandStr.trim().replace(/^str2str\s+/, '');
    const args = cleaned.split(/\s+/);

    const config: Partial<BuilderConfig> = {
      outputs: [],
    };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-in' && i + 1 < args.length) {
        const streamConfig = parseStreamArg(args[i + 1]);
        if (streamConfig) {
          config.input = streamConfig as any;
        }
        i++;
      } else if (args[i] === '-out' && i + 1 < args.length) {
        const streamConfig = parseStreamArg(args[i + 1]);
        if (streamConfig && config.outputs) {
          config.outputs.push(streamConfig as any);
        }
        i++;
      }
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Parse a single stream argument (e.g., "serial://ttyUSB0:115200")
 */
function parseStreamArg(arg: string): StreamConfig | null {
  try {
    const url = new URL(arg);
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    switch (url.protocol.replace(':', '')) {
      case 'serial': {
        const parts = url.pathname.substring(1).split(':');
        return {
          id,
          type: 'serial',
          params: {
            port: parts[0] || '/dev/ttyUSB0',
            baudrate: parseInt(parts[1]) || 115200,
            bytesize: parts[2] ? (parseInt(parts[2]) as 8 | 7) : 8,
            parity: (parts[3] as 'N' | 'E' | 'O') || 'N',
            stopbits: parts[4] ? (parseInt(parts[4]) as 1 | 2) : 1,
          },
        };
      }
      case 'tcpcli': {
        return {
          id,
          type: 'tcpcli',
          params: {
            host: url.hostname,
            port: parseInt(url.port) || 2101,
          },
        };
      }
      case 'tcpsvr': {
        return {
          id,
          type: 'tcpsvr',
          params: {
            port: parseInt(url.port) || 2101,
          },
        };
      }
      case 'ntrip': {
        const mountpoint = url.pathname.substring(1);
        return {
          id,
          type: 'ntripcli',
          params: {
            host: url.hostname,
            port: parseInt(url.port) || 2101,
            mountpoint,
            username: url.username || undefined,
            password: url.password || undefined,
          },
        };
      }
      case 'file': {
        return {
          id,
          type: 'file',
          params: {
            path: url.pathname,
          },
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

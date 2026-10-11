import type {
  BuilderConfig,
  StreamConfig,
} from '../types/streamConfig';

/**
 * Map internal type names to RTKLIB protocol prefixes
 */
const TYPE_TO_PROTO: Record<string, string> = {
  serial: 'serial',
  tcpcli: 'tcpcli',
  tcpsvr: 'tcpsvr',
  ntripcli: 'ntrip',
  file: 'file',
};

/**
 * Generate relay argument string from a stream configuration
 */
function generateStreamArg(stream: StreamConfig): string {
  const proto = TYPE_TO_PROTO[stream.type] || stream.type;
  return `${proto}://${stream.path}`;
}

/**
 * Generate full mrtk relay arguments array from builder configuration
 */
export function generateRelayArgs(config: BuilderConfig): string[] {
  const args: string[] = [];

  if (config.input) {
    args.push('-in');
    args.push(generateStreamArg(config.input));
  }

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
  const args = generateRelayArgs(config);
  return `mrtk relay ${args.join(' ')}`;
}

/**
 * Parse command string to builder config (best effort)
 */
export function parseCommandString(commandStr: string): Partial<BuilderConfig> | null {
  try {
    const cleaned = commandStr.trim().replace(/^(?:mrtk\s+relay|str2str)\s+/, '');
    return parseRelayArgs(cleaned.split(/\s+/));
  } catch {
    return null;
  }
}

/**
 * Parse an mrtk relay arguments array back to builder config (best effort)
 */
export function parseRelayArgs(args: string[]): Partial<BuilderConfig> {
  const config: Partial<BuilderConfig> = {
    outputs: [],
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-in' && i + 1 < args.length) {
      const streamConfig = parseStreamArg(args[i + 1]);
      if (streamConfig) config.input = streamConfig;
      i++;
    } else if (args[i] === '-out' && i + 1 < args.length) {
      const streamConfig = parseStreamArg(args[i + 1]);
      if (streamConfig && config.outputs) config.outputs.push(streamConfig);
      i++;
    }
  }

  return config;
}

/**
 * Reverse map: protocol prefix → internal type
 */
const PROTO_TO_TYPE: Record<string, string> = {
  serial: 'serial',
  tcpcli: 'tcpcli',
  tcpsvr: 'tcpsvr',
  ntrip: 'ntripcli',
  ntrips: 'ntripcli',
  ntripc: 'ntripcli',
  file: 'file',
};

/**
 * Parse a single stream argument (e.g., "ntrip://user:pass@host:port/mount")
 */
function parseStreamArg(arg: string): StreamConfig | null {
  try {
    const match = arg.match(/^(\w+):\/\/(.*)$/);
    if (!match) return null;
    const [, proto, path] = match;
    const type = PROTO_TO_TYPE[proto];
    if (!type) return null;
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return { id, type: type as StreamConfig['type'], path };
  } catch {
    return null;
  }
}

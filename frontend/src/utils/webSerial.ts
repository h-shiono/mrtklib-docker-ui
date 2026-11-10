/**
 * Web Serial input for the Stream Monitor (#136): the page opens a serial
 * port on the user's computer and sends what it reads to the backend's
 * ingest WebSocket. A receiver plugged into the machine running the browser
 * then needs no Docker USB access (usbipd on Windows, nothing works on macOS).
 *
 * Chrome and Edge only, and only in a secure context (localhost or https).
 * The tab owns the port: closing it ends the session.
 */

/** The parts of the Web Serial API used here (not in TypeScript's DOM lib). */
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface WebSerialPort {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
}

interface WebSerial {
  requestPort(): Promise<WebSerialPort>;
}

function serialApi(): WebSerial | null {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return null;
  return (navigator as unknown as { serial: WebSerial }).serial;
}

/** Whether this browser and page can open a serial port. */
export function webSerialAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && serialApi() !== null;
}

export const BAUD_RATES = ['9600', '38400', '57600', '115200', '230400', '460800', '921600'];
export const DEFAULT_BAUD = '115200';

/** The port's read buffer, and the largest message sent to the backend
 *  (MAX_INGEST_FRAME there). */
const BUFFER_SIZE = 65536;
/** Bytes are sent in batches, at most this often. */
const FLUSH_MS = 50;
/** The socket is not draining (server or network stalled): give up. */
const MAX_BUFFERED = 4 * 1024 * 1024;

const VENDORS: Record<number, string> = { 0x1546: 'u-blox' };

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** "u-blox 1546:01A9, 115200 baud": a name for the port in the status and
 *  logs. No "@": "a:b@" reads as credentials and would be masked. */
export function serialPortLabel(info: SerialPortInfo, baud: string): string {
  if (info.usbVendorId === undefined) return `serial port, ${baud} baud`;
  const ids = `${hex4(info.usbVendorId)}:${hex4(info.usbProductId ?? 0)}`;
  return `${VENDORS[info.usbVendorId] ?? 'USB'} ${ids}, ${baud} baud`;
}

/** The user closed the port picker without choosing: not an error. */
export function isPickerCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError';
}

export class BrowserSerialSession {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private ws: WebSocket | null = null;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly port: WebSerialPort;
  readonly label: string;
  /** Called once when the session ends; `reason` is set for a failure. */
  private readonly onEnd: (reason: string | null) => void;

  private constructor(port: WebSerialPort, label: string, onEnd: (reason: string | null) => void) {
    this.port = port;
    this.label = label;
    this.onEnd = onEnd;
  }

  /** Ask for a port and open it. Call first in a click handler: the
   *  browser shows the picker only right after a user action. */
  static async open(baud: string, onEnd: (reason: string | null) => void): Promise<BrowserSerialSession> {
    const api = serialApi();
    if (!api) throw new Error('This browser cannot open serial ports (use Chrome or Edge on localhost or https)');
    const port = await api.requestPort();
    await port.open({ baudRate: Number(baud), bufferSize: BUFFER_SIZE });
    return new BrowserSerialSession(port, serialPortLabel(port.getInfo(), baud), onEnd);
  }

  /** Start sending to the backend session's ingest socket. */
  attach(url: string): void {
    if (this.closed) return;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => void this.pump();
    // Receiver commands from the server: {"type": "write", "data": base64}.
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data) as { type?: string; data?: string };
        if (msg.type === 'write' && typeof msg.data === 'string') {
          void this.write(Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)));
        }
      } catch {
        // not for us
      }
    };
    // The server ends the session (Stop on any page) by closing the socket;
    // a refusal carries its reason.
    ws.onclose = (event) => void this.close(event.code === 1000 || event.code === 1005 ? null : event.reason || 'Connection to the server lost');
  }

  private async pump(): Promise<void> {
    let failure: string | null = null;
    try {
      const readable = this.port.readable;
      if (!readable) throw new Error('The serial port cannot be read');
      this.reader = readable.getReader();
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) this.queue(value);
      }
    } catch (err) {
      // Unplugged, or a read error. A read cancelled by close() lands here too.
      if (!this.closed) failure = `Serial port: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.flush();
    await this.close(failure);
  }

  /** Writes run one after another, each holding the port's writer. */
  private writing: Promise<void> = Promise.resolve();

  private write(data: Uint8Array): Promise<void> {
    this.writing = this.writing.then(async () => {
      const writable = this.port.writable;
      if (this.closed || !writable) return;
      const writer = writable.getWriter();
      try {
        await writer.write(data);
      } catch (err) {
        void this.close(`Serial port: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        writer.releaseLock();
      }
    });
    return this.writing;
  }

  private queue(chunk: Uint8Array): void {
    if (this.pendingBytes + chunk.length > BUFFER_SIZE) this.flush();
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    if (this.pendingBytes === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(this.pendingBytes);
    let offset = 0;
    for (const chunk of this.pending) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.pending = [];
    this.pendingBytes = 0;
    if (ws.bufferedAmount > MAX_BUFFERED) {
      void this.close('The server is not keeping up with the serial port');
      return;
    }
    ws.send(out);
  }

  /** Close the port and the socket; ends the backend session. */
  async close(reason: string | null = null): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.reader?.cancel();
    } catch {
      // already errored
    }
    this.reader?.releaseLock();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
    try {
      await this.port.close();
    } catch {
      // already closed or unplugged
    }
    this.onEnd(reason);
  }
}

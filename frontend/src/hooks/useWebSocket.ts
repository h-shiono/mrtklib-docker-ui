import { useCallback, useEffect, useRef, useState } from 'react';

export interface LogMessage {
  type: 'log' | 'status' | 'connected' | 'ack' | 'progress' | 'clas_pvt' | 'clas_flow';
  process_id?: string;
  message?: string;
  status?: string;
  timestamp: string;
  // Progress fields (type === 'progress')
  epoch?: string;
  quality?: number;
  ns?: number | null;
  ratio?: number | null;
  // CLAS pipeline PVT fix (type === 'clas_pvt')
  time_gpst?: string;
  lat?: number;
  lon?: number;
  hgt?: number;
  age?: number;
  // CLAS pipeline flow stats (type === 'clas_flow')
  bytes_total?: number;
  blocks_total?: number;
  bytes_per_sec?: number;
  msg_per_sec?: number;
  last_block_at?: string | null;
  last_pvt_at?: string | null;
}

export interface UseWebSocketOptions {
  url?: string;
  onMessage?: (message: LogMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  sendMessage: (data: string) => void;
}

// Detach handlers before an intentional close: onclose fires asynchronously,
// after unmount cleanup has run, and would otherwise schedule a reconnect
// that opens a socket nobody owns.
function closeQuietly(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
  ws.close();
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/logs`,
    onMessage,
    onConnect,
    onDisconnect,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendMessage = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection and any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      closeQuietly(wsRef.current);
      wsRef.current = null;
      setIsConnected(false);
    }

    // In development, use Vite proxy
    const wsUrl = import.meta.env.DEV
      ? `ws://${window.location.hostname}:8000/ws/logs`
      : url;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as LogMessage;
        onMessage?.(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      onDisconnect?.();

      // Attempt to reconnect
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [url, onMessage, onConnect, onDisconnect, reconnectInterval, maxReconnectAttempts]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        closeQuietly(wsRef.current);
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected,
    sendMessage,
  };
}

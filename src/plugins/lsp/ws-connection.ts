import type { LSPConnectionOptions } from './index';

export interface LSPConnection {
  send(message: string): void;
  close(): void;
}

export function createWebSocketConnection(
  options: LSPConnectionOptions,
): Promise<LSPConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(options.serverUrl);

    ws.onopen = () => {
      console.log(`[LSP] Connected to ${options.serverUrl}`);

      // Send initialize request
      const initMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          processId: null,
          capabilities: {},
          rootUri: null,
        },
      });
      ws.send(initMsg);

      resolve({
        send: (msg: string) => ws.send(msg),
        close: () => ws.close(),
      });
    };

    ws.onerror = (err) => {
      console.warn(`[LSP] WebSocket error:`, err);
      reject(err);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        console.log('[LSP] Received:', msg);
      } catch {
        // non-JSON messages are ignored
      }
    };

    ws.onclose = () => {
      console.log(`[LSP] Disconnected from ${options.serverUrl}`);
    };
  });
}

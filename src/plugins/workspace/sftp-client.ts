// ---------------------------------------------------------------------------
// SFTP WebSocket Bridge Client
//
// Connects to a WebSocket server that proxies SFTP operations.
// The server must implement the following JSON protocol:
//
//   → { action: "connect", host, port, username, password|privateKey }
//   ← { action: "connected" }
//
//   → { action: "list", path }
//   ← { action: "list", path, entries: [{ name, type: "file"|"dir", size }] }
//
//   → { action: "read", path }
//   ← { action: "read", path, content (base64) }
//
//   → { action: "write", path, content (base64) }
//   ← { action: "write", path, ok: true }
//
//   → { action: "mkdir", path }
//   ← { action: "mkdir", path, ok: true }
//
//   → { action: "delete", path }
//   ← { action: "delete", path, ok: true }
//
// A minimal reference server (Node.js + ssh2) is in README / docs.
// ---------------------------------------------------------------------------

export interface SFTPConnectOptions {
  /** WebSocket URL of the SFTP bridge server, e.g. "ws://localhost:3100" */
  bridgeUrl: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export interface SFTPEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
}

export class SFTPClient {
  private ws: WebSocket | null = null;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private idCounter = 0;
  private connected = false;

  async connect(opts: SFTPConnectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(opts.bridgeUrl);

      this.ws.onopen = () => {
        this.send({
          action: 'connect',
          host: opts.host,
          port: opts.port ?? 22,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey,
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          // Handle connect response
          if (msg.action === 'connected') {
            this.connected = true;
            resolve();
            return;
          }

          // Handle error
          if (msg.error) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              pending.reject(new Error(msg.error));
              this.pending.delete(msg.id);
            }
            return;
          }

          // Handle response with id
          if (msg.id != null) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              pending.resolve(msg);
              this.pending.delete(msg.id);
            }
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      this.ws.onerror = () => {
        reject(new Error(`Failed to connect to SFTP bridge at ${opts.bridgeUrl}`));
      };

      this.ws.onclose = () => {
        this.connected = false;
      };
    });
  }

  async list(remotePath: string): Promise<SFTPEntry[]> {
    const resp = await this.request({ action: 'list', path: remotePath });
    return resp.entries as SFTPEntry[];
  }

  async readFile(remotePath: string): Promise<Uint8Array> {
    const resp = await this.request({ action: 'read', path: remotePath });
    return base64ToBytes(resp.content as string);
  }

  async writeFile(remotePath: string, content: Uint8Array): Promise<void> {
    await this.request({
      action: 'write',
      path: remotePath,
      content: bytesToBase64(content),
    });
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.request({ action: 'mkdir', path: remotePath });
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.request({ action: 'delete', path: remotePath });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // -----------------------------------------------------------------------

  private send(data: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(data));
  }

  private request(data: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = String(++this.idCounter);
      this.pending.set(id, { resolve, reject });
      this.send({ ...data, id });

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`SFTP request timed out: ${data.action}`));
        }
      }, 30_000);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Terminal backend — pipes the integrated terminal to a remote pty over
// Socket.IO (same transport as the SFTP module).
//
// Behaviour:
//   - A new terminal reuses the active SFTP/SSH credentials (see sftp-session).
//   - Each terminal owns its own Socket.IO connection and stays connected while
//     hidden — toggling the panel never reconnects or kills the session.
//   - Scrollback is persisted to IndexedDB so sessions can be restored after a
//     reload. Records are deleted only when the user explicitly closes a
//     terminal (not on reload / window unload).
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { io, type Socket } from 'socket.io-client';
import {
  SimpleTerminalBackend,
  SimpleTerminalProcess,
  type ITerminalChildProcess,
} from '@codingame/monaco-vscode-terminal-service-override';
import { API_CONFIG } from './config';
import { getSftpCredentials, getSessionId } from './sftp-session';
import {
  saveSession,
  deleteSession,
  type TerminalSessionRecord,
} from './terminal-history';

// Rename these to match your backend's terminal socket contract.
const TERMINAL_EVENTS = {
  START: '@@TERMINAL_START',   // client → server: begin/attach a pty
  INPUT: '@@TERMINAL_INPUT',   // client → server: keystrokes (string)
  DATA: '@@TERMINAL_DATA',     // server → client: pty output (string)
  RESIZE: '@@TERMINAL_RESIZE', // client → server: { cols, rows }
  EXIT: '@@TERMINAL_EXIT',     // server → client: number | { exitCode }
} as const;

const MAX_SCROLLBACK = 256 * 1024; // cap persisted buffer size

// Terminals disposed during a reload/unload must keep their history for
// restore; only an explicit user close should delete it.
let pageUnloading = false;
window.addEventListener('beforeunload', () => { pageUnloading = true; });
window.addEventListener('pagehide', () => { pageUnloading = true; });

// Records queued (at boot) to hydrate the next created terminals with history.
const restoreQueue: TerminalSessionRecord[] = [];

/** Queue persisted sessions so the next created terminals replay their history. */
export function queueTerminalRestore(records: TerminalSessionRecord[]): void {
  restoreQueue.push(...records);
}

let nextProcessId = 1;

class SocketTerminalProcess extends SimpleTerminalProcess {
  private readonly _data: vscode.EventEmitter<string>;
  private readonly _exit = new vscode.EventEmitter<number>();
  private readonly socket: Socket;
  private readonly persistentId: string;
  private readonly title: string;
  private cols: number;
  private rows: number;
  private buffer: string;
  private restoreBuffer: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    id: number,
    persistentId: string,
    cwd: string,
    cols: number,
    rows: number,
    data: vscode.EventEmitter<string>,
    restore?: TerminalSessionRecord,
  ) {
    super(id, id, cwd, data.event as never);
    this._data = data;
    this.persistentId = persistentId;
    this.cols = cols;
    this.rows = rows;
    this.title = restore?.title ?? `Terminal ${id}`;
    this.buffer = restore?.buffer ?? '';
    this.restoreBuffer = restore?.buffer ?? '';
    this.shouldPersist = true; // keep the session across hide/show
    this.onProcessExit = this._exit.event as never;

    this.socket = io(`${API_CONFIG.baseUrl}${API_CONFIG.terminalNamespace}`, {
      query: {
        sessionId: getSessionId(),
        terminalSessionId: persistentId,
      },
    });

    this.socket.on(TERMINAL_EVENTS.DATA, (chunk: unknown) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      this._data.fire(text);
      this.append(text);
    });

    this.socket.on(TERMINAL_EVENTS.EXIT, (payload: unknown) => {
      const code =
        typeof payload === 'number'
          ? payload
          : (payload as { exitCode?: number } | null)?.exitCode ?? 0;
      this._exit.fire(code);
    });
  }

  private append(text: string): void {
    this.buffer += text;
    if (this.buffer.length > MAX_SCROLLBACK) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_SCROLLBACK);
    }
    this.schedulePersist();
  }

  private record(): TerminalSessionRecord {
    return {
      id: this.persistentId,
      title: this.title,
      cwd: this.cwd,
      buffer: this.buffer,
      updatedAt: Date.now(),
    };
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void saveSession(this.record());
    }, 500);
  }

  async start(): Promise<undefined> {
    // Replay stored scrollback first so restored history renders immediately.
    if (this.restoreBuffer) {
      this._data.fire(this.restoreBuffer);
      this.restoreBuffer = '';
    }

    const creds = getSftpCredentials();
    this.socket.emit(TERMINAL_EVENTS.START, {
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      sessionId: getSessionId(),
      terminalSessionId: this.persistentId,
      // Reuse the existing SFTP/SSH session; backend falls back to sessionId.
      creds: creds ?? undefined,
      restore: this.buffer.length > 0,
    });

    void saveSession(this.record());
    return undefined;
  }

  input(data: string): void {
    this.socket.emit(TERMINAL_EVENTS.INPUT, data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.socket.emit(TERMINAL_EVENTS.RESIZE, { cols, rows });
  }

  shutdown(_immediate: boolean): void {
    this.socket.disconnect();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (pageUnloading) {
      // Reload/unload — keep history so the session can be restored.
      void saveSession(this.record());
    } else {
      // Explicit user close — forget the session.
      void deleteSession(this.persistentId);
    }
    this._data.dispose();
    this._exit.dispose();
  }

  sendSignal(_signal: string): void {
    // No dedicated signal channel — signals arrive as input (e.g. Ctrl-C).
  }

  clearBuffer(): void {
    this.buffer = '';
    void saveSession(this.record());
  }
}

export class SocketTerminalBackend extends SimpleTerminalBackend {
  constructor() {
    super();
    this.setReady();
  }

  getDefaultSystemShell = async (): Promise<string> => '/bin/bash';

  createProcess = async (
    _shellLaunchConfig: unknown,
    cwd: string,
    cols: number,
    rows: number,
    ..._rest: unknown[]
  ): Promise<ITerminalChildProcess> => {
    const restore = restoreQueue.shift();
    const id = nextProcessId++;
    const persistentId =
      restore?.id ?? (crypto.randomUUID?.() ?? `term_${id}_${Date.now()}`);
    const data = new vscode.EventEmitter<string>();
    return new SocketTerminalProcess(
      id,
      persistentId,
      restore?.cwd || cwd || '/',
      cols,
      rows,
      data,
      restore,
    );
  };
}

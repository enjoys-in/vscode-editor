import { io, type Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// SFTP Socket Client — connects to backend /sftp namespace
//
// Wraps Socket.IO events from the backend SFTP module.
// Each instance represents one SFTP panel/tab session.
// ---------------------------------------------------------------------------

// Socket.IO event constants (must match backend SocketEventConstants)
const E = {
  // Client → Server
  CONNECT: '@@SFTP_CONNECT',
  GET_FILE: '@@SFTP_GET_FILE',
  RENAME: '@@SFTP_RENAME_FILE',
  MOVE: '@@SFTP_MOVE_FILE',
  COPY: '@@SFTP_COPY_FILE',
  DELETE_FILE: '@@SFTP_DELETE_FILE',
  DELETE_DIR: '@@SFTP_DELETE_DIR',
  CREATE_FILE: '@@SFTP_CREATE_FILE',
  CREATE_DIR: '@@SFTP_CREATE_DIR',
  EXISTS: '@@SFTP_EXISTS',
  FILE_STATS: '@@SFTP_FILE_STATS',
  EDIT_FILE_REQUEST: '@@SFTP_EDIT_FILE_REQUEST',
  EDIT_FILE_DONE: '@@SFTP_EDIT_FILE_DONE',
  GET_DIR_TREE: '@@SFTP_GET_DIR_TREE',

  // Server → Client
  READY: '@@SFTP_READY',
  CURRENT_PATH: '@@SFTP_CURRENT_PATH',
  FILES_LIST: '@@SFTP_FILES_LIST',
  DIR_TREE: '@@SFTP_DIR_TREE',
  EMIT_ERROR: '@@SFTP_EMIT_ERROR',
  ENDED: '@@SFTP_ENDED',
  EDIT_FILE_RESPONSE: '@@SFTP_EDIT_FILE_REQUEST_RESPONSE',
  FILE_STATS_RESPONSE: '@@SFTP_FILE_STATS',
  SUCCESS: '@@SUCCESS',
  ERROR: '@@ERROR',
} as const;

export interface SftpFileEntry {
  name: string;
  type: string; // "d" | "-" | "l"
  size: number;
  modifyTime: number;
  accessTime: number;
  rights: { user: string; group: string; other: string };
  owner: number;
  group: number;
  longname: string;
}

export interface SftpConnectOptions {
  host: string;
  port?: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  password?: string;
  privateKeyText?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null;
}

export type SftpEventHandler = (...args: any[]) => void;

export class SftpSocket {
  private socket: Socket;
  private _ready = false;
  private _currentPath = '';

  constructor(serverUrl: string, sessionId: string, sftpSessionId?: string) {
    this.socket = io(`${serverUrl}/sftp`, {
      query: {
        sessionId,
        sftpSessionId: sftpSessionId ?? sessionId,
      },
    });

    this.socket.on(E.READY, () => {
      this._ready = true;
    });

    this.socket.on(E.CURRENT_PATH, (path: string) => {
      this._currentPath = path;
    });
  }

  get ready() { return this._ready; }
  get currentPath() { return this._currentPath; }
  get connected() { return this.socket.connected; }

  // --- Connection ---

  connect(opts?: SftpConnectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onError = (msg: string) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        this.socket.off(E.READY, onReady);
        this.socket.off(E.EMIT_ERROR, onError);
      };
      this.socket.on(E.READY, onReady);
      this.socket.on(E.EMIT_ERROR, onError);
      this.socket.emit(E.CONNECT, opts ?? {});
    });
  }

  // --- Directory listing ---

  listDir(dirPath?: string): Promise<{ files: SftpFileEntry[]; currentDir: string }> {
    return new Promise((resolve, reject) => {
      const onList = (data: { files: string; currentDir: string }) => {
        cleanup();
        resolve({ files: JSON.parse(data.files), currentDir: data.currentDir });
      };
      const onError = (msg: string) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        this.socket.off(E.FILES_LIST, onList);
        this.socket.off(E.ERROR, onError);
      };
      this.socket.on(E.FILES_LIST, onList);
      this.socket.on(E.ERROR, onError);
      this.socket.emit(E.GET_FILE, dirPath ? { dirPath } : {});
    });
  }

  // --- Directory tree ---

  getDirTree(dirPath?: string, depth?: number): Promise<{ root: TreeNode; dirPath: string; depth: number }> {
    return new Promise((resolve, reject) => {
      const onTree = (data: { root: TreeNode; dirPath: string; depth: number }) => {
        cleanup();
        resolve(data);
      };
      const onError = (msg: string) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        this.socket.off(E.DIR_TREE, onTree);
        this.socket.off(E.ERROR, onError);
      };
      this.socket.on(E.DIR_TREE, onTree);
      this.socket.on(E.ERROR, onError);
      this.socket.emit(E.GET_DIR_TREE, { dirPath, depth });
    });
  }

  // --- File operations ---

  createFile(filePath: string): Promise<void> {
    return this._emitAndWait(E.CREATE_FILE, { filePath });
  }

  createDir(folderPath: string): Promise<void> {
    return this._emitAndWait(E.CREATE_DIR, { folderPath });
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this._emitAndWait(E.RENAME, { oldPath, newPath });
  }

  move(oldPath: string, newPath: string): Promise<void> {
    return this._emitAndWait(E.MOVE, { oldPath, newPath });
  }

  copy(currentPath: string, destinationPath: string): Promise<void> {
    return this._emitAndWait(E.COPY, { currentPath, destinationPath });
  }

  deleteFile(path: string): Promise<void> {
    return this._emitAndWait(E.DELETE_FILE, { path });
  }

  deleteDir(path: string): Promise<void> {
    return this._emitAndWait(E.DELETE_DIR, { path });
  }

  // --- File edit ---

  readFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const onResponse = (content: string) => { cleanup(); resolve(content); };
      const onError = (msg: string) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        this.socket.off(E.EDIT_FILE_RESPONSE, onResponse);
        this.socket.off(E.ERROR, onError);
      };
      this.socket.on(E.EDIT_FILE_RESPONSE, onResponse);
      this.socket.on(E.ERROR, onError);
      this.socket.emit(E.EDIT_FILE_REQUEST, { path });
    });
  }

  writeFile(path: string, content: string): Promise<void> {
    return this._emitAndWait(E.EDIT_FILE_DONE, { path, content });
  }

  // --- File stats ---

  stat(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const onStats = (stats: any) => { cleanup(); resolve(stats); };
      const onError = (msg: string) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        this.socket.off(E.FILE_STATS_RESPONSE, onStats);
        this.socket.off(E.ERROR, onError);
      };
      this.socket.on(E.FILE_STATS_RESPONSE, onStats);
      this.socket.on(E.ERROR, onError);
      this.socket.emit(E.FILE_STATS, { path });
    });
  }

  // --- Event listeners ---

  on(event: string, handler: SftpEventHandler): void {
    this.socket.on(event, handler);
  }

  off(event: string, handler: SftpEventHandler): void {
    this.socket.off(event, handler);
  }

  // --- Cleanup ---

  disconnect(): void {
    this.socket.disconnect();
    this._ready = false;
  }

  // --- Internal ---

  private _emitAndWait(event: string, payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const onSuccess = () => { cleanup(); resolve(); };
      const onError = (msg: string) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        this.socket.off(E.SUCCESS, onSuccess);
        this.socket.off(E.ERROR, onError);
      };
      this.socket.on(E.SUCCESS, onSuccess);
      this.socket.on(E.ERROR, onError);
      this.socket.emit(event, payload);
    });
  }
}

import type { Plugin, PluginContext, Disposable } from '@core/types';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';
import { SftpSocket, type SftpFileEntry } from './sftp-socket';
import { API_CONFIG, apiUrl } from './config';

// ---------------------------------------------------------------------------
// API File Reader Plugin
//
// Handles two modes based on URL query ?path=:
//   1. File path (has extension) → fetch via POST /api/file/read, open in editor
//   2. Directory path → fetch listing via POST /api/files, populate explorer
//
// Also connects Socket.IO to /sftp for real-time file operations
// (create, rename, delete, etc.)
// ---------------------------------------------------------------------------

export interface ApiFileReaderOptions {
  basePath?: string;
}

interface ApiResponse {
  status: boolean;
  message: string;
  result: any;
}

interface FilesApiResponse {
  status: boolean;
  message: string;
  result: {
    currentDir: string;
    files: SftpFileEntry[];
  };
}

function isFilePath(p: string): boolean {
  const last = p.split('/').pop() || '';
  return last.includes('.') && !last.startsWith('.');
}

export function createApiFileReaderPlugin(options?: ApiFileReaderOptions): Plugin {
  const disposables: Disposable[] = [];
  const basePath = options?.basePath ?? '/workspace';
  const apiBase = API_CONFIG.baseUrl;

  return {
    id: 'builtin.api-file-reader',
    name: 'API File Reader',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const fsProvider = new RegisteredFileSystemProvider(false);
      const overlay = registerFileSystemOverlay(2, fsProvider);
      disposables.push(overlay);

      // Read query params
      const params = new URLSearchParams(window.location.search);
      const remotePath = params.get('path');
      const sessionId = params.get('tabId') ?? '';
      const user = params.get('user') ?? '';

      if (!remotePath) {
        console.log('[ApiFileReader] No ?path= query param, skipping');
        return;
      }

      // Map remote path → virtual FS path for save interception
      const remoteToVirtual = new Map<string, string>();

      // Connect Socket.IO for file operations
      const sftp = new SftpSocket(apiBase, sessionId);
      disposables.push({ dispose: () => sftp.disconnect() });

      // Decide: file or directory
      if (isFilePath(remotePath)) {
        console.log('[ApiFileReader] Loading file:', remotePath);
        loadFile(remotePath, sessionId).catch((err) => {
          console.error('[ApiFileReader] Load failed:', err);
          ctx.vscode.window.showErrorMessage(`Failed to load file: ${err.message}`);
        });
      } else {
        console.log('[ApiFileReader] Loading directory:', remotePath);
        loadDirectory(remotePath, sessionId).catch((err) => {
          console.error('[ApiFileReader] Dir load failed:', err);
          ctx.vscode.window.showErrorMessage(`Failed to load directory: ${err.message}`);
        });
      }

      // -------------------------------------------------------------------
      // Fetch single file via REST
      // -------------------------------------------------------------------

      async function parseApiError(res: Response): Promise<string> {
        try {
          const data = await res.json();
          return data.message || `API error ${res.status}`;
        } catch {
          return `API error ${res.status}`;
        }
      }

      async function fetchFile(filePath: string, sid: string): Promise<string> {
        const res = await fetch(apiUrl('fileRead'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, path: filePath }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        const data: ApiResponse = await res.json();
        if (!data.status) throw new Error(data.message || 'File read failed');
        return data.result;
      }

      // -------------------------------------------------------------------
      // Load single file into virtual FS and open in editor
      // -------------------------------------------------------------------

      async function loadFile(filePath: string, sid: string): Promise<void> {
        const content = await fetchFile(filePath, sid);
        const fileName = filePath.split('/').pop() || 'file';
        const vsPath = `${basePath}/${fileName}`;
        const uri = ctx.vscode.Uri.file(vsPath);

        remoteToVirtual.set(vsPath, filePath);

        try {
          fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
        } catch { /* already registered */ }

        const doc = await ctx.vscode.workspace.openTextDocument(uri);
        await ctx.vscode.window.showTextDocument(doc);
        console.log('[ApiFileReader] Opened:', vsPath);
      }

      // -------------------------------------------------------------------
      // Load directory listing via REST POST /api/files
      // -------------------------------------------------------------------

      async function loadDirectory(dirPath: string, sid: string): Promise<void> {
        const res = await fetch(apiUrl('fileList'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sftpSessionId: sid, path: dirPath }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        const data: FilesApiResponse = await res.json();
        if (!data.status) throw new Error(data.message || 'Directory listing failed');

        const { files, currentDir } = data.result;
        console.log('[ApiFileReader] Directory:', currentDir, `(${files.length} entries)`);

        // Register directories first, then files
        for (const entry of files) {
          const vsPath = `${basePath}/${entry.name}`;
          const uri = ctx.vscode.Uri.file(vsPath);
          const entryRemotePath = `${currentDir}/${entry.name}`.replace(/\/+/g, '/');

          if (entry.type === 'd') {
            // Register directory as empty (lazy — loaded on demand)
            try {
              fsProvider.registerFile(new RegisteredMemoryFile(uri, ''));
            } catch { /* already registered */ }
          } else if (entry.type === '-') {
            // Register file placeholder (content loaded on open)
            remoteToVirtual.set(vsPath, entryRemotePath);
            try {
              fsProvider.registerFile(new RegisteredMemoryFile(uri, ''));
            } catch { /* already registered */ }
          }
        }

        // Auto-open the first file
        const firstFile = files.find(f => f.type === '-');
        if (firstFile) {
          const firstRemote = `${currentDir}/${firstFile.name}`.replace(/\/+/g, '/');
          await loadFileContent(firstRemote, `${basePath}/${firstFile.name}`, sid);
        }
      }

      // -------------------------------------------------------------------
      // Load file content into an already-registered virtual file
      // -------------------------------------------------------------------

      async function loadFileContent(remoteFP: string, vsPath: string, sid: string): Promise<void> {
        const content = await fetchFile(remoteFP, sid);
        const uri = ctx.vscode.Uri.file(vsPath);

        // Re-register with actual content
        try {
          fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
        } catch { /* already registered — update via edit */ }

        const doc = await ctx.vscode.workspace.openTextDocument(uri);
        await ctx.vscode.window.showTextDocument(doc);
        console.log('[ApiFileReader] Opened:', vsPath);
      }

      // -------------------------------------------------------------------
      // Save file back to remote via REST
      // -------------------------------------------------------------------

      async function saveFile(filePath: string, sid: string, content: string): Promise<void> {
        const res = await fetch(apiUrl('fileWrite'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, path: filePath, content }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        const data: ApiResponse = await res.json();
        if (!data.status) throw new Error(data.message || 'File write failed');
      }

      // Intercept save — resolve virtual path to remote path and push
      disposables.push(
        ctx.vscode.workspace.onWillSaveTextDocument((e) => {
          const doc = e.document;
          const remoteFilePath = remoteToVirtual.get(doc.uri.path);

          if (remoteFilePath) {
            e.waitUntil(
              saveFile(remoteFilePath, sessionId, doc.getText())
                .then(() => {
                  console.log('[ApiFileReader] Saved:', remoteFilePath);
                  return [] as any;
                })
                .catch((err) => {
                  console.error('[ApiFileReader] Save failed:', err);
                  ctx.vscode.window.showErrorMessage(`Save failed: ${err.message}`);
                  return [] as any;
                }),
            );
          }
        }),
      );

      // -------------------------------------------------------------------
      // Expose services
      // -------------------------------------------------------------------

      ctx.services.register('apiFileReader', {
        loadFile: (path: string, sid?: string) => loadFile(path, sid ?? sessionId),
        loadDirectory: (path: string, sid?: string) => loadDirectory(path, sid ?? sessionId),
        fetchFile: (path: string, sid?: string) => fetchFile(path, sid ?? sessionId),
        saveFile: (path: string, content: string, sid?: string) => saveFile(path, sid ?? sessionId, content),
        sftp,
      });
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

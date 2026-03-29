import type { Plugin, PluginContext, Disposable } from '@core/types';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';

// ---------------------------------------------------------------------------
// API File Reader Plugin
//
// Reads a remote file via POST /api/file/read using:
//   - sessionId from URL query ?tabId= (or defaults to empty)
//   - path from URL query ?path=
//
// On activation, fetches the file and loads it into the virtual filesystem
// so explorer, editor, search all work.
// ---------------------------------------------------------------------------

export interface ApiFileReaderOptions {
  /** Base URL for the API (default: same origin) */
  apiBase?: string;
  /** Base path inside the virtual FS (default: /workspace) */
  basePath?: string;
}

interface ApiResponse {
  status: boolean;
  message: string;
  result: string;
}

export function createApiFileReaderPlugin(options?: ApiFileReaderOptions): Plugin {
  const disposables: Disposable[] = [];
  const basePath = options?.basePath ?? '/workspace';
  const apiBase = options?.apiBase ?? '';

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

      if (!remotePath) {
        console.log('[ApiFileReader] No ?path= query param, skipping auto-load');
        return;
      }

      // Auto-load on activation
      console.log('[ApiFileReader] Loading file:', remotePath);
      loadFile(remotePath, sessionId).catch((err) => {
        console.error('[ApiFileReader] Load failed:', err);
        ctx.vscode.window.showErrorMessage(`Failed to load file: ${err.message}`);
      });

      // -------------------------------------------------------------------
      // Fetch a single file from the API
      // -------------------------------------------------------------------

      async function fetchFile(filePath: string, sid: string): Promise<string> {
        const res = await fetch(`${apiBase}/api/file/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, path: filePath }),
        });

        if (!res.ok) {
          throw new Error(`API returned ${res.status}: ${await res.text()}`);
        }

        const data: ApiResponse = await res.json();
        if (!data.status) {
          throw new Error(data.message || 'File read failed');
        }

        return data.result;
      }

      // -------------------------------------------------------------------
      // Load a file into the virtual FS and open it
      // -------------------------------------------------------------------

      async function loadFile(filePath: string, sid: string): Promise<void> {
        const content = await fetchFile(filePath, sid);
        const fileName = filePath.split('/').pop() || 'file';
        const vsPath = `${basePath}/${fileName}`;
        const uri = ctx.vscode.Uri.file(vsPath);

        try {
          fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
        } catch {
          // File already registered
        }

        const doc = await ctx.vscode.workspace.openTextDocument(uri);
        await ctx.vscode.window.showTextDocument(doc);
        console.log('[ApiFileReader] Opened:', vsPath);
      }

      // -------------------------------------------------------------------
      // Save file back to remote via API
      // -------------------------------------------------------------------

      async function saveFile(filePath: string, sid: string, content: string): Promise<void> {
        const res = await fetch(`${apiBase}/api/file/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, path: filePath, content }),
        });

        if (!res.ok) {
          throw new Error(`API returned ${res.status}: ${await res.text()}`);
        }

        const data: ApiResponse = await res.json();
        if (!data.status) {
          throw new Error(data.message || 'File write failed');
        }
      }

      // Intercept save — when the document is saved, push content to the API
      disposables.push(
        ctx.vscode.workspace.onWillSaveTextDocument((e) => {
          const doc = e.document;
          const fileName = remotePath!.split('/').pop() || 'file';
          const expectedPath = `${basePath}/${fileName}`;

          if (doc.uri.path === expectedPath) {
            e.waitUntil(
              saveFile(remotePath!, sessionId, doc.getText())
                .then(() => {
                  console.log('[ApiFileReader] Saved:', remotePath);
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
      // Expose service for manual use
      // -------------------------------------------------------------------

      ctx.services.register('apiFileReader', {
        loadFile: (path: string, sid?: string) =>
          loadFile(path, sid ?? sessionId),
        fetchFile: (path: string, sid?: string) =>
          fetchFile(path, sid ?? sessionId),
        saveFile: (path: string, content: string, sid?: string) =>
          saveFile(path, sid ?? sessionId, content),
      });

      // -------------------------------------------------------------------
      // Command for manual load
      // -------------------------------------------------------------------

      disposables.push(
        ctx.registerCommand('apiFileReader.load', async () => {
          const path = await ctx.vscode.window.showInputBox({
            prompt: 'Remote file path to load',
            value: remotePath ?? '',
          });
          if (path) {
            await loadFile(path, sessionId);
          }
        }),
      );
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
